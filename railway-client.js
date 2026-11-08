(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.LiangceRailway=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function symbol(code){code=String(code);if(/^(sh|sz|bj)\d{6}$/.test(code))return code;if(!/^\d{6}$/.test(code))throw Error('请输入六位股票代码');return (code.startsWith('6')?'sh':/^(4|8|92)/.test(code)?'bj':'sz')+code;}
 function create({baseUrl,fetcher=fetch,clock=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
  const base=new URL(baseUrl);if(base.protocol!=='https:')throw Error('云端接口必须使用HTTPS');
  const cache=new Map(),pending=new Map();let historyMode='live',session='outside_trading_hours';
  async function request(path,body){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
   try{const response=await fetcher(new URL(path,base).href,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,credentials:'omit',cache:'no-store',signal:controller.signal});
    const data=await response.json();if(!response.ok){const error=Error(typeof data.detail==='string'?data.detail:'云端请求失败 '+response.status);error.status=response.status;throw error;}return data;
   }finally{clearTimeout(timer);}
  }
  async function quotes(codes){
   const requested=[...new Set(codes.map(symbol))],output={},missing=[];let refresh=300,received=null,error=null;
   for(let offset=0;offset<requested.length;offset+=80){
    const batch=requested.slice(offset,offset+80),data=await request('/api/research/quotes?symbols='+batch.join(','));
    session=data.market_session;refresh=Math.min(refresh,session==='trading_hours'?Math.max(20,Number(data.refresh_after_seconds)||20):300);received=data.received_at;error=data.error||error;
    for(const full of batch){const row=data.quotes?.[full];
     if(!row||row.symbol!==full||!Number.isFinite(row.price)||row.price<=0){missing.push(full.slice(2));continue;}
     output[full.slice(2)]={code:full.slice(2),name:row.name,price:row.price,previous_close:row.previous_close,
      change:Number.isFinite(row.change_percent)?row.change_percent:null,market_time:row.market_time,received_at:row.received_at,
      source:row.source,live_quote:true,stale:Boolean(row.stale)};
    }
   }
   return {quotes:output,missing,refresh_after_seconds:refresh,market_session:session,received_at:received,error};
  }
  function convert(panel,full){
   if(panel.symbol!==full||panel.period!=='day'||panel.source_kind==='verified_historical_snapshot')throw Error('云端未返回所选股票的最新日线');
   const unique=new Map();
   for(const b of panel.bars||[]){
    const date=String(b.date_cn||'').slice(0,10),values=['open','high','low','close','volume'].map(k=>b[k]);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||values.some(x=>!Number.isFinite(x))||Math.min(...values.slice(0,4))<=0||b.volume<0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))throw Error('云端K线数据校验失败');
    unique.set(date,{date,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,is_closed:b.is_closed!==false});
   }
   const bars=[...unique.values()].sort((a,b)=>a.date.localeCompare(b.date));if(!bars.length)throw Error('云端没有有效日线');
   bars.forEach((b,i)=>b.prevClose=i?bars[i-1].close:b.close);
   return {ok:true,code:full.slice(2),name:panel.name,bars,source:'Railway / market_gateway',adjusted:null,adjustment:'provider_unspecified',
    volume_unit:panel.provenance?.volume_unit||'source_native',history_freshness:'cloud_live',checked_at:panel.computed_at,
    first_date:bars[0].date,last_date:bars.at(-1).date,input_sha256:panel.coverage?.input_sha256||'',score_ready:bars.length>=100,
    history_note:`云端已核验 ${bars.length} 根闭合日线；上游复权口径未认证`,execution_allowed:false};
  }
  async function loadHistory(full,force){
   const maxAge=session==='trading_hours'?60000:300000;
   if(!force){
    try{const panel=await request('/api/research/panel/'+full+'/day');
     const age=clock()-Date.parse(panel.computed_at||'');if(panel.source_kind!=='verified_historical_snapshot'&&age>=0&&age<maxAge)return convert(panel,full);
    }catch(error){if(error.status!==404)throw error;}
   }
   const job=await request('/api/research/jobs',{symbol:full,period:'day',source:'live',mode:'analysis'}),deadline=clock()+180000;
   if(!/^[a-f0-9]{32}$/.test(job.id))throw Error('云端任务编号无效');
   while(clock()<deadline){
    const state=await request('/api/research/jobs/'+job.id);
    if(state.state==='failed')throw Error(state.error||'云端取数失败');
    if(state.state==='completed')return convert(await request('/api/research/jobs/'+job.id+'/result'),full);
    await sleep(1500);
   }
   throw Error('云端仍在取数，请稍后刷新；也可切换查看已发布历史');
  }
  async function history(code,force=false){
   const full=symbol(code),saved=cache.get(full),maxAge=session==='trading_hours'?60000:300000;
   if(!force&&saved&&clock()-saved.savedAt<maxAge)return saved.value;
   if(pending.has(full))return pending.get(full);
   const promise=loadHistory(full,force).then(value=>{cache.set(full,{value,savedAt:clock()});if(cache.size>20)cache.delete(cache.keys().next().value);return value;}).finally(()=>pending.delete(full));
   pending.set(full,promise);return promise;
  }
  return {quotes,history,get historyMode(){return historyMode;},setHistoryMode(value){if(!['live','published'].includes(value))throw Error('历史来源无效');historyMode=value;}};
 }
 return {create,symbol};
});
