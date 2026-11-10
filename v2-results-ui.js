(() => {
 'use strict';
 const $=selector=>document.querySelector(selector),L=window.LightweightCharts;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const periods={day:'日线','1m':'1分钟','5m':'5分钟','15m':'15分钟','30m':'30分钟','60m':'60分钟',week:'周线',month:'月线',quarter:'季线',year:'年线','5d':'5日K线'};
 const states={success:'结果已完成',failed:'计算失败',pending:'待计算',running:'计算中'};
 const screen=document.createElement('div');screen.id='v2-results-screen';screen.className='content screen';screen.hidden=true;
 screen.innerHTML=`<div class="page-head"><div><h1>V2 任务结果</h1><div class="subtitle">在 LiangCe 查看本机已保存的任务、K线与结构证据</div></div><button id="v2-refresh" class="quiet-button">刷新任务</button></div><div class="v2-workspace"><section class="panel v2-list"><div class="panel-head"><h2 class="section-title">已保存任务</h2></div><div class="v2-filters"><select id="v2-source" class="select" aria-label="V2结果库"></select><select id="v2-job" class="select" aria-label="V2任务"></select><input id="v2-search" class="search" placeholder="搜索本任务股票" aria-label="搜索V2任务股票"></div><div id="v2-stocks" class="v2-stocks"></div><div class="table-foot"><span id="v2-count">等待加载</span><button id="v2-prev" class="quiet-button">上一页</button><button id="v2-next" class="quiet-button">下一页</button></div></section><section class="panel v2-result"><div class="panel-head"><div><h2 id="v2-title" class="section-title">选择任务查看结果</h2><div id="v2-meta" class="section-caption"></div></div><select id="v2-period" class="select" aria-label="V2结果周期"></select></div><div class="v2-actions"><span id="v2-status" role="status">点击左侧任务中的股票</span><button id="v2-retry" class="quiet-button" hidden>重新加载</button><button id="v2-fit" class="quiet-button">全部历史</button><button id="v2-recent" class="quiet-button">最近 200 根</button><button id="v2-export" class="quiet-button" disabled>导出当前周期证据</button></div><div class="v2-plot-wrap"><div id="v2-plot"></div><div id="v2-empty" class="v2-empty">等待读取本地任务库</div></div><div id="v2-evidence" class="method-note"></div></section></div>`;
 $('main').append(screen);
 const nav=document.createElement('button');nav.dataset.screen=screen.id;nav.innerHTML='<span class="glyph">▤</span>V2 任务结果';$('.nav').append(nav);
 const S={source:null,job:null,selected:null,period:'day',rows:[],offset:0,total:0,result:null,jobs:[],listVersion:0,jobVersion:0};
 let chart=null,candles=null,volume=null,markers=null,requestDraw=()=>{},searchTimer=null;
 function clearChart(message){
  S.result=null;$('#v2-title').textContent=S.selected?S.rows.find(row=>row.symbol===S.selected)?.name||S.selected:'选择任务查看结果';
  $('#v2-meta').textContent='';$('#v2-evidence').textContent='';$('#v2-status').textContent=message;
  $('#v2-empty').hidden=false;$('#v2-empty').textContent=message;$('#v2-export').disabled=true;$('#v2-retry').hidden=true;
  if(candles){candles.setData([]);volume.setData([]);markers.setMarkers([]);requestDraw();}
 }
 function ensureChart(){
  if(chart)return;
  chart=L.createChart($('#v2-plot'),{autoSize:true,layout:{background:{type:'solid',color:'#fff'},textColor:'#7a8581',fontFamily:'Microsoft YaHei',fontSize:11,attributionLogo:true},grid:{vertLines:{color:'#f0f3f1'},horzLines:{color:'#edf1ee'}},rightPriceScale:{borderColor:'#e4e9e6',scaleMargins:{top:.08,bottom:.12}},timeScale:{minBarSpacing:.001,borderColor:'#e4e9e6',timeVisible:true},localization:{locale:'zh-CN',timeFormatter:t=>new Date(t*1000).toISOString().replace('T',' ').slice(0,16)}});
  candles=chart.addSeries(L.CandlestickSeries,{upColor:'#c74b4b',downColor:'#087b68',borderUpColor:'#c74b4b',borderDownColor:'#087b68',wickUpColor:'#c74b4b',wickDownColor:'#087b68'});
  volume=chart.addSeries(L.HistogramSeries,{priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false},1);chart.panes()[1].setHeight(80);
  markers=L.createSeriesMarkers(candles,[]);
  candles.attachPrimitive({attached({requestUpdate}){requestDraw=requestUpdate;},paneViews(){return [{renderer:()=>({draw(target){
   const p=S.result?.panel;if(!p)return;
   target.useMediaCoordinateSpace(({context:ctx,mediaSize:size})=>{
    const bars=p.bars,byIndex=new Map(bars.map((bar,index)=>[bar.source_index??index,bar]));
    const x=index=>{const b=byIndex.get(index);return b?chart.timeScale().timeToCoordinate(b.time):null;};
    for(const center of p.centers||[]){const a=x(center.start),b=x(center.end),top=candles.priceToCoordinate(center.zg),bottom=candles.priceToCoordinate(center.zd);if([a,b,top,bottom].some(v=>v==null)||b<0||a>size.width)continue;ctx.fillStyle='rgba(8,123,104,.07)';ctx.strokeStyle='rgba(8,123,104,.5)';ctx.lineWidth=1;ctx.setLineDash([]);ctx.fillRect(a,top,b-a,bottom-top);ctx.strokeRect(a,top,b-a,bottom-top);}
    for(const [items,color,width] of [[p.strokes||[],'#9ba9b6',1],[p.segments||[],'#315e85',2]])for(const item of items){const a=x(item.start),b=x(item.end),y1=candles.priceToCoordinate(item.start_price),y2=candles.priceToCoordinate(item.end_price);if([a,b,y1,y2].some(v=>v==null)||b<0||a>size.width)continue;ctx.beginPath();ctx.strokeStyle=item.state==='provisional'?'#b87724':color;ctx.lineWidth=width;ctx.setLineDash(item.state==='provisional'?[5,4]:[]);ctx.moveTo(a,y1);ctx.lineTo(b,y2);ctx.stroke();}ctx.setLineDash([]);
   });
  }})}];}});
 }
 function renderResult(result){
  if(result.symbol!==S.selected||result.job_id!==S.job||result.source_id!==S.source)throw Error('任务、股票或结果库不一致');
  const panel=result.panel,summary=result.summary,bars=panel.bars;
  if(!bars?.length)throw Error('当前周期没有K线');
  for(let i=0;i<bars.length;i++){const b=bars[i];if(!Number.isFinite(b.time)||[b.open,b.high,b.low,b.close].some(v=>!Number.isFinite(v)||v<=0)||(i&&b.time<=bars[i-1].time))throw Error('结果K线数据校验失败');}
  S.result=result;ensureChart();
  candles.setData(bars.map(b=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close})));
  volume.setData(bars.filter(b=>Number.isFinite(b.volume)).map(b=>({time:b.time,value:b.volume,color:b.close>=b.open?'#c74b4b66':'#087b6866'})));
  const byIndex=new Map(bars.map((bar,index)=>[bar.source_index??index,bar]));
  markers.setMarkers((panel.signals||[]).filter(signal=>byIndex.has(signal.available_at)).map(signal=>({time:byIndex.get(signal.available_at).time,position:signal.side==='buy'?'belowBar':'aboveBar',color:signal.side==='buy'?'#c74b4b':'#087b68',shape:signal.side==='buy'?'arrowUp':'arrowDown',text:signal.label||signal.class,size:1})).sort((a,b)=>a.time-b.time));
  $('#v2-title').textContent=`${summary.name||S.selected} · ${S.selected.slice(2)}`;
  $('#v2-meta').textContent=`${periods[panel.period]||panel.period} · ${bars.length.toLocaleString()} 根 · ${bars[0].date_cn} → ${bars.at(-1).date_cn} · 原任务不复权口径`;
  $('#v2-status').textContent='已加载所选任务的真实结果';$('#v2-empty').hidden=true;$('#v2-export').disabled=false;
  $('#v2-period').innerHTML=result.periods.map(p=>`<option value="${esc(p.period)}">${esc(periods[p.period]||p.period)} · ${p.count.toLocaleString()} 根</option>`).join('');$('#v2-period').value=S.period;
  const confirmed=(panel.segments||[]).filter(s=>s.state==='confirmed').length;
  $('#v2-evidence').textContent=`任务 ${S.job} · 来源：已保存的 V2 研究结果。笔 ${(panel.strokes||[]).length} · 已确认线段 ${confirmed} · 中枢 ${(panel.centers||[]).length} · 候选 ${(panel.signals||[]).length}。${summary.result_text||''}。线段确认状态来自原任务；不等于已经满足买卖触发。任务采用其声明的V2定义，原文严格等价未证明。`;
  chart.timeScale().setVisibleLogicalRange({from:Math.max(0,bars.length-200),to:bars.length+3});requestDraw();
 }
 const loader=LiangceSelection.create(async key=>{
  const request=JSON.parse(key),r=await pywebview.api.get_v2_task_result(request.source,request.job,request.symbol,request.period);
  if(!r.ok)throw Error(r.message||'任务结果读取失败');return r;
 },event=>{
  if(event.state==='loading')clearChart('正在读取 '+(S.rows.find(row=>row.symbol===S.selected)?.name||S.selected)+' 的任务结果…');
  if(event.state==='idle')clearChart('请选择任务中的股票');
  if(event.state==='error'){clearChart(event.error.message||'结果读取失败');$('#v2-retry').hidden=false;}
  if(event.state==='ready'){
   if(!event.result.available){clearChart(event.result.message||'该股票尚无本任务结果');return;}
   try{renderResult(event.result);}catch(error){clearChart(error.message);$('#v2-retry').hidden=false;}
  }
 });
 function choose(symbol){S.selected=symbol;$('#v2-stocks').querySelectorAll('[data-symbol]').forEach(b=>b.classList.toggle('chosen',b.dataset.symbol===symbol));return loader.select(JSON.stringify({source:S.source,job:S.job,symbol,period:S.period}));}
 async function stocks(reset=true){
  const token=++S.listVersion,source=S.source,job=S.job;
  if(reset){S.selected=null;loader.clear();}if(!job)return;
  try{
   const data=await pywebview.api.get_v2_task_stocks(source,job,$('#v2-search').value,S.offset);
   if(token!==S.listVersion||source!==S.source||job!==S.job)return;
   S.rows=data.rows;S.total=data.total;
   $('#v2-stocks').innerHTML=data.rows.map(row=>`<button class="v2-stock" data-symbol="${row.symbol}"><strong>${esc(row.name)}</strong><span>${row.code} · ${esc(states[row.state]||row.state)}</span><small>${esc(row.last_date||'尚无结果日期')}${row.price!=null?' · ¥'+Number(row.price).toFixed(2):''}</small></button>`).join('')||'<div class="empty-state">当前任务没有匹配股票</div>';
   $('#v2-stocks').querySelectorAll('[data-symbol]').forEach(button=>button.onclick=()=>{S.period='day';choose(button.dataset.symbol);});
   $('#v2-count').textContent=`${data.total?S.offset+1:0}–${Math.min(S.offset+100,data.total)} / ${data.total}`;$('#v2-prev').disabled=S.offset===0;$('#v2-next').disabled=S.offset+100>=data.total;
   if(!data.rows.some(row=>row.symbol===S.selected)){const first=data.rows.find(row=>row.state==='success')||data.rows[0];if(first){S.period='day';await choose(first.symbol);}else clearChart('当前任务没有匹配股票');}
  }catch(error){if(token===S.listVersion)clearChart(error.message||'任务列表加载失败');}
 }
 async function jobs(sourceId=null){
  const token=++S.jobVersion;loader.clear();S.listVersion++;
  try{
   if(!window.pywebview?.api?.list_v2_jobs){clearChart('请在 LiangCe 桌面版中读取本机V2任务结果');return;}
   const data=await pywebview.api.list_v2_jobs(sourceId);if(token!==S.jobVersion)return;
   S.source=data.source_id;S.jobs=data.jobs;
   $('#v2-source').innerHTML=data.sources.map(item=>`<option value="${item.id}">${esc(item.label)}</option>`).join('');$('#v2-source').value=S.source||'';
   $('#v2-job').innerHTML=data.jobs.map(item=>`<option value="${esc(item.id)}">${esc(item.title)} · ${esc(item.created?.slice(5,16).replace('T',' '))} · 成功 ${item.success}/${item.total}</option>`).join('');
   S.job=data.jobs.some(item=>item.id===S.job)?S.job:(data.jobs.find(item=>item.success>0)||data.jobs[0])?.id||null;
   $('#v2-job').value=S.job||'';S.offset=0;
   if(S.job)await stocks();else clearChart(data.message||'当前任务库还没有计算任务');
  }catch(error){clearChart(error.message||'任务库读取失败');}
 }
 function show(){document.querySelectorAll('.screen').forEach(s=>s.hidden=s!==screen);document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b===nav));$('.crumb b').textContent='V2 任务结果';if(!S.jobs.length)jobs();else requestAnimationFrame(()=>{chart?.resize($('#v2-plot').clientWidth,$('#v2-plot').clientHeight);requestDraw();});}
 nav.onclick=show;
 $('#v2-source').onchange=()=>{S.job=null;jobs($('#v2-source').value);};
 $('#v2-job').onchange=()=>{S.job=$('#v2-job').value;S.offset=0;$('#v2-search').value='';stocks();};
 $('#v2-period').onchange=()=>{S.period=$('#v2-period').value;if(S.selected)choose(S.selected);};
 $('#v2-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{S.offset=0;stocks();},180);};
 $('#v2-prev').onclick=()=>{S.offset=Math.max(0,S.offset-100);stocks();};$('#v2-next').onclick=()=>{S.offset+=100;stocks();};
 $('#v2-refresh').onclick=()=>jobs(S.source);$('#v2-retry').onclick=()=>S.selected?choose(S.selected):jobs(S.source);
 $('#v2-fit').onclick=()=>chart?.timeScale().fitContent();$('#v2-recent').onclick=()=>{if(S.result)chart.timeScale().setVisibleLogicalRange({from:Math.max(0,S.result.panel.bars.length-200),to:S.result.panel.bars.length+3});};
 $('#v2-export').onclick=async()=>{
  if(!S.result)return;const result=S.result,period=S.period;$('#v2-export').disabled=true;
  try{const bytes=new TextEncoder().encode(JSON.stringify(result,null,2));let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
   const saved=await pywebview.api.save_chart_export(`liangce-v2-${result.symbol}-${period}.json`,btoa(binary));if(S.result===result)$('#v2-status').textContent=saved.ok?`已保存 ${saved.filename} · 可从图表复盘的导出目录打开`:'导出失败，请重试';
  }catch(error){if(S.result===result)$('#v2-status').textContent=error.message||'导出失败';}finally{if(S.result===result)$('#v2-export').disabled=false;}
 };
 document.querySelectorAll('.nav button').forEach(button=>{if(button!==nav)button.addEventListener('click',()=>{screen.hidden=true;});});
 window.LiangceV2Results={show,state:()=>({source:S.source,job:S.job,selected:S.selected,period:S.period,available:Boolean(S.result),rows:S.rows.map(r=>r.symbol),bars:S.result?.panel.bars.length,stock:S.result?.summary.name,loading:loader.current().state==='loading'})};
})();
