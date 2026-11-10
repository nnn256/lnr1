(() => {
 'use strict';
 const cloud=window.LiangceWeb?.cloud;if(!cloud)return;
 let busy=false,next=0,lastKey='',version=0,lastResult=null,lastError=null,requests=0;
 const visible=()=>{
  const marketVisible=!document.querySelector('#market-screen').hidden,chartVisible=!document.querySelector('#tv-chart-screen').hidden;
  const codes=marketVisible?LiangceApp.getMarketView().rows.map(r=>r.code):[];
  if(marketVisible&&LiangceApp.selectedCode())codes.push(LiangceApp.selectedCode());
  if(chartVisible){const code=LiangceCharts.getRequestedCode()||document.querySelector('#tv-code').value;if(/^\d{6}$/.test(code))codes.push(code);}
  return [...new Set(codes)].sort();
 };
 const time=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'行情源未提供时间';
 function status(result,error){
  if(!result&&!error)return;
  const latest=result?Object.values(result.quotes).map(x=>x.market_time).filter(Boolean).sort().at(-1):null;
  const stale=result?Object.values(result.quotes).some(x=>x.stale)||result.missing.length>0:false;
  const count=Object.keys(result?.quotes||{}).length;
  const text=error?`云端报价未更新：${error} · 已保留原数据，可点击“刷新行情”重试`:
   `${count?'Railway 行情已连接':'云端暂未返回有效报价'} · ${result.market_session==='trading_hours'?'当前页及所选股票每20秒刷新':'休市，保留最近交易报价，每5分钟检查'} · 行情时间 ${time(latest)}${stale?' · 部分股票暂缺或为旧报价':''} · 全市场评分仍以各自日线日期为准`;
  const detail={message:text,state:error||stale||!count?'error':'ready',count,market_time:latest};
  window.dispatchEvent(new CustomEvent('liangce:web-status',{detail}));
  window.dispatchEvent(new CustomEvent('liangce:quote-status',{detail}));
  const code=window.LiangceCharts?.getRequestedCode(),quote=result?.quotes?.[code],line=document.querySelector('#cloud-chart-quote');
  if(line&&quote)line.textContent=`${quote.name||code} ${code} · ${quote.stale||error?'上次报价':'行情报价'} ¥${quote.price.toFixed(2)} · ${quote.change==null?'涨幅未提供':(quote.change>=0?'+':'')+quote.change.toFixed(2)+'%'} · ${time(quote.market_time)}`;
  else if(line&&code)line.textContent=`${code} · 正在获取该股票的行情报价…`;
 }
 async function refresh(force=false){
  if(document.hidden||busy)return;
  const codes=visible(),key=codes.join(',');if(!codes.length){if(force){try{await pywebview.api.start_background();window.dispatchEvent(new CustomEvent('liangce:reload-market'));}catch(error){status(null,error.message);}}return;}
  if(!force&&key===lastKey&&Date.now()<next)return;
  busy=true;lastKey=key;const current=++version;requests++;
  if(!lastResult){const detail={message:'股票列表已就绪 · 正在连接 Railway 报价（最多20秒）',state:'loading'};window.dispatchEvent(new CustomEvent('liangce:web-status',{detail}));window.dispatchEvent(new CustomEvent('liangce:quote-status',{detail}));}
  try{const result=await cloud.quotes(codes);if(current!==version)return;
   lastResult=result;lastError=result.error||null;LiangceApp.applyLiveQuotes(result.quotes,result.missing);next=Date.now()+result.refresh_after_seconds*1000;status(result,lastError);
  }catch(error){lastError=error.message;LiangceApp.markQuotesStale(codes);next=Date.now()+30000;status(lastResult,error.message);}
  finally{busy=false;}
 }
 const select=document.createElement('select');select.id='cloud-history-mode';select.className='select';select.setAttribute('aria-label','K线数据来源');
 select.innerHTML='<option value="live">云端最新日线</option><option value="published">已发布完整历史</option>';
 select.onchange=()=>{cloud.setHistoryMode(select.value);const code=LiangceCharts.getRequestedCode()||document.querySelector('#tv-code').value;if(code)LiangceCharts.open(code);};
 document.querySelector('.tv-toolbar').prepend(select);
 const quoteLine=document.createElement('div');quoteLine.className='tv-readout';quoteLine.id='cloud-chart-quote';quoteLine.textContent='行情报价正在连接…';document.querySelector('.tv-toolbar').after(quoteLine);
 const note=document.createElement('div');note.className='tv-review-note';note.textContent='云端按需核验闭合日线；盘中报价单独更新。完整长期历史可切换“已发布完整历史”，两种来源分别展示。';document.querySelector('.tv-toolbar').after(note);
 const planNote=document.createElement('div');planNote.id='plan-live-quote';planNote.className='section-caption';document.querySelector('#plan-current').parentElement.after(planNote);
 window.addEventListener('load',()=>{for(const id of ['refresh-data','rescan-market']){const button=document.getElementById(id);button.textContent='刷新行情';button.onclick=()=>refresh(true);}document.querySelector('#batch-retry').textContent='检查评分快照';refresh();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){next=0;refresh();}});
 window.addEventListener('online',()=>{next=0;refresh();});
 window.addEventListener('liangce:chart-rendered',()=>{status(lastResult,lastError);refresh();});
 window.addEventListener('liangce:published-refreshed',()=>refresh(true));
 window.addEventListener('liangce:market-ready',()=>refresh());
 window.addEventListener('liangce:stock-requested',()=>refresh());
 setInterval(()=>refresh(),1000);
 window.LiangceLive={refresh,state:()=>({busy,next,lastKey,requests,lastResult,lastError,hidden:document.hidden})};
})();
