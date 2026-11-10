const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function harness(quotes){
 const events={},sent=[],nodes=new Map();
 const node=()=>({textContent:'',value:'',hidden:false,className:'',parentElement:{after(){}},setAttribute(){},prepend(){},after(){}});
 const document={hidden:false,querySelector(selector){if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);},getElementById:node,createElement:node,addEventListener(){}};
 const window={LiangceWeb:{cloud:{quotes}},addEventListener(name,fn){events[name]=fn;},dispatchEvent(event){sent.push(event);}};
 const context={window,document,setInterval(){},Date,CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},LiangceApp:{getMarketView:()=>({rows:[{code:'600519'}]}),selectedCode:()=>null,applyLiveQuotes(){},markQuotesStale(){}},LiangceCharts:{getSnapshot:()=>null,getRequestedCode:()=>null}};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'railway-live.js'),'utf8'),context);
 return {live:window.LiangceLive,events,sent};
}
test('initial quote failure leaves loading state, releases busy and manual refresh recovers',async()=>{
 let fails=true;const h=harness(async()=>{if(fails)throw Error('连接超时');return {quotes:{'600519':{price:10,market_time:'2026-11-10T15:00:00+08:00'}},missing:[],market_session:'outside_trading_hours',refresh_after_seconds:300};});
 await h.live.refresh();assert.equal(h.live.state().busy,false);assert.equal(h.live.state().lastError,'连接超时');
 const failure=h.sent.filter(x=>x.type==='liangce:quote-status').at(-1);assert.equal(failure.detail.state,'error');assert.match(failure.detail.message,/刷新行情/);
 fails=false;await h.live.refresh(true);assert.equal(h.live.state().lastError,null);
 const ready=h.sent.filter(x=>x.type==='liangce:quote-status').at(-1);assert.equal(ready.detail.state,'ready');assert.equal(ready.detail.count,1);
});
test('market list arrival initiates cloud refresh before scores are ready',async()=>{
 let called=0;const h=harness(async()=>{called++;return {quotes:{},missing:['600519'],market_session:'outside_trading_hours',refresh_after_seconds:300};});
 await h.events['liangce:market-ready']();assert.equal(called,1);assert.equal(h.live.state().busy,false);
 assert.equal(h.sent.filter(x=>x.type==='liangce:quote-status').at(-1).detail.state,'error');
});
