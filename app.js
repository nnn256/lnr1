(() => {
  const engine = window.QuantStrategy;
  const marketTable = window.LiangceMarketTable;
  let universe = [];
  const screens = [...document.querySelectorAll('.screen')];
  const screenNames = { 'market-screen': '市场概况', 'strategy-screen': '选股策略', 'backtest-screen': '回测实验' };
  const moduleConfigs = {
    '涨停分布': { subtitle: '涨停梯队、连板高度与封单强度', columns: ['梯队', '股票', '涨幅', '连板', '封单额', '状态'], rows: [] },
    '板块轮动': { subtitle: '行业强弱、相对强度与轮动阶段', columns: ['板块', '今日涨幅', '5日强度', '成交额', '阶段', '信号'], rows: [] },
    '图表复盘': { subtitle: 'K 线、分型、笔与中枢证据回放', columns: ['标的', '周期', '最新结构', '中枢', '最近信号', '可用时点'], rows: [] },
    '资金流向': { subtitle: '主力净流入、成交额与资金方向', columns: ['标的', '主力净额', '超大单', '成交额', '5日趋势', '风险'], rows: [] },
    '筹码密集': { subtitle: '成本分布、集中区与突破压力', columns: ['标的', '获利盘', '集中价', '集中度', '支撑', '压力'], rows: [] },
    '股票池': { subtitle: '自选标的、策略标签与风险状态', columns: ['代码', '名称', '标签', '评分', '持仓状态', '备注'], rows: [] }
  };

  function openModule(name, button) {
    const config = moduleConfigs[name];
    if (!config) return;
    let screen = document.querySelector('#module-screen');
    if (!screen) {
      screen = document.createElement('div'); screen.id = 'module-screen'; screen.className = 'content screen';
      document.querySelector('main').append(screen); screens.push(screen);
    }
    screen.innerHTML = `<div class="page-head"><div><h1>${name}</h1><div class="subtitle">${config.subtitle}</div></div><span class="mode-tag"><span class="tag-dot"></span>实时行情</span></div><section class="panel"><div class="panel-head"><div class="panel-title-wrap"><h2 class="section-title">${name}工作台</h2><span class="section-caption">等待真实通达信扫描结果</span></div></div><div class="table-wrap"><table><thead><tr>${config.columns.map(column => `<th>${column}</th>`).join('')}</tr></thead><tbody>${config.rows.map(row => `<tr>${row.map((cell, index) => `<td>${cell}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${config.columns.length}" class="empty-state">等待实时行情；未连接时不显示演示数据。</td></tr>`}</tbody></table></div><div class="assumption-bar">实时来源和更新时间以通达信桥接扫描为准。</div></section>`;
    screens.forEach(item => { item.hidden = item !== screen; });
    document.querySelectorAll('.nav button').forEach(item => item.classList.toggle('active', item === button));
    document.querySelector('.crumb b').textContent = name;
  }
  let periodDefinitions;
  const backtestRuns = new Map();
  let activePeriod = '3y';
  let lastRun = null;
  let datasetSource = '等待真实行情';
  const historySignatures = new Map();
  const analysisCache = new Map();
  const batchCandidates = new Map();
  const historyStatuses = new Map();
  const liveQuotes = new Map();
  let dataAdjustment = '待核对';
  let marketSnapshot = null,marketPage = 1;
  const loadingStocks = new Set();

  function rebuildPeriods() {
    const availableDates = universe.flatMap(symbol => symbol.bars.map(bar => bar.date)).sort();
    const last = availableDates.at(-1) || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const first = availableDates[0] || last;
    const rangeStart = years => {
      const date = new Date(`${last}T00:00:00Z`);
      date.setUTCFullYear(date.getUTCFullYear() - years);
      return date.toISOString().slice(0, 10) < first ? first : date.toISOString().slice(0, 10);
    };
    periodDefinitions = {
      '1y': { label: '近 1 年', startDate: rangeStart(1), endDate: last },
      '3y': { label: '近 3 年', startDate: rangeStart(3), endDate: last },
      '5y': { label: '近 5 年', startDate: rangeStart(5), endDate: last },
      all: { label: '全样本', startDate: first, endDate: last }
    };
  }
  rebuildPeriods();

  window.LiangceApp = {
    loadHistory(histories) {
      if (!histories.length) return;
      for(const item of histories){
        if(item.bars?.length&&item.bars.length<100)historyStatuses.set(item.code,{kind:'short_history',bar_count:item.bars.length});
        else if(item.bars?.length>=100)historyStatuses.delete(item.code);
      }
      let changed=false;
      const mergedHistories=new Map(universe.map(item=>[item.code,item]));
      for(const item of histories.filter(item=>item.bars?.length>=100)){
        const signature=JSON.stringify([item.adjusted,item.bars]);
        const previous=mergedHistories.get(item.code);
        if(historySignatures.get(item.code)===signature&&previous){
          mergedHistories.set(item.code,{...previous,...item,bars:previous.bars});
        }else{
          changed=true;historySignatures.set(item.code,signature);
          mergedHistories.set(item.code,{...item,sector:'真实历史分析 · 日线',bars:item.bars.map((bar,index)=>({...bar,prevClose:index?item.bars[index-1].close:bar.close}))});
        }
      }
      universe=[...mergedHistories.values()];
      if(!changed){refreshCandidates();return;}
      datasetSource = '真实历史标的';
      backtestRuns.clear();
      rebuildPeriods();
      document.querySelector('#bt-start').value = periodDefinitions['3y'].startDate;
      document.querySelector('#bt-end').value = periodDefinitions['3y'].endDate;
      dataAdjustment = [...new Set(universe.map(item => item.adjusted ? '前复权（来源标记）' : '未复权'))].join(' / ');
      document.querySelector('#bt-data-source').textContent = `真实日线 · ${universe.length} 只 · ${dataAdjustment}`;
      document.querySelector('#bt-status').textContent = `历史已就绪 · ${universe.length} 只 · 可运行回测`;
      document.querySelector('#period-table tbody').innerHTML = '<tr><td colspan="8" class="empty-state">真实历史已加载，点击“运行回测”计算；样本为当前候选，存在选择偏差</td></tr>';
      refreshCandidates();
    },
    analysisParams() { return Object.fromEntries(Object.entries(readParams()).filter(([key,value])=>value!==engine.DEFAULT_PARAMS[key])); },
    loadAnalysisSummaries(items,reset=false) {
      if(reset)batchCandidates.clear();
      for(const item of items)batchCandidates.set(item.code,item);
      refreshCandidates();
    },
    loadMarket(market) { marketSnapshot=market;renderCandidates(); },
    applyLiveQuotes(rows,missing=[]) {
      for(const [code,quote] of Object.entries(rows))liveQuotes.set(code,quote);
      for(const code of missing)if(liveQuotes.has(code))liveQuotes.set(code,{...liveQuotes.get(code),stale:true});
      renderCandidates();renderLiveQuote();
    },
    markQuotesStale(codes) {for(const code of codes)if(liveQuotes.has(code))liveQuotes.set(code,{...liveQuotes.get(code),stale:true});renderCandidates();renderLiveQuote();},
    loadHistoryStatuses(items) { historyStatuses.clear();for(const item of items)historyStatuses.set(item.code,item);renderCandidates(); },
    getHistoryCount() { return universe.length; },
    selectedCode() { return selectedCandidate; },
    getMarketView() { return currentMarketView(); }
  };

  function setScreen(id) {
    screens.forEach(screen => { screen.hidden = screen.id !== id; });
    document.querySelectorAll('.nav button[data-screen]').forEach(button => {
      button.classList.toggle('active', button.dataset.screen === id);
    });
    const label = screenNames[id] || '市场概况';
    document.querySelector('.crumb b').textContent = label;
  }

  document.querySelectorAll('.nav button[data-screen]').forEach(button => {
    button.addEventListener('click', () => setScreen(button.dataset.screen));
  });
  document.querySelectorAll('.nav button:not([data-screen])').forEach(button => {
    button.addEventListener('click', () => {
      openModule(button.querySelector('.glyph') ? button.textContent.replace(button.querySelector('.glyph').textContent, '').trim() : button.textContent.trim(), button);
    });
  });

  function readParams() {
    const params = { ...engine.DEFAULT_PARAMS };
    document.querySelectorAll('[data-param]').forEach(input => {
      params[input.dataset.param] = input.type === 'checkbox' ? input.checked : Number(input.value);
      if(input.dataset.param==='pullbackPct')params.pullbackPct/=100;
    });
    return params;
  }

  function validateParams() {
    const invalid = [...document.querySelectorAll('#strategy-screen [data-param]')].find(input => !input.checkValidity());
    if (invalid) return `${invalid.labels?.[0]?.textContent || invalid.id} 超出允许范围`;
    const params = readParams();
    if (params.maFast >= params.maSlow) return 'MA 快线周期必须小于慢线周期';
    if (params.macdFast >= params.macdSlow) return 'MACD 快线周期必须小于慢线周期';
    return '';
  }

  let candidates = [];
  let selectedCandidate = null;
  function refreshCandidates() {
    const params = readParams(),paramsKey=JSON.stringify(params);
    candidates = universe.map(symbol => {
      const cached=analysisCache.get(symbol.code);
      if(cached?.bars===symbol.bars&&cached.paramsKey===paramsKey)return {...cached.candidate,...symbol};
      const indicators = engine.buildIndicators(symbol.bars, params);
      const index = symbol.bars.length - 1;
      if (index < 61) return null;
      const bar = symbol.bars[index];
      const signal = engine.scoreAt(symbol.bars, indicators, index, params);
      const window = symbol.bars.slice(Math.max(0, index - params.breakoutPeriod), index);
      const trigger = Math.max(...window.map(item => item.high));
      const priceCondition = signal.breakout || signal.pullback;
      const confirmed = signal.trend && signal.macdConfirmed && signal.volumeConfirmed && priceCondition
        && (!params.requireChan || Boolean(signal.chan));
      const distance = bar.close / trigger - 1;
      const status = confirmed ? '代理条件齐备' : Math.abs(distance) <= 0.015 && signal.trend ? '接近触发' : '观察';
      const candidate={ ...symbol, bar, index, indicators, signal, trigger, distance, status };
      analysisCache.set(symbol.code,{bars:symbol.bars,paramsKey,candidate});
      return candidate;
    }).filter(Boolean).sort((a, b) => b.signal.score - a.signal.score || a.distance - b.distance);
    const combined=new Map(batchCandidates);
    candidates.forEach(candidate=>{
      const compact=combined.get(candidate.code);
      if(!compact||compact.bar.date<candidate.bar.date||candidate.history_freshness==='cloud_live')combined.set(candidate.code,candidate);
    });
    candidates=[...combined.values()];
    renderCandidates();
    if (!selectedCandidate) {
      selectedCandidate = candidates[0]?.code || null;
    }
    if (selectedCandidate) selectCandidate(selectedCandidate);
  }

  function currentMarketView() {
    const threshold = Number(document.querySelector('#candidate-threshold').value || 0);
    const query = document.querySelector('#candidate-search').value.trim().toLowerCase();
    const mode = document.querySelector('.filter-chip[data-candidate-filter].selected')?.dataset.candidateFilter || 'all';
    const rows=marketTable.buildRows(marketSnapshot,candidates).map(row=>liveQuotes.has(row.code)?{...row,quote:{...row.quote,...liveQuotes.get(row.code)}}:row);
    return marketTable.queryRows(rows,{
      threshold,query,mode,page:marketPage,pageSize:Number(document.querySelector('#market-page-size').value),sort:document.querySelector('#market-sort').value
    });
  }
  function renderCandidates() {
    const view=currentMarketView();marketPage=view.page;
    document.querySelector('#candidate-body').innerHTML=view.rows.map(row=>{
      const candidate=row.analysis,quote=row.quote,price=quote?.price??candidate?.bar.close,change=quote?.live_quote?quote.change:quote?.change??(candidate?(candidate.bar.close/candidate.bar.prevClose-1)*100:null);
      const ratio=candidate?(candidate.volumeRatio??candidate.bar.volume/candidate.indicators.volume20[candidate.index]):null;
      const historyStatus=historyStatuses.get(row.code);
      const status=loadingStocks.has(row.code)?'获取中…':candidate?candidate.status:historyStatus?.kind==='short_history'?`已获取${historyStatus.bar_count}根 · 待累计`:historyStatus?.kind==='no_history'?'行情源暂无K线':historyStatus?'数据待重试':quote?'待历史分析':'暂无有效报价';
      return `<tr data-code="${row.code}" class="${row.code===selectedCandidate?'chosen':''}" tabindex="0" aria-label="分析 ${escapeHtml(row.name)} ${row.code}">
        <td><div class="stock-name">${escapeHtml(row.name)}</div><div class="stock-code">${row.code} · ${quote?.live_quote?(quote.stale?'上次报价 ':'行情 ')+escapeHtml(quote.market_time?new Date(quote.market_time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'时间未提供'):candidate?((candidate.history_freshness==='verified'?'K线 ':'缓存K线 ')+candidate.bar.date):quote?'全市场报价':'证券清单'}</div></td>
        <td>${candidate?`<span class="score ${candidate.signal.score<70?'watch':''}">${candidate.signal.score}</span>`:`<span class="stock-code">${historyStatus?.kind==='short_history'?'待累计100根':'待分析'}</span>`}</td>
        <td>${price!=null?price.toFixed(2):'—'}</td><td class="${change>=0?'up':'down'}">${change!=null?Number(change).toFixed(2)+'%':'—'}</td>
        <td>${Number.isFinite(ratio)?ratio.toFixed(2):'—'}</td><td class="${candidate?.distance>=0?'up':'down'}">${candidate?percent(candidate.distance):'—'}</td>
        <td><span class="signal ${candidate?.status==='代理条件齐备'?'':'watch'}">${status}</span></td></tr>`;
    }).join('')||'<tr><td colspan="7" class="empty-state">没有匹配股票；请检查搜索词、评分或历史筛选</td></tr>';
    document.querySelector('#candidate-count').textContent=`第 ${view.start}–${view.end} 条 / 匹配 ${view.matched} 只 · 全市场 ${view.total} 只 · 有效报价 ${view.quoted} 只 · 已评分 ${view.analysed} 只`;
    document.querySelector('#candidate-mode').textContent=window.LiangceWeb?.cloud?'当前页报价自动刷新；成交额排序和全市场评分依据已发布日线；点击股票核验云端最新闭合日线':'后台持续完成全市场日线评分；点击任意股票查看最新历史和图表';
    document.querySelector('#market-page-label').textContent=`${view.page} / ${view.pageCount} 页`;
    document.querySelector('#market-page-input').value=String(view.page);
    document.querySelector('#market-page-input').max=String(view.pageCount);
    document.querySelector('#market-prev').disabled=view.page<=1;document.querySelector('#market-next').disabled=view.page>=view.pageCount;
    document.querySelectorAll('#candidate-body tr[data-code]').forEach(row=>{
      row.addEventListener('click',()=>selectMarketStock(row.dataset.code));
      row.addEventListener('keydown',event=>{if(event.key==='Enter')selectMarketStock(row.dataset.code);});
    });
  }
  async function selectMarketStock(code){
    if(loadingStocks.has(code))return;
    selectedCandidate=code;
    if(candidates.some(candidate=>candidate.code===code)){selectCandidate(code);renderCandidates();}
    const row=marketTable.buildRows(marketSnapshot,candidates).find(item=>item.code===code);
    if(!row)return;
    document.querySelector('#plan-name').textContent=row.name;document.querySelector('#plan-code').textContent=code;
    document.querySelector('#plan-score').textContent='待历史分析';document.querySelector('#plan-signal').textContent='加载历史中';
    document.querySelector('#plan-current').textContent=row.quote?`¥${row.quote.price.toFixed(2)}`:'—';
    document.querySelector('#plan-change').textContent=row.quote?`${row.quote.change.toFixed(2)}%`:'—';
    ['plan-entry','plan-stop','plan-target','plan-size','plan-risk','plan-stop-distance'].forEach(id=>document.querySelector('#'+id).textContent='—');
    document.querySelector('#plan-rule').textContent='正在核验该股票最新K线；如本地历史过期会自动更新后计算。';
    if(!window.pywebview?.api?.get_chart_history){document.querySelector('#plan-rule').textContent='请使用桌面版读取该股票真实历史';return;}
    loadingStocks.add(code);renderCandidates();
    try{
      const history=await window.pywebview.api.get_chart_history(code,1200);
      if(!history.ok)throw Error(history.message||'历史暂不可用');
      window.LiangceApp.loadHistory([history]);
      window.dispatchEvent(new CustomEvent('liangce:history-selected',{detail:history}));
      if(selectedCandidate===code){
        if(history.bars.length<100){
          document.querySelector('#plan-score').textContent='待累计100根';document.querySelector('#plan-signal').textContent='K线已获取';
          document.querySelector('#plan-rule').textContent=`已获取 ${history.bars.length} 根真实日线，可在图表复盘查看；累计100根后参与评分。`;
        }else selectCandidate(code);
      }
    }catch(error){if(selectedCandidate===code){document.querySelector('#plan-signal').textContent='历史未就绪';document.querySelector('#plan-rule').textContent=error.message;}}
    finally{loadingStocks.delete(code);renderCandidates();renderLiveQuote();}
  }

  function renderLiveQuote(){
    const quote=liveQuotes.get(selectedCandidate),note=document.querySelector('#plan-live-quote');
    if(!quote){if(note)note.textContent='';return;}
    document.querySelector('#plan-current').textContent=`¥${quote.price.toFixed(2)}`;
    document.querySelector('#plan-change').textContent=quote.change==null?'—':`${quote.change>=0?'+':''}${quote.change.toFixed(2)}%`;
    document.querySelector('#plan-change').className=`price-change ${quote.change>=0?'up':'down'}`;
    if(note)note.textContent=`${quote.stale?'上次报价':'行情报价'} · ${quote.market_time?new Date(quote.market_time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'源未提供时间'} · 评分和入场方案依据下方日线日期`;
  }

  function selectCandidate(code) {
    const candidate = candidates.find(item => item.code === code);
    if (!candidate) return;
    selectedCandidate = code;
    document.querySelectorAll('#candidate-body tr[data-code]').forEach(row => row.classList.toggle('chosen', row.dataset.code === code));
    const { bar, signal, indicators } = candidate;
    const params = readParams();
    const entry = signal.breakout || signal.pullback ? bar.close : Math.max(bar.close, candidate.trigger);
    const plan = engine.computeTradePlan({ entry, structuralLow: signal.structuralLow, atr: candidate.atrValue??indicators.atr[candidate.index] }, params);
    const dailyChange = bar.close / bar.prevClose - 1;
    const planClass = signal.trend && signal.macdConfirmed ? '条件观察' : '等待趋势';
    document.querySelector('#plan-name').textContent = candidate.name;
    document.querySelector('#plan-code').textContent = code;
    document.querySelector('#plan-score').textContent = `${signal.score} / 100`;
    document.querySelector('#plan-signal').textContent = candidate.status;
    document.querySelector('#plan-current').textContent = `¥${bar.close.toFixed(2)}`;
    document.querySelector('#plan-change').textContent = percent(dailyChange);
    document.querySelector('#plan-change').className = `price-change ${dailyChange >= 0 ? 'up' : 'down'}`;
    document.querySelector('#plan-entry').textContent = `¥${entry.toFixed(2)}`;
    document.querySelector('#plan-stop').textContent = plan.valid ? `¥${plan.stop.toFixed(2)}` : '—';
    document.querySelector('#plan-stop-distance').textContent = plan.valid ? `−${((entry - plan.stop) / entry * 100).toFixed(2)}%` : plan.reason;
    document.querySelector('#plan-target').textContent = plan.valid ? `¥${plan.target.toFixed(2)}` : '—';
    document.querySelector('#plan-size').textContent = plan.valid ? `${plan.shares.toLocaleString('zh-CN')} 股 · ${money(plan.positionValue)}` : '风险预算不足';
    document.querySelector('#plan-risk').textContent = plan.valid ? `${money(plan.plannedRisk)} · ${plan.riskPct.toFixed(2)}%` : '—';
    document.querySelector('#plan-rule').textContent = `${candidate.history_note||'缓存尚未核验最新日期'} · 历史截至 ${bar.date} · ${candidate.adjustment==='provider_unspecified'?'复权口径未认证':candidate.adjusted ? '前复权来源标记' : '未复权'}。${planClass}：MA${params.maFast}/${params.maSlow}、MACD、量比和 K 线触发共同过滤。结构失效参考前低 ${signal.structuralLow.toFixed(2)} 与 ATR(${params.atrPeriod})；信号等级为日线 proxy_research，未使用低级别触发。`;
    renderLiveQuote();
  }

  document.querySelectorAll('.filter-chip[data-candidate-filter]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip[data-candidate-filter]').forEach(item => item.classList.toggle('selected', item === button));
    marketPage=1;renderCandidates();
  }));
  ['candidate-threshold','market-page-size','market-sort'].forEach(id=>document.querySelector('#'+id).addEventListener('change',()=>{marketPage=1;renderCandidates();}));
  document.querySelector('#candidate-search').addEventListener('input',()=>{marketPage=1;renderCandidates();});
  document.querySelector('#market-prev').onclick=()=>{marketPage--;renderCandidates();};
  document.querySelector('#market-next').onclick=()=>{marketPage++;renderCandidates();};
  document.querySelector('#market-page-input').addEventListener('change',event=>{marketPage=Number(event.target.value)||1;renderCandidates();});

  function loadParams() {
    try {
      const saved = JSON.parse(localStorage.getItem('liangce.strategy.params') || '{}');
      document.querySelectorAll('[data-param]').forEach(input => {
        if (!(input.dataset.param in saved)) return;
        if (input.type === 'checkbox') input.checked = Boolean(saved[input.dataset.param]);
        else input.value = saved[input.dataset.param];
      });
    } catch (error) { /* Storage may be unavailable for file URLs. */ }
  }

  document.querySelector('#save-strategy').addEventListener('click', () => {
    const validation = validateParams();
    if (validation) {
      document.querySelector('#strategy-feedback').textContent = validation;
      return;
    }
    const params = readParams();
    batchCandidates.clear();
    window.dispatchEvent(new CustomEvent('liangce:strategy-changed',{detail:params}));
    let saved = false;
    try { localStorage.setItem('liangce.strategy.params', JSON.stringify({...params,pullbackPct:params.pullbackPct*100})); saved = true; } catch (error) {}
    document.querySelector('#strategy-feedback').textContent = saved ? '参数已保存，正在刷新回测结果…' : '参数已应用，正在刷新回测结果…';
    updateCalculator();
    refreshCandidates();
    backtestRuns.clear();
    document.querySelector('#run-backtest').click();
  });

  function updateCalculator() {
    const params = readParams();
    const result = engine.computeTradePlan({
      entry: Number(document.querySelector('#calc-entry').value),
      structuralLow: Number(document.querySelector('#calc-low').value),
      atr: Number(document.querySelector('#calc-atr').value)
    }, {
      ...params,
      openRisk: Number(document.querySelector('#calc-openRisk').value || 0)
    });
    const values = result.valid ? [
      ['止损价', `¥${result.stop.toFixed(2)}`],
      ['每股风险', `¥${result.riskPerShare.toFixed(2)}`],
      ['止盈参考', `¥${result.target.toFixed(2)}`],
      ['风险预算', `¥${result.riskBudget.toFixed(0)}`],
      ['计划股数', `${result.shares.toLocaleString('zh-CN')} 股`],
      ['计划仓位', `¥${result.positionValue.toLocaleString('zh-CN')}`],
      ['计划最大损失', `¥${result.plannedRisk.toLocaleString('zh-CN')}`],
      ['占账户风险', `${result.riskPct.toFixed(2)}%`]
    ] : [['无法计算', result.reason]];
    document.querySelector('#calc-results').innerHTML = values.map(([label, value]) =>
      `<div class="risk-line"><span>${label}</span><b>${value}</b></div>`
    ).join('');
    document.querySelector('#calc-warning').textContent = result.valid
      ? '止损取结构前低与 ATR 止损中较低者；股数按 100 股整手向下取整。跳空、涨跌停和流动性仍可能扩大实际损失。'
      : result.reason;
  }

  document.querySelectorAll('#strategy-screen [data-param],#calc-entry,#calc-low,#calc-atr,#calc-openRisk').forEach(input => {
    input.addEventListener('input', updateCalculator);
    input.addEventListener('change', updateCalculator);
  });

  function percent(value) {
    if (!Number.isFinite(value)) return '—';
    return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
  }
  function money(value) {
    return `¥${Math.round(value).toLocaleString('zh-CN')}`;
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function renderMetrics(result) {
    const metric = result.metrics;
    document.querySelector('#active-metrics').innerHTML = [
      ['区间收益', percent(metric.totalReturn), metric.totalReturn >= 0],
      ['年化收益', percent(metric.cagr), metric.cagr >= 0],
      ['最大回撤', percent(-metric.maxDrawdown), false],
      ['胜率 / 笔数', `${(metric.winRate * 100).toFixed(1)}% / ${metric.tradeCount}`, null]
    ].map(([label, value, positive]) => `<div class="metric"><label>${label}</label><b class="${positive === null ? '' : positive ? 'up' : 'down'}">${value}</b></div>`).join('');
  }

  function renderChart(result) {
    const svg = document.querySelector('#equity-chart');
    const points = result.equityCurve;
    if (!points.length) {
      svg.innerHTML = '<text class="bt-chart-axis" x="50" y="110">此区间没有可用行情</text>';
      return;
    }
    const width = 1000;
    const height = 230;
    const left = 58;
    const right = 985;
    const top = 16;
    const bottom = 192;
    const values = points.map(point => point.equity);
    const min = Math.min(...values) * 0.985;
    const max = Math.max(...values) * 1.015;
    const span = max - min || 1;
    const xAt = index => left + (right - left) * index / Math.max(1, points.length - 1);
    const yAt = value => bottom - (value - min) / span * (bottom - top);
    const path = points.map((point, index) => `${index ? 'L' : 'M'}${xAt(index).toFixed(1)},${yAt(point.equity).toFixed(1)}`).join(' ');
    const start = points[0]?.date || '';
    const end = points.at(-1)?.date || '';
    const mid = points[Math.floor(points.length / 2)]?.date || '';
    const baselineY = yAt(result.metrics.startingEquity);
    svg.innerHTML = `
      <line class="bt-chart-grid" x1="${left}" y1="${top}" x2="${right}" y2="${top}" />
      <line class="bt-chart-grid" x1="${left}" y1="${(top + bottom) / 2}" x2="${right}" y2="${(top + bottom) / 2}" />
      <line class="bt-chart-grid" x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" />
      <line class="bt-chart-zero" x1="${left}" y1="${baselineY}" x2="${right}" y2="${baselineY}" />
      <path class="bt-chart-line" d="${path}" />
      <text class="bt-chart-axis" x="4" y="${top + 3}">${money(max)}</text>
      <text class="bt-chart-axis" x="4" y="${(top + bottom) / 2 + 3}">${money((min + max) / 2)}</text>
      <text class="bt-chart-axis" x="4" y="${bottom + 3}">${money(min)}</text>
      <text class="bt-chart-axis" x="${left}" y="220">${start}</text>
      <text class="bt-chart-axis" x="${(left + right) / 2 - 30}" y="220">${mid}</text>
      <text class="bt-chart-axis" x="${right - 72}" y="220">${end}</text>`;
  }

  function renderOverview(result) {
    const svg = document.querySelector('#overview-chart');
    if (!svg) return;
    const points = result.equityCurve;
    if (!points.length) return;
    const values = points.map(point => point.equity);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const x = index => 28 + 288 * index / Math.max(1, points.length - 1);
    const y = value => 82 - (value - min) / span * 68;
    const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(point.equity).toFixed(1)}`).join(' ');
    svg.innerHTML = `<path class="chart-grid" d="M28 14H316 M28 48H316 M28 82H316"/><path class="chart-line" d="${path}"/>`;
    const m = result.metrics;
    document.querySelector('#overview-metrics').innerHTML = `
      <div class="stat"><label>累计收益</label><b class="${m.totalReturn >= 0 ? 'up' : 'down'}">${percent(m.totalReturn)}</b></div>
      <div class="stat"><label>最大回撤</label><b class="down">${percent(-m.maxDrawdown)}</b></div>
      <div class="stat"><label>胜率 / 笔数</label><b>${(m.winRate * 100).toFixed(1)}% / ${m.tradeCount}</b></div>`;
    document.querySelector('#overview-note').textContent = `${datasetSource} · ${m.startDate} 至 ${m.endDate} · 研究回测。`;
  }

  function renderTrades(result) {
    const rows = [...result.trades].reverse().slice(0, 30);
    document.querySelector('#trade-table tbody').innerHTML = rows.length ? rows.map(trade => `
      <tr><td><div class="stock-name">${escapeHtml(trade.symbol)}</div><div class="stock-code">${trade.code}</div></td>
      <td>${trade.entryDate}</td><td>${trade.exitDate}</td>
      <td class="${trade.pnl >= 0 ? 'up' : 'down'}">${money(trade.pnl)}</td><td>${escapeHtml(trade.reason)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty-state">当前区间无成交；可降低结构门控或放宽量价条件。</td></tr>';
  }

  function showPeriod(key) {
    const result = backtestRuns.get(key);
    if (!result) return;
    activePeriod = key;
    renderMetrics(result);
    renderChart(result);
    renderTrades(result);
    if (key === '3y' || key === 'custom') renderOverview(result);
    document.querySelectorAll('#period-table tbody tr').forEach(row => row.classList.toggle('selected', row.dataset.period === key));
    document.querySelector('#backtest-meta').textContent = `${result.metadata.execution}；期末未平仓 ${result.openPositions.length} 只按收盘估值。定义=${result.metadata.definition_mode}；${result.metadata.approximation_loss}。数据口径：${dataAdjustment}。当前候选样本存在选择偏差；除权口径可能影响结果。`;
  }

  function renderComparison() {
    const order = ['1y', '3y', '5y', 'all', 'custom'];
    const entries = order.filter(key => backtestRuns.has(key)).map(key => [key, backtestRuns.get(key)]);
    document.querySelector('#period-table tbody').innerHTML = entries.map(([key, result]) => {
      const m = result.metrics;
      const label = key === 'custom' ? `${m.startDate} 至 ${m.endDate}` : periodDefinitions[key].label;
      return `<tr data-period="${key}" class="${key === activePeriod ? 'selected' : ''}">
        <td>${label}</td><td>${m.tradeCount}</td>
        <td class="${m.totalReturn >= 0 ? 'up' : 'down'}">${percent(m.totalReturn)}</td>
        <td>${percent(m.cagr)}</td><td class="down">${percent(-m.maxDrawdown)}</td>
        <td>${(m.winRate * 100).toFixed(1)}%</td><td>${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞'}</td><td>${m.sharpe.toFixed(2)}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="empty-state">点击“运行回测”生成多区间结果</td></tr>';
    document.querySelectorAll('#period-table tbody tr[data-period]').forEach(row => row.addEventListener('click', () => showPeriod(row.dataset.period)));
  }

  function selectedRanges() {
    const selected = document.querySelector('.range-button.active')?.dataset.period || 'multi';
    const start = document.querySelector('#bt-start').value;
    const end = document.querySelector('#bt-end').value;
    if (!start || !end || start > end) throw new Error('请填写有效的回测起止日期');
    if (selected === 'multi') return ['1y', '3y', '5y', 'all'].map(key => ({ key, ...periodDefinitions[key] }));
    if (selected === 'custom') return [{ key: 'custom', label: '自定义区间', startDate: start, endDate: end }];
    return [{ key: selected, ...periodDefinitions[selected] }];
  }

  function parseCsvRows(source) {
    const text = source.replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) throw new Error('CSV 至少需要表头和一行 OHLCV 数据');
    const splitLine = line => {
      const fields = [];
      let field = '';
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"' && line[i + 1] === '"' && quoted) { field += '"'; i += 1; }
        else if (char === '"') quoted = !quoted;
        else if (char === ',' && !quoted) { fields.push(field.trim()); field = ''; }
        else field += char;
      }
      fields.push(field.trim());
      return fields;
    };
    const headers = splitLine(lines[0]).map(value => value.toLowerCase().replace(/\s/g, ''));
    const aliases = {
      date: ['date', 'trade_date', '日期', '交易日期'], code: ['code', 'symbol', 'ts_code', '证券代码', '股票代码'],
      name: ['name', '股票名称', '证券名称', '名称'], open: ['open', '开盘', '开盘价'],
      high: ['high', '最高', '最高价'], low: ['low', '最低', '最低价'], close: ['close', '收盘', '收盘价'],
      volume: ['volume', 'vol', '成交量', '成交量(股)']
    };
    const columns = Object.fromEntries(Object.entries(aliases).map(([key, choices]) => [key,
      headers.findIndex(header => choices.some(alias => header === alias.toLowerCase().replace(/\s/g, '')))
    ]));
    for (const required of ['date', 'code', 'open', 'high', 'low', 'close', 'volume']) {
      if (columns[required] < 0) throw new Error(`CSV 缺少必要列：${required}`);
    }
    const groups = new Map();
    let rejected = 0;
    lines.slice(1).forEach(line => {
      const row = splitLine(line);
      let date = (row[columns.date] || '').replace(/[./]/g, '-');
      if (/^\d{8}$/.test(date)) date = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
      let code = (row[columns.code] || '').replace(/^(SH|SZ|BJ)/i, '').split('.')[0].replace(/\D/g, '');
      if (code.length > 6) code = code.slice(-6);
      const numeric = ['open', 'high', 'low', 'close', 'volume'].map(key => Number((row[columns[key]] || '').replace(/,/g, '')));
      const [open, high, low, close, volume] = numeric;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || code.length !== 6 || numeric.some(value => !Number.isFinite(value))
        || Math.min(open, high, low, close) <= 0 || volume < 0 || high < Math.max(open, close) || low > Math.min(open, close)) {
        rejected += 1;
        return;
      }
      const name = columns.name >= 0 ? row[columns.name] : code;
      if (!groups.has(code)) groups.set(code, { code, name, sector: 'CSV 导入', bars: [] });
      groups.get(code).bars.push({ date, open, high, low, close, volume });
    });
    const imported = [...groups.values()].map(symbol => {
      symbol.bars.sort((a, b) => a.date.localeCompare(b.date));
      const unique = symbol.bars.filter((bar, index, bars) => !index || bar.date !== bars[index - 1].date);
      unique.forEach((bar, index) => { bar.prevClose = index ? unique[index - 1].close : bar.close; });
      symbol.bars = unique;
      return symbol;
    }).filter(symbol => symbol.bars.length >= 100);
    if (!imported.length) throw new Error('没有可回测标的；每只股票至少需要 100 根有效日线，供 MA60 和预热计算使用');
    return { imported, rejected };
  }

  document.querySelector('#csv-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const status = document.querySelector('#bt-status');
    try {
      status.textContent = '正在读取 CSV…';
      const { imported, rejected } = parseCsvRows(await file.text());
      universe = imported;
      datasetSource = 'CSV 标的';
      dataAdjustment = 'CSV 口径待核对';
      backtestRuns.clear();
      activePeriod = '3y';
      rebuildPeriods();
      document.querySelector('#bt-start').value = periodDefinitions['3y'].startDate;
      document.querySelector('#bt-end').value = periodDefinitions['3y'].endDate;
      document.querySelector('#bt-data-source').innerHTML = `<span class="tag-dot"></span>CSV · ${imported.length} 只 · ${rejected} 行忽略`;
      document.querySelector('#bt-data-source').title = 'CSV 导入数据；行情状态以首页采集结果为准';
      document.querySelector('#period-table tbody').innerHTML = '<tr><td colspan="8" class="empty-state">CSV 已加载，点击“运行回测”计算比较区间</td></tr>';
      document.querySelector('#active-metrics').innerHTML = '<div class="metric"><label>区间收益</label><b>—</b></div><div class="metric"><label>年化收益</label><b>—</b></div><div class="metric"><label>最大回撤</label><b>—</b></div><div class="metric"><label>胜率 / 笔数</label><b>—</b></div>';
      refreshCandidates();
      status.textContent = `已加载 ${imported.length} 只股票${rejected ? `；忽略 ${rejected} 行` : ''}`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      event.target.value = '';
    }
  });

  document.querySelectorAll('.range-button').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.range-button').forEach(item => item.classList.toggle('active', item === button));
    if (button.dataset.period !== 'custom') {
      const range = button.dataset.period === 'multi' ? periodDefinitions['3y'] : periodDefinitions[button.dataset.period];
      if (range) {
        document.querySelector('#bt-start').value = range.startDate;
        document.querySelector('#bt-end').value = range.endDate;
      }
    }
  }));
  document.querySelectorAll('#market-screen .period').forEach(button => button.addEventListener('click', () => {
    const range = button.textContent.trim().toLowerCase();
    const key = range === '1y' ? '1y' : range === '5y' ? '5y' : '3y';
    document.querySelectorAll('.range-button').forEach(item => item.classList.toggle('active', item.dataset.period === key));
    setScreen('backtest-screen');
    document.querySelector('#run-backtest').click();
  }));
  document.querySelector('#market-screen .text-button').addEventListener('click', () => setScreen('strategy-screen'));
  ['bt-start', 'bt-end'].forEach(id => document.querySelector('#' + id).addEventListener('change', () => {
    document.querySelectorAll('.range-button').forEach(item => item.classList.toggle('active', item.dataset.period === 'custom'));
  }));

  document.querySelector('#run-backtest').addEventListener('click', () => {
    const button = document.querySelector('#run-backtest');
    try {
      const validation = validateParams();
      if (validation) throw new Error(validation);
      if (!universe.length) throw new Error('历史日线尚未就绪，请等待自动下载');
      const ranges = selectedRanges();
      button.disabled = true;
      document.querySelector('#bt-status').textContent = '正在计算…';
      const params = readParams();
      ranges.forEach(range => {
        const hasBars = universe.some(symbol => symbol.bars.some(bar => bar.date >= range.startDate && bar.date <= range.endDate));
        if (!hasBars) throw new Error(`${range.label} 与当前数据日期无交集`);
        backtestRuns.set(range.key, engine.runBacktest(universe, {
          ...params, startDate: range.startDate, endDate: range.endDate
        }));
      });
      activePeriod = ranges.find(range => range.key === '3y')?.key || ranges[0].key;
      lastRun = backtestRuns.get(activePeriod);
      renderComparison();
      showPeriod(activePeriod);
      document.querySelector('#bt-status').textContent = `完成 · ${ranges.length} 个区间`;
    } catch (error) {
      document.querySelector('#bt-status').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector('#export-trades').addEventListener('click', () => {
    const result = backtestRuns.get(activePeriod);
    if (!result) {
      document.querySelector('#bt-status').textContent = '请先运行回测';
      return;
    }
    const columns = ['code', 'symbol', 'entryDate', 'exitDate', 'entry', 'exit', 'shares', 'pnl', 'returnPct', 'rMultiple', 'reason', 'signal_date', 'trade_level', 'confirm_level', 'trigger_level', 'definition_mode', 'approximation_loss'];
    const rows = result.trades.map(trade => columns.map(column => {
      const key = column === 'signal_date' ? trade.signal?.available_at : column;
      const value = column === 'signal_date' ? trade.signal?.available_at
        : ['trade_level', 'confirm_level', 'trigger_level', 'definition_mode', 'approximation_loss'].includes(column)
          ? trade.signal?.[column] : trade[key];
      return `"${String(value ?? '').replaceAll('"', '""')}"`;
    }).join(','));
    const blob = new Blob(['\ufeff' + [columns.join(','), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `liangce-trades-${activePeriod}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  loadParams();
  updateCalculator();
  document.querySelector('#candidate-body').innerHTML = '<tr><td colspan="7" class="empty-state">等待真实通达信行情扫描…</td></tr>';
  document.querySelectorAll('.nav button').forEach(button => { button.disabled = false; });
  // Backtest starts only after real OHLCV/CSV data is explicitly loaded.
})();
