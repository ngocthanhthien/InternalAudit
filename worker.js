const enc=new TextEncoder();
const b64=b=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export async function verifyPassword(password,stored){
  try{
    const [format,iterations,salt,digest]=stored.split(':');
    if(format!=='pbkdf2'||Number(iterations)!==100000) return false;
    const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
    const hash=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unb64(salt),iterations:100000,hash:'SHA-256'},key,256));
    const expected=unb64(digest); let diff=hash.length^expected.length;
    hash.forEach((v,i)=>diff|=v^expected[i]); return diff===0;
  }catch{return false;}
}
async function tokenKey(secret){return crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signToken(payload,secret){
  const data=b64(enc.encode(JSON.stringify(payload)));
  return data+'.'+b64(new Uint8Array(await crypto.subtle.sign('HMAC',await tokenKey(secret),enc.encode(data))));
}
export async function verifyToken(token,secret){
  try{
    const [data,sig,...extra]=token.split('.');
    if(extra.length||!await crypto.subtle.verify('HMAC',await tokenKey(secret),unb64(sig),enc.encode(data)))return null;
    const p=JSON.parse(new TextDecoder().decode(unb64(data)));
    return typeof p.id==='string'&&Number.isFinite(p.exp)&&p.exp>Date.now()?p:null;
  }catch{return null;}
}
async function gateFor(token,env){
  const p=await verifyToken(token,env.AUTH_SECRET); if(!p)return null;
  if(p.id!=='QA'||!['gate','member'].includes(p.kind))return null;
  const gate=await env.DB.prepare('SELECT id FROM users WHERE id=? AND active=1').bind(p.id).first();
  return gate?p:null;
}
async function userFor(token,env){
  const p=await gateFor(token,env);if(!p||p.kind!=='member')return null;
  const u=await env.DB.prepare('SELECT id,name,role,revision FROM members WHERE id=? AND active=1').bind(p.memberId||'').first();
  return u&&u.revision===p.revision?{...u,code:u.id,admin:u.role==='admin',exp:p.exp}:null;
}
async function loginAllowed(request,env,prefix){
  const key=prefix+':'+(request.headers.get('CF-Connecting-IP')||'local'),now=Date.now();
  const row=await env.DB.prepare('INSERT INTO login_attempts(key,count,until_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until_at<? THEN 1 ELSE count+1 END,until_at=CASE WHEN until_at<? THEN excluded.until_at ELSE until_at END RETURNING count').bind(key,now+60000,now,now).first();
  return row.count<=10;
}
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const collections=['records','verification','programme','approvals','auditors','auditees','deleted','log'];
export function validate(data){
  if(!data||data.app!=='ILD_InternalAudit')return false;
  if(!collections.every(k=>Array.isArray(data[k])))return false;
  if(!['settings','meta','auditorEmails','deptManagerEmails'].every(k=>data[k]&&typeof data[k]==='object'&&!Array.isArray(data[k])))return false;
  for(const k of ['records','verification','programme','deleted','log']){
    const ids=data[k].map(x=>x?.id); if(ids.some(x=>typeof x!=='string'||!x)||new Set(ids).size!==ids.length)return false;
  }
  if(data.auditorPasswords && Object.keys(data.auditorPasswords).length)return false;
  if(data.auditees.some(x=>!x||typeof x.func!=='string'||x.password))return false;
  return true;
}
export function permitted(user,before,after){
  if(user.role==='admin')return true;
  if(!['auditor','auditee'].includes(user.role)||!before)return false;
  for(const key of ['programme','approvals','auditors','auditees','deleted','settings','meta','auditorEmails','deptManagerEmails']){
    if(!eq(before[key],after[key]))return false;
  }
  const old=new Map(before.records.map(x=>[x.id,x]));
  if(before.records.some(x=>!after.records.some(y=>y.id===x.id)))return false;
  for(const r of after.records){
    const b=old.get(r.id);
    if(!b){if(r.approved||r.status==='Done')return false;continue;}
    if(!eq(r.approved,b.approved))return false;
    if(b.status==='Done'&&!eq(r,b))return false;
    if(!eq(r.status,b.status)&&!(r.status==='Pending'&&['Open','Late'].includes(b.status)&&r.action&&r.pic))return false;
    // Existing assessments are edited only by Admin. Auditor/PIC update CAPA.
    const mutable=new Set(['action','pic','dueDate','status','remarks','updatedAt']);
    for(const k of new Set([...Object.keys(b),...Object.keys(r)]))if(!mutable.has(k)&&!eq(b[k],r[k]))return false;
  }
  const ov=new Map(before.verification.map(x=>[x.id,x]));
  if(before.verification.some(x=>!after.verification.some(y=>y.id===x.id)))return false;
  for(const v of after.verification){
    const b=ov.get(v.id);
    if(!b){if(v.approved||v.done||v.month||v.auditor)return false;}
    else {
      for(const k of new Set([...Object.keys(b),...Object.keys(v)]))if(!['done','updatedAt'].includes(k)&&!eq(v[k],b[k]))return false;
      if(!eq(v.done,b.done)){
        if(v.done!==true||!after.records.some(r=>r.verifyId===v.id&&!old.has(r.id)&&r.source==='score'))return false;
      }
    }
  }
  return true;
}
async function readState(db){
  // One statement: the head and every chunk belong to the same SQLite snapshot.
  const result=await db.prepare('SELECT h.version,c.part,c.data FROM head h LEFT JOIN chunks c ON c.version=h.version WHERE h.id=1 ORDER BY c.part').all();
  const rows=result.results; const version=rows[0]?.version||null;
  return {version,data:version?JSON.parse(rows.map(r=>r.data).join('')):null};
}
export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url),origin=request.headers.get('Origin');
    if(!url.pathname.startsWith('/api/'))return env.ASSETS?env.ASSETS.fetch(request):new Response('Not found',{status:404});
    const allowed=new Set((env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean)); allowed.add(url.origin);
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
    if(origin&&allowed.has(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'});
    const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
    if(origin&&!allowed.has(origin))return json({error:'Origin không được phép'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(!env.AUTH_SECRET||env.AUTH_SECRET.length<32)return json({error:'Chưa cấu hình AUTH_SECRET'},503);
    try{
      if(url.pathname==='/api/login'&&request.method==='POST'){
        if(Number(request.headers.get('Content-Length'))>4096)return json({error:'Request quá lớn'},413);
        const raw=await request.text();if(raw.length>4096)return json({error:'Request quá lớn'},413);
        const body=JSON.parse(raw),id=String(body.id||'').trim(),password=String(body.password||'');
        const now=Date.now();
        if(!await loginAllowed(request,env,'gate'))return json({error:'Thử lại sau một phút'},429);
        const row=await env.DB.prepare('SELECT * FROM users WHERE id=? AND active=1').bind(id).first();
        if(id!=='QA'||!row||!await verifyPassword(password,row.password_hash))return json({error:'Sai tài khoản QA hoặc mật khẩu'},401);
        const gateToken=await signToken({id:row.id,kind:'gate',exp:now+8*3600000},env.AUTH_SECRET);
        return json({gateToken});
      }
      let token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
      if(url.pathname==='/api/events')token=(request.headers.get('Sec-WebSocket-Protocol')||'').split(',').map(x=>x.trim()).find(x=>x.startsWith('auth.'))?.slice(5)||'';
      if(url.pathname==='/api/members'&&request.method==='GET'){
        if(!await gateFor(token,env))return json({error:'Đăng nhập QA trước'},401);
        const list=await env.DB.prepare('SELECT id,name,role FROM members WHERE active=1 ORDER BY role,id').all();
        return json({members:list.results});
      }
      if(url.pathname==='/api/member-login'&&request.method==='POST'){
        const gate=await gateFor(token,env);if(!gate)return json({error:'Đăng nhập QA trước'},401);
        if(!await loginAllowed(request,env,'member'))return json({error:'Thử lại sau một phút'},429);
        const raw=await request.text();if(raw.length>4096)return json({error:'Request quá lớn'},413);
        const body=JSON.parse(raw);
        const row=await env.DB.prepare('SELECT * FROM members WHERE id=? AND active=1').bind(String(body.id||'').trim()).first();
        if(!row||!await verifyPassword(String(body.password||''),row.password_hash))return json({error:'Sai tài khoản nội bộ hoặc mật khẩu'},401);
        const memberToken=await signToken({id:gate.id,kind:'member',memberId:row.id,revision:row.revision,exp:gate.exp},env.AUTH_SECRET);
        return json({token:memberToken,user:{id:row.id,code:row.id,name:row.name,role:row.role,admin:row.role==='admin'}});
      }
      const user=await userFor(token,env); if(!user)return json({error:'Cần đăng nhập lại'},401);
      if(url.pathname==='/api/members'&&request.method==='POST'){
        if(!user.admin)return json({error:'Chỉ Admin quản lý tài khoản nội bộ'},403);
        const raw=await request.text();if(raw.length>100000)return json({error:'Request quá lớn'},413);
        const body=JSON.parse(raw),accounts=body.accounts;
        if(!Array.isArray(accounts)||!accounts.length||accounts.length>25)return json({error:'Mỗi lần tối đa 25 tài khoản'},400);
        const defaults=new Map();
        for(const a of accounts){
          if(!a||typeof a.id!=='string'||!a.id.trim()||a.id.length>150||typeof a.name!=='string'||!a.name.trim()||a.name.length>150||!['admin','auditor','auditee'].includes(a.role))return json({error:'Thông tin tài khoản không hợp lệ'},400);
          if(!a.password_hash&&a.role!=='admin'){
            if(!defaults.has(a.role)){const row=await env.DB.prepare('SELECT password_hash FROM member_defaults WHERE role=?').bind(a.role).first();defaults.set(a.role,row?.password_hash);}
            a.password_hash=defaults.get(a.role);
          }
          if(!/^pbkdf2:100000:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{43}$/.test(a.password_hash||''))return json({error:'Thiếu mật khẩu hợp lệ cho nhóm tài khoản'},400);
          if(a.id.toLowerCase()===user.id.toLowerCase()&&a.role!=='admin')return json({error:'Không thể tự bỏ quyền Admin đang dùng'},400);
        }
        const statements=accounts.map(a=>env.DB.prepare('INSERT INTO members(id,name,password_hash,role) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,password_hash=excluded.password_hash,role=excluded.role,revision=members.revision+1').bind(a.id.trim(),a.name.trim(),a.password_hash,a.role));
        await env.DB.batch(statements);return json({updated:accounts.length});
      }
      if(url.pathname==='/api/me')return json({user});
      if(url.pathname==='/api/events'&&request.method==='GET'){
        const h=new Headers(request.headers); h.set('X-Session-Expiry',String(user.exp));
        return env.SYNC_HUB.get(env.SYNC_HUB.idFromName('main')).fetch(new Request(request,{headers:h}));
      }
      if(url.pathname==='/api/state'&&request.method==='GET')return json(await readState(env.DB));
      if(url.pathname==='/api/state'&&request.method==='PUT'){
        const raw=await request.text();
        if(enc.encode(raw).length>8*1024*1024)return json({error:'Dữ liệu vượt 8 MB; cần tách ảnh sang R2 trước khi tiếp tục'},413);
        const body=JSON.parse(raw);
        if(!Object.hasOwn(body,'baseVersion')||(body.baseVersion!==null&&typeof body.baseVersion!=='string')||!validate(body.data))return json({error:'Dữ liệu không hợp lệ'},400);
        const current=await readState(env.DB);
        if(current.version!==body.baseVersion)return json({error:'Có phiên bản mới trên máy khác'},409);
        if(!permitted(user,current.data,body.data))return json({error:'Tài khoản không có quyền thực hiện thay đổi này'},403);
        const version=crypto.randomUUID(),data=JSON.stringify(body.data),statements=[];
        statements.push(env.DB.prepare('UPDATE head SET version=? WHERE id=1 AND version IS ?').bind(version,body.baseVersion));
        statements.push(env.DB.prepare('INSERT INTO versions(version,created_at,actor) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM head WHERE version=?)').bind(version,Date.now(),user.id,version));
        // 256k UTF-16 units stay below D1's 2 MB per-value limit, including Unicode.
        for(let start=0,part=0;start<data.length;part++){
          let end=Math.min(start+262144,data.length);
          if(end<data.length&&/[\uD800-\uDBFF]/.test(data[end-1]))end--;
          statements.push(env.DB.prepare('INSERT INTO chunks(version,part,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM head WHERE version=?)').bind(version,part,data.slice(start,end),version)); start=end;
        }
        statements.push(env.DB.prepare('DELETE FROM versions WHERE version NOT IN(SELECT version FROM versions ORDER BY created_at DESC,rowid DESC LIMIT 20) AND version!=(SELECT version FROM head WHERE id=1)'));
        const results=await env.DB.batch(statements);
        if(results[0].meta.changes!==1)return json({error:'Có phiên bản mới trên máy khác'},409);
        ctx.waitUntil(env.SYNC_HUB.get(env.SYNC_HUB.idFromName('main')).fetch('https://hub/notify',{method:'POST',body:JSON.stringify({version})}).catch(()=>{}));
        return json({version});
      }
      return json({error:'Not found'},404);
    }catch(e){console.error('API failure',e?.name);return json({error:'Server chưa xử lý được. Dữ liệu trên máy vẫn được giữ.'},500);}
  }
};
export class SyncHub {
  constructor(state){this.state=state;}
  async fetch(request){
    if(new URL(request.url).pathname==='/notify'&&request.method==='POST'){
      const text=await request.text();
      for(const ws of this.state.getWebSockets()){
        try{if(ws.deserializeAttachment()?.exp<=Date.now())ws.close(1008,'Session expired');else ws.send(text);}catch{ws.close(1011,'Reconnect');}
      }
      return new Response('ok');
    }
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket required',{status:426});
    const pair=new WebSocketPair(); this.state.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({exp:Number(request.headers.get('X-Session-Expiry'))});
    return new Response(null,{status:101,webSocket:pair[0],headers:{'Sec-WebSocket-Protocol':'audit-sync'}});
  }
  webSocketMessage(){}
  webSocketClose(ws,code){ws.close(code);}
  webSocketError(ws){ws.close(1011,'Reconnect');}
}
