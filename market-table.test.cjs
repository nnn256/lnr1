const test=require('node:test'),assert=require('node:assert/strict');
const T=require('./market-table.js');
const securities=Array.from({length:5579},(_,index)=>({code:String(600000+index),name:'真实接口结构测试'+index,exchange:'sh'}));
const quotes=securities.slice(0,5573).map((item,index)=>({...item,price:10+index/100,change:index%20-10,amount:5573-index}));
const analyses=securities.slice(0,15).map((item,index)=>({...item,signal:{score:index*5},status:index<5?'接近触发':'观察'}));
test('full universe keeps quote-less securities and paginates every symbol exactly once',()=>{
  const rows=T.buildRows({securities,rows:quotes},analyses),codes=[];
  const first=T.queryRows(rows,{pageSize:50});
  assert.equal(first.total,5579);assert.equal(first.quoted,5573);assert.equal(first.analysed,15);assert.equal(first.rows.length,50);
  for(let page=1;page<=first.pageCount;page++)codes.push(...T.queryRows(rows,{pageSize:50,page}).rows.map(row=>row.code));
  assert.equal(codes.length,5579);assert.equal(new Set(codes).size,5579);
  assert.equal(rows.filter(row=>!row.quote).length,6);
});
test('search queries full market beyond the first historical pool and clamps pages',()=>{
  const rows=T.buildRows({securities,rows:quotes},analyses);
  const result=T.queryRows(rows,{query:securities[4500].code,page:999,pageSize:25});
  assert.equal(result.matched,1);assert.equal(result.page,1);assert.equal(result.rows[0].analysis,null);assert.ok(result.rows[0].quote);
  assert.equal(T.queryRows(rows,{query:'not-a-stock'}).matched,0);
});
test('unanalysed stocks have no invented scores; score and history filters are explicit',()=>{
  const rows=T.buildRows({securities,rows:quotes},analyses);
  assert.equal(T.queryRows(rows,{mode:'pending'}).matched,5564);
  assert.equal(T.queryRows(rows,{mode:'analysed'}).matched,15);
  assert.equal(T.queryRows(rows,{threshold:70}).matched,1);
  assert.equal(T.queryRows(rows,{mode:'near'}).matched,5);
  assert.equal(T.queryRows(rows,{mode:'observe'}).matched,10);
  assert.equal(T.queryRows(rows,{sort:'score'}).rows[0].analysis.signal.score,70);
  assert.ok(rows.slice(15).every(row=>!row.analysis));
});
test('cached older quote contracts and local-only histories remain usable',()=>{
  assert.equal(T.buildRows({rows:quotes},analyses).length,5573);
  assert.equal(T.buildRows(null,analyses).length,15);
  assert.equal(T.queryRows([],{page:99}).page,1);
});
