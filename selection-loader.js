(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.LiangceSelection=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function create(load,onState){
  let version=0,key=null,state='idle';
  async function select(next){
   const token=++version;key=next;state='loading';onState({state,key});
   try{const result=await load(next);if(token!==version)return {obsolete:true};state='ready';onState({state,key,result});return result;}
   catch(error){if(token!==version)return {obsolete:true};state='error';onState({state,key,error});return {ok:false,error:error.message};}
  }
  function clear(){version++;key=null;state='idle';onState({state,key});}
  return {select,clear,current:()=>({key,state,version})};
 }
 return {create};
});
