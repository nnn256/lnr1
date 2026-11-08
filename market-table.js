(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.LiangceMarketTable=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  function buildRows(market,analyses=[]){
    const result=new Map(),known=new Map(analyses.map(item=>[String(item.code),item]));
    const securities=Array.isArray(market?.securities)?market.securities:market?.rows||[];
    for(const item of securities){
      const code=String(item.code||'');if(!/^\d{6}$/.test(code))continue;
      result.set(code,{code,name:String(item.name||code),exchange:item.exchange||'',quote:null,analysis:known.get(code)||null});
    }
    for(const quote of market?.rows||[]){
      const code=String(quote.code||'');if(!/^\d{6}$/.test(code))continue;
      const row=result.get(code)||{code,name:quote.name||code,exchange:quote.exchange||'',analysis:known.get(code)||null};
      row.quote=finite(quote.price)&&quote.price>0?quote:null;
      if(quote.name)row.name=String(quote.name);
      result.set(code,row);
    }
    // A CSV/local-only session still has a usable research list before quotes arrive.
    if(!result.size)for(const analysis of analyses)result.set(String(analysis.code),{code:String(analysis.code),name:analysis.name||analysis.code,exchange:'',quote:null,analysis});
    return [...result.values()];
  }
  function queryRows(rows,options={}){
    const query=String(options.query||'').trim().toLowerCase(),threshold=Number(options.threshold||0),mode=options.mode||'all';
    const filtered=rows.filter(row=>{
      const analysis=row.analysis,score=analysis?.signal?.score;
      if(query&&!`${row.code} ${row.name}`.toLowerCase().includes(query))return false;
      if(threshold>0&&(!finite(score)||score<threshold))return false;
      if(mode==='analysed'&&!analysis)return false;
      if(mode==='pending'&&analysis)return false;
      if(mode==='near'&&(!analysis||analysis.status==='观察'))return false;
      if(mode==='observe'&&(!analysis||analysis.status!=='观察'))return false;
      return true;
    });
    const sort=options.sort||'amount';
    const metric=row=>sort==='score'?row.analysis?.signal?.score:sort==='change'?row.quote?.change:row.quote?.amount;
    filtered.sort((a,b)=>{
      if(sort==='code')return a.code.localeCompare(b.code);
      const x=metric(a),y=metric(b),aValid=finite(x),bValid=finite(y);
      if(aValid!==bValid)return aValid?-1:1;
      return (aValid?y-x:0)||a.code.localeCompare(b.code);
    });
    const pageSize=[25,50,100].includes(Number(options.pageSize))?Number(options.pageSize):25;
    const pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));
    const page=Math.max(1,Math.min(pageCount,Math.floor(Number(options.page)||1)));
    const start=(page-1)*pageSize;
    return {rows:filtered.slice(start,start+pageSize),matched:filtered.length,total:rows.length,page,pageCount,pageSize,
      start:filtered.length?start+1:0,end:Math.min(start+pageSize,filtered.length),
      analysed:rows.filter(row=>row.analysis).length,quoted:rows.filter(row=>row.quote).length};
  }
  return {buildRows,queryRows};
});
