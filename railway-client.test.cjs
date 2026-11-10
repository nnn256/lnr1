const test=require('node:test'),assert=require('node:assert/strict'),{create,symbol}=require('./railway-client.js');
const baseUrl='https://liangce-v3-api-production.up.railway.app';
function panel(){return {symbol:'sh600519',name:'贵州茅台',period:'day',source_kind:'live_candles',structure_computed:false,computed_at:new Date().toISOString(),coverage:{input_sha256:'fixture'},provenance:{volume_unit:'shares'},bars:[{date_cn:'2026-11-06 15:00',open:1450,high:1457.72,low:1436,close:1453,volume:4284800,is_closed:true}]};}
const response=(value,status=200)=>({ok:status===200||status===202,status,json:async()=>value});
test('exchange mapping preserves Shanghai Shenzhen and Beijing codes',()=>{assert.equal(symbol('600519'),'sh600519');assert.equal(symbol('000001'),'sz000001');assert.equal(symbol('920085'),'bj920085');assert.throws(()=>symbol('../600519'));});
test('quote change uses percentage, missing prices stay missing and 80-stock limit is respected',async()=>{
 const requests=[];const client=create({baseUrl,fetcher:async url=>{const codes=new URL(url).searchParams.get('symbols').split(',');requests.push(codes);return response({quotes:Object.fromEntries(codes.map(s=>[s,{symbol:s,price:10,change:2,change_percent:25,stale:false}])),market_session:'trading_hours',refresh_after_seconds:20});}});
 const result=await client.quotes(Array.from({length:101},(_,i)=>String(600000+i)));assert.equal(requests.length,2);assert.equal(requests[0].length,80);assert.equal(result.quotes['600000'].change,25);assert.equal(result.refresh_after_seconds,20);
});
test('stale flags and missing percentages survive normalization without fabricated zero',async()=>{
 const client=create({baseUrl,fetcher:async()=>response({quotes:{sh600519:{symbol:'sh600519',price:10,change_percent:null,stale:true},sz000001:{symbol:'sz000001',price:0}},market_session:'outside_trading_hours'})});
 const result=await client.quotes(['600519','000001','920085']);assert.equal(result.quotes['600519'].change,null);assert.equal(result.quotes['600519'].stale,true);assert.deepEqual(result.missing,['000001','920085']);assert.equal(result.refresh_after_seconds,300);
});
test('chart fetches raw live candles once without creating a structural calculation job',async()=>{
 const calls=[];const client=create({baseUrl,sleep:async()=>{},fetcher:async(url,options)=>{const path=new URL(url);calls.push([path.pathname,options.method]);
  assert.equal(path.pathname,'/api/market/candles/sh600519');assert.equal(path.searchParams.get('count'),'1200');assert.equal(options.method,'GET');return response(panel());
 }});
 const [a,b]=await Promise.all([client.history('600519'),client.history('600519')]);assert.strictEqual(a,b);assert.equal(a.bars.length,1);assert.equal(a.adjustment,'provider_unspecified');assert.equal(a.history_freshness,'cloud_live');assert.equal(calls.length,1);
 assert.strictEqual(await client.history('600519'),a);
});
test('wrong symbol or invalid OHLC cannot enter a chart',async()=>{
 const wrong=create({baseUrl,fetcher:async()=>response({...panel(),symbol:'sz000001'})});await assert.rejects(wrong.history('600519'),/所选股票/);
 const invalid=panel();invalid.bars[0].high=1;const client=create({baseUrl,fetcher:async()=>response(invalid)});await assert.rejects(client.history('600519'),/校验失败/);
});
test('queue errors are surfaced and never relabeled as live history',async()=>{
 const client=create({baseUrl,sleep:async()=>{},fetcher:async()=>response({detail:'队列已满'},429)});await assert.rejects(client.history('600519'),/队列已满/);
});
test('chart exports preserve uncertified provider adjustment',async()=>{
 const client=create({baseUrl,fetcher:async()=>response(panel())});const history=await client.history('600519'),model=require('./chart-model.js');
 const plan=model.buildDrawingPlan(model.buildSnapshot(history),history);assert.equal(plan.source_adjustment,'provider_unspecified');assert.equal(plan.execution_allowed,false);
});

test('a stalled quote request times out and the next refresh can recover',async()=>{
 let stalled=true;
 const client=create({baseUrl,requestTimeoutMs:5,fetcher:async(url,options)=>{
  if(stalled)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'}))));
  return response({quotes:{sh600519:{symbol:'sh600519',price:10,change_percent:1}},market_session:'outside_trading_hours'});
 }});
 await assert.rejects(client.quotes(['600519']),/响应超时/);stalled=false;
 assert.equal((await client.quotes(['600519'])).quotes['600519'].price,10);
});

test('busy history endpoint retries only twice and can recover without changing its source',async()=>{
 let calls=0;const delays=[];
 const client=create({baseUrl,sleep:async ms=>delays.push(ms),fetcher:async()=>++calls<3?response({detail:'繁忙'},429):response(panel())});
 const history=await client.history('600519');assert.equal(history.code,'600519');assert.equal(history.history_freshness,'cloud_live');assert.deepEqual(delays,[2000,4000]);
 let rejected=0;const busy=create({baseUrl,sleep:async()=>{},fetcher:async()=>{rejected++;return response({detail:'队列已满'},429);}});
 await assert.rejects(busy.history('600519'),/队列已满/);assert.equal(rejected,3);
});

test('forming candles are excluded and provider adjustment survives direct live API conversion',async()=>{
 const data=panel();data.provenance.adjustment='unadjusted';data.bars.push({...data.bars[0],date_cn:'2026-11-10 15:00',close:1451,is_closed:false});
 const calls=[];const client=create({baseUrl,fetcher:async(url)=>{calls.push(url);return response(data);}});
 const value=await client.history('600519',true);assert.equal(value.bars.length,1);assert.equal(value.adjustment,'unadjusted');assert.equal(value.adjusted,false);assert.match(calls[0],/refresh=true/);
});

test('conflicting duplicates and impossible or future dates are rejected before charting',async()=>{
 for(const mutate of [
  p=>p.bars.push({...p.bars[0],close:1451}),
  p=>p.bars[0].date_cn='2026-02-30 15:00',
  p=>p.bars[0].date_cn='2099-01-01 15:00',
  p=>delete p.bars[0].is_closed
 ]){
  const data=panel();mutate(data);const client=create({baseUrl,fetcher:async()=>response(data)});
  await assert.rejects(client.history('600519'),/日期|冲突|收盘状态/);
 }
 const data=panel();data.bars.push({...data.bars[0]});const client=create({baseUrl,fetcher:async()=>response(data)});
 assert.equal((await client.history('600519')).bars.length,1);
});

test('verified split-adjusted history is labelled as back-adjusted instead of unadjusted',async()=>{
 const data=panel();data.provenance.adjustment='causal_split_hfq_verified_actions';
 const client=create({baseUrl,fetcher:async()=>response(data)}),history=await client.history('600519');
 assert.equal(history.adjustment,'causal_split_hfq_verified_actions');assert.match(history.adjustment_label,/后复权/);assert.match(history.history_note,/已核验拆股/);
});
