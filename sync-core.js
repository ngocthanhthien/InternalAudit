/* Shared by the browser and regression tests. No clock-based conflict decisions. */
(function(root){
  const copy=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const object=x=>x!==null && typeof x==='object' && !Array.isArray(x);
  function merge(base,local,remote,preference){
    const conflicts=[];
    function walk(b,l,r,path){
      if(equal(l,r)) return copy(l);
      if(equal(l,b)) return copy(r);
      if(equal(r,b)) return copy(l);
      if(object(l)&&object(r)&&(object(b)||b===undefined)){
        const out=Object.create(null);
        for(const k of new Set([...Object.keys(b||{}),...Object.keys(l),...Object.keys(r)])){
          if(['__proto__','prototype','constructor'].includes(k)) throw Error('Invalid key');
          // These timestamps are informational; actual conflict detection uses values.
          const v=(k==='updatedAt'||k.endsWith('UpdatedAt')) && typeof l[k]==='number' && typeof r[k]==='number'
            ? Math.max(l[k],r[k]) : walk(b?.[k],l[k],r[k],path+'/'+k);
          if(v!==undefined) out[k]=v;
        }
        return out;
      }
      const key=path==='/auditees'?'func':path==='/approvals'?'batch':'id';
      if(Array.isArray(l)&&Array.isArray(r)&&(Array.isArray(b)||b===undefined) && [...(b||[]),...l,...r].every(x=>object(x)&&typeof x[key]==='string')){
        const map=arr=>{
          const m=new Map(); for(const x of arr||[]){if(m.has(x[key])) throw Error('Duplicate ID: '+path); m.set(x[key],x);} return m;
        };
        const bm=map(b),lm=map(l),rm=map(r),out=[];
        for(const id of new Set([...lm.keys(),...rm.keys(),...bm.keys()])){
          const v=walk(bm.get(id),lm.get(id),rm.get(id),path+'/'+id); if(v!==undefined) out.push(v);
        }
        return out;
      }
      conflicts.push(path);
      return copy(preference==='remote'?r:l);
    }
    return {data:walk(base,local,remote,''),conflicts};
  }
  root.AuditSyncCore={merge,equal,copy};
})(globalThis);
