import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{signToken} from '../worker.js';
function harness(){
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  sql.prepare('INSERT INTO users VALUES(?,?,?,?,1)').run('admin','Admin','unused','admin');
  function prepare(query){let args=[];return {bind(...a){args=a;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}};}
  const DB={prepare,async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const env={DB,AUTH_SECRET:'test-secret-of-at-least-thirty-two-characters',SYNC_HUB:{idFromName:x=>x,get:()=>({fetch:async()=>new Response('ok')})}};
  return {env,sql};
}
function data(){return {app:'ILD_InternalAudit',version:1,records:[],verification:[],programme:[],approvals:[],auditors:[],auditees:[],deleted:[],log:[],settings:{},meta:{},auditorEmails:{},deptManagerEmails:{}};}
test('API requires authentication, persists chunks, rejects stale writes, retains history',async()=>{
  const {env,sql}=harness(),ctx={waitUntil:p=>p};
  const token=await signToken({id:'admin',exp:Date.now()+60000},env.AUTH_SECRET);
  const request=(method,payload,auth=token)=>new Request('https://audit.test/api/state',{method,headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});
  assert.equal((await worker.fetch(request('GET',null,''),env,ctx)).status,401);
  const initial=await (await worker.fetch(request('GET'),env,ctx)).json();assert.equal(initial.version,null);
  const first=data();first.records=[{id:'r',img:'a'.repeat(700000),description:'🌿'.repeat(40000)}];
  const saved=await (await worker.fetch(request('PUT',{baseVersion:null,data:first}),env,ctx)).json();assert.ok(saved.version);
  const loaded=await (await worker.fetch(request('GET'),env,ctx)).json();assert.deepEqual(loaded.data,first);
  assert.ok(sql.prepare('SELECT count(*) n FROM chunks').get().n>1);
  assert.equal((await worker.fetch(request('PUT',{baseVersion:null,data:data()}),env,ctx)).status,409);
  const second=await worker.fetch(request('PUT',{baseVersion:saved.version,data:data()}),env,ctx);assert.equal(second.status,200);
  assert.equal(sql.prepare('SELECT count(*) n FROM versions').get().n,2);
  sql.prepare('UPDATE users SET active=0 WHERE id=?').run('admin');
  assert.equal((await worker.fetch(request('GET'),env,ctx)).status,401);
});
test('unapproved origins are rejected',async()=>{
  const {env}=harness();
  const response=await worker.fetch(new Request('https://audit.test/api/state',{headers:{Origin:'https://evil.test'}}),env,{});
  assert.equal(response.status,403);
});
test('API returns the database role, ignoring forged role/admin fields in a signed session',async()=>{
  const {env,sql}=harness();
  for(const role of ['auditor','auditee']){
    sql.prepare('INSERT INTO users VALUES(?,?,?,?,1)').run(role,role,'unused',role);
    const token=await signToken({id:role,role:'admin',admin:true,exp:Date.now()+60000},env.AUTH_SECRET);
    const response=await worker.fetch(new Request('https://audit.test/api/me',{headers:{Authorization:'Bearer '+token}}),env,{});
    const {user}=await response.json();assert.equal(user.role,role);assert.equal(user.admin,false);
  }
});
