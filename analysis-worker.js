importScripts('strategy.js'+self.location.search,'analysis-model.js'+self.location.search);
self.onmessage=event=>{
 const {token,histories,params}=event.data;const results=[],errors=[];
 for(const history of histories){
  try{results.push(LiangceAnalysis.summarize(history,params));}
  catch(error){errors.push({code:history.code,error:error.message});}
 }
 self.postMessage({token,results,errors});
};
