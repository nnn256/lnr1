const test=require('node:test'),assert=require('node:assert/strict'),L=require('./selection-loader.js');
test('later stock selection wins even when older request resolves last',async()=>{
 const pending={},states=[];const loader=L.create(key=>new Promise(resolve=>pending[key]=resolve),s=>states.push(s));
 const a=loader.select('old'),b=loader.select('new');pending.new({code:'new'});await b;pending.old({code:'old'});assert.deepEqual(await a,{obsolete:true});
 assert.equal(states.at(-1).result.code,'new');assert.deepEqual(states.filter(s=>s.state==='ready').map(s=>s.key),['new']);
});
test('clear invalidates in-flight results and never shows a stale error',async()=>{
 let reject;const states=[];const loader=L.create(()=>new Promise((resolve,r)=>reject=r),s=>states.push(s));
 const old=loader.select('old');loader.clear();reject(Error('delayed error'));await old;assert.equal(states.at(-1).state,'idle');
});
test('same stock in another task or period uses a separate request identity',async()=>{
 const states=[];const loader=L.create(async key=>({key}),s=>states.push(s));
 await loader.select('job1:stock:day');await loader.select('job2:stock:5m');
 assert.equal(states.at(-1).key,'job2:stock:5m');assert.equal(states.filter(s=>s.state==='loading').length,2);
});
test('failure publishes retriable error after loading rather than previous detail',async()=>{
 const states=[];const loader=L.create(async()=>{throw Error('missing')},s=>states.push(s));const result=await loader.select('stock');
 assert.equal(result.ok,false);assert.equal(states[0].state,'loading');assert.equal(states.at(-1).state,'error');
});
