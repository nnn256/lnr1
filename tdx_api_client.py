"""oficcejo/tdx-api HTTP contract. Quotes use <=50 codes and milli-yuan prices."""
import datetime as dt
import json
import math
import urllib.parse
import urllib.request


class TdxAPIClient:
    def __init__(self, base_url='http://127.0.0.1:18779', timeout=20):
        self.base_url = str(base_url).rstrip('/')
        self.timeout = timeout

    def request(self, path, payload=None):
        request = urllib.request.Request(self.base_url + path,
                                         data=json.dumps(payload).encode('utf8') if payload is not None else None,
                                         headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            result = json.load(response)
        if not isinstance(result, dict) or result.get('code') != 0:
            raise ValueError(result.get('message', 'invalid tdx-api response') if isinstance(result, dict) else 'invalid tdx-api payload')
        return result['data']

    def codes(self):
        payload = self.request('/api/codes')
        entries = payload.get('codes') if isinstance(payload, dict) else None
        if not entries:
            raise ValueError('tdx-api returned no stock codes')
        result = {}
        for entry in entries:
            code, exchange = str(entry.get('code', '')), str(entry.get('exchange', '')).lower()
            if code.isdigit() and len(code) == 6 and exchange in ('sh', 'sz', 'bj'):
                result[exchange + code] = dict(code=code, exchange=exchange, name=entry.get('name') or code)
        if not result:
            raise ValueError('no valid stock codes in tdx-api response')
        return result

    @staticmethod
    def quote(raw, names):
        exchange = {0: 'sz', 1: 'sh', 2: 'bj'}.get(raw.get('Exchange'))
        code = str(raw.get('Code', ''))
        full_code = (exchange or '') + code
        if full_code not in names:
            raise ValueError('quote does not belong to requested stock codes: ' + full_code)
        kline = raw.get('K')
        if not isinstance(kline, dict):
            raise ValueError('missing nested Quote.K')
        # protocol.Price is int64 in milli-yuan, while Quote.Amount is already yuan.
        price, previous = float(kline.get('Close', 0)) / 1000, float(kline.get('Last', 0)) / 1000
        if not math.isfinite(price) or not math.isfinite(previous) or min(price, previous) <= 0:
            return None
        return dict(code=code, exchange=exchange, name=names[full_code]['name'], price=price,
                    previous_close=previous, change=(price / previous - 1) * 100,
                    volume=float(raw.get('TotalHand', 0)), amount=float(raw.get('Amount', 0)),
                    server_time=raw.get('ServerTime'))

    def scan(self, progress=None):
        names = self.codes()
        codes = list(names)
        rows, failed_batches, batches = {}, [], []
        for offset in range(0, len(codes), 50):
            batch = codes[offset:offset + 50]
            error = None
            for attempt in range(2):
                try:
                    raw = self.request('/api/batch-quote', {'codes': batch})
                    if not isinstance(raw, list):
                        raise ValueError('batch-quote data must be a list')
                    requested = {code: names[code] for code in batch}
                    batch_rows = {}
                    for quote in raw:
                        row = self.quote(quote, requested)
                        if row:
                            batch_rows[row['exchange'] + row['code']] = row
                    rows.update(batch_rows)
                    batches.append(dict(offset=offset, requested=len(batch), returned=len(raw), attempts=attempt + 1))
                    error = None
                    break
                except Exception as exc:
                    error = type(exc).__name__ + ': ' + str(exc)
            if error:
                failed_batches.append(dict(offset=offset, codes=batch, error=error))
            if progress:
                progress(min(offset + 50, len(codes)), len(codes), len(rows), len(failed_batches))
        if not rows:
            raise RuntimeError('tdx-api returned no valid quotes')
        return dict(ok=True, source='tdx-api /api/batch-quote', total_codes=len(codes), total_quotes=len(rows),
                    securities=list(names.values()), rows=list(rows.values()), batches=batches, failed_batches=failed_batches,
                    received_at=dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='seconds'),
                    cached=False, endpoint=self.base_url, price_unit='yuan', volume_unit='hands')

    def history(self, full_code, count=1200):
        if not 1 <= int(count) <= 8000:
            raise ValueError('daily count must be between 1 and 8000')
        query = urllib.parse.urlencode({'code': full_code, 'type': 'day', 'limit': int(count)})
        data = self.request('/api/kline-all/tdx?' + query)
        bars = data.get('list') if isinstance(data, dict) else data
        if not bars:
            raise ValueError('empty TDX daily history')
        return self.decode_history(bars)

    @staticmethod
    def decode_history(bars):
        # respondKlineSuccess returns protocol.Kline with Price fields in milli-yuan.
        result = []
        for bar in bars:
            date = str(bar['Time'])[:10]
            parsed_date = dt.date.fromisoformat(date)
            if parsed_date > dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date():
                raise ValueError('TDX returned a future daily date')
            result.append(dict(date=date, open=float(bar['Open']) / 1000,
                               high=float(bar['High']) / 1000, low=float(bar['Low']) / 1000,
                               close=float(bar['Close']) / 1000, volume=float(bar.get('Volume', 0))))
        return sorted(result, key=lambda row: row['date'])

    def batch_history(self, codes, count=1200):
        if not 1 <= len(codes) <= 24:
            raise ValueError('batch history requires 1..24 codes')
        rows = self.request('/api/batch-daily', {'codes': codes, 'count': count})
        if not isinstance(rows, list):
            raise ValueError('batch history response must be a list')
        expected=set(codes)
        result={}
        for row in rows:
            code=row.get('code')
            if code not in expected or code in result:
                raise ValueError('unexpected or duplicate history code')
            try:
                if row.get('error'):
                    raise ValueError(row['error'])
                result[code]={'bars':self.decode_history(row.get('list') or [])}
            except (ValueError,KeyError,TypeError) as error:
                result[code]={'error':str(error)}
        for code in expected-result.keys():
            result[code]={'error':'missing batch history response'}
        return result
