(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./strategy.js'):root.QuantStrategy);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.LiangceBacktest=api;})(typeof globalThis!=='undefined'?globalThis:this,function(engine){
 'use strict';
 function codes(text){const rows=[...new Set(String(text).trim().split(/[\s,，;；]+/).filter(Boolean))];if(!rows.length||rows.length>50||rows.some(x=>!/^\d{6}$/.test(x)))throw Error('请输入1～50个六位股票代码，用空格或逗号分隔');return rows;}
 function date(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error('回测日期无效');return value;}
 function validateRange(start,end){date(start);date(end);if(start>end)throw Error('起始日期不能晚于结束日期');}
 function coverage(universe){
  if(!universe.length)throw Error('没有加载回测样本');
  return universe.map(h=>{if(!h.bars?.length||h.bars.length<100)throw Error(`${h.code} 仅有 ${h.bars?.length||0} 根日线，回测至少需要100根`);
   if(h.adjustment==='provider_unspecified')throw Error(`${h.code} 云端日线口径未认证，请使用完整历史或导入已核对CSV`);
   return {code:h.code,name:h.name||h.code,bars:h.bars.length,first:h.bars[0].date,last:h.bars.at(-1).date,source:h.source||'CSV',adjustment:h.adjustment|| (h.adjusted?'qfq':'none')};});
 }
 function ranges(universe,mode,start,end){
  const rows=coverage(universe),last=rows.map(x=>x.last).sort().at(-1),first=rows.map(x=>x.first).sort()[0];
  const definitions={};for(const years of [1,3,5]){const d=new Date(last+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()-years);definitions[years+'y']={key:years+'y',label:`近 ${years} 年`,startDate:d.toISOString().slice(0,10),endDate:last};}
  definitions.all={key:'all',label:'全样本',startDate:first,endDate:last};
  if(mode==='custom'){validateRange(start,end);return [{key:'custom',label:'自定义区间',startDate:start,endDate:end}];}
  if(mode==='multi')return ['1y','3y','5y','all'].map(key=>definitions[key]);
  if(!definitions[mode])throw Error('回测区间无效');return [definitions[mode]];
 }
 function run(universe,range,params){
  const sample=coverage(universe),usable=universe.map(s=>({s,days:s.bars.filter(b=>b.date>=range.startDate&&b.date<=range.endDate)})).filter(x=>x.days.length>=2);
  if(usable.length!==universe.length){const absent=universe.filter(s=>!usable.some(x=>x.s===s)).map(s=>s.code);throw Error(`${range.label} 内 ${absent.join('、')} 少于2根日线；请调整样本或日期`);}
  const result=engine.runBacktest(universe,{...params,startDate:range.startDate,endDate:range.endDate});
  result.sample=sample;result.requested_range={...range};
  result.coverage_note=sample.map(x=>`${x.name} ${x.code}：${x.bars}根，${x.first}～${x.last}`).join('；');
  result.metadata.sample_codes=sample.map(x=>x.code);return result;
 }
 return {codes,coverage,ranges,run,validateRange};
});
