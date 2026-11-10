const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{webcrypto}=require('node:crypto');
function harness({waitForScores=false}={}){
 const bars=Array.from({length:120},(_,i)=>[new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),10,12,9,11,100]);
 const files={
  'data/manifest.json':{market_day:'2025-04-30',generated_at:'2025-05-01',histories:['600000','600001'],issues:[{code:'600001',kind:'short_history',bar_count:1},{code:'600002',kind:'no_history',bar_count:0}]},
  'data/market.json':{securities:[{code:'600000'},{code:'600001'},{code:'600002'}],rows:[]},
  'data/scores.json':[{code:'600000',signal:{score:40}}],
  'data/daily/600000.json':{code:'600000',first_date:bars[0][0],last_date:bars.at(-1)[0],bars},
  'data/daily/600001.json':{code:'600001',first_date:bars[0][0],last_date:bars[0][0],bars:bars.slice(0,1)}
 };
 const calls=[],window={LIANGCE_WEB_CONFIG:{mode:'snapshot'},dispatchEvent(){},addEventListener(){}};
 let releaseScores;const scoresGate=waitForScores?new Promise(resolve=>{releaseScores=resolve;}):Promise.resolve();
 const context={window,crypto:webcrypto,TextEncoder,Uint8Array,AbortController,setTimeout,clearTimeout,CustomEvent:class{},console,
  fetch:async path=>{calls.push(path);if(path==='data/scores.json')await scoresGate;return{ok:Boolean(files[path]),status:files[path]?200:404,json:async()=>structuredClone(files[path])};}};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'web-bridge.js'),'utf8'),context);
 return {api:window.pywebview.api,calls,files,releaseScores};
}

test('market list and chart history remain available while scoring download is pending',async()=>{
 const h=harness({waitForScores:true});const scoring=h.api.configure_analysis({});
 const state=await h.api.get_state();assert.equal(state.phase,'ready');assert.equal(state.market.securities.length,3);
 assert.equal((await h.api.get_chart_history('600000')).bars.length,120);
 h.releaseScores();await scoring;assert.equal((await h.api.get_analysis_batch()).progress.analysed,1);
});
test('published defaults restore scores and distinguish short from empty history',async()=>{
 const h=harness();await h.api.configure_analysis({});const state=await h.api.get_analysis_batch();
 assert.equal(state.progress.analysed,1);assert.equal(state.progress.downloaded,2);assert.equal(state.progress.short_history,1);assert.equal(state.progress.no_history,1);
 assert.equal(state.restored_results.length,1);assert.equal((await h.api.get_chart_history('600001')).bars.length,1);
 assert.equal((await h.api.get_chart_history('600002')).ok,false);
});
test('custom parameters recompute published candles and acknowledge the exact queue',async()=>{
 const h=harness();await h.api.configure_analysis({volumeRatio:2});const state=await h.api.get_analysis_batch();
 assert.equal(state.batch.histories.length,1);assert.equal(state.batch.histories[0].bars.length,120);
 assert.equal(state.batch.params.volumeRatio,2);assert.equal(state.progress.short_history,1);assert.equal(state.progress.no_history,1);
 assert.equal((await h.api.complete_analysis_batch(state.run_id,state.batch.token,[{code:'600000',signal:{score:60}}],[])).ok,true);
 const done=await h.api.get_analysis_batch();assert.equal(done.progress.phase,'complete');assert.equal(done.progress.completed,3);
});
test('refresh drops downloaded candle cache and rejects obsolete score packets',async()=>{
 const h=harness();await h.api.configure_analysis({volumeRatio:2});const old=await h.api.get_analysis_batch();
 h.files['data/daily/600000.json'].bars[119][4]=10.5;
 await h.api.control_analysis('retry_failed');
 assert.equal((await h.api.complete_analysis_batch(old.run_id,old.batch.token,[],[])).ok,false);
 const newer=await h.api.get_analysis_batch();assert.equal(newer.batch.histories[0].bars[119].close,10.5);
 assert.equal(h.calls.filter(p=>p==='data/daily/600000.json').length,2);
});
test('unchanged polls omit issues so the stock table is not rebuilt every250ms',async()=>{
 const h=harness();await h.api.configure_analysis({});const first=await h.api.get_analysis_batch();
 const second=await h.api.get_analysis_batch(first.generation,first.progress.issues_version);
 assert.equal(second.history_issues,undefined);assert.equal(second.restored_results,undefined);
 await h.api.control_analysis('retry_failed');const third=await h.api.get_analysis_batch(first.generation,first.progress.issues_version);
 assert.equal(third.history_issues.length,2);
});
