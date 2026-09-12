import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{signToken} from '../worker.js';
function harness(){
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  sql.prepare('INSERT INTO users VALUES(?,?,?,?,1)').run('QA','QA','unused','admin');
  sql.prepare('INSERT INTO members VALUES(?,?,?,?,1,1)').run('admin','Admin','unused','admin');
  function prepare(query){let args=[];return {bind(...a){args=a;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}};}
  const DB={prepare,async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const env={DB,AUTH_SECRET:'test-secret-of-at-least-thirty-two-characters',SYNC_HUB:{idFromName:x=>x,get:()=>({fetch:async()=>new Response('ok')})}};
  return {env,sql};
}
function data(){return {app:'ILD_InternalAudit',version:1,records:[],verification:[],programme:[],approvals:[],auditors:[],auditees:[],deleted:[],log:[],settings:{},meta:{},auditorEmails:{},deptManagerEmails:{}};}
test('API requires authentication, persists chunks, rejects stale writes, retains history',async()=>{
  const {env,sql}=harness(),ctx={waitUntil:p=>p};
  const token=await signToken({id:'QA',kind:'member',memberId:'admin',revision:1,exp:Date.now()+60000},env.AUTH_SECRET);
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
  sql.prepare('UPDATE users SET active=0 WHERE id=?').run('QA');
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
    sql.prepare('INSERT INTO members VALUES(?,?,?,?,1,1)').run(role,role,'unused',role);
    const token=await signToken({id:'QA',kind:'member',memberId:role,revision:1,role:'admin',admin:true,exp:Date.now()+60000},env.AUTH_SECRET);
    const response=await worker.fetch(new Request('https://audit.test/api/me',{headers:{Authorization:'Bearer '+token}}),env,{});
    const {user}=await response.json();assert.equal(user.role,role);assert.equal(user.admin,false);
  }
});
test('QA gate can list names but cannot read/write state or manage accounts',async()=>{
  const {env}=harness();const token=await signToken({id:'QA',kind:'gate',exp:Date.now()+60000},env.AUTH_SECRET);
  for(const [path,method] of [['state','GET'],['state','PUT'],['members','POST'],['me','GET']]){
    const response=await worker.fetch(new Request('https://audit.test/api/'+path,{method,headers:{Authorization:'Bearer '+token},...(method==='POST'||method==='PUT'?{body:'{}'}:{})}),env,{});
    assert.equal(response.status,401);
  }
  const result=await (await worker.fetch(new Request('https://audit.test/api/members',{headers:{Authorization:'Bearer '+token}}),env,{})).json();
  assert.equal(result.members[0].id,'admin');assert.equal('password_hash' in result.members[0],false);
  const legacy=await signToken({id:'QA',admin:true,exp:Date.now()+60000},env.AUTH_SECRET);
  assert.equal((await worker.fetch(new Request('https://audit.test/api/state',{headers:{Authorization:'Bearer '+legacy}}),env,{})).status,401);
});
test('password change invalidates previously issued member sessions',async()=>{
  const {env,sql}=harness();const token=await signToken({id:'QA',kind:'member',memberId:'admin',revision:1,exp:Date.now()+60000},env.AUTH_SECRET);
  sql.prepare('UPDATE members SET revision=revision+1 WHERE id=?').run('admin');
  assert.equal((await worker.fetch(new Request('https://audit.test/api/me',{headers:{Authorization:'Bearer '+token}}),env,{})).status,401);
});
test('QA requires password; member selection requires only an active ID after QA',async()=>{
  const {env,sql}=harness();
  const salt=new Uint8Array(16);crypto.getRandomValues(salt);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('test-password'),'PBKDF2',false,['deriveBits']);
  const hash=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256));
  const stored='pbkdf2:100000:'+Buffer.from(salt).toString('base64url')+':'+Buffer.from(hash).toString('base64url');
  sql.prepare('UPDATE users SET password_hash=?').run(stored);sql.prepare('UPDATE members SET password_hash=?').run(stored);
  const call=(path,body,token='')=>worker.fetch(new Request('https://audit.test/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)}),env,{});
  assert.equal((await call('member-login',{id:'admin',password:'test-password'})).status,401);
  assert.equal((await call('login',{id:'QA',password:'wrong'})).status,401);
  const gate=await (await call('login',{id:'QA',password:'test-password'})).json();assert.ok(gate.gateToken);assert.equal(gate.token,undefined);
  assert.equal((await call('member-login',{id:'missing'},gate.gateToken)).status,403);
  const member=await (await call('member-login',{id:'admin'},gate.gateToken)).json();assert.ok(member.token);assert.equal(member.user.admin,true);
  assert.equal((await worker.fetch(new Request('https://audit.test/api/state',{headers:{Authorization:'Bearer '+member.token}}),env,{})).status,200);
  sql.prepare('UPDATE members SET active=0 WHERE id=?').run('admin');
  assert.equal((await call('member-login',{id:'admin'},gate.gateToken)).status,403);
});
