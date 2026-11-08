const test=require('node:test'),assert=require('node:assert/strict'),M=require('./backtest-model.js');
const fixture=require('./tests/fixtures/chanlun-300750-daily.json');
const raw=Array.isArray(fixture)?fixture:fixture.bars;
const sample={code:'300750',name:'宁德时代',bars:raw,source:'test',adjustment:'none'};
test('requested year ranges do not disguise a short history as five years',()=>{
 const h={...sample,bars:raw.slice(-160)};const ranges=M.ranges([h],'multi');
 assert.equal(ranges.length,4);assert.notEqual(ranges[0].startDate,ranges[1].startDate);assert.notEqual(ranges[1].startDate,ranges[2].startDate);
 assert.ok(ranges[2].startDate<h.bars[0].date);
});
test('backtest samples are explicit, deduplicated and bounded',()=>{
 assert.deepEqual(M.codes('600519, 000001，600519'),['600519','000001']);assert.throws(()=>M.codes('abc'));assert.throws(()=>M.codes(Array.from({length:51},(_,i)=>String(600000+i)).join(',')));
});
test('uncertified cloud and short datasets cannot silently enter long-history backtest',()=>{
 assert.throws(()=>M.coverage([{...sample,adjustment:'provider_unspecified'}]),/未认证/);
 assert.throws(()=>M.coverage([{...sample,bars:raw.slice(0,4)}]),/100/);
});
test('failed sample interval is rejected before publishing any completed metrics',()=>{
 assert.throws(()=>M.validateRange('2026-11-30','2026-11-01'),/起始日期/);
 assert.throws(()=>M.run([sample],{label:'自定义',startDate:'2099-01-01',endDate:'2099-12-31'},{}),/少于2根/);
});
test('actual coverage and sample codes are attached to reproducible results',()=>{
 const range=M.ranges([sample],'1y')[0],a=M.run([sample],range,{}),b=M.run([sample],range,{});
 assert.deepEqual(a.metrics,b.metrics);assert.equal(a.sample[0].code,'300750');assert.equal(a.requested_range.startDate,range.startDate);assert.ok(a.metrics.startDate>=range.startDate);
 for(const trade of a.trades)assert.ok(trade.entryDate>trade.signal.available_at);
});
