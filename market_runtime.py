"""Bounded TDX collection, visible progress and persistent history."""
import copy
import datetime as dt
import json
import logging
import math
import hashlib
import base64
import re
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from local_history import LocalHistoryStore, full_code
from tdx_api_client import TdxAPIClient
from batch_analysis import BatchAnalysis
from v2_results import V2Results

VERSION = '1.6.0'
SHANGHAI = dt.timezone(dt.timedelta(hours=8))
BASE = Path(getattr(sys, '_MEIPASS', Path(__file__).parent))


def now():
    return dt.datetime.now(SHANGHAI).isoformat(timespec='seconds')


def parse_bridge(stdout):
    for line in reversed(stdout.decode('utf-8', errors='replace').splitlines()):
        if line.lstrip().startswith(('{', '[')):
            try:
                return json.loads(line)
            except ValueError:
                continue
    raise ValueError('bridge did not return JSON')


def safe_bridge(command, timeout):
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
    result = subprocess.run(command, capture_output=True, timeout=timeout, creationflags=flags)
    if result.returncode:
        raise RuntimeError(f'bridge exit={result.returncode}: {result.stderr[-500:]!r}')
    return result


def number(value, default=0):
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (ValueError, TypeError):
        return default


def normalize_market(payload):
    rows = {}
    for raw in payload.get('rows') or []:
        code = str(raw.get('code', '')).removeprefix('sh').removeprefix('sz').removeprefix('bj')
        price = number(raw.get('price'))
        if len(code) != 6 or not code.isdigit() or price <= 0:
            continue
        previous = number(raw.get('previous_close', raw.get('last_close')))
        change = number(raw.get('change_percent', raw.get('change')),
                        (price / previous - 1) * 100 if previous else 0)
        rows[code] = dict(code=code, name=str(raw.get('name') or code), price=price,
                          previous_close=previous, change=change, volume=number(raw.get('volume')),
                          amount=number(raw.get('amount')), server_time=raw.get('server_time'))
    if not rows:
        raise ValueError('empty market response')
    return dict(ok=True, source=payload.get('source') or 'TDX 归一化报价', total_codes=max(len(rows), int(payload.get('total_codes') or 0)),
                total_quotes=len(rows), rows=list(rows.values()), received_at=now(), cached=False)


def normalize_bars(rows, count):
    """Validate available candles; indicator warm-up belongs to scoring, not storage."""
    valid = {}
    for row in rows or []:
        date = str(row.get('date', ''))[:10]
        try:
            dt.date.fromisoformat(date)
        except ValueError:
            continue
        values = {key: number(row.get(key), float('nan')) for key in ('open', 'high', 'low', 'close', 'volume')}
        if any(not math.isfinite(value) for value in values.values()):
            continue
        if min(values[key] for key in ('open', 'high', 'low', 'close')) <= 0 or values['volume'] < 0:
            continue
        if values['high'] < max(values['open'], values['close']) or values['low'] > min(values['open'], values['close']):
            continue
        valid[date] = dict(date=date, **values)
    bars = [valid[date] for date in sorted(valid)][-count:]
    if not bars:
        raise ValueError(f'only {len(bars)} valid daily bars')
    for index, bar in enumerate(bars):
        bar['prevClose'] = bars[index - 1]['close'] if index else bar['close']
    return bars


class MarketAPI:
    def __init__(self, data_dir=None, candidate_limit=16, history_count=1200, refresh_seconds=60):
        self.data_dir = Path(data_dir or Path(os.getenv('LOCALAPPDATA', str(Path.home()))) / 'LiangCe' / 'data-v1')
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.log = logging.getLogger(f'liangce.{id(self)}')
        self.log.setLevel(logging.INFO)
        handler = logging.FileHandler(self.data_dir / 'market.log', encoding='utf-8')
        handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
        self.log.addHandler(handler)
        self.limit = max(1, min(50, int(candidate_limit)))
        self.history_count = max(100, min(8000, int(history_count)))
        self.refresh_seconds = max(10, int(refresh_seconds))
        self.tdx = TdxAPIClient(os.getenv('LIANGCE_TDX_API_URL', 'http://127.0.0.1:18780'))
        self.local = LocalHistoryStore()
        self.v2_results = V2Results()
        self.service_process = None
        self.service_log = None
        self.http_history_lock = threading.Lock()
        self.service_lock = threading.Lock()
        self.history_locks = {}
        self.market_day = None
        self.market_day_checked = 0
        self.history_memory = {}
        self.lock = threading.RLock()
        self.wake = threading.Event()
        self.stop_event = threading.Event()
        self.thread = None
        self.state = dict(version=VERSION, phase='waiting', message='等待启动数据采集',
                          market_version=0, history_version=0, market=None, histories=[],
                          progress=dict(done=0, total=0, failed=0), last_error=None,
                          next_refresh_at=None, cycle=0, history_failures=[])
        cached = self._read('market.json')
        if cached and cached.get('rows'):
            cached['cached'] = True
            self.state.update(market=cached, market_version=1, message='已恢复上次行情，正在重新连接')
        # Only load detailed candles on demand; the full-market compact results
        # resume separately without transferring millions of bars to the renderer.
        paths=sorted(self.data_dir.glob('daily-*.json'),key=lambda path:path.stat().st_mtime,reverse=True)[:self.limit]
        restored=[]
        for path in paths:
            history=self._read(path.name)
            try:
                if not history:continue
                history['bars']=normalize_bars(history['bars'],self.history_count)
                history.update(cached=True,history_freshness='cache_unverified',first_date=history['bars'][0]['date'],last_date=history['bars'][-1]['date'])
                restored.append(history)
            except (KeyError,ValueError,TypeError):continue
        if restored:self.state.update(histories=restored,history_version=1)
        self.batch=BatchAnalysis(self,normalize_bars,BASE,SHANGHAI)

    def _read(self, filename):
        try:
            return json.loads((self.data_dir / filename).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return None

    def _write(self, filename, data):
        target = self.data_dir / filename
        temporary = target.with_name(target.name + '.' + str(threading.get_ident()) + '.tmp')
        temporary.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False), encoding='utf-8')
        temporary.replace(target)

    def _update(self, **values):
        with self.lock:
            self.state.update(values)

    def scan_auto(self, endpoint=None, host=None, port=7709):
        self._ensure_tdx_api()
        def progress(done, total, quotes, failed):
            self._update(phase='scanning', message=f'tdx-api 批量报价 {done}/{total} · 已获得 {quotes} 只',
                         quote_progress=dict(done=done, total=total, quotes=quotes, failed_batches=failed))
        result = self.tdx.scan(progress)
        result['server'] = self.tdx.base_url
        return result

    def _ensure_tdx_api(self):
        with self.service_lock:
            self._start_tdx_api()

    def _start_tdx_api(self):
        def healthy():
            try:
                with urllib.request.urlopen(self.tdx.base_url + '/api/health', timeout=1) as response:
                    return json.load(response).get('status') == 'healthy'
            except (OSError, ValueError):
                return False
        if healthy():
            return
        parsed = urllib.parse.urlparse(self.tdx.base_url)
        service = Path(os.getenv('LIANGCE_TDX_BINARY', str(BASE / ('tdx-api-service.exe' if sys.platform == 'win32' else 'tdx-api-service'))))
        if parsed.hostname not in ('127.0.0.1', 'localhost') or not service.exists():
            raise RuntimeError('configured tdx-api service is unavailable')
        self._update(phase='connecting', message='正在启动 tdx-api，并自动检测行情连接…')
        if self.service_process is None or self.service_process.poll() is not None:
            directory = self.data_dir / 'tdx-api-state'
            directory.mkdir(exist_ok=True)
            environment = os.environ.copy()
            environment['LIANGCE_QUOTES_ONLY'] = '1'
            environment['LIANGCE_TDX_LISTEN'] = parsed.netloc
            self.service_log = (self.data_dir / 'tdx-api.log').open('ab')
            self.service_process = subprocess.Popen([str(service)], cwd=directory, env=environment,
                stdout=self.service_log, stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
        deadline = time.monotonic() + 80
        while time.monotonic() < deadline and not self.stop_event.is_set():
            if healthy():
                return
            if self.service_process.poll() is not None:
                raise RuntimeError('tdx-api exited during startup')
            time.sleep(0.5)
        raise TimeoutError('tdx-api startup timed out')

    def fetch_bars(self, host, port, code, category=9, count=1200):
        code, count = str(code), max(100, min(8000, int(count)))
        if not code.isdigit() or len(code) != 6 or int(category) != 9:
            raise ValueError('six digit stock code and daily category required')
        with self.http_history_lock:
            bars = normalize_bars(self.tdx.history(full_code(code), count), count)
        return dict(ok=True, code=code, bars=bars, source='tdx-api 历史日线', adjusted=False, volume_unit='hands',
                    received_at=now(), first_date=bars[0]['date'], last_date=bars[-1]['date'], cached=False)

    def _reference_market_day(self):
        if self.market_day and time.monotonic() - self.market_day_checked < 300:
            return self.market_day
        try:
            with self.http_history_lock:
                # This endpoint decodes stock bars; an index uses a different frame.
                rows = self.tdx.history('sz000001', 2)
            latest = max(row['date'] for row in rows)
            dt.date.fromisoformat(latest)
            if latest > dt.datetime.now(SHANGHAI).date().isoformat():
                raise ValueError('reference date cannot be in the future')
            self.market_day, self.market_day_checked = latest, time.monotonic()
            return latest
        except Exception:
            self.log.warning('reference market day unavailable')
            return None

    def _resolve_history(self, code, count, name, force=False):
        with self.lock:
            guard = self.history_locks.setdefault(code, threading.Lock())
        with guard:
            cached = self.history_memory.get(code) or self._read(f'daily-{code}.json')
            if cached and not force:
                try:
                    checked = dt.datetime.fromisoformat(cached.get('checked_at', ''))
                    clock = dt.datetime.now(SHANGHAI)
                    age = (clock - checked).total_seconds()
                    if (cached.get('history_freshness') in ('verified', 'market_lag')
                            and checked.date() == clock.date() and 0 <= age < 60
                            and (cached.get('market_last_date') or '') <= clock.date().isoformat()
                            and cached.get('requested_count', 0) >= count):
                        result = copy.deepcopy(cached)
                        result['cached'] = True
                        result['bars'] = normalize_bars(result['bars'], count)
                        result['first_date'] = result['bars'][0]['date']
                        return result
                except (ValueError, TypeError):
                    pass
            start = time.monotonic()
            try:
                self._ensure_tdx_api()
                result = self.fetch_bars(self.tdx.base_url, 7709, code, 9, count)
                if cached and cached.get('bars') and result['last_date'] < cached['bars'][-1]['date']:
                    raise ValueError('remote history is older than saved history')
                market_day = self._reference_market_day()
                result.update(name=name, checked_at=now(), requested_count=count,
                              history_freshness='market_lag' if market_day and result['last_date'] < market_day else 'verified',
                              market_last_date=market_day, cached=False,
                              history_note='已向行情源核验个股最新日线')
                if result['history_freshness'] == 'market_lag':
                    result['history_note'] = '个股最新可得日线早于市场日线，可能停牌或源端未更新'
            except Exception:
                self.log.exception('live history refresh failed code=%s', code)
                local = self.local.read(code, count)
                with self.lock:
                    loaded = next((item for item in self.state['histories'] if item['code'] == code), None)
                options = [item for item in (cached, local, loaded) if item and item.get('bars')]
                if not options:
                    raise
                result = copy.deepcopy(max(options, key=lambda item: item['bars'][-1]['date']))
                result['bars'] = normalize_bars(result['bars'], count)
                result.update(ok=True, name=name, cached=True, history_freshness='stale_fallback',
                              history_note='最新日线更新失败，暂用旧历史；请重试',
                              warning='最新日线更新失败，暂用旧历史', last_attempt_at=now())
                # A failed request never makes an old cache newly verified.
                result.pop('checked_at', None)
                result.update(first_date=result['bars'][0]['date'], last_date=result['bars'][-1]['date'])
            result['load_ms'] = round((time.monotonic() - start) * 1000)
            result['code'] = code
            result['score_ready'] = len(result['bars']) >= 100
            result['score_min_bars'] = 100
            if not result['score_ready']:
                result['history_note'] += f" · 已获取 {len(result['bars'])} 根，评分需累计100根"
            self._write(f'daily-{code}.json', result)
            self.history_memory[code] = copy.deepcopy(result)
            return result

    def _history(self, item, server, force=False):
        return self._resolve_history(item['code'], self.history_count, item['name'], force)

    def run_cycle(self):
        self._update(phase='scanning', message='正在获取沪深京全市场报价…', next_refresh_at=None,
                     last_error=None, progress=dict(done=0, total=0, failed=0))
        market = self.scan_auto()
        self._write('market.json', market)
        with self.lock:
            self.state.update(market=market, market_version=self.state['market_version'] + 1)
        with self.lock:
            self.state['cycle'] += 1
        self._update(phase='ready',message=f"全市场 {market['total_quotes']} 只报价已更新；后台自动评分",
                     next_refresh_at=(dt.datetime.now(SHANGHAI)+dt.timedelta(seconds=self.refresh_seconds)).isoformat(timespec='seconds'))
        self.batch.wake.set()

    def _worker(self):
        while not self.stop_event.is_set():
            self.wake.clear()
            try:
                self.run_cycle()
            except Exception as error:
                self.log.exception('collection cycle failed')
                self._update(phase='retry', message='本次数据获取未完成，保留已有数据，60 秒后重试',
                             last_error=type(error).__name__,
                             next_refresh_at=(dt.datetime.now(SHANGHAI) + dt.timedelta(seconds=self.refresh_seconds)).isoformat(timespec='seconds'))
            self.wake.wait(self.refresh_seconds)

    def start_background(self):
        with self.lock:
            if self.thread is None or not self.thread.is_alive():
                self.thread = threading.Thread(target=self._worker, daemon=True, name='liangce-market')
                self.thread.start()
        return dict(ok=True, version=VERSION)

    def refresh_data(self):
        self.start_background()
        self.wake.set()
        return dict(ok=True)

    def get_state(self, market_version=-1, history_version=-1):
        with self.lock:
            state = {key: value for key, value in self.state.items() if key not in ('market', 'histories')}
            if int(market_version) != self.state['market_version']:
                state['market'] = self.state['market']
            if int(history_version) != self.state['history_version']:
                state['histories'] = self.state['histories']
            state['batch_analysis']=self.batch.snapshot()
            return copy.deepcopy(state)

    def configure_analysis(self, params):
        return self.batch.configure(params)

    def get_analysis_batch(self, generation=-1, issues_version=-1):
        return self.batch.poll(generation,issues_version)

    def complete_analysis_batch(self, run_id, token, results, errors):
        return self.batch.acknowledge(run_id,token,results,errors)

    def control_analysis(self, action):
        return self.batch.control(action)

    def get_analysis_issues(self, offset=0):
        return self.batch.issues(offset)

    def get_history(self, code):
        with self.lock:
            for history in self.state['histories']:
                if history['code'] == str(code):
                    return copy.deepcopy(history)
        return dict(ok=False)

    def list_v2_jobs(self, source_id=None):
        return self.v2_results.jobs(source_id)

    def get_v2_task_stocks(self, source_id, job_id, query='', offset=0):
        return self.v2_results.stocks(source_id,job_id,query,offset)

    def get_v2_task_result(self, source_id, job_id, symbol, period='day'):
        return self.v2_results.result(source_id,job_id,symbol,period)

    def get_chart_history(self, code, count=1200, force=False):
        code = str(code).strip()
        if len(code) != 6 or not code.isdigit():
            return dict(ok=False, message='请输入六位股票代码')
        with self.lock:
            name = next((row['name'] for row in (self.state.get('market') or {}).get('rows', []) if row['code'] == code), code)
        try:
            count = max(100, min(8000, int(count)))
            result = self._resolve_history(code, count, name, bool(force))
            raw = json.dumps(result['bars'], sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
            result['input_sha256'] = hashlib.sha256(raw).hexdigest()
            with self.lock:
                items = {item['code']: item for item in self.state['histories']}
                items[code] = copy.deepcopy(result)
                self.state['histories'] = list(items.values())
                self.state['history_version'] += 1
            return result
        except Exception:
            self.log.exception('chart history unavailable code=%s', code)
            return dict(ok=False, message='该股票历史暂不可用，请稍后重试')

    def save_chart_export(self, filename, encoded):
        filename = str(filename)
        if not re.fullmatch(r'liangce-[A-Za-z0-9_.-]+\.(png|csv|json)', filename) or len(filename) > 160:
            return dict(ok=False, message='导出文件名无效')
        try:
            if len(encoded) > 20_000_000:
                raise ValueError('export too large')
            data = base64.b64decode(encoded, validate=True)
            if filename.endswith('.png') and not data.startswith(b'\x89PNG\r\n\x1a\n'):
                raise ValueError('invalid PNG')
            if filename.endswith('.json'):
                json.loads(data.decode('utf-8-sig'))
            directory = self.data_dir.parent / 'exports'
            directory.mkdir(parents=True, exist_ok=True)
            path = directory / filename
            if path.exists():
                path = directory / (path.stem + '-' + dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f') + path.suffix)
            with path.open('xb') as stream:
                stream.write(data)
            return dict(ok=True, filename=path.name, path=str(path), bytes=len(data))
        except (ValueError, OSError):
            self.log.exception('chart export save failed filename=%s', filename)
            return dict(ok=False, message='文件未保存，请稍后重试')

    def open_chart_exports(self):
        directory = self.data_dir.parent / 'exports'
        directory.mkdir(parents=True, exist_ok=True)
        if sys.platform == 'win32':
            os.startfile(str(directory))
        return dict(ok=True)

    def get_research_report(self):
        try:
            report = json.loads((BASE / 'research-summary.json').read_text(encoding='utf-8'))
            report['engine_record_matches_current'] = report.get('engine_sha256') == hashlib.sha256((BASE / 'chanlun.js').read_bytes()).hexdigest()
            if not report['engine_record_matches_current']:
                report['scope_note'] = '以下为旧版结构算法的历史核验记录；当前版本已增加二/三类上下文校验和候选状态复核，旧版方向统计不代表当前版本表现。'
            latest = BASE / 'signal-validation-summary.json'
            if latest.exists():
                report['latest_signal_validation'] = json.loads(latest.read_text(encoding='utf-8'))
            return report
        except (OSError, ValueError):
            return dict(status='unavailable', message='本地缠论核验报告尚未生成')

    def close(self):
        self.stop_event.set()
        self.wake.set()
        self.batch.close()
        if self.service_process is not None and self.service_process.poll() is None:
            self.service_process.terminate()
        if self.service_log:
            self.service_log.close()
