(() => {
 'use strict';
 if(window.pywebview?.api)return;
 const config=window.LIANGCE_WEB_CONFIG||{mode:'api'},snapshotMode=config.mode==='snapshot';
 const cloud=snapshotMode&&config.live_api?LiangceRailway.create({baseUrl:config.live_api}):null;
 let manifest,market,scores,params={},generation=0,issueRevision=0,tokenId=0,pending=null,paused=false,completed={},issues={},queue=[],initializing,scoring,downloaded=new Map(),exports=[];
 const announce=(message,state='ready')=>window.dispatchEvent(new CustomEvent('liangce:web-status',{detail:{message,state}}));
 const dataPath=path=>config.data_base&&/^data\/daily\//.test(path)?new URL(path,config.data_base).href:path;
 const json=async path=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{const response=await fetch(dataPath(path),{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error(response.status===404?'尚未发布这份数据':'数据读取失败 '+response.status);return await response.json();}
  catch(error){if(error.name==='AbortError')throw Error('数据下载超时，请检查网络或点击重试');throw error;}
  finally{clearTimeout(timer);}
 };
 async function initialize(force=false){
  if(force){initializing=null;scoring=null;downloaded.clear();}
  if(!initializing)initializing=(async()=>{
   [manifest,market]=await Promise.all([json('data/manifest.json'),json('data/market.json')]);
   announce(`股票列表已就绪 · 历史快照截至 ${manifest.market_day||'未知'}${cloud?' · 正在获取云端报价':''}`);
  })().catch(error=>{initializing=null;announce(error.message,'error');throw error;});
  return initializing;
 }
 async function initializeScores(){
  await initialize();
  if(!scoring)scoring=json('data/scores.json').then(value=>{scores=value;}).catch(error=>{scoring=null;throw error;});
  return scoring;
 }
 function reset(next){
  params=next||{};generation++;issueRevision++;pending=null;paused=false;
  if(Object.keys(params).length===0){completed=Object.fromEntries(scores.map(x=>[x.code,x]));issues=Object.fromEntries(manifest.issues.map(x=>[x.code,x]));queue=[];}
  else{completed={};issues={};queue=market.securities.slice();}
 }
 function progress(){
  const counts={};Object.values(issues).forEach(x=>counts[x.kind]=(counts[x.kind]||0)+1);
  const analysed=Object.keys(completed).length,short=counts.short_history||0,empty=counts.no_history||0,failed=Object.keys(issues).length-short-empty;
  return {phase:paused?'paused':queue.length||pending?'running':'complete',message:'正在按已发布日线计算',total:market.securities.length,completed:analysed+Object.keys(issues).length,analysed,downloaded:analysed+short,short_history:short,no_history:empty,failed,issues_count:Object.keys(issues).length,issues_version:issueRevision,restored:Object.keys(params).length?0:scores.length,elapsed_seconds:0,eta_seconds:null,market_day:manifest.market_day,run_id:String(generation),generation};
 }
 async function history(code){
  code=String(code);if(!/^\d{6}$/.test(code))throw Error('请输入六位股票代码');
  if(!manifest.histories.includes(code))return {ok:false,message:'已发布数据暂未包含这只股票的日线'};
  if(downloaded.has(code))return downloaded.get(code);
  const h=await json(`data/daily/${code}.json`);
  const bars=h.bars.map((b,index,all)=>({date:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5],prevClose:index?all[index-1][4]:b[4]}));
  const raw=JSON.stringify(bars.map(b=>Object.fromEntries(Object.entries(b).sort(([a],[z])=>a.localeCompare(z)))));
  let hash=h.input_sha256;
  if(!hash&&crypto.subtle)hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),b=>b.toString(16).padStart(2,'0')).join('');
  const result={...h,bars,ok:true,code,input_sha256:hash||'published-snapshot',cached:true,history_note:`已发布日线 · 截至 ${h.last_date}`,history_freshness:'published_snapshot'};
  downloaded.set(code,result);if(downloaded.size>30)downloaded.delete(downloaded.keys().next().value);return result;
 }
 function save(filename,encoded){
  if(!/^liangce-[A-Za-z0-9_.-]+\.(json|csv|png)$/.test(filename))throw Error('导出文件名无效');
  const binary=atob(encoded),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  const blob=new Blob([bytes],{type:filename.endsWith('.png')?'image/png':filename.endsWith('.json')?'application/json':'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);exports.push({url,filename});const a=document.createElement('a');a.href=url;a.download=filename;a.click();
  return {ok:true,filename,bytes:bytes.length};
 }
 function openExports(){
  let dialog=document.querySelector('#web-exports');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='web-exports';dialog.className='history-dialog';document.body.append(dialog);}
  dialog.replaceChildren();const heading=document.createElement('h2');heading.textContent='本次导出';dialog.append(heading);
  for(const item of exports){const p=document.createElement('p'),a=document.createElement('a');a.href=item.url;a.download=item.filename;a.textContent=item.filename;p.append(a);dialog.append(p);}
  if(!exports.length){const p=document.createElement('p');p.textContent='导出的文件会下载到浏览器下载目录。';dialog.append(p);}
  const close=document.createElement('button');close.className='quiet-button';close.textContent='关闭';close.onclick=()=>dialog.close();dialog.append(close);dialog.showModal();return {ok:true};
 }
 const staticAPI={
  async start_background(){await initialize();return {ok:true};},
  async refresh_data(){await initialize(true);await initializeScores();reset(params);return {ok:true};},
  async get_state(mv=-1,hv=-1){await initialize();return {version:'1.6.0',phase:'ready',message:`已发布行情 · 截至 ${manifest.market_day}`,market_version:generation,history_version:0,progress:{done:manifest.histories.length,total:market.securities.length,failed:0},...(mv!==generation?{market}:{ }),...(hv!==0?{histories:[]}:{})};},
  async get_research_report(){return {status:'unavailable',message:'已发布网页未包含本机研究报告；可连接完整网页服务查看'};},
  async configure_analysis(next){await initializeScores();reset(next);return {ok:true};},
  async get_analysis_batch(g=-1,iv=-1){
   await initializeScores();const current=generation;
   if(!pending&&!paused&&queue.length){
    const selected=queue.splice(0,12),histories=[];
    const fetched=await Promise.allSettled(selected.map(x=>history(x.code)));
    if(current!==generation)return {generation,run_id:String(generation),progress:progress()};
    fetched.forEach((entry,index)=>{const item=selected[index],h=entry.value;if(entry.status==='fulfilled'&&h?.ok&&h.bars.length>=100)histories.push(h);else issues[item.code]={code:item.code,name:item.name,kind:h?.ok?'short_history':entry.status==='rejected'?'fetch_error':'no_history',bar_count:h?.bars?.length||0,first_date:h?.first_date,last_date:h?.last_date,message:h?.ok?`已获取 ${h.bars.length} 根，待累计100根`:entry.reason?.message||h?.message};});
    if(histories.length<selected.length)issueRevision++;
    if(histories.length)pending={token:String(++tokenId),histories,params};
   }
   return {progress:progress(),generation,run_id:String(generation),...(g!==generation?{restored_results:Object.values(completed)}:{}),...(iv!==issueRevision?{history_issues:Object.values(issues)}:{}),...(!paused&&pending?{batch:pending}:{})};
  },
  async complete_analysis_batch(id,token,results,errors){if(id!==String(generation)||pending?.token!==token)return {ok:false,obsolete:true};for(const r of results)completed[r.code]=r;for(const e of errors)issues[e.code]={...e,kind:'compute_error',message:e.error};if(errors.length)issueRevision++;pending=null;return {ok:true};},
  async control_analysis(action){if(action==='pause')paused=true;else if(action==='resume')paused=false;else if(action==='retry_failed'){await initialize(true);await initializeScores();reset(params);}return {ok:true};},
  async get_analysis_issues(offset=0){const rows=Object.values(issues).sort((a,b)=>a.code.localeCompare(b.code));return {rows:rows.slice(offset,offset+50),total:rows.length,offset,limit:50,version:issueRevision};},
  async get_chart_history(code,count=1200,force=false){
   if(cloud&&cloud.historyMode==='live'){
    const value=await cloud.history(code,force),security=market?.securities.find(item=>item.code===String(code));
    return {...value,name:security?.name||value.name};
   }
   await initialize();
   return history(code);
  },
  async get_backtest_history(code){await initialize();return history(code);},
  async get_sectors(){return json('data/sectors.json');},
  async list_v2_jobs(){return {ok:true,sources:[],jobs:[],source_id:null,message:'已发布网页未包含本机V2任务；请使用完整网页服务读取任务库'};}
 };
 async function rpc(name,args){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
  try{const response=await fetch('api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-LiangCe-Web':'1'},body:JSON.stringify(args),signal:controller.signal});const value=await response.json();if(!response.ok)throw Error(value.message||'服务暂不可用');announce('通达信在线服务 · 报价自动刷新 · K线日期以各股票实际返回为准');return value;}
  catch(error){announce(error.name==='AbortError'?'数据服务响应超时，稍后可重试':'数据服务暂未连接，请确认网页后台已启动','error');throw error;}
  finally{clearTimeout(timer);}
 }
 window.pywebview={api:new Proxy({}, {get:(_,name)=>{
  if(name==='save_chart_export')return async(...args)=>save(...args);
  if(name==='open_chart_exports')return async()=>openExports();
  if(snapshotMode)return async(...args)=>{if(!staticAPI[name])throw Error('此功能需要完整网页服务');return staticAPI[name](...args);};
  return (...args)=>rpc(name,args);
 }})};
 window.LiangceWeb={mode:cloud?'hybrid':snapshotMode?'snapshot':'api',cloud};
 window.addEventListener('load',()=>{if(snapshotMode){document.querySelectorAll('#batch-retry,#refresh-data,#rescan-market').forEach(b=>b.textContent='检查发布更新');document.querySelector('#v2-results-screen .subtitle').textContent='本机任务可在完整网页服务中查看';const labels=document.querySelectorAll('.market-label');labels.forEach(x=>{x.innerHTML=x.innerHTML.replace('实时扫描标的','已发布标的').replace('LIVE','SNAPSHOT');});}const dir=document.querySelector('#tv-export-dir');if(dir)dir.textContent='下载记录';});
})();
