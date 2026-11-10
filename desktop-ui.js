(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => Number(value || 0).toLocaleString('zh-CN', {maximumFractionDigits:2});
  const stamp = value => value ? new Date(value).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false}) : '—';
  let marketVersion = -1, historyVersion = -1, market = null, histories = [], currentCode = null;
  let polling = false, started = false, activeModule = null, chanSignature = '';

  const style = document.createElement('style');
  style.textContent = `.data-pipeline{margin-bottom:18px}.pipeline-top{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:14px 16px}.pipeline-message{font-weight:600;color:var(--teal)}.pipeline-meta{font-size:11px;color:var(--muted);margin-top:5px}.pipeline-progress{height:3px;background:var(--line)}.pipeline-progress>span{display:block;height:100%;background:var(--teal);transition:width .2s}.history-section{margin-top:18px}.history-dialog{width:min(960px,94vw);max-height:90vh;overflow:auto;border:1px solid var(--line);border-radius:var(--radius);padding:22px;color:var(--ink);background:var(--paper)}.history-dialog::backdrop{background:#17221d88}.history-dialog svg{width:100%;height:270px;display:block;margin:20px 0}.history-dialog header{display:flex;justify-content:space-between;align-items:center;gap:16px}.data-link{border:0;background:transparent;color:var(--teal);padding:0;text-align:left}.history-badge{font-size:11px;color:var(--muted);margin:8px 0}.quote-scroll{max-height:360px;overflow:auto}.data-pipeline .quiet-button{white-space:nowrap}.history-section td{white-space:nowrap}`;
  document.head.append(style);
  const pipeline = document.createElement('section');
  pipeline.className = 'panel data-pipeline';
  pipeline.innerHTML = `<div class="pipeline-top"><div><div id="pipeline-message" class="pipeline-message" role="status">正在启动后台采集…</div><div id="pipeline-meta" class="pipeline-meta">全市场报价自动刷新；全部股票日线评分进度见下方</div></div><button id="refresh-data" class="quiet-button">立即更新</button></div><div class="pipeline-progress"><span id="pipeline-progress" style="width:0%"></span></div>`;
  $('#market-screen .page-head').after(pipeline);
  const historySection = document.createElement('section');
  historySection.className = 'panel history-section';
  historySection.innerHTML = `<div class="panel-head"><div class="panel-title-wrap"><h2 class="section-title">已打开的历史详情</h2><span id="history-summary" class="section-caption">等待全市场报价后自动下载</span></div><span class="mode-tag">日线 · 分别保留复权口径</span></div><div class="table-wrap quote-scroll"><table><thead><tr><th>标的</th><th>日线根数</th><th>开始日期</th><th>最新日期</th><th>获取时间</th><th>状态 / 查看</th></tr></thead><tbody id="history-rows"><tr><td colspan="6" class="empty-state">历史下载进度会逐只显示，不需要手动导入</td></tr></tbody></table></div><div class="assumption-bar">以下仅列出已打开详情的历史；全市场后台评分数量见上方进度。点击股票可打开完整历史及图表。未复权日线可能受除权影响；候选池回测存在选择偏差。</div>`;
  $('#market-screen').append(historySection);
  const dialog = document.createElement('dialog');
  dialog.className = 'history-dialog'; dialog.id = 'history-dialog';
  document.body.append(dialog);

  const chanScreen = document.createElement('div');
  chanScreen.id = 'chan-screen'; chanScreen.className = 'content screen'; chanScreen.hidden = true;
  chanScreen.innerHTML = `<div class="page-head"><div><h1>缠论结构 · 历史回放</h1><div class="subtitle">使用已自动下载的真实日线；结构候选保留各自可用时点</div></div><select id="chan-code" class="select" aria-label="缠论历史股票"></select></div><section class="panel"><div class="panel-head"><h2 class="section-title">买卖候选</h2><select id="chan-filter" class="select"><option value="all">全部</option><option value="buy">买入候选</option><option value="sell">卖出候选</option></select></div><div class="table-wrap"><table><thead><tr><th>标的 / 时点</th><th>类别</th><th>结构价</th><th>失效边界</th><th>触发价</th><th>状态 / 发生日</th></tr></thead><tbody id="chan-rows"></tbody></table></div><div id="chan-evidence" class="assumption-bar">等待历史 K 线</div></section><div class="method-note" style="margin-top:16px">本版为方向包含、分型、固定间隔笔和三笔重叠类中枢的研究代理。严格线段特征序列、走势递归、背驰证明与多级别触发尚未完成，严格缠论确认未实现；额外日线规则要求后续收盘越过候选可用当根的高/低价，后续失效优先，20根内未触发结束观察。</div>`;
  $('main').append(chanScreen);
  const chanNav = document.createElement('button');
  chanNav.dataset.screen = 'chan-screen'; chanNav.innerHTML = '<span class="glyph">⌁</span>缠论 · 通达信';
  $('.nav').append(chanNav);
  function showScreen(screen, button, title) {
    document.querySelectorAll('.screen').forEach(item => item.hidden = item !== screen);
    document.querySelectorAll('.nav button').forEach(item => item.classList.toggle('active',item===button));
    $('.crumb b').textContent = title;
  }
  chanNav.onclick = () => {activeModule=null;showScreen(chanScreen,chanNav,'缠论 · 通达信');renderChan();};
  $('#chan-code').onchange = () => {currentCode=$('#chan-code').value;renderChan();};
  $('#chan-filter').onchange = renderChan;
  // Dynamically appended screens must also disappear when returning to an original route.
  document.querySelectorAll('.nav button[data-screen]').forEach(button => {
    if(button!==chanNav) button.addEventListener('click',()=>{
      activeModule=null;
      document.querySelectorAll('.screen').forEach(screen=>screen.hidden=screen.id!==button.dataset.screen);
    });
  });

  function renderMarket(data) {
    market=data; window.liangceLiveMarket=data;
    window.LiangceApp.loadMarket(data);
    $('#live-count').textContent=fmt(data.total_quotes);
    $('#live-source').textContent=data.cached?'上次行情缓存':'通达信报价已获取';
    $('#live-breadth').textContent=`${data.rows.filter(row=>row.change>0).length} / ${data.rows.filter(row=>row.change<0).length}`;
    const leader=data.rows.slice().sort((a,b)=>b.change-a.change)[0];
    $('#live-leader').textContent=leader.name;
    $('#live-leader-change').textContent=`${leader.change.toFixed(2)}% · ${leader.code}`;
    $('#live-asof').textContent=new Date(data.received_at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
    $('#live-asof').nextElementSibling.textContent='本机获取时间 · 非逐笔行情时间';
    $('#scan-codes').textContent=fmt(data.total_codes);
    $('#scan-quotes').textContent=fmt(data.total_quotes);
    $('#scan-coverage').textContent=`${(data.total_quotes/data.total_codes*100).toFixed(1)}%`;
    $('#market-screen .subtitle').textContent=`沪深京报价 ${fmt(data.total_quotes)} / ${fmt(data.total_codes)} 只 · ${data.cached?'上次缓存':'真实接口快照'}`;
    $('#overview-note').textContent=`报价获取于 ${stamp(data.received_at)}。休市时显示最近快照；历史下载结果见下方。`;
    if(activeModule) renderModule(activeModule);
  }

  function renderHistory(items) {
    const combined=new Map(histories.map(item=>[item.code,item]));
    items.forEach(item=>combined.set(item.code,item));
    items=[...combined.values()];
    histories=items; window.liangceHistory=items;
    window.dispatchEvent(new CustomEvent('liangce:histories',{detail:items}));
    window.LiangceApp.loadHistory(items);
    const total=items.reduce((sum,item)=>sum+item.bars.length,0);
    const latest=items.map(item=>item.last_date).sort().at(-1);
    $('#history-summary').textContent=`${items.length} 只 · ${fmt(total)} 根有效日线 · 最新至 ${latest||'—'}`;
    $('#history-rows').innerHTML=items.map(item=>`<tr><td><button class="data-link" data-history="${item.code}">${esc(item.name)} <span class="stock-code">${item.code}</span></button></td><td>${fmt(item.bars.length)}</td><td>${item.first_date}</td><td>${item.last_date}</td><td>${stamp(item.received_at)}</td><td>${item.history_freshness==='verified'?'已核验':item.history_freshness==='market_lag'?'早于市场日期':item.history_freshness==='stale_fallback'?'更新失败·旧缓存':'缓存待核验'} · ${item.adjustment==='provider_unspecified'?'复权口径未认证':item.adjusted?'前复权来源标记':'未复权'} · <button class="data-link" data-history="${item.code}">K 线 / 明细</button></td></tr>`).join('');
    $('#history-rows').querySelectorAll('[data-history]').forEach(button=>button.onclick=()=>openHistory(button.dataset.history));
    $('#chan-code').innerHTML=items.map(item=>`<option value="${item.code}">${esc(item.name)} · ${item.code}</option>`).join('');
    currentCode=items.some(item=>item.code===currentCode)?currentCode:items[0]?.code;
    $('#chan-code').value=currentCode||'';
    if(!chanScreen.hidden)renderChan();
    if(activeModule) renderModule(activeModule);
  }

  function renderChan() {
    const item=histories.find(row=>row.code===currentCode);
    if(!item){$('#chan-rows').innerHTML='<tr><td colspan="6" class="empty-state">等待候选历史日线自动下载</td></tr>';return;}
    const filter=$('#chan-filter').value,signature=JSON.stringify([item.code,item.bars,filter]);
    if(signature===chanSignature)return;chanSignature=signature;
    const result=Chanlun.replay(item.bars);
    result.signals=LiangceSignalReview.reviewSignals(item.bars,result.signals);
    const counts=LiangceSignalReview.signalCounts(result.signals);
    const signals=result.signals.filter(signal=>filter==='all'||signal.side===filter).slice(-80).reverse();
    $('#chan-rows').innerHTML=signals.map(signal=>`<tr><td>${esc(item.name)}<div class="stock-code">${esc(signal.available_at)}</div></td><td class="${signal.side==='buy'?'up':'down'}">${esc(signal.label)}</td><td>${signal.price.toFixed(2)}</td><td>${signal.invalidation.toFixed(2)}</td><td>${signal.confirmation.trigger_price.toFixed(2)}</td><td>${esc(signal.confirmation.label)}<div class="stock-code">${esc(signal.confirmation.state_changed_at)}</div></td></tr>`).join('')||'<tr><td colspan="6" class="empty-state">当前历史范围没有满足规则的候选</td></tr>';
    $('#chan-evidence').textContent=`${item.code} · ${item.bars.length} 根日线 · ${item.first_date} → ${item.last_date} · 分型/笔端点 ${result.points?.length||0} · 类中枢 ${result.centers?.length||0} · 候选 ${result.signals.length} · 日线规则触发有效 ${counts.proxy_confirmed} · 已失效 ${counts.by_state.invalidated} · 严格确认未实现 · ${item.adjustment==='provider_unspecified'?'复权口径未认证':item.adjusted?'前复权来源标记':'未复权'}`;
  }

  function openHistory(code) {
    window.LiangceCharts?.open(code);
  }
  window.addEventListener('liangce:history-selected',event=>renderHistory([event.detail]));

  const modules=['涨停分布','板块轮动','图表复盘','资金流向','筹码密集','股票池'];
  const moduleScreen=document.createElement('div');moduleScreen.id='dedicated-module-screen';moduleScreen.className='content screen';moduleScreen.hidden=true;$('main').append(moduleScreen);
  function renderModule(name) {
    const rows=(market?.rows||[]).slice().sort((a,b)=>b.amount-a.amount).slice(0,30);
    let heads=[],data=[],note='';
    if(name==='资金流向'){heads=['标的','最新价','涨跌幅','成交额','主力净额','超大单'];data=rows.map(r=>[r.name,r.price.toFixed(2),r.change.toFixed(2)+'%',fmt(r.amount/1e8)+' 亿','未提供','未提供']);note='协议报价提供成交额，不提供主力净流入和超大单分类；成交额不代表资金净流入。';}
    if(name==='涨停分布'){heads=['股票','代码','最新价','涨幅','连板','封单'];data=(market?.rows||[]).filter(r=>r.change>=9.5).sort((a,b)=>b.change-a.change).slice(0,100).map(r=>[r.name,r.code,r.price.toFixed(2),r.change.toFixed(2)+'%','未计算','未提供']);note='展示涨幅 ≥ 9.5% 的观察列表；不同板块、ST 和新股限制不同，不据此认定已封涨停。';}
    if(name==='板块轮动'){heads=['板块','今日涨幅','5 日强度','成交额'];note='当前协议链路尚未接入行业成分与板块历史，等待这些数据后计算轮动。';}
    if(name==='筹码密集'){heads=['标的','最新价','获利盘','集中度','成本分布'];data=rows.map(r=>[r.name,r.price.toFixed(2),'未计算','未计算','缺换手与流通股数据']);note='OHLCV 和当前价不足以还原持仓成本分布，尚未生成筹码估计。';}
    if(name==='股票池'){heads=['代码','名称','日线根数','起始日期','结束日期','状态'];data=histories.map(r=>[r.code,r.name,r.bars.length,r.first_date,r.last_date,'历史已入池']);note='由全市场成交额筛出的历史研究候选；策略评分、触发价和止损在市场概况中查看。';}
    if(name==='图表复盘'){heads=['标的','周期','日线根数','类中枢','候选数','最新日期'];data=histories.map(r=>{const c=Chanlun.replay(r.bars);return[r.name,'日线',r.bars.length,c.centers?.length||0,c.signals.length,r.last_date];});note='使用真实日线计算的研究代理结构，更多逐条信号见“缠论 · 通达信”。';}
    moduleScreen.innerHTML=`<div class="page-head"><div><h1>${name}</h1><div class="subtitle">${market?`报价 ${market.total_quotes} 只 · 获取于 ${stamp(market.received_at)}`:'等待后台数据采集'}</div></div><span class="mode-tag">后台自动更新</span></div><section class="panel"><div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${data.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${heads.length}" class="empty-state">${esc(note||'等待有效数据')}</td></tr>`}</tbody></table></div><div class="assumption-bar">${esc(note)}</div></section>`;
  }
  document.querySelectorAll('.nav button:not([data-screen])').forEach(button=>{
    const name=button.textContent.replace(button.querySelector('.glyph')?.textContent||'','').trim();
    if(modules.includes(name))button.onclick=()=>{activeModule=name;renderModule(name);showScreen(moduleScreen,button,name);};
  });

  const auditScreen=document.createElement('div');
  auditScreen.id='audit-screen';auditScreen.className='content screen';auditScreen.hidden=true;
  auditScreen.innerHTML='<div class="page-head"><div><h1>本地算法核验</h1><div class="subtitle">等待加载本机日线研究结果</div></div><span class="mode-tag">structure_proxy</span></div><section class="panel"><div class="empty-state">等待核验报告</div></section>';
  $('main').append(auditScreen);
  const auditNav=document.createElement('button');auditNav.dataset.screen='audit-screen';auditNav.innerHTML='<span class="glyph">✓</span>算法核验';$('.nav').append(auditNav);
  auditNav.onclick=()=>{activeModule=null;showScreen(auditScreen,auditNav,'算法核验');};
  function renderAudit(report){
    if(report.status!=='complete')return;
    const rows=report.cohorts.map(cohort=>`<tr><td>${cohort.name==='sqlite_daily'?'本地原始日线':'前复权来源标记'}</td><td>${fmt(cohort.symbols)}</td><td>${fmt(cohort.bars)}</td><td>${fmt(cohort.baseline.duplicate_anchor_signals)} → ${fmt(cohort.final.duplicate_anchor_signals)}</td><td>${fmt(cohort.baseline.invalid_on_arrival)} → ${fmt(cohort.final.invalid_on_arrival)}</td><td>${cohort.final.prefix_failures} / ${cohort.final.prefix_checks}</td><td>${cohort.final.mirror_failures} / ${cohort.final.mirror_checks}</td></tr>`).join('');
    const outcomes=report.directional_outcomes.filter(row=>row.horizon===20&&row.split==='holdout_2025_plus');
    auditScreen.innerHTML=`<div class="page-head"><div><h1>本地算法核验</h1><div class="subtitle">${report.run_date} · ${fmt(report.sequences)} 组序列 · ${fmt(report.symbols_unique)} 个不同代码 · ${fmt(report.bars)} 根日线</div></div><span class="mode-tag">日线结构代理</span></div><section class="panel"><div class="panel-head"><h2 class="section-title">历史结构与时点检查</h2><button id="export-audit" class="quiet-button">导出核验 JSON</button></div><div class="table-wrap"><table><thead><tr><th>数据口径</th><th>序列</th><th>日线</th><th>重复端点：旧 → 新</th><th>确认收盘越界：旧 → 新</th><th>前缀差异 / 检查</th><th>镜像差异 / 检查</th></tr></thead><tbody>${rows}</tbody></table></div><div class="assumption-bar">${esc(report.scope_note||'')} 缺人工逐点标注，严格缠论识别准确率尚无可计算基准。严格线段、走势递归与低级别触发仍未完成。</div></section><section class="panel" style="margin-top:16px"><div class="panel-head"><h2 class="section-title">20 日方向观察 · 2025 年起日期分组</h2><span class="section-caption">方向统计与结构准确性分别记录</span></div><div class="table-wrap"><table><thead><tr><th>队列</th><th>方向</th><th>观察数</th><th>方向一致</th><th>扣成本后为正</th><th>平均有向收益</th></tr></thead><tbody>${outcomes.map(row=>`<tr><td>${row.cohort==='sqlite_daily'?'原始日线':'前复权来源标记'}</td><td>${row.side==='buy'?'买侧':'卖侧风险方向'}</td><td>${fmt(row.n)}</td><td>${row.direction_pct.toFixed(2)}%</td><td>${row.positive_after_cost_pct.toFixed(2)}%</td><td>${row.mean_net_pct.toFixed(2)}%</td></tr>`).join('')}</tbody></table></div><div class="assumption-bar">次根日线开盘观察至第 20 根收盘，减 0.20% 参考成本，剔除已知除权事件窗口；工程修复查看过全期结构检查，此处不属于完全盲测。事件可重叠，未逐笔模拟涨跌停、停牌及全部成交限制。这些比例不等于可成交胜率。</div></section><section class="panel" style="margin-top:16px"><div class="panel-head"><h2 class="section-title">数据与接口实测</h2></div><div class="method-note">ASL / SQLite：${fmt(report.lake_crosscheck.overlapping_rows)} 根重叠日线，价格超容差差异 ${report.lake_crosscheck.price_difference_gt_0011_rows} 条。<br>tdx-api：${fmt(report.realtime.codes)} 个代码、${fmt(report.realtime.quotes)} 只报价、${report.realtime.batches} 批、失败 ${report.realtime.failed_batches} 批，约 ${report.realtime.seconds.toFixed(1)} 秒；测试于非交易时段，显示最近可得快照。<br>所有原始库以只读方式读取；前复权缓存和原始价分别运行。</div></section>`;
    if(report.latest_signal_validation){
      const latest=report.latest_signal_validation;
      const panel=document.createElement('section');panel.className='panel';panel.style.marginBottom='16px';
      panel.innerHTML=`<div class="panel-head"><h2 class="section-title">当前版本 · 分类与状态复核</h2><span class="mode-tag">${esc(latest.version)}</span></div><div class="method-note">${fmt(latest.sequences)} 组序列 · ${fmt(latest.distinct_codes)} 个不同代码 · ${fmt(latest.bars)} 根日线。<br>二类必须引用已发布且边界未破的一类；三类必须引用离开前已形成的中枢。<br>前缀检查 ${latest.prefix_checks} 次，差异 ${latest.prefix_failures}；买卖镜像检查 ${latest.mirror_checks} 次，差异 ${latest.mirror_failures}；上下文校验不通过 ${latest.context_violations} 条。<br>结构候选 ${fmt(latest.candidate_events)}；各股票自身最后日期仍在等待 ${fmt(latest.by_state.waiting)}，规则已触发且尚未失效 ${fmt(latest.by_state.proxy_confirmed)}，已失效 ${fmt(latest.by_state.invalidated)}，已过观察期 ${fmt(latest.by_state.expired)}，结构更新 ${fmt(latest.by_state.superseded)}。<br>这衡量分类和状态一致性；严格缠论确认未实现，旧版方向统计保留为历史记录。</div>`;
      auditScreen.querySelector('.page-head').after(panel);
    }
    $('#export-audit').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='chanlun-local-audit-20261106.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  }

  async function poll() {
    if(polling)return;
    polling=true;
    try {
      const state=await window.pywebview.api.get_state(marketVersion,historyVersion);
      if(state.market)renderMarket(state.market);
      if(state.histories?.length){
        
        renderHistory(state.histories);
      }
      marketVersion=state.market_version;historyVersion=state.history_version;
      $('#pipeline-message').textContent=state.message;
      const p=state.progress;
      $('#pipeline-progress').style.width=state.phase==='ready'?'100%':state.phase==='history'?`${30+70*p.done/Math.max(1,p.total)}%`:state.phase==='retry'?'0%':'12%';
      const latest=histories.map(item=>item.last_date).sort().at(-1);
      $('#pipeline-meta').textContent=`报价：${market?stamp(market.received_at):'等待获取'} · 详情历史：${histories.length} 只${latest?'，最新日线 '+latest:''}${state.next_refresh_at?' · 下次更新 '+stamp(state.next_refresh_at):''}${p.failed?' · 未入池 '+p.failed+' 只：'+(state.history_failures||[]).map(item=>item.code+' '+item.reason).join('；'):''}`;
      $('#scan-state').textContent=({waiting:'等待启动',connecting:'连接中',scanning:'报价扫描中',history:`历史 ${p.done}/${p.total}`,ready:'数据就绪',retry:'等待重试'})[state.phase]||state.phase;
      $('#top-data-status').textContent=`${state.phase==='retry'?'数据延迟':market?.cached?'缓存行情':'行情'} ${market?.total_quotes||0} 只 · 详情历史 ${histories.length} 只`;
      $('#refresh-data').disabled=!['ready','retry','waiting'].includes(state.phase);
      $('#rescan-market').disabled=$('#refresh-data').disabled;
    } catch(error) {
      $('#pipeline-message').textContent='数据同步暂时中断，正在重新连接…';
      console.error('market-state',error);
    } finally {polling=false;}
  }
  async function start() {
    if(started||!window.pywebview?.api)return;started=true;
    try{await window.pywebview.api.start_background();await poll();setInterval(poll,2000);renderAudit(await window.pywebview.api.get_research_report());}
    catch(error){started=false;$('#pipeline-message').textContent='后台启动失败，请重新打开程序';console.error(error);}
  }
  const refresh=async()=>{if(window.pywebview?.api){await window.pywebview.api.refresh_data();await poll();}};
  $('#refresh-data').onclick=refresh;
  $('#rescan-market').onclick=refresh;
  $('#plan-name').closest('section').querySelector('.text-button').onclick=()=>openHistory($('#plan-code').textContent.trim());
  window.addEventListener('pywebviewready',start);
  if(window.pywebview?.api)start();
  else setTimeout(()=>{if(!started)$('#pipeline-message').textContent='等待桌面行情连接 · 请运行 LiangCe 1.5.2';},4000);
  renderChan();
})();

