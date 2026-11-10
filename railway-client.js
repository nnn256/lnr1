(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.LiangceRailway=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function symbol(code){code=String(code);if(/^(sh|sz|bj)\d{6}$/.test(code))return code;if(!/^\d{6}$/.test(code))throw Error('请输入六位股票代码');return (code.startsWith('6')?'sh':/^(4|8|92)/.test(code)?'bj':'sz')+code;}
 function create({baseUrl,fetcher=fetch,clock=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),requestTimeoutMs=20000}){
  const base=new URL(baseUrl);if(base.protocol!=='https:')throw Error('云端接口必须使用HTTPS');
  const cache=new Map(),pending=new Map();let historyMode='live',session='outside_trading_hours';
  async function request(path,body){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),requestTimeoutMs);
   try{const response=await fetcher(new URL(path,base).href,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,credentials:'omit',cache:'no-store',signal:controller.signal});
    const data=await response.json();if(!response.ok){const error=Error(typeof data.detail==='string'?data.detail:'云端请求失败 '+response.status);error.status=response.status;throw error;}return data;
   }catch(error){if(error.name==='AbortError')throw Error('云端响应超时，请点击刷新重试');throw error;}
   finally{clearTimeout(timer);}
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
  async function historyRequest(path,body){
   for(let attempt=0;;attempt++){
    try{return await request(path,body);}
    catch(error){if(error.status!==429||attempt>=2)throw error;await sleep((attempt+1)*2000);}
   }
  }
  function convert(panel,full){
   if(panel.symbol!==full||panel.period!=='day'||panel.source_kind!=='live_candles'||panel.structure_computed!==false)throw Error('云端未返回所选股票的实时K线');
   const unique=new Map();
   for(const b of panel.bars||[]){
    if(b.is_closed===false)continue;
    const date=String(b.date_cn||'').slice(0,10),values=['open','high','low','close','volume'].map(k=>b[k]);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||values.some(x=>!Number.isFinite(x))||Math.min(...values.slice(0,4))<=0||b.volume<0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))throw Error('云端K线数据校验失败');
    unique.set(date,{date,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,is_closed:b.is_closed!==false});
   }
   const bars=[...unique.values()].sort((a,b)=>a.date.localeCompare(b.date));if(!bars.length)throw Error('云端没有有效日线');
   bars.forEach((b,i)=>b.prevClose=i?bars[i-1].close:b.close);
   const adjustment=panel.provenance?.adjustment||'provider_unspecified';
   return {ok:true,code:full.slice(2),name:panel.name,bars,source:'Railway / '+(panel.provenance?.source||'tdx-api'),adjusted:adjustment==='unadjusted'?false:null,adjustment,
    volume_unit:panel.provenance?.volume_unit||'source_native',history_freshness:'cloud_live',checked_at:panel.computed_at,
    first_date:bars[0].date,last_date:bars.at(-1).date,input_sha256:panel.coverage?.input_sha256||'',score_ready:bars.length>=100,
    history_note:`实时API · 最近 ${bars.length} 根已收盘日线 · ${adjustment==='unadjusted'?'未复权':'上游复权口径未认证'}`,coverage:panel.coverage,execution_allowed:false};
  }
  async function loadHistory(full,force){
   const panel=await historyRequest('/api/market/candles/'+full+'?period=day&count=1200'+(force?'&refresh=true':''));
   return convert(panel,full);
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
