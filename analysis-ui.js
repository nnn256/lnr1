(() => {
 'use strict';
 const $=selector=>document.querySelector(selector);
 const section=document.createElement('section');section.className='panel data-pipeline';section.id='batch-analysis-panel';
 section.innerHTML='<div class="pipeline-top"><div><div id="batch-message" class="pipeline-message" role="status">全市场日线获取与评分 · 等待启动</div><div id="batch-meta" class="pipeline-meta">所有有效K线都会保存；累计100根后再评分</div></div><div style="display:flex;gap:8px"><button id="batch-pause" class="quiet-button">暂停</button><button id="batch-retry" class="quiet-button">重新获取未评分数据</button></div></div><div class="pipeline-progress"><span id="batch-progress" style="width:0%"></span></div><details id="batch-issues" style="margin-top:12px"><summary id="batch-issues-title" style="cursor:pointer">查看未评分股票的数据</summary><div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>股票</th><th>已获取日线</th><th>起止日期</th><th>状态</th><th>查看</th></tr></thead><tbody id="batch-issue-rows"></tbody></table></div><div class="table-foot"><span id="batch-issue-page"></span><button id="batch-issue-prev" class="quiet-button">上一页</button><button id="batch-issue-next" class="quiet-button">下一页</button></div></details>';
 $('#market-screen .data-pipeline').after(section);
 let started=false,busy=false,generation=-1,worker,paramsVersion=0,paused=false,marketIssuesVersion=-1;
 let issuesOffset=0,issuesVersion=-1,issuesRequest=0;
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 async function loadIssues(){
  const request=++issuesRequest;
  try{
   const data=await pywebview.api.get_analysis_issues(issuesOffset);
   if(request!==issuesRequest)return;
   if(issuesOffset>=data.total&&issuesOffset){issuesOffset=Math.max(0,Math.floor((data.total-1)/data.limit)*data.limit);return loadIssues();}
   issuesVersion=data.version;
   $('#batch-issue-rows').innerHTML=data.rows.map(row=>`<tr><td>${esc(row.name)}<div class="stock-code">${esc(row.code)}</div></td><td>${row.bar_count==null?'—':esc(row.bar_count)+' 根'}</td><td>${esc(row.first_date||'—')} → ${esc(row.last_date||'—')}</td><td>${esc(row.message)}</td><td>${row.bar_count>0?`<button class="data-link" data-short-chart="${esc(row.code)}">查看K线</button>`:'等待重新获取'}</td></tr>`).join('')||'<tr><td colspan="5" class="empty-state">没有待处理的数据记录</td></tr>';
   $('#batch-issue-page').textContent=data.total?`${data.offset+1}–${Math.min(data.total,data.offset+data.limit)} / ${data.total} 只`:'0 只';
   $('#batch-issue-prev').disabled=data.offset===0;$('#batch-issue-next').disabled=data.offset+data.limit>=data.total;
   $('#batch-issue-rows').querySelectorAll('[data-short-chart]').forEach(button=>button.onclick=()=>window.LiangceCharts?.open(button.dataset.shortChart));
  }catch(error){if(request===issuesRequest)$('#batch-issue-page').textContent='数据明细读取失败，请重新展开';console.error(error);}
 }
 function format(seconds){return seconds==null?'测算中':seconds<60?`${Math.round(seconds)}秒`:`${Math.floor(seconds/60)}分${Math.round(seconds%60)}秒`;}
 function status(p){
  if(!p)return;
  paused=p.phase==='paused';$('#batch-pause').textContent=paused?'继续':'暂停';
  $('#batch-message').textContent=`全市场日线评分 ${p.analysed} / ${p.total} · ${paused?'已暂停':p.phase==='complete'?'本轮完成':p.message}`;
  $('#batch-meta').textContent=`已获取K线 ${p.downloaded} 只 · 已评分 ${p.analysed} 只 · 待累计100根 ${p.short_history} 只 · 暂无K线 ${p.no_history} 只 · 获取或计算失败 ${p.failed} 只 · 用时 ${format(p.elapsed_seconds)}${p.phase==='complete'?'':' · 预计剩余 '+format(p.eta_seconds)} · 日线基准 ${p.market_day||'等待核验'}`;
  $('#batch-issues-title').textContent=`查看未评分股票的数据 · ${p.issues_count} 只`;
  if($('#batch-issues').open&&issuesVersion!==p.issues_version)loadIssues();
  $('#batch-progress').style.width=`${p.total?100*p.completed/p.total:0}%`;
  window.liangceBatchProgress=p;
 }
 function calculate(batch){return new Promise((resolve,reject)=>{
  const done=event=>{if(event.data.token===batch.token){cleanup();resolve(event.data);}};
  const fail=event=>{cleanup();reject(Error(event.message||'计算线程异常'));};
  const cleanup=()=>{worker.removeEventListener('message',done);worker.removeEventListener('error',fail);};
  worker.addEventListener('message',done);worker.addEventListener('error',fail);
  worker.postMessage(batch);
 });}
 async function poll(){
  if(busy||!started)return;busy=true;const version=paramsVersion;
  try{
   const state=await pywebview.api.get_analysis_batch(generation,marketIssuesVersion);status(state.progress);
   if(state.history_issues&&version===paramsVersion){LiangceApp.loadHistoryStatuses(state.history_issues);marketIssuesVersion=state.progress.issues_version;}
   if(state.restored_results&&version===paramsVersion){LiangceApp.loadAnalysisSummaries(state.restored_results,true);generation=state.generation;}
   if(state.batch){
    const output=await calculate(state.batch);
    const ack=await pywebview.api.complete_analysis_batch(state.run_id,state.batch.token,output.results,output.errors);
    if(ack.ok&&version===paramsVersion)LiangceApp.loadAnalysisSummaries(output.results);
   }
  }catch(error){$('#batch-message').textContent='批量评分暂未完成，正在重试';console.error('batch-analysis',error);}
  finally{busy=false;setTimeout(poll,250);}
 }
 async function start(){
  if(started||!window.pywebview?.api)return;
  started=true;if(!worker)worker=new Worker('analysis-worker.js'+(window.LIANGCE_ASSET_VERSION?'?v='+window.LIANGCE_ASSET_VERSION:''));
  try{await pywebview.api.configure_analysis(LiangceApp.analysisParams());poll();}
  catch(error){started=false;$('#batch-message').textContent=`评分暂未加载：${error.message} · 股票搜索和看图可继续使用`;setTimeout(start,15000);}
 }
 $('#batch-pause').onclick=()=>pywebview.api.control_analysis(paused?'resume':'pause');
 $('#batch-retry').onclick=async()=>{
  $('#batch-retry').disabled=true;
  try{await pywebview.api.control_analysis('retry_failed');issuesVersion=-1;$('#batch-message').textContent='已开始向行情源重新获取未评分数据';}
  catch(error){$('#batch-message').textContent='重新获取未启动，请重试';console.error(error);}
  finally{$('#batch-retry').disabled=false;}
 };
 $('#batch-issues').ontoggle=()=>{if($('#batch-issues').open)loadIssues();};
 $('#batch-issue-prev').onclick=()=>{issuesOffset=Math.max(0,issuesOffset-50);loadIssues();};
 $('#batch-issue-next').onclick=()=>{issuesOffset+=50;loadIssues();};
 window.addEventListener('liangce:strategy-changed',async event=>{
  if(!started)return;paramsVersion++;generation=-1;await pywebview.api.configure_analysis(LiangceApp.analysisParams());
 });
 window.addEventListener('pywebviewready',start);if(window.pywebview?.api)start();
})();
