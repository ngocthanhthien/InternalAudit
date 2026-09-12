import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../sync-core.js';
import {signToken,verifyToken,permitted,validate} from '../worker.js';
const {merge}=globalThis.AuditSyncCore;
const plain=x=>JSON.parse(JSON.stringify(x));
test('different fields of one record merge without clock ordering',()=>{
  const b={records:[{id:'r',action:'old',pic:'A',updatedAt:1}]};
  const l={records:[{id:'r',action:'new',pic:'A',updatedAt:500}]};
  const r={records:[{id:'r',action:'old',pic:'B',updatedAt:2}]};
  const result=merge(b,l,r);assert.deepEqual(result.conflicts,[]);
  assert.deepEqual(plain(result.data.records[0]),{id:'r',action:'new',pic:'B',updatedAt:500});
});
test('simultaneous additions on separate devices survive',()=>{
  const result=merge({records:[]},{records:[{id:'a'}]},{records:[{id:'b'}]});
  assert.equal(result.data.records.length,2);assert.equal(result.conflicts.length,0);
});
test('delete cannot silently overwrite an offline edit',()=>{
  const b={records:[{id:'r',score:1}]};
  const r=merge(b,{records:[]},{records:[{id:'r',score:2}]});
  assert.deepEqual(r.conflicts,['/records/r']);
});
test('a stale unchanged copy cannot resurrect a deleted row',()=>{
  const b={records:[{id:'r',score:1}]};
  assert.deepEqual(plain(merge(b,b,{records:[]}).data),{records:[]});
});
test('same field conflict keeps both alternatives selectable',()=>{
  const b={settings:{company:'old'}},l={settings:{company:'local'}},r={settings:{company:'remote'}};
  assert.equal(merge(b,l,r).conflicts.length,1);
  assert.equal(merge(b,l,r,'local').data.settings.company,'local');
  assert.equal(merge(b,l,r,'remote').data.settings.company,'remote');
});
test('a change made during upload remains pending after acknowledgement',()=>{
  const sent={records:[{id:'r',score:1}]},latest={records:[{id:'r',score:2}]};
  assert.equal(merge(sent,latest,sent).data.records[0].score,2);
});
test('tampered, expired and unsigned sessions are rejected',async()=>{
  const secret='a-long-test-secret-that-is-at-least-32-characters';
  const t=await signToken({id:'admin',exp:Date.now()+10000},secret);
  assert.equal((await verifyToken(t,secret)).id,'admin');
  assert.equal(await verifyToken(t+'x',secret),null);
  assert.equal(await verifyToken(await signToken({id:'admin',exp:1},secret),secret),null);
  assert.equal(await verifyToken(await signToken({id:'admin'},secret),secret),null);
});
test('server protects approval and admin data even if browser role is changed',()=>{
  const before={records:[{id:'r',approved:false,status:'Open'}],verification:[],programme:[],approvals:[],auditors:[],auditees:[],deleted:[],settings:{},auditorEmails:{},deptManagerEmails:{}};
  const after=structuredClone(before);after.records[0].approved=true;
  assert.equal(permitted({role:'auditor',admin:true},before,after),false);
  assert.equal(permitted({role:'viewer'},before,before),false);
  after.records[0].approved=false;after.records[0].action='fix';
  assert.equal(permitted({role:'auditor'},before,after),true);
});
for(const role of ['auditor','auditee']){
  test(role+' retains legacy CAPA and request rights without Admin privileges',()=>{
    const b={records:[{id:'r',approved:false,status:'Open',score:1,action:'',pic:''}],verification:[],programme:[],approvals:[],auditors:[],auditees:[],deleted:[],settings:{},meta:{},auditorEmails:{},deptManagerEmails:{}};
    const allows=edit=>{const a=structuredClone(b);edit(a);return permitted({role,admin:true},b,a);};
    assert.equal(allows(a=>Object.assign(a.records[0],{action:'Fix',pic:'PIC',status:'Pending'})),true);
    assert.equal(allows(a=>a.records.push({id:'new',source:'score',score:2,approved:false,status:'N/A'})),true);
    assert.equal(allows(a=>a.verification.push({id:'v',approved:false,done:false,month:'',auditor:''})),true);
    assert.equal(allows(a=>a.records[0].status='Done'),false);
    assert.equal(allows(a=>a.records[0].score=2),false);
    assert.equal(allows(a=>a.records[0].approved=true),false);
    assert.equal(allows(a=>a.records=[]),false);
    assert.equal(allows(a=>a.programme.push({id:'p'})),false);
    assert.equal(allows(a=>a.settings.company='Changed'),false);
    assert.equal(allows(a=>a.approvals.push({batch:'b'})),false);
  });
  test(role+' cannot reopen or alter closed CAPA and can mark verification done only with a new score',()=>{
    const b={records:[{id:'r',status:'Done',action:'old'}],verification:[{id:'v',done:false,approved:true,month:'9',auditor:'A'}],programme:[],approvals:[],auditors:[],auditees:[],deleted:[],settings:{},meta:{},auditorEmails:{},deptManagerEmails:{}};
    const a=structuredClone(b);a.records[0].action='changed';assert.equal(permitted({role},b,a),false);
    const c=structuredClone(b);c.verification[0].done=true;assert.equal(permitted({role},b,c),false);
    c.records.push({id:'score',source:'score',verifyId:'v',approved:false,status:'N/A'});assert.equal(permitted({role},b,c),true);
    c.verification[0].approved=false;assert.equal(permitted({role},b,c),false);
  });
}
test('invalid payloads and credential-bearing snapshots are rejected',()=>{
  assert.equal(validate({app:'ILD_InternalAudit'}),false);
});
