(() => {
 'use strict';const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const screen=document.createElement('div');screen.id='sectors-screen';screen.className='content screen';screen.hidden=true;
 screen.innerHTML=`<div class="page-head"><div><h1>板块轮动</h1><div id="sector-source" class="subtitle">读取板块指数历史…</div></div><button id="sector-refresh" class="quiet-button">刷新板块行情</button></div><section class="panel"><div class="pipeline-top"><div><div id="sector-status" class="pipeline-message" role="status">等待加载</div><div id="sector-method" class="pipeline-meta"></div></div></div><div class="filters"><input id="sector-search" class="search" aria-label="搜索板块" placeholder="搜索板块名称"><select id="sector-sort" class="select" aria-label="板块排序"><option value="rank">5日强度排名</option><option value="rank_change_5d">排名提升</option><option value="quote_change_pct">盘中涨幅</option><option value="return_20d">20日收益</option></select></div><div class="table-wrap"><table><thead><tr><th>板块 / 排名</th><th>最新涨幅</th><th>5日收益</th><th>20日收益</th><th>5日排名变化</th><th>涨 / 跌家数</th><th>行情成交额</th><th>历史截至</th></tr></thead><tbody id="sector-rows"></tbody></table></div><div class="table-foot"><span id="sector-count"></span><button id="sector-prev" class="quiet-button">上一页</button><button id="sector-next" class="quiet-button">下一页</button></div></section><section class="panel" style="margin-top:16px"><div class="panel-head"><h2 id="sector-detail-title" class="section-title">点击板块查看排名轨迹</h2></div><div id="sector-detail" class="method-note"></div></section>`;
 $('main').append(screen);const button=Array.from(document.querySelectorAll('.nav button')).find(b=>b.textContent.includes('板块轮动'));
 let data=null,page=0,selected=null,loading=false,lastLive=0,version=0;
 const number=(v,suffix='%')=>typeof v==='number'&&Number.isFinite(v)?`${v>0?'+':''}${v.toFixed(2)}${suffix}`:'—';
 function detail(row){selected=row.code;$('#sector-detail-title').textContent=row.name+' · 5日收益排名轨迹';$('#sector-detail').textContent=row.rank_history.map(x=>`${x.date}：${x.rank==null?'缺数据':'第'+x.rank+'名'}`).join(' → ');}
 function render(){if(!data)return;const search=$('#sector-search').value.trim(),sort=$('#sector-sort').value;
  const rows=data.rows.filter(r=>r.name.includes(search)||r.code.includes(search)).sort((a,b)=>{
   const x=a[sort],y=b[sort];if(x==null||y==null)return x==null?(y==null?0:1):-1;return sort==='rank'?x-y:y-x;
  });page=Math.min(page,Math.max(0,Math.ceil(rows.length/30)-1));
  $('#sector-rows').innerHTML=rows.slice(page*30,page*30+30).map(r=>`<tr data-sector="${esc(r.code)}" tabindex="0"><td><button class="data-link">${esc(r.name)}</button><div class="stock-code">${esc(r.code)} · ${r.rank==null?'缺排名':'第'+r.rank+'名'}</div></td><td class="${r.quote_change_pct>=0?'up':'down'}">${number(r.quote_change_pct)}<div class="stock-code">${esc(r.quote_time?.slice(5,16).replace('T',' ')||'时间未提供')}</div></td><td class="${r.return_5d>=0?'up':'down'}">${number(r.return_5d)}</td><td class="${r.return_20d>=0?'up':'down'}">${number(r.return_20d)}</td><td>${r.rank_change_5d==null?'—':r.rank_change_5d>0?'↑ '+r.rank_change_5d:r.rank_change_5d<0?'↓ '+Math.abs(r.rank_change_5d):'持平'}</td><td>${esc(r.up_count??'—')} / ${esc(r.down_count??'—')}</td><td>${typeof r.quote_amount==='number'?(r.quote_amount/1e8).toFixed(2)+'亿':'—'}</td><td>${esc(r.history_as_of)}</td></tr>`).join('')||'<tr><td colspan="8" class="empty-state">没有匹配板块</td></tr>';
  $('#sector-count').textContent=`${rows.length}个板块 · ${page+1}/${Math.max(1,Math.ceil(rows.length/30))}页`;
  $('#sector-prev').disabled=page===0;$('#sector-next').disabled=(page+1)*30>=rows.length;
  $('#sector-rows').querySelectorAll('[data-sector]').forEach(el=>{const choose=()=>detail(rows.find(x=>x.code===el.dataset.sector));el.onclick=choose;el.onkeydown=e=>{if(e.key==='Enter')choose();};});
  if(!selected&&rows[0])detail(rows[0]);
 }
 async function load(){const own=++version;try{
  data=await pywebview.api.get_sectors();if(own!==version)return;if(!data?.ok||!data.rows?.length)throw Error(data?.message||'尚无板块数据');
  $('#sector-source').textContent=`${data.source} · 历史截至 ${data.as_of} · 覆盖 ${data.covered}/${data.total} 个板块`;
  $('#sector-method').textContent=data.methodology+' '+data.classification;
  $('#sector-status').textContent=`历史轮动已加载${data.failed.length?'，'+data.failed.length+'个板块历史暂缺':''}；正在核验最新板块行情`;render();await live();
 }catch(e){$('#sector-status').textContent='板块数据读取失败：'+e.message;}}
 async function live(){if(loading||!data)return;loading=true;$('#sector-refresh').disabled=true;
  try{
   const found=new Map();let total=Infinity;
   for(let pn=1;found.size<total&&pn<=10;pn++){
    const url='https://push2.eastmoney.com/api/qt/clist/get?'+new URLSearchParams({pn,pz:100,po:0,np:1,fid:'f12',fs:'m:90+t:2',fields:'f12,f14,f3,f6,f104,f105,f124',fltt:2});
    const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('行情HTTP '+response.status);const payload=await response.json();if(!payload.data)throw Error('行情源空响应');total=payload.data.total;
    const rows=Array.isArray(payload.data.diff)?payload.data.diff:Object.values(payload.data.diff||{});if(!rows.length)break;rows.forEach(x=>found.set(x.f12,x));
   }
   if(found.size!==total)throw Error('板块行情分页不完整');
   for(const row of data.rows){const q=found.get(row.code);if(q)Object.assign(row,{quote_change_pct:typeof q.f3==='number'?q.f3:null,quote_amount:typeof q.f6==='number'?q.f6:null,up_count:q.f104,down_count:q.f105,quote_time:typeof q.f124==='number'?new Date(q.f124*1000+8*3600000).toISOString().slice(0,19)+'+08:00':null});}
   lastLive=Date.now();$('#sector-status').textContent=`已核验 ${found.size} 个板块行情 · 历史轮动仍截至 ${data.as_of}`;render();
  }catch(e){$('#sector-status').textContent='最新板块行情未更新：'+e.message+'；下表保留标有原时间的已发布数据';}
  finally{loading=false;$('#sector-refresh').disabled=false;}
 }
 button.onclick=()=>{document.querySelectorAll('.screen').forEach(x=>x.hidden=x!==screen);document.querySelectorAll('.nav button').forEach(x=>x.classList.toggle('active',x===button));$('.crumb b').textContent='板块轮动';if(!data)load();else if(Date.now()-lastLive>60000)live();};
 $('#sector-refresh').onclick=()=>data?live():load();$('#sector-search').oninput=()=>{page=0;render();};$('#sector-sort').onchange=()=>{page=0;render();};$('#sector-prev').onclick=()=>{page--;render();};$('#sector-next').onclick=()=>{page++;render();};
 setInterval(()=>{if(!document.hidden&&!screen.hidden&&Date.now()-lastLive>60000)live();},60000);
 window.LiangceSectors={state:()=>({loaded:Boolean(data),count:data?.rows.length,as_of:data?.as_of,page,selected,loading}),data:()=>data};
})();
