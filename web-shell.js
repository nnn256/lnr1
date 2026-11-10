(() => {
 'use strict';
 const sidebar=document.querySelector('.app > aside'),topbar=document.querySelector('.topbar');
 sidebar.id='web-navigation';
 const menu=document.createElement('button');menu.className='web-menu';menu.type='button';menu.textContent='☰';menu.setAttribute('aria-label','打开导航');menu.setAttribute('aria-controls',sidebar.id);menu.setAttribute('aria-expanded','false');topbar.prepend(menu);
 const shade=document.createElement('button');shade.className='web-shade';shade.hidden=true;shade.setAttribute('aria-label','关闭导航');document.body.append(shade);
 function close(){document.body.classList.remove('web-nav-open');shade.hidden=true;menu.setAttribute('aria-expanded','false');}
 menu.onclick=()=>{const open=!document.body.classList.contains('web-nav-open');document.body.classList.toggle('web-nav-open',open);shade.hidden=!open;menu.setAttribute('aria-expanded',String(open));if(open)sidebar.querySelector('.nav button')?.focus();};
 shade.onclick=()=>{close();menu.focus();};
 document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
 sidebar.addEventListener('click',e=>{if(e.target.closest('.nav button'))close();});
 const bottom=document.createElement('nav');bottom.className='web-bottom';bottom.setAttribute('aria-label','快捷导航');
 for(const [label,key] of [['市场','market-screen'],['图表','图表复盘'],['策略','strategy-screen'],['更多','more']]){
  const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{if(key==='more'){menu.click();return;}const target=Array.from(sidebar.querySelectorAll('.nav button')).find(x=>x.dataset.screen===key||x.textContent.trim().includes(key));target?.click();window.scrollTo({top:0,behavior:'instant'});};bottom.append(b);
 }
 document.body.append(bottom);
 const banner=document.createElement('div');banner.className='web-data-banner';banner.id='web-data-banner';banner.setAttribute('role','status');banner.textContent='正在加载股票列表（最多30秒），评分将单独加载…';topbar.after(banner);
 document.querySelector('.side-bottom').textContent='LiangCe Web · 多端研究工作台';
 const badge=document.querySelector('.demo-label');badge.textContent='网页端';
 window.addEventListener('liangce:web-status',e=>{banner.textContent=e.detail.message;banner.dataset.state=e.detail.state||'ready';});
 window.addEventListener('resize',()=>{if(window.innerWidth>760)close();});
})();
