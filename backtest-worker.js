importScripts('strategy.js'+self.location.search,'backtest-model.js'+self.location.search);
self.onmessage=event=>{
 const {id,universe,ranges,params}=event.data,results=[];
 try{for(const [index,range] of ranges.entries()){
  self.postMessage({id,type:'progress',done:index,total:ranges.length,label:range.label});
  results.push({key:range.key,result:LiangceBacktest.run(universe,range,params)});
 }self.postMessage({id,type:'complete',results});}
 catch(error){self.postMessage({id,type:'error',message:error.message});}
};
