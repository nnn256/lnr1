(() => {
  'use strict';
  const M=window.LiangceChartModel,L=window.LightweightCharts;
  const $=selector=>document.querySelector(selector);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pretty=value=>Number(value||0).toLocaleString('zh-CN',{maximumFractionDigits:2});
  const timeString=value=>typeof value==='string'?value:value?`${value.year}-${String(value.month).padStart(2,'0')}-${String(value.day).padStart(2,'0')}`:null;
  const screen=document.createElement('div');screen.id='tv-chart-screen';screen.className='content screen tv-chart-screen';screen.hidden=true;
  screen.innerHTML=`<div class="page-head"><div><h1>图表复盘</h1><div id="tv-source" class="subtitle">TradingView Lightweight Charts · 真实历史与缠论结构逐时点复盘</div></div><span class="mode-tag">日线结构代理</span></div>
  <section class="panel"><div class="tv-toolbar"><select id="tv-symbol" class="select" aria-label="图表股票"><option value="">等待历史数据</option></select><input id="tv-code" class="search" inputmode="numeric" maxlength="6" placeholder="输入代码，如 600519" aria-label="按股票代码加载图表"><button id="tv-load" class="quiet-button">加载</button><button id="tv-refresh" class="quiet-button">刷新 K线</button><div class="tv-periods" role="group" aria-label="图表周期"><button data-tv-period="D" aria-pressed="true">日</button><button data-tv-period="W" aria-pressed="false">周</button><button data-tv-period="M" aria-pressed="false">月</button></div><span class="tv-spacer"></span><button id="tv-fit" class="quiet-button">适应</button><button id="tv-csv" class="quiet-button">导出 CSV</button><button id="tv-png" class="quiet-button">导出图片</button><button id="tv-plan" class="primary-button">导出 TradingView 绘图</button></div>
  <div class="tv-layerbar"><label><input id="tv-strokes" type="checkbox" checked>笔</label><label><input id="tv-centers-toggle" type="checkbox" checked>类中枢</label><label><input id="tv-signals" type="checkbox" checked>候选时点</label><label><input id="tv-volume" type="checkbox" checked>成交量</label><span style="color:var(--line)">│</span><button id="tv-pointer" class="tv-tool" aria-pressed="true">光标</button><button id="tv-trend" class="tv-tool" aria-pressed="false">趋势线</button><button id="tv-horizontal" class="tv-tool" aria-pressed="false">水平线</button><button id="tv-undo" class="tv-tool">撤销</button><span id="tv-drawing-status" class="tv-drawing-status">滚轮缩放 · 拖动平移</span></div>
  <div class="tv-signalbar"><select id="tv-side-filter" class="select" aria-label="买卖方向"><option value="all">买卖全部</option><option value="buy">买侧</option><option value="sell">卖侧</option></select><select id="tv-class-filter" class="select" aria-label="买卖点类别"><option value="all">一 / 二 / 三类</option><option value="1">仅一类</option><option value="2">仅二类</option><option value="3">仅三类</option></select><select id="tv-state-filter" class="select" aria-label="候选状态"><option value="active">当前待触发 / 已触发</option><option value="proxy_confirmed">规则触发有效</option><option value="waiting">待触发</option><option value="all">全部历史（含失效）</option><option value="invalidated">已失效</option><option value="superseded">结构已更新</option><option value="expired">已过观察期</option></select><span id="tv-signal-counts" class="tv-counts"></span></div><div id="tv-review-note" class="tv-review-note">严格缠论确认未实现；规则触发：后续收盘越过候选可用当根高/低价，失效优先，20根内未触发结束观察。</div><div id="tv-readout" class="tv-readout"><strong>等待真实历史</strong></div><div class="tv-plot-wrap"><div id="tv-plot" class="tv-plot" role="img" aria-label="TradingView真实K线、成交量和缠论结构图"></div><svg id="tv-centers" class="tv-centers" aria-hidden="true"></svg><div id="tv-empty" class="tv-empty">正在等待自动历史数据</div></div>
  <div class="tv-replay"><span>历史回放</span><button id="tv-prev" class="quiet-button" aria-label="前一根K线">←</button><input id="tv-replay" type="range" min="0" max="0" value="0" aria-label="历史回放截至时点"><button id="tv-next" class="quiet-button" aria-label="后一根K线">→</button><output id="tv-asof">—</output><button id="tv-latest" class="quiet-button">最新</button></div><div class="tv-footer"><button id="tv-export-dir" class="tv-tool">导出目录</button><span id="tv-status" class="tv-status" role="status">加载数据后自动绘图</span><a id="tv-external" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView ↗</a></div></section>
  <div class="tv-evidence-grid"><section class="panel"><div class="panel-head"><h2 class="section-title">候选与可用时点</h2><span class="section-caption">候选在首次可用日，规则触发在后续实际满足日</span></div><div class="table-wrap"><table><thead><tr><th>类别</th><th>结构端点</th><th>首次可用</th><th>当前状态 / 发生日</th><th>触发价 / 失效位</th></tr></thead><tbody id="tv-events"></tbody></table></div></section><section class="panel"><div class="panel-head"><h2 class="section-title">图上证据</h2><span id="tv-mode" class="mode-tag">structure_proxy</span></div><div id="tv-detail" class="method-note">点击候选查看结构证据与失效边界。</div></section></div>
  <div class="bottom-note">周线/月线由实际日线聚合，最后一根可能尚未收完；回放会截断数据重新计算，不使用右侧未来 K 线。笔和类中枢是结构代理，未实现严格线段、递归走势及低级别确认。</div>`;
  $('main').append(screen);
  let chart,candles,volume,markers,snapshot,history,aggregate=[],period='D',cursor=null,tool='pointer',pending=null;
  let strokeSeries=null,manualSeries=[],priceLines=[],manual=[],stored=new Map(),renderToken=0,replayTimer=null,lastSignature='';
  let lastSignal=null,centerRequest=()=>{},requestedCode=null;
  const nav=Array.from(document.querySelectorAll('.nav button')).find(button=>button.textContent.includes('图表复盘'));
  // The dedicated chart owns this route; the former table renderer replayed every stock.
  nav.onclick=null;
  function show(){
    document.querySelectorAll('.screen').forEach(item=>item.hidden=item!==screen);
    document.querySelectorAll('.nav button').forEach(button=>button.classList.toggle('active',button===nav));
    $('.crumb b').textContent='图表复盘';
    requestAnimationFrame(()=>{ensureChart();if(history&&!snapshot)render();else{chart?.resize($('#tv-plot').clientWidth,$('#tv-plot').clientHeight);drawCenters();}});
  }
  nav.addEventListener('click',()=>{show();const code=window.LiangceApp.selectedCode?.();if(code&&code!==history?.code)loadCode(code);});
  function ensureChart(){
    if(chart)return;
    chart=L.createChart($('#tv-plot'),{autoSize:true,layout:{background:{type:'solid',color:'#ffffff'},textColor:'#7a8581',fontFamily:'Microsoft YaHei, sans-serif',fontSize:11,attributionLogo:true,panes:{separatorColor:'#e4e9e6',separatorHoverColor:'#a5b9b0'}},grid:{vertLines:{color:'#f0f3f1'},horzLines:{color:'#edf1ee'}},crosshair:{mode:L.CrosshairMode.Normal,vertLine:{color:'#91aaa1',labelBackgroundColor:'#526d62'},horzLine:{color:'#91aaa1',labelBackgroundColor:'#526d62'}},rightPriceScale:{borderColor:'#e4e9e6',minimumWidth:70,scaleMargins:{top:.1,bottom:.13}},timeScale:{borderColor:'#e4e9e6',rightOffset:4,barSpacing:7,minBarSpacing:2,timeVisible:false},localization:{locale:'zh-CN'}});
    candles=chart.addSeries(L.CandlestickSeries,{upColor:'#c74b4b',downColor:'#087b68',borderUpColor:'#c74b4b',borderDownColor:'#087b68',wickUpColor:'#c74b4b',wickDownColor:'#087b68',priceFormat:{type:'price',precision:2,minMove:.01}});
    candles.attachPrimitive({
      attached({requestUpdate}){centerRequest=requestUpdate;},
      paneViews(){return [{zOrder:()=> 'bottom',renderer:()=>({draw(target){
        if(!snapshot||!$('#tv-centers-toggle').checked)return;
        target.useMediaCoordinateSpace(({context:ctx,mediaSize:size})=>{
          ctx.fillStyle='rgba(184,119,36,.065)';ctx.strokeStyle='rgba(184,119,36,.45)';ctx.lineWidth=1;
          for(const center of snapshot.centers){
            const x1=chart.timeScale().timeToCoordinate(center.start_time),x2=chart.timeScale().timeToCoordinate(center.end_time),y1=candles.priceToCoordinate(center.zg),y2=candles.priceToCoordinate(center.zd);
            if([x1,x2,y1,y2].some(value=>value==null))continue;
            const left=Math.max(0,Math.min(x1,x2)),right=Math.min(size.width,Math.max(x1,x2));
            const top=Math.max(0,Math.min(y1,y2)),bottom=Math.min(size.height,Math.max(y1,y2));
            if(right<=left||bottom<=top)continue;
            ctx.fillRect(left,top,right-left,bottom-top);ctx.strokeRect(left,top,right-left,bottom-top);
          }
        });
      }})}];}
    });
    volume=chart.addSeries(L.HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:'right',lastValueVisible:false,priceLineVisible:false},1);
    chart.panes()[1].setHeight(92);
    markers=L.createSeriesMarkers(candles,[],{autoScale:true});
    chart.subscribeCrosshairMove(event=>{const data=event.seriesData.get(candles);if(data&&data.open!=null)readout(data);else if(snapshot?.bars.length)readout(snapshot.bars.at(-1));});
    chart.subscribeClick(onChartClick);
    chart.timeScale().subscribeVisibleLogicalRangeChange(drawCenters);
    new ResizeObserver(()=>requestAnimationFrame(drawCenters)).observe($('#tv-plot'));
  }
  function readout(bar){
    $('#tv-readout').innerHTML=`<strong>${esc(history?.name||history?.code||'')}</strong><span>${esc(timeString(bar.time)||bar.date)}</span><span>开 ${Number(bar.open).toFixed(2)}</span><span>高 ${Number(bar.high).toFixed(2)}</span><span>低 ${Number(bar.low).toFixed(2)}</span><span class="${bar.close>=bar.open?'up':'down'}">收 ${Number(bar.close).toFixed(2)}</span>`;
  }
  function removeOverlays(){
    if(strokeSeries){chart.removeSeries(strokeSeries);strokeSeries=null;}
    manualSeries.forEach(series=>chart.removeSeries(series));manualSeries=[];
    priceLines.forEach(line=>candles.removePriceLine(line));priceLines=[];
  }
  function drawOverlays(){
    if(!snapshot||!chart)return;
    removeOverlays();
    if($('#tv-strokes').checked&&snapshot.points.length){
      strokeSeries=chart.addSeries(L.LineSeries,{color:'#526d88',lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
      strokeSeries.setData(snapshot.points.map(p=>({time:p.time,value:p.price})));
    }
    const validManual=manual.filter(drawing=>drawing.points.every(point=>new Date(point.time*1000).toISOString().slice(0,10)<=snapshot.as_of));
    for(const drawing of validManual){
      if(drawing.type==='horizontal_line')priceLines.push(candles.createPriceLine({price:drawing.points[0].price,color:'#8365a7',lineWidth:1,lineStyle:L.LineStyle.Dashed,title:'手动画线'}));
      else{
        const series=chart.addSeries(L.LineSeries,{color:'#8365a7',lineWidth:2,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
        series.setData(drawing.points.map(point=>({time:new Date(point.time*1000).toISOString().slice(0,10),value:point.price})).sort((a,b)=>a.time.localeCompare(b.time)));
        manualSeries.push(series);
      }
    }
    const events=$('#tv-signals').checked?filteredSignals():[];
    markers.setMarkers(events.map(signal=>{
      const state=signal.confirmation.state,triggered=state==='proxy_confirmed';
      const ended=['invalidated','expired','superseded'].includes(state);
      return {time:triggered?signal.confirmation.confirmed_at:signal.available_at,position:signal.side==='buy'?'belowBar':'aboveBar',color:ended?'#9ba49f':signal.side==='buy'?'#c74b4b':'#087b68',shape:ended?'circle':signal.side==='buy'?'arrowUp':'arrowDown',text:`${['','一','二','三'][signal.signal_class]}${signal.side==='buy'?'买':'卖'}·${triggered?'规则触发':signal.confirmation.label}`,size:1};
    }).sort((a,b)=>a.time.localeCompare(b.time)));
    volume.applyOptions({visible:$('#tv-volume').checked});chart.panes()[1].setHeight($('#tv-volume').checked?92:24);
    drawCenters();
  }
  function drawCenters(){
    if(!chart||!snapshot||screen.hidden)return;
    centerRequest();
  }
  function filteredSignals(){
    if(!snapshot)return [];
    const side=$('#tv-side-filter').value,cls=$('#tv-class-filter').value,state=$('#tv-state-filter').value;
    return snapshot.signals.filter(signal=>(side==='all'||signal.side===side)&&(cls==='all'||String(signal.signal_class)===cls)&&(state==='all'||(state==='active'?['waiting','proxy_confirmed'].includes(signal.confirmation.state):signal.confirmation.state===state)));
  }
  function renderSignalReview(){
    const counts=snapshot.signal_counts,c=counts.by_class,state=counts.by_state;
    $('#tv-signal-counts').textContent=`全历史：一买 ${c.buy1} / 二买 ${c.buy2} / 三买 ${c.buy3} · 一卖 ${c.sell1} / 二卖 ${c.sell2} / 三卖 ${c.sell3}`;
    const level={D:'日线',W:'周线',M:'月线'}[period];
    $('#tv-review-note').textContent=`当前状态：待触发 ${state.waiting} · ${level}规则触发有效 ${state.proxy_confirmed} · 已失效 ${state.invalidated} · 已过期 ${state.expired} · 结构更新 ${state.superseded}。严格缠论确认 0（未实现）。规则触发＝后续收盘越过候选可用当根高/低价；失效优先，20根内未触发结束观察。`;
    const visible=filteredSignals().slice(-60).reverse();
    $('#tv-events').innerHTML=visible.map((signal,index)=>`<tr><td><button class="tv-event" data-event="${index}">${esc(signal.label)}</button></td><td>${esc(signal.point_time)}</td><td>${esc(signal.available_at)}</td><td><span class="tv-state tv-state-${signal.confirmation.state}">${esc(signal.confirmation.label)}</span><div class="stock-code">${esc(signal.confirmation.state_changed_at)}</div></td><td>${signal.confirmation.trigger_price.toFixed(2)} / ${signal.invalidation.toFixed(2)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty-state">当前筛选没有候选；可切换“全部历史（含失效）”查看事件记录</td></tr>';
    $('#tv-events').querySelectorAll('[data-event]').forEach(button=>button.onclick=()=>{const signal=visible[Number(button.dataset.event)];detail(signal);const date=signal.confirmation.confirmed_at||signal.available_at,idx=snapshot.bars.findIndex(bar=>bar.date===date);chart.timeScale().setVisibleLogicalRange({from:Math.max(0,idx-50),to:Math.min(snapshot.bars.length+2,idx+25)});});
  }
  function detail(signal){
    lastSignal=signal;
    if(!signal){
      const counts=snapshot?.signal_counts;
      $('#tv-detail').innerHTML=`<div class="tv-detail-title">${esc(history?.name||history?.code||'')} · ${period==='D'?'日':period==='W'?'周':'月'}线</div><div class="tv-context">笔 ${snapshot?.moves.length||0} · 类中枢 ${snapshot?.centers.length||0} · 历史候选 ${snapshot?.signals.length||0}<br>当前筛选 ${filteredSignals().length} 个<br>待触发 ${counts?.by_state.waiting||0} · 规则触发有效 ${counts?.proxy_confirmed||0}<br>严格缠论确认 0（未实现）<br>截至 ${snapshot?.as_of||'—'}<br>点击左侧候选查看触发、失效和结构更新日期。</div>`;return;
    }
    const review=signal.confirmation;
    $('#tv-detail').innerHTML=`<div class="tv-detail-title ${signal.side==='buy'?'up':'down'}">${esc(signal.label)} · ${esc(review.label)}</div><div class="tv-detail-price">¥${signal.price.toFixed(2)}</div><div class="tv-context">结构端点 ${esc(signal.point_time)}<br>首次可用 ${esc(signal.available_at)}<br>后续收盘触发价 ¥${review.trigger_price.toFixed(2)}<br>触发日期 ${review.confirmed_at||'尚未满足'}<br>失效边界 ¥${signal.invalidation.toFixed(2)}<br>失效日期 ${review.invalidated_at||'—'}<br>结构更新 ${review.superseded_at||'—'}<br>类中枢 ${esc(signal.center_id||'—')} · ZD ${signal.zd?.toFixed(2)||'—'} / ZG ${signal.zg?.toFixed(2)||'—'}<br>${esc(signal.basis)}<br>${esc(review.reason)}<br>当前是${period==='D'?'日':period==='W'?'周':'月'}线价格触发规则，严格缠论确认未实现。</div>`;
  }
  function render(){
    if(!history||screen.hidden)return;
    ensureChart();
    const wasNew=!snapshot||snapshot.code!==history.code||snapshot.period!==period;
    const token=++renderToken;
    $('#tv-status').textContent='正在按所选时点重新计算结构…';
    try{
      const options={period};if(cursor!=null)options.endIndex=cursor;
      const next=M.buildSnapshot(history,options);if(token!==renderToken)return;
      snapshot=next;
      candles.setData(snapshot.bars.map(bar=>({time:bar.time,open:bar.open,high:bar.high,low:bar.low,close:bar.close})));
      volume.setData(snapshot.bars.map(bar=>({time:bar.time,value:bar.volume,color:bar.close>=bar.open?'#c74b4b88':'#087b6888'})));
      drawOverlays();
      if(wasNew)chart.timeScale().setVisibleLogicalRange({from:Math.max(0,snapshot.bars.length-140),to:snapshot.bars.length+3});
      $('#tv-empty').hidden=snapshot.bars.length>0;
      $('#tv-asof').textContent=snapshot.as_of||'—';$('#tv-replay').max=String(Math.max(0,aggregate.length-1));$('#tv-replay').value=String(cursor==null?aggregate.length-1:cursor);
      $('#tv-source').textContent=`${history.name||history.code} ${history.code} · ${history.history_note||'缓存待核验'} · ${history.source||'真实历史'} · ${history.adjustment==='provider_unspecified'?'复权口径未认证':history.adjusted?'前复权来源标记':'未复权'} · ${history.bars[0]?.date} → ${history.bars.at(-1)?.date}`;
      $('#tv-status').textContent=`${snapshot.bars.length} 根${period==='D'?'日':period==='W'?'周':'月'}线 · 笔 ${snapshot.moves.length} · 类中枢 ${snapshot.centers.length} · 候选 ${snapshot.signals.length} · ${cursor==null?'最新':'历史回放'}`;
      const symbol=M.tradingViewSymbol(String(history.code));$('#tv-external').href=symbol?`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`:'https://www.tradingview.com/';
      renderSignalReview();
      readout(snapshot.bars.at(-1));detail(null);requestAnimationFrame(drawCenters);
      window.dispatchEvent(new CustomEvent('liangce:chart-rendered',{detail:{code:history.code,as_of:snapshot.as_of,period,bars:snapshot.bars.length}}));
    }catch(error){$('#tv-status').textContent='图表数据校验失败，请重新加载该股票';console.error('tradingview-chart',error);}
  }
  function signature(item){return `${item.code}:${Boolean(item.adjusted)}:${JSON.stringify(item.bars)}`;}
  function select(item){
    const sig=signature(item);
    if(snapshot&&history?.code===item.code&&sig===lastSignature){
      history=item;
      $('#tv-source').textContent=`${item.name||item.code} ${item.code} · ${item.history_note||'缓存待核验'} · ${item.source} · ${item.adjusted?'前复权来源标记':'未复权'} · ${item.first_date} → ${item.last_date}`;
      return;
    }
    history=item;aggregate=M.aggregateBars(item.bars,period);cursor=null;snapshot=null;lastSignature=sig;pending=null;manual=stored.get(item.code+':'+period)||[];$('#tv-code').value=item.code;$('#tv-symbol').value=item.code;render();
  }
  function setHistories(items){
    for(const item of items)stored.set('history:'+item.code,item);
    const previous=$('#tv-symbol').value;
    const all=Array.from(stored.entries()).filter(([key])=>key.startsWith('history:')).map(([,value])=>value);
    $('#tv-symbol').innerHTML=all.map(item=>`<option value="${item.code}">${esc(item.name||item.code)} · ${item.code}</option>`).join('');
    if(history){$('#tv-symbol').value=history.code;const updated=stored.get('history:'+history.code);if(updated&&signature(updated)!==lastSignature)select(updated);else if(updated)history=updated;}
    else if(all.length&&!requestedCode)select(all.find(item=>item.code===previous)||all[0]);
  }
  const selectionLoader=LiangceSelection.create(async key=>{
    const request=JSON.parse(key);
    const item=await window.pywebview.api.get_chart_history(request.code,1200,request.force);
    if(!item.ok)throw Error(item.message||'历史加载未完成');
    if(item.code!==request.code)throw Error('返回历史的股票代码不一致');
    return item;
  },event=>{
    if(event.state==='loading'){
      const request=JSON.parse(event.key),known=stored.get('history:'+request.code);
      requestedCode=request.code;
      $('#tv-code').value=request.code;
      if(known)select(known);
      else {history=null;snapshot=null;aggregate=[];if(chart){removeOverlays();candles.setData([]);volume.setData([]);markers.setMarkers([]);centerRequest();}$('#tv-source').textContent=request.code+' · 正在读取历史';$('#tv-empty').hidden=false;$('#tv-empty').textContent='正在加载 '+request.code+' 的真实历史…';$('#tv-events').innerHTML='';$('#tv-detail').textContent='等待该股票结果';$('#tv-readout').textContent='正在加载 '+request.code;}
      $('#tv-status').textContent='正在核验 '+request.code+' 的最新K线…';
    }
    if(event.state==='ready'){
      const item=event.result;stored.set('history:'+item.code,item);select(item);setHistories([item]);
      window.dispatchEvent(new CustomEvent('liangce:history-selected',{detail:item}));
      $('#tv-status').textContent=`${item.history_note||'历史已获取'} · K线截至 ${item.last_date}`;
    }
    if(event.state==='error'){$('#tv-status').textContent=event.error.message||'历史加载失败';if(!snapshot){$('#tv-empty').hidden=false;$('#tv-empty').textContent='历史暂不可用，请点击刷新 K线重试';}}
  });
  async function loadCode(code,force=false){
    code=String(code||'').trim();if(!/^\d{6}$/.test(code)){$('#tv-status').textContent='请输入六位股票代码';return;}
    if(!window.pywebview?.api?.get_chart_history){const known=stored.get('history:'+code);if(known)select(known);else $('#tv-status').textContent='请在桌面版加载该股票真实历史';return;}
    return selectionLoader.select(JSON.stringify({code,force}));
  }
  function setTool(next){tool=next;pending=null;for(const [name,id]of [['pointer','pointer'],['trend_line','trend'],['horizontal_line','horizontal']])$('#tv-'+id).setAttribute('aria-pressed',String(next===name));$('#tv-drawing-status').textContent=next==='pointer'?'滚轮缩放 · 拖动平移':next==='trend_line'?'在主图依次点击两个点':'在主图点击价格位置';}
  function onChartClick(event){
    if(tool==='pointer'||!snapshot||event.paneIndex!==0||!event.time||!event.point)return;
    const date=timeString(event.time),price=candles.coordinateToPrice(event.point.y);if(price==null||price<=0)return;
    const point={time:Date.parse(date+'T00:00:00Z')/1000,price};
    if(tool==='trend_line'&&!pending){pending=point;$('#tv-drawing-status').textContent='已选起点，请选择终点';return;}
    if(tool==='trend_line'&&pending.time===point.time){$('#tv-drawing-status').textContent='请选择不同日期的终点';return;}
    const drawing={type:tool,points:tool==='horizontal_line'?[point]:[pending,point].sort((a,b)=>a.time-b.time),overrides:{linecolor:'#8365a7',linewidth:2},text:'手工研究标记'};
    manual.push(drawing);stored.set(history.code+':'+period,manual);setTool('pointer');drawOverlays();
  }
  async function download(blob,name){
    if(window.pywebview?.api?.save_chart_export){
      const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
      for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
      const result=await window.pywebview.api.save_chart_export(name,btoa(binary));
      if(!result.ok)throw Error(result.message||'文件未保存');
      $('#tv-status').textContent=`已保存 ${result.filename} · 点击“导出目录”查看`;
      return result;
    }
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function exportPlan(){
    if(!snapshot)return;
    const eligible=manual.filter(drawing=>drawing.points.every(point=>new Date(point.time*1000).toISOString().slice(0,10)<=snapshot.as_of));
    const plan=M.buildDrawingPlan(snapshot,history,{includeStrokes:$('#tv-strokes').checked,includeCenters:$('#tv-centers-toggle').checked,userDrawings:eligible});
    plan.original_drawing_count=plan.drawings.length;
    if(plan.drawings.length>200){
      plan.drawings=plan.drawings.slice().sort((a,b)=>(a.available_at||snapshot.as_of).localeCompare(b.available_at||snapshot.as_of)).slice(-200);
      plan.export_scope='仅导出最近可用的200个绘图对象';
    }else plan.export_scope='当前可用全部绘图对象';
    const input=JSON.stringify(snapshot.bars.map(({date,open,high,low,close,volume})=>({date,open,high,low,close,volume})));
    plan.input_sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
    plan.input_hash_basis='当前回放截至时点的聚合OHLCV，JSON字段顺序date/open/high/low/close/volume';
    plan.signal_review={rule_id:LiangceSignalReview.RULE_ID,counts:snapshot.signal_counts,signals:snapshot.signals,strict_confirmed:false};
    plan.exported_at=new Date().toISOString();
    await download(new Blob([JSON.stringify(plan,null,2)],{type:'application/json'}),`liangce-tradingview-${history.code}-${period}-${snapshot.as_of}.json`);
    $('#tv-status').textContent=plan.symbol?`已导出 ${plan.drawings.length}/${plan.original_drawing_count} 个对象 · ${plan.symbol} · 导出目录可查看`:'已导出证据；北交所 TradingView 代码映射需手动核对';
    return plan;
  }
  $('#tv-load').onclick=()=>loadCode($('#tv-code').value);$('#tv-code').onkeydown=event=>{if(event.key==='Enter')loadCode(event.target.value);};
  $('#tv-refresh').onclick=()=>loadCode($('#tv-code').value,true);
  $('#tv-symbol').onchange=()=>loadCode($('#tv-symbol').value);
  document.querySelectorAll('[data-tv-period]').forEach(button=>button.onclick=()=>{period=button.dataset.tvPeriod;document.querySelectorAll('[data-tv-period]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));if(history){aggregate=M.aggregateBars(history.bars,period);cursor=null;snapshot=null;manual=stored.get(history.code+':'+period)||[];render();}});
  ['side','class','state'].forEach(name=>$('#tv-'+name+'-filter').onchange=()=>{if(snapshot){drawOverlays();renderSignalReview();detail(null);}});
  ['strokes','centers-toggle','signals','volume'].forEach(name=>$('#tv-'+name).onchange=drawOverlays);
  $('#tv-export-dir').onclick=()=>window.pywebview?.api?.open_chart_exports();
  $('#tv-fit').onclick=()=>{chart?.timeScale().fitContent();drawCenters();};
  $('#tv-replay').oninput=()=>{clearTimeout(replayTimer);replayTimer=setTimeout(()=>{cursor=Number($('#tv-replay').value);render();},100);};
  function step(amount){if(!aggregate.length)return;cursor=Math.max(0,Math.min(aggregate.length-1,(cursor??aggregate.length-1)+amount));render();}
  $('#tv-prev').onclick=()=>step(-1);$('#tv-next').onclick=()=>step(1);$('#tv-latest').onclick=()=>{cursor=null;render();};
  $('#tv-pointer').onclick=()=>setTool('pointer');$('#tv-trend').onclick=()=>setTool('trend_line');$('#tv-horizontal').onclick=()=>setTool('horizontal_line');
  $('#tv-undo').onclick=()=>{manual.pop();pending=null;drawOverlays();};$('#tv-plan').onclick=()=>exportPlan().catch(error=>$('#tv-status').textContent=error.message);
  $('#tv-csv').onclick=async()=>{
    if(!snapshot)return;
    const csv=['date,code,open,high,low,close,volume',...snapshot.bars.map(bar=>[bar.date,history.code,bar.open,bar.high,bar.low,bar.close,bar.volume].join(','))].join('\r\n');
    try{await download(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),`liangce-${history.code}-${period}-${snapshot.as_of}.csv`);}catch(error){$('#tv-status').textContent=error.message;}
  };
  $('#tv-png').onclick=async()=>{
    if(!chart||!snapshot)return;
    const image=chart.takeScreenshot();
    image.toBlob(blob=>{if(blob)download(blob,`liangce-${history.code}-${period}-${snapshot.as_of}.png`).catch(error=>$('#tv-status').textContent=error.message);});
  };
  window.addEventListener('liangce:histories',event=>setHistories(event.detail));
  window.addEventListener('liangce:history-selected',event=>setHistories([event.detail]));
  setInterval(()=>{if(!document.hidden&&!screen.hidden&&history&&cursor==null&&selectionLoader.current().state!=='loading')loadCode(history.code);},60000);
  window.LiangceCharts={open(code){show();if(code)loadCode(code);else if(!history&&window.liangceHistory?.length)setHistories(window.liangceHistory);},getSnapshot:()=>snapshot,getDrawings:()=>manual.slice(),exportPlan,show};
  if(window.liangceHistory?.length)setHistories(window.liangceHistory);
})();
