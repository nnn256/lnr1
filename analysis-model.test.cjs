const test=require('node:test'),assert=require('node:assert/strict');
const M=require('./analysis-model.js'),Q=require('./strategy.js'),fixture=require('./tests/fixtures/chanlun-300750-daily.json');
test('compact score and plan match the existing full-history strategy on real bars',()=>{
 const params={...Q.DEFAULT_PARAMS,maFast:15,maSlow:55,volumeRatio:1.3};
 const bars=fixture.bars.map((bar,i)=>({...bar,prevClose:i?fixture.bars[i-1].close:bar.close}));
 const source={...fixture,bars,source:'real local fixture',adjusted:false,input_sha256:'test-hash'};
 const compact=M.summarize(source,params),indicators=Q.buildIndicators(bars,params),i=bars.length-1;
 assert.deepEqual(compact.signal,Q.scoreAt(bars,indicators,i,params));
 assert.equal(compact.atrValue,indicators.atr[i]);
 assert.equal(compact.volumeRatio,bars[i].volume/indicators.volume20[i]);
 const entry=compact.signal.breakout||compact.signal.pullback?compact.bar.close:Math.max(compact.bar.close,compact.trigger);
 assert.deepEqual(Q.computeTradePlan({entry,structuralLow:compact.signal.structuralLow,atr:compact.atrValue},params),Q.computeTradePlan({entry,structuralLow:compact.signal.structuralLow,atr:indicators.atr[i]},params));
 assert.equal(compact.bars,undefined);assert.equal(compact.indicators,undefined);
 assert.ok(JSON.stringify(compact).length<3000);assert.equal(compact.input_sha256,'test-hash');
 assert.equal(compact.execution_allowed,false);
});
test('insufficient histories fail without inventing score or shortening lookback',()=>{
 assert.throws(()=>M.summarize({bars:fixture.bars.slice(0,60)}),/100/);
 const h={...fixture,bars:fixture.bars.slice(0,150)};
 const a=M.summarize(h),b=M.summarize(h);
 assert.deepEqual(a,b);assert.equal(a.bar.date,h.bars.at(-1).date);
});
