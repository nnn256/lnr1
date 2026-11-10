const test=require('node:test'),assert=require('node:assert/strict'),{create,symbol}=require('./railway-client.js');
const baseUrl='https://liangce-v3-api-production.up.railway.app';
function panel(){return {symbol:'sh600519',name:'贵州茅台',period:'day',source_kind:'live',computed_at:new Date().toISOString(),coverage:{input_sha256:'fixture'},provenance:{volume_unit:'shares'},bars:[{date_cn:'2026-11-06 15:00',open:1450,high:1457.72,low:1436,close:1453,volume:4284800,is_closed:true}]};}
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
test('verified archive is replaced through a live job, with shared in-flight requests',async()=>{
 const calls=[];const client=create({baseUrl,sleep:async()=>{},fetcher:async(url,options)=>{const path=new URL(url).pathname;calls.push([path,options.method]);
  if(path.includes('/panel/'))return response({...panel(),source_kind:'verified_historical_snapshot'});
  if(options.method==='POST'){assert.equal(JSON.parse(options.body).source,'live');return response({id:'a'.repeat(32)},202);}
  if(path.endsWith('/result'))return response(panel());return response({state:'completed'});
 }});
 const [a,b]=await Promise.all([client.history('600519'),client.history('600519')]);assert.strictEqual(a,b);assert.equal(a.bars.length,1);assert.equal(a.adjustment,'provider_unspecified');assert.equal(a.history_freshness,'cloud_live');assert.equal(calls.filter(x=>x[1]==='POST').length,1);
 assert.strictEqual(await client.history('600519'),a);
});
test('wrong symbol or invalid OHLC cannot enter a chart',async()=>{
 const wrong=create({baseUrl,fetcher:async()=>response({...panel(),symbol:'sz000001'})});await assert.rejects(wrong.history('600519'),/所选股票/);
 const invalid=panel();invalid.bars[0].high=1;const client=create({baseUrl,fetcher:async()=>response(invalid)});await assert.rejects(client.history('600519'),/校验失败/);
});
test('queue errors are surfaced and never relabeled as live history',async()=>{
 const client=create({baseUrl,fetcher:async(url,o)=>o.method==='POST'?response({detail:'队列已满'},429):response({},404)});await assert.rejects(client.history('600519'),/队列已满/);
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
