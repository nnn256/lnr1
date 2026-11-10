(function(root){
  'use strict';
  // Prefix-only replay prevents a later extreme from rewriting an earlier signal.
  function analyze(bars){
    const merged=[];
    for(let i=0;i<bars.length;i++){
      const b={...bars[i],start:i,end:i}; const p=merged.at(-1), q=merged.at(-2);
      if(p && ((b.high<=p.high&&b.low>=p.low)||(b.high>=p.high&&b.low<=p.low))){
        const up=q ? p.high>=q.high : b.close>=p.close;
        p.high=up?Math.max(p.high,b.high):Math.min(p.high,b.high);
        p.low=up?Math.max(p.low,b.low):Math.min(p.low,b.low);
        p.close=b.close;p.end=i;p.date=b.date;
      }else merged.push(b);
    }
    const points=[];
    for(let i=1;i<merged.length-1;i++){
      const a=merged[i-1],b=merged[i],c=merged[i+1];
      const top=b.high>a.high&&b.high>c.high&&b.low>a.low&&b.low>c.low;
      const bottom=b.low<a.low&&b.low<c.low&&b.high<a.high&&b.high<c.high;
      if(!top&&!bottom)continue;
      const p={type:top?'top':'bottom',price:top?b.high:b.low,index:b.end,mergedIndex:i,available:c.end};
      const last=points.at(-1);
      if(last?.type===p.type){if((top&&p.price>last.price)||(bottom&&p.price<last.price))points[points.length-1]=p;}
      else if(!last||(i-last.mergedIndex>=4&&(last.type==='bottom'?p.price>last.price:p.price<last.price)))points.push(p);
    }
    const moves=points.slice(1).map((p,i)=>({a:points[i],b:p,high:Math.max(points[i].price,p.price),low:Math.min(points[i].price,p.price)}));
    const centers=[];
    for(let i=2;i<moves.length;i++){
      const group=moves.slice(i-2,i+1),zg=Math.min(...group.map(x=>x.high)),zd=Math.max(...group.map(x=>x.low));
      if(zg>zd)centers.push({id:'C'+i,zg,zd,gg:Math.max(...group.map(x=>x.high)),dd:Math.min(...group.map(x=>x.low)),end:group.at(-1).b.index});
    }
    return {points,moves,centers};
  }
  function detect(bars){
    const {points:p,moves,centers}=analyze(bars),signals=[];
    const firsts={buy:null,sell:null};
    const centerEvidence=center=>{
      if(!center)return null;
      const lastMove=Number(center.id.slice(1)),group=moves.slice(lastMove-2,lastMove+1);
      return {start_index:group[0].a.index,end_index:center.end,available_index:group.at(-1).b.available};
    };
    for(let i=3;i<p.length;i++){
      const d=p[i],b=p[i-2],a=p[i-3];const buy=d.type==='bottom',side=buy?'buy':'sell';
      let center=centers.filter(c=>c.end<d.index).at(-1);
      // A third-class center must already exist when the departure's starting
      // fractal becomes available. The departing stroke cannot form its own center.
      const priorCenter=centers.filter(c=>c.end<=b.index&&centerEvidence(c).available_index<=b.available).at(-1);
      const amp1=Math.abs(a.price-b.price),amp2=Math.abs(p[i-1].price-d.price);
      const duration1=Math.max(1,b.index-a.index),duration2=Math.max(1,d.index-p[i-1].index);
      // Equal price slopes must remain equal after price reflection/rounding.
      const tolerance=64*Number.EPSILON*Math.max(Math.abs(a.price),Math.abs(b.price),Math.abs(p[i-1].price),Math.abs(d.price))/Math.min(duration1,duration2);
      const weakening=amp2/duration2<amp1/duration1-tolerance;
      const first=firsts[side];
      const firstBoundaryHeld=first&&bars.slice(first.point.available+1,d.available+1).every(bar=>{
        const epsilon=64*Number.EPSILON*Math.max(1,Math.abs(first.point.price),Math.abs(buy?bar.low:bar.high));
        return buy?bar.low>=first.point.price-epsilon:bar.high<=first.point.price+epsilon;
      });
      let cls=0, basis='';
      if(center && (buy?d.price<b.price&&p[i-1].price<a.price:d.price>b.price&&p[i-1].price>a.price)&&weakening){
        cls=1;basis='同向笔新极值且单位时间振幅减弱；笔力度代理';firsts[side]={point:d,index:i};
      }else if(firstBoundaryHeld&&i===firsts[side].index+2&&(buy?d.price>firsts[side].point.price:d.price<firsts[side].point.price)){
        cls=2;basis='一类候选之后第一次反向运动及首次回试未破极值';
      }else if(priorCenter && (buy?b.price<=priorCenter.zg&&p[i-1].price>priorCenter.zg&&d.price>priorCenter.zg:b.price>=priorCenter.zd&&p[i-1].price<priorCenter.zd&&d.price<priorCenter.zd)){
        cls=3;center=priorCenter;basis='已知类中枢之后的离开笔跨越边界，首次回试未重新进入';
      }
      const evidence=centerEvidence(center);
      if(cls) signals.push({side,signal_class:cls,label:`${['','一','二','三'][cls]}${buy?'买':'卖'}候选`,
        candidate_id:[side,cls,d.index,d.price].join(':'),
        episode_id:[side,cls,cls===2?firsts[side].point.index:cls===3?center.id:b.index,p[i-1].index].join('|'),
        point_index:d.index,confirmed_index:d.available,
        comparison_prior_start_index:cls===1?a.index:null,comparison_prior_end_index:cls===1?b.index:null,
        comparison_current_start_index:cls===1?p[i-1].index:null,comparison_current_end_index:cls===1?d.index:null,
        first_candidate_point:cls===2?firsts[side].point.index:null,
        first_candidate_at:cls===2?bars[firsts[side].point.available]?.date:null,
        departure_start_index:cls===3?b.index:null,departure_end_index:cls===3?p[i-1].index:null,
        departure_available_index:cls===3?b.available:null,
        center_start_index:evidence?.start_index,center_end_index:evidence?.end_index,
        center_available_index:evidence?.available_index,center_available_at:bars[evidence?.available_index]?.date,
        date:bars[d.available]?.date,available_at:bars[d.available]?.date,price:d.price,invalidation:d.price,
        status:'candidate',strict_confirmed:false,definition_mode:'structure_proxy',structure_completeness:'inclusion/fractal/stroke/center_proxy_only',trade_level:'1d',confirm_level:'missing',trigger_level:'missing',
        center_id:center?.id,zg:center?.zg,zd:center?.zd,gg:center?.gg,dd:center?.dd,basis,
        approximation_loss:'笔构建采用固定间隔；未实现严格线段特征序列、走势类型递归及低级别触发；一类力度为振幅代理，不是原文背驰证明'});
    }
    return {signals,points:p,centers,moves};
  }
  function replay(bars){
    const signals=[],seen=new Set();
    for(let i=2;i<bars.length;i++){
      const snapshot=detect(bars.slice(0,i+1));
      for(const signal of snapshot.signals){
        // A confirming merged candle may extend over several source bars. Emit one event
        // for the same structural endpoint and class, keeping its first usable timestamp.
        const key=[signal.side,signal.signal_class,signal.point_index,signal.price].join('|');
        const usable=signal.side==='buy'?bars[i].close>=signal.invalidation:bars[i].close<=signal.invalidation;
        if(signal.available_at===bars[i].date&&usable&&!seen.has(key)){
          const parent=signal.signal_class===2?signals.find(first=>first.side===signal.side&&first.signal_class===1&&first.point_index===signal.first_candidate_point):null;
          // A retrospective first-class label that was never emitted cannot act as
          // a causal parent for a published second-class candidate.
          if(signal.signal_class===2&&!parent)continue;
          // A later inclusion extension can move the first fractal's available index.
          // Preserve its actually published timestamp, and reject an already-broken
          // parent boundary using the complete raw path since that timestamp.
          if(parent){
            const firstAt=bars.findIndex(bar=>bar.date===parent.available_at);
            const boundaryHeld=bars.slice(firstAt+1,i+1).every(bar=>{
              const epsilon=64*Number.EPSILON*Math.max(1,Math.abs(parent.invalidation),Math.abs(signal.side==='buy'?bar.low:bar.high));
              return signal.side==='buy'?bar.low>=parent.invalidation-epsilon:bar.high<=parent.invalidation+epsilon;
            });
            if(!boundaryHeld)continue;
          }
          seen.add(key);signals.push({...signal,...(parent?{first_candidate_at:parent.available_at,first_candidate_id:parent.candidate_id}:{})});
        }
      }
    }
    return {...analyze(bars),signals};
  }
  const api={analyze,detect,replay};root.Chanlun=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
