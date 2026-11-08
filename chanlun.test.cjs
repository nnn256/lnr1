const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('./chanlun.js');
const Q=require('./strategy.js');
test('structure evidence respects confirmation timing and never claims strict confirmation',()=>{
 const bars=Q.generateSyntheticUniverse()[0].bars;
 const result=C.detect(bars);
 assert.ok(result.signals.length>0);
 for(const s of result.signals){
  assert.ok([1,2,3].includes(s.signal_class));
  assert.equal(s.strict_confirmed,false);
  assert.ok(s.approximation_loss);
  assert.ok(s.available_at<=bars.at(-1).date);
 }
 assert.deepEqual(C.detect(bars.slice(0,500)),C.detect(bars.slice(0,500)));
});
test('buy and sell candidate rules are mirrored under price reflection',()=>{
 const bars=Q.generateSyntheticUniverse()[2].bars;
 const roof=Math.max(...bars.map(b=>b.high))*2;
 const mirror=bars.map(b=>({...b,open:roof-b.open,close:roof-b.close,high:roof-b.low,low:roof-b.high}));
 const a=C.detect(bars).signals,b=C.detect(mirror).signals;
 assert.equal(a.length,b.length);
 a.forEach((s,i)=>{assert.equal(s.signal_class,b[i].signal_class);assert.notEqual(s.side,b[i].side);});
});
test('prefix replay freezes emitted signals and does not use future bars',()=>{
 const bars=Q.generateSyntheticUniverse()[2].bars.slice(0,700);
 const a=C.replay(bars.slice(0,400)).signals;
 const b=C.replay(bars).signals.filter(s=>s.available_at<=bars[399].date);
 assert.deepEqual(a,b);
});
(function(){
  const test=require('node:test'),assert=require('node:assert/strict');
  const chan=require('./chanlun.js'),fixture=require('./tests/fixtures/chanlun-real-daily.json');
  test('real daily history emits one usable event per structural endpoint and class',()=>{
    const result=chan.replay(fixture.bars),seen=new Set(),byDate=new Map(fixture.bars.map(bar=>[bar.date,bar]));
    for(const signal of result.signals){
      const key=[signal.side,signal.signal_class,signal.point_index,signal.price].join('|');
      assert.ok(!seen.has(key),'repeated structural endpoint');seen.add(key);
      const bar=byDate.get(signal.available_at);
      assert.ok(signal.side==='buy'?bar.close>=signal.invalidation:bar.close<=signal.invalidation,'invalidated before publication');
      assert.ok(signal.confirmed_index>signal.point_index);
    }
  });
})();
(function(){
  const test=require('node:test'),assert=require('node:assert/strict');
  const chan=require('./chanlun.js'),fixture=require('./tests/fixtures/chanlun-equal-force-daily.json');
  test('equal force remains equal under price reflection on real history',()=>{
    const bars=fixture.bars,constant=Math.max(...bars.map(bar=>bar.high))+Math.min(...bars.map(bar=>bar.low));
    const reflected=bars.map(bar=>({...bar,open:constant-bar.open,close:constant-bar.close,high:constant-bar.low,low:constant-bar.high}));
    const key=signal=>[signal.side,signal.signal_class,signal.point_index,signal.available_at,Math.round(signal.price*1e7)].join('|');
    const expected=chan.replay(bars).signals.map(signal=>key({...signal,side:signal.side==='buy'?'sell':'buy',price:constant-signal.price})).sort();
    assert.deepEqual(chan.replay(reflected).signals.map(key).sort(),expected);
  });
})();
