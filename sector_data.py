"""Public sector indices with dated history; no inferred stock-to-industry memberships."""
import concurrent.futures
import datetime as dt
import json
import math
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

CN=dt.timezone(dt.timedelta(hours=8))
def request(base,params):
    req=urllib.request.Request(base+'?'+urllib.parse.urlencode(params),headers={'User-Agent':'Mozilla/5.0','Referer':'https://quote.eastmoney.com/'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req,timeout=18) as response:data=json.load(response)
            break
        except (urllib.error.URLError,TimeoutError,ConnectionError):
            if attempt==2:raise
            time.sleep(.4*(attempt+1))
    if data.get('rc')!=0 or not data.get('data'):raise ValueError('板块源返回空数据')
    return data['data']

def quote_page(page):
    return request('https://push2.eastmoney.com/api/qt/clist/get',dict(pn=page,pz=100,po=0,np=1,fid='f12',fs='m:90+t:2',fields='f12,f14,f2,f3,f6,f104,f105,f124',fltt=2))

def history(code):
    data=request('https://push2his.eastmoney.com/api/qt/stock/kline/get',dict(secid='90.'+code,klt=101,fqt=0,lmt=60,end='20500101',fields1='f1,f2,f3,f4,f5,f6',fields2='f51,f52,f53,f54,f55,f56,f57'))
    if data.get('code')!=code:raise ValueError('板块代码与历史返回不一致')
    bars={}
    for raw in data.get('klines',[]):
        cells=raw.split(',');day=dt.date.fromisoformat(cells[0]);close=float(cells[2]);amount=float(cells[6])
        if day>dt.datetime.now(CN).date() or not math.isfinite(close) or close<=0 or not math.isfinite(amount) or amount<0:raise ValueError('板块历史数值无效')
        bars[day.isoformat()]={'date':day.isoformat(),'close':close,'amount':amount}
    return [bars[day] for day in sorted(bars)]

def rank_data(rows):
    dates=sorted({bar['date'] for row in rows for bar in row['bars']})
    if not dates:raise ValueError('没有板块历史日线')
    asof=dates[-1];rank_dates=dates[-6:];maps={};rankings={}
    for row in rows:
        bars=row['bars'];values={}
        for i,b in enumerate(bars):
            values[b['date']]={n:(b['close']/bars[i-n]['close']-1)*100 if i>=n else None for n in (1,5,20)}
        maps[row['code']]=values
    for day in rank_dates:
        ranked=sorted((row for row in rows if maps[row['code']].get(day,{}).get(5) is not None),key=lambda row:(-maps[row['code']][day][5],row['code']))
        rankings[day]={row['code']:i+1 for i,row in enumerate(ranked)}
    for row in rows:
        values=maps[row['code']].get(asof,{})
        row.update(history_as_of=row['bars'][-1]['date'] if row['bars'] else None,return_1d=values.get(1),return_5d=values.get(5),return_20d=values.get(20),rank=rankings[asof].get(row['code']))
        previous=rankings[rank_dates[0]].get(row['code']);row['rank_change_5d']=previous-row['rank'] if previous is not None and row['rank'] is not None and len(rank_dates)==6 else None
        row['rank_history']=[dict(date=d,rank=rankings[d].get(row['code'])) for d in rank_dates]
    return asof,rank_dates

def collect(destination):
    first=quote_page(1);pages=[first]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        pages+=list(pool.map(quote_page,range(2,math.ceil(first['total']/100)+1)))
    quotes={}
    for page in pages:
        raw=page['diff'];raw=list(raw.values()) if isinstance(raw,dict) else raw
        for row in raw:quotes[row['f12']]=row
    if len(quotes)!=first['total']:raise ValueError(f'板块分页不完整：{len(quotes)}/{first["total"]}')
    rows=[];failed=[]
    def fetch(item):
        code,quote=item
        try:
            bars=history(code)
            if len(bars)<26:raise ValueError('少于26根板块日线')
            return dict(code=code,name=quote['f14'],bars=bars,quote_change_pct=quote.get('f3'),quote_amount=quote.get('f6'),up_count=quote.get('f104'),down_count=quote.get('f105'),quote_time=dt.datetime.fromtimestamp(quote['f124'],CN).isoformat() if isinstance(quote.get('f124'),(int,float)) else None)
        except Exception as error:return dict(code=code,error=str(error)[:150])
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for index,result in enumerate(pool.map(fetch,quotes.items())):
            (failed if 'error' in result else rows).append(result)
            if index%100==0:print('sector histories',index+1,len(quotes),flush=True)
    if len(rows)<len(quotes)*.8:raise ValueError(f'板块历史覆盖不足：{len(rows)}/{len(quotes)}')
    asof,rank_dates=rank_data(rows)
    result=dict(ok=True,source='东方财富行业板块指数',classification='源站行业板块分类，可能包含上下级行业；不作为互斥行业组合',received_at=dt.datetime.now(CN).isoformat(timespec='seconds'),as_of=asof,total=len(quotes),covered=len(rows),failed=failed,rank_dates=rank_dates,rows=rows,
        methodology='5日/20日收益=同一指数当前收盘÷前5/20根收盘−1；排名变化=5个交易日前的5日收益排名−当前排名。各日排名仅使用截至当日的数据。板块分类是当前源站口径。')
    target=Path(destination);target.parent.mkdir(parents=True,exist_ok=True);temp=target.with_suffix('.tmp');temp.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf8');temp.replace(target)
    print(json.dumps({'sectors':len(quotes),'covered':len(rows),'failed':len(failed),'as_of':asof}),flush=True);return result

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--output',default='runtime/data/sectors.json');args=parser.parse_args();collect(args.output)
