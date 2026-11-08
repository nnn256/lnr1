const readline=require('node:readline'),model=require('../analysis-model.js');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const packet=JSON.parse(line),results=[],errors=[];
 for(const h of packet.histories){try{results.push(model.summarize(h,packet.params));}catch(e){errors.push({code:h.code,error:e.message});}}
 process.stdout.write(JSON.stringify({results,errors})+'\n');
});
