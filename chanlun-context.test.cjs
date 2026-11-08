const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('./chanlun.js');
const history=require('./tests/fixtures/chanlun-300750-daily.json');

test('real first-class endpoint revisions share one causal episode',()=>{
  const result=C.replay(history.bars);
  const revisions=result.signals.filter(signal=>signal.side==='buy'&&signal.signal_class===1&&signal.available_at>='2026-09-01');
  assert.equal(revisions.length,5);
  assert.equal(new Set(revisions.map(signal=>signal.episode_id)).size,1);
  assert.equal(new Set(revisions.map(signal=>signal.candidate_id)).size,5);
  for(const signal of revisions){
    assert.equal(signal.comparison_prior_end_index,1122);
    assert.equal(signal.comparison_current_start_index,1140);
    assert.equal(signal.comparison_current_end_index,signal.point_index);
    assert.equal(signal.strict_confirmed,false);
  }
});

test('third-class centers predate departure and never use the departure stroke as a component',()=>{
  const thirds=C.replay(history.bars).signals.filter(signal=>signal.signal_class===3);
  assert.ok(thirds.length>0);
  for(const signal of thirds){
    assert.ok(signal.center_end_index<=signal.departure_start_index);
    assert.ok(signal.center_available_index<=signal.departure_available_index);
    assert.ok(signal.departure_start_index<signal.departure_end_index);
    assert.ok(signal.departure_end_index<signal.point_index);
    assert.ok(signal.center_available_at<=signal.available_at);
  }
  const apr2=thirds.find(signal=>signal.available_at==='2026-04-02');
  assert.equal(apr2.center_id,'C85');
  assert.equal(apr2.center_end_index,1034);
  assert.equal(apr2.departure_end_index,1046);
});

test('second-class metadata links to prior first-class evidence and grouped pullback revisions',()=>{
  const signals=C.replay(history.bars).signals;
  const seconds=signals.filter(signal=>signal.signal_class===2);
  assert.ok(seconds.length>0);
  for(const signal of seconds){
    assert.ok(Number.isInteger(signal.first_candidate_point));
    assert.ok(signal.first_candidate_at<signal.available_at);
    const parent=signals.find(first=>first.side===signal.side&&first.signal_class===1
      &&first.point_index===signal.first_candidate_point&&first.available_at===signal.first_candidate_at);
    assert.ok(parent);
    assert.equal(signal.first_candidate_id,parent.candidate_id);
    const parentIndex=history.bars.findIndex(bar=>bar.date===parent.available_at);
    const signalIndex=history.bars.findIndex(bar=>bar.date===signal.available_at);
    assert.ok(history.bars.slice(parentIndex+1,signalIndex+1).every(bar=>signal.side==='buy'
      ?bar.low>=parent.invalidation-1e-7:bar.high<=parent.invalidation+1e-7));
  }
  const revisions=seconds.filter(signal=>signal.side==='buy'&&signal.available_at>='2026-08-01');
  assert.equal(revisions.length,2);
  assert.equal(revisions[0].episode_id,revisions[1].episode_id);
  assert.ok(!seconds.some(signal=>signal.side==='buy'&&signal.available_at==='2023-06-28'),
    'first-buy boundary broke intraday June 7 before this second-buy label');
  const may27=seconds.find(signal=>signal.available_at==='2022-05-27');
  assert.equal(may27.first_candidate_at,'2022-05-06',
    'retain published parent date despite later inclusion extending its confirming candle');
});

test('metadata and corrected class decisions remain prefix-causal and mirror-symmetric',()=>{
  const bars=history.bars;
  const prefix=C.replay(bars.slice(0,1174)).signals;
  const full=C.replay(bars).signals.filter(signal=>signal.available_at<=bars[1173].date);
  assert.deepEqual(prefix,full);
  const roof=Math.max(...bars.map(bar=>bar.high))+Math.min(...bars.map(bar=>bar.low));
  const mirror=bars.map(bar=>({...bar,open:roof-bar.open,close:roof-bar.close,high:roof-bar.low,low:roof-bar.high}));
  const canonical=signal=>[signal.side,signal.signal_class,signal.point_index,signal.available_at,Math.round(signal.price*1e7)].join('|');
  const expected=C.replay(bars).signals.map(signal=>canonical({...signal,side:signal.side==='buy'?'sell':'buy',price:roof-signal.price})).sort();
  assert.deepEqual(C.replay(mirror).signals.map(canonical).sort(),expected);
});
