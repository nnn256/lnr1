(function(root,factory){
 const api=factory(typeof module==='object'&&module.exports?require('./strategy.js'):root.QuantStrategy);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.LiangceAnalysis=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(engine){
 'use strict';
 function summarize(history,overrides={}){
  const params={...engine.DEFAULT_PARAMS,...overrides},bars=history.bars;
  if(!Array.isArray(bars)||bars.length<100)throw Error('历史不足100根');
  const indicators=engine.buildIndicators(bars,params),index=bars.length-1,bar=bars[index];
  const signal=engine.scoreAt(bars,indicators,index,params);
  const trigger=Math.max(...bars.slice(Math.max(0,index-params.breakoutPeriod),index).map(item=>item.high));
  const distance=bar.close/trigger-1;
  const complete=signal.trend&&signal.macdConfirmed&&signal.volumeConfirmed&&(signal.breakout||signal.pullback)&&(!params.requireChan||Boolean(signal.chan));
  const status=complete?'代理条件齐备':Math.abs(distance)<=.015&&signal.trend?'接近触发':'观察';
  const atrValue=indicators.atr[index],volumeRatio=bar.volume/indicators.volume20[index];
  if(![trigger,distance,atrValue,volumeRatio].every(Number.isFinite))throw Error('指标预热不足');
  return {code:history.code,name:history.name||history.code,source:history.source,adjusted:Boolean(history.adjusted),
   history_freshness:history.history_freshness,history_note:history.history_note,checked_at:history.checked_at,
   history_count:bars.length,bar,signal,trigger,distance,status,atrValue,volumeRatio,
   definition_mode:'proxy_research',execution_allowed:false,input_sha256:history.input_sha256};
 }
 return {summarize};
});
