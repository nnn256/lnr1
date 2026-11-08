"""Bounded full-universe history queue with acknowledged, resumable score results."""
import copy
import datetime as dt
import hashlib
import json
import threading
import time
import uuid
from pathlib import Path

class BatchAnalysis:
    def __init__(self, api, normalize, base, timezone):
        self.api,self.normalize,self.base,self.timezone=api,normalize,Path(base),timezone
        self.lock=threading.RLock()
        self.wake=threading.Event()
        self.stop=threading.Event()
        self.params=None
        self.key=None
        self.token=None
        self.pending=None
        self.results={}
        self.failures={}
        self.items=[]
        self.paused=False
        self.started=time.monotonic()
        self.finished_elapsed=None
        self.restored=0
        self.thread=None
        self.message='等待全市场报价'
        self.phase='waiting'
        self.generation=0
        self.last_reference=None
        self.last_context_check=0
        self.market_version=-1
        self.force_codes=set()
        self.fetch_epoch=0
        self.issues_version=0

    def configure(self, params):
        if not isinstance(params,dict) or len(json.dumps(params))>10000:
            raise ValueError('invalid strategy parameters')
        with self.lock:
            if self.params!=params:
                self.params=copy.deepcopy(params)
                self.key=None
                self.pending=None
                self.results={};self.failures={}
                self.force_codes.clear();self.fetch_epoch+=1;self.issues_version+=1
                self.generation+=1
            if not self.thread or not self.thread.is_alive():
                self.thread=threading.Thread(target=self._run,daemon=True,name='liangce-batch-analysis')
                self.thread.start()
        self.wake.set()
        return {'ok':True}

    def control(self, action):
        with self.lock:
            if action=='pause':self.paused=True
            elif action=='resume':self.paused=False
            elif action=='retry_failed':
                self.force_codes.update(self.failures)
                self.failures={};self.paused=False
                self.fetch_epoch+=1;self.issues_version+=1
                self.phase='running';self.message='正在重新获取未评分股票的日线'
                self.started=time.monotonic();self.restored=len(self.results)
                self.finished_elapsed=None
                if self.key:self._save()
            else:raise ValueError('unknown batch action')
        self.wake.set()
        return {'ok':True}

    def _clock(self):
        return dt.datetime.now(self.timezone)

    def _path(self):
        return self.api.data_dir/('analysis-'+self.key+'.json')

    def _save(self):
        self.api._write(self._path().name,dict(key=self.key,results=self.results,failures=self.failures))

    def _context(self, market, reference):
        clock=self._clock()
        # During a trading session today's bar is unfinished, so refresh the batch
        # at most every 15 minutes. After close, completed daily work is reusable.
        slot=clock.strftime('%Y%m%d')+f'-{clock.hour*4+clock.minute//15}' if clock.weekday()<5 and 9<=clock.hour<16 else 'closed'
        engine=hashlib.sha256((self.base/'strategy.js').read_bytes()+(self.base/'analysis-model.js').read_bytes()).hexdigest()
        payload=dict(day=reference,slot=slot,params=self.params,engine=engine,count=self.api.history_count)
        return hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()[:24]

    def _setup(self, market, reference):
        key=self._context(market,reference)
        with self.lock:
            rows=market.get('securities') or market['rows']
            amount={row['code']:row.get('amount',0) for row in market['rows']}
            unique={row['code']:row for row in rows if len(str(row.get('code','')))==6}
            self.items=sorted(unique.values(),key=lambda row:(-amount.get(row['code'],0),row['code']))
            if key==self.key:return
            self.key=key;self.pending=None;self.generation+=1
            saved=self.api._read(self._path().name) or {}
            self.results={code:value for code,value in saved.get('results',{}).items() if code in unique}
            # Older releases discarded short histories. Re-fetch those entries
            # once while retaining all acknowledged scores under the same key.
            self.failures={code:value for code,value in saved.get('failures',{}).items()
                           if code in unique and (value.get('kind')!='short_history' or value.get('history_saved'))}
            self.force_codes.clear();self.fetch_epoch+=1;self.issues_version+=1
            self.restored=len(self.results)
            self.started=time.monotonic()
            self.finished_elapsed=None
            self.last_reference=reference
            self.phase='running'

    def snapshot(self):
        with self.lock:
            done=len(self.results)+len(self.failures)
            elapsed=self.finished_elapsed if self.finished_elapsed is not None else round(time.monotonic()-self.started,1)
            newly=max(0,done-self.restored)
            remaining=max(0,len(self.items)-done)
            eta=round(remaining*elapsed/newly) if newly>24 else None
            states={}
            for failure in self.failures.values():
                kind=failure.get('kind','failed');states[kind]=states.get(kind,0)+1
            short=states.get('short_history',0);empty=states.get('no_history',0)
            return dict(phase='paused' if self.paused else self.phase,message=self.message,
                        total=len(self.items),completed=done,analysed=len(self.results),
                        failed=len(self.failures)-short-empty,short_history=short,no_history=empty,
                        downloaded=len(self.results)+short,issues_count=len(self.failures),issues_version=self.issues_version,
                        failure_types=states,restored=self.restored,
                        pending=len(self.pending['histories']) if self.pending else 0,
                        elapsed_seconds=elapsed,eta_seconds=eta,market_day=self.last_reference,
                        run_id=self.key,generation=self.generation,
                        history_count=self.api.history_count)

    def issues(self, offset=0):
        offset=max(0,int(offset))
        with self.lock:
            names={item['code']:item.get('name',item['code']) for item in self.items}
            rows=[dict(code=code,name=names.get(code,code),**copy.deepcopy(value))
                  for code,value in sorted(self.failures.items())]
            return dict(rows=rows[offset:offset+50],total=len(rows),offset=offset,limit=50,version=self.issues_version)

    def poll(self, generation=-1, issues_version=-1):
        with self.lock:
            result={'progress':self.snapshot(),'run_id':self.key,'generation':self.generation}
            if int(generation)!=self.generation:
                result['restored_results']=copy.deepcopy(list(self.results.values()))
            if int(issues_version)!=self.issues_version:
                result['history_issues']=[dict(code=code,**copy.deepcopy(value)) for code,value in self.failures.items()]
            if self.pending and not self.paused:
                result['batch']=copy.deepcopy(self.pending)
            return result

    def acknowledge(self, run_id, token, results, errors):
        with self.lock:
            if run_id!=self.key or not self.pending or token!=self.pending['token']:
                return {'ok':False,'obsolete':True}
            expected={item['code']:item for item in self.pending['histories']}
            codes=[row.get('code') for row in results]+[row.get('code') for row in errors]
            if len(codes)!=len(set(codes)) or set(codes)!=set(expected):
                raise ValueError('score acknowledgement must cover exactly the batch')
            for row in results:
                history=expected[row['code']]
                if row.get('input_sha256')!=history['input_sha256'] or row.get('bar',{}).get('date')!=history['last_date']:
                    raise ValueError('score result does not match input history')
                if row.get('signal',{}).get('score') not in (0,20,40,60,80,100):
                    raise ValueError('invalid score')
            # Validate the entire packet before committing any row.
            for row in results:
                self.results[row['code']]=copy.deepcopy(row)
            for row in errors:self.failures[row['code']]={'kind':'compute_error','message':str(row.get('error',''))[:160]}
            if errors:self.issues_version+=1
            self._save()
            self.pending=None
        self.wake.set()
        return {'ok':True}

    def _ready_cache(self,item,reference):
        cached=self.api._read(f"daily-{item['code']}.json")
        if not cached or cached.get('adjusted') or cached.get('history_freshness') not in ('verified','market_lag'):return None
        try:
            checked=dt.datetime.fromisoformat(cached['checked_at'])
            clock=self._clock()
            after_close=clock.weekday()>=5 or clock.hour>=16 or clock.hour<9
            if not after_close and (clock-checked).total_seconds()>300:return None
            cutoff=dt.datetime.combine(dt.date.fromisoformat(reference),dt.time(15,10),self.timezone)
            if after_close and checked<cutoff:return None
            if cached.get('market_last_date')!=reference or cached.get('requested_count',0)<self.api.history_count:return None
            cached['bars']=self.normalize(cached['bars'],self.api.history_count)
            return cached
        except (KeyError,ValueError,TypeError):return None

    def _fetch(self, selected, reference, force_codes=()):
        output=[];needed=[];failures={}
        for item in selected:
            cached=None if item['code'] in force_codes else self._ready_cache(item,reference)
            if cached:output.append(cached)
            else:needed.append(item)
        if needed:
            fullcodes=[(item.get('exchange') or ('sh' if item['code'].startswith('6') else 'bj' if item['code'].startswith(('4','8','92')) else 'sz'))+item['code'] for item in needed]
            responses={};retry=fullcodes
            for attempt in range(2):
                try:
                    received=self.api.tdx.batch_history(retry,self.api.history_count)
                except Exception as error:
                    received={code:{'error':str(error)} for code in retry}
                for code in retry:responses[code]=received.get(code,{'error':'missing batch history response'})
                retry=[code for code in retry if responses[code].get('error')]
                if not retry or self.stop.is_set():break
            for item,fullcode in zip(needed,fullcodes):
                raw=responses[fullcode]
                try:
                    if raw.get('error'):raise RuntimeError(raw['error'])
                    if not raw.get('bars'):
                        failures[item['code']]=dict(kind='no_history',bar_count=0,checked_at=self._clock().isoformat(timespec='seconds'),
                            message='行情源暂未返回日线，可重新获取')
                        continue
                    bars=self.normalize(raw['bars'],self.api.history_count)
                    result=dict(ok=True,code=item['code'],name=item.get('name') or item['code'],bars=bars,
                        source='tdx-api 批量日线',adjusted=False,volume_unit='hands',cached=False,
                        first_date=bars[0]['date'],last_date=bars[-1]['date'],checked_at=self._clock().isoformat(timespec='seconds'),
                        received_at=self._clock().isoformat(timespec='seconds'),requested_count=self.api.history_count,
                        market_last_date=reference,history_freshness='verified' if bars[-1]['date']==reference else 'market_lag',
                        history_note='批量日线已核验' if bars[-1]['date']==reference else '个股日线早于市场，可能停牌或源端延迟')
                    self.api._write(f"daily-{item['code']}.json",result)
                    output.append(result)
                except Exception as error:
                    failures[item['code']]={'kind':'fetch_error','message':str(error)[:180],
                                             'checked_at':self._clock().isoformat(timespec='seconds')}
        histories=[]
        for item in output:
            if len(item['bars'])<100:
                failures[item['code']]=dict(kind='short_history',history_saved=True,bar_count=len(item['bars']),
                    required_bars=100,first_date=item['bars'][0]['date'],last_date=item['bars'][-1]['date'],
                    checked_at=item.get('checked_at'),history_freshness=item.get('history_freshness'),source=item.get('source'),
                    message=f"已获取 {len(item['bars'])} 根日线，可查看K线；评分需累计100根")
                continue
            raw=json.dumps(item['bars'],sort_keys=True,separators=(',',':')).encode()
            item['input_sha256']=hashlib.sha256(raw).hexdigest()
            histories.append(item)
        return histories,failures

    def _step(self):
        if self.params is None or self.paused:return
        with self.api.lock:market=self.api.state.get('market')
        if not market or market.get('cached'):
            self.message='等待新一轮全市场报价';return
        if not self.key or time.monotonic()-self.last_context_check>60:
            reference=self.api._reference_market_day()
            if not reference:
                self.message='等待核验市场日线日期';return
            self._setup(market,reference);self.last_context_check=time.monotonic()
        with self.lock:
            if self.pending:return
            remaining=[item for item in self.items if item['code'] not in self.results and item['code'] not in self.failures]
            if not remaining:
                self.phase='complete';self.message='本轮获取与评分已完成'
                if self.finished_elapsed is None:self.finished_elapsed=round(time.monotonic()-self.started,1)
                return
            run_id=self.key;fetch_epoch=self.fetch_epoch;selected=remaining[:24]
            forced=self.force_codes.intersection(item['code'] for item in selected)
            self.phase='running';self.message=f"正在读取并评分 {len(self.results)+len(self.failures)}/{len(self.items)}"
        histories,failures=self._fetch(selected,self.last_reference,forced)
        with self.lock:
            if self.key!=run_id or self.fetch_epoch!=fetch_epoch:return
            self.force_codes.difference_update(item['code'] for item in selected)
            self.failures.update(failures)
            if failures:self.issues_version+=1
            if histories:
                self.pending=dict(token=uuid.uuid4().hex,histories=histories,params=copy.deepcopy(self.params))
                self.message=f'已读取 {len(histories)} 只，正在计算评分'
            else:self._save()

    def _run(self):
        while not self.stop.is_set():
            self.wake.clear()
            try:self._step()
            except Exception:
                self.api.log.exception('batch analysis fetch failed')
                self.phase='retry';self.message='批量读取暂未完成，自动重试中'
                self.stop.wait(3)
            self.wake.wait(.1 if self.key and not self.pending else .5)

    def close(self):
        self.stop.set();self.wake.set()
