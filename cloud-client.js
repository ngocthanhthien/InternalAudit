/* IndexedDB journal is the source of truth until the server acknowledges a version. */
const CLOUD={ready:false,busy:false,gateToken:'',token:'',base:null,version:null,timer:null,ws:null,conflicts:[],retry:1000,error:'',generation:0};
const dataKeys=['records','verification','programme','approvals','auditors','auditorEmails','deptManagerEmails','auditees','settings','meta','deleted','log'];
function cloudIdentity(user){
  const labels={admin:'Admin',auditor:'Auditor',auditee:'PIC'};
  if(!labels[user?.role])throw Error('Nhóm tài khoản chưa được hỗ trợ');
  CURRENT_USER={...user,admin:user.role==='admin'};
  if(user.role==='auditor')CH.auditor=user.name;
  if(user.role==='auditee')CURRENT_USER.auditeeFunc=AUDITEE_LIST.find(a=>(a.pic||'').trim().toLowerCase()===user.name.trim().toLowerCase())?.func||'';
  document.getElementById('userName').title=labels[user.role];
  let badge=document.getElementById('cloudRole');
  if(!badge){badge=document.createElement('span');badge.id='cloudRole';badge.style='margin-left:6px';document.getElementById('userName').after(badge);}
  badge.textContent='· '+labels[user.role];
  cloudAccountVisibility();
}
function cloudData(){
  const s=AuditSyncCore.copy(snapshot());
  delete s.device;delete s.savedAt;delete s.auditorPasswords;
  s.auditees.forEach(a=>delete a.password);
  delete s.meta.auditorPasswordsUpdatedAt;
  delete s.settings.autoSync;
  // Legacy tombstones sometimes contain duplicates; retain the newest marker.
  s.deleted=Array.from(s.deleted.reduce((m,t)=>{if(!m.has(t.id)||m.get(t.id).deletedAt<t.deletedAt)m.set(t.id,t);return m;},new Map()).values());
  return s;
}
function cloudApply(s){
  RECORDS=s.records;VERIFICATION=s.verification;PROGRAMME=s.programme;APPROVALS=s.approvals;
  AUDITOR_LIST=s.auditors;AUDITOR_EMAILS=s.auditorEmails;DEPT_MANAGER_EMAILS=s.deptManagerEmails;
  AUDITEE_LIST=s.auditees;SETTINGS={...SETTINGS,...s.settings,autoSync:false};META=s.meta;DELETED=s.deleted;LOG=s.log;
  if(CURRENT_USER?.role==='auditee')CURRENT_USER.auditeeFunc=AUDITEE_LIST.find(a=>(a.pic||'').trim().toLowerCase()===CURRENT_USER.name.trim().toLowerCase())?.func||'';
}
function cloudEnvelope(){return {local:cloudData(),base:CLOUD.base,version:CLOUD.version};}
async function cloudJournal(){
  const d=await db(),value=cloudEnvelope();
  await new Promise((resolve,reject)=>{
    const tx=d.transaction(APP.store,'readwrite');
    tx.objectStore(APP.store).put(value,'cloudJournal');
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Local transaction aborted'));
  });
}
function cloudStatus(message){
  const el=document.getElementById('cloudStatus');if(el)el.textContent=message;
}
function cloudDirty(){return !AuditSyncCore.equal(cloudData(),CLOUD.base);}
function cloudSchedule(){
  if(!CLOUD.ready)return;
  CLOUD.generation++;
  cloudStatus(CLOUD.token?'Đã lưu trên máy · chờ gửi lên Cloudflare':'Đã lưu trên máy · cần đăng nhập để đồng bộ');
  clearTimeout(CLOUD.timer);CLOUD.timer=setTimeout(()=>cloudSync(),500);
}
async function cloudRequest(path,options={}){
  const response=await fetch('/api/'+path,{...options,cache:'no-store',headers:{'Content-Type':'application/json','Authorization':'Bearer '+CLOUD.token,...options.headers},signal:AbortSignal.timeout(30000)});
  const body=await response.json();
  if(!response.ok){const e=Error(body.error||'HTTP '+response.status);e.status=response.status;throw e;}
  return body;
}
function cloudConflict(result,remote){
  CLOUD.conflicts=result.conflicts;CLOUD.remote=remote;
  cloudStatus('Có '+result.conflicts.length+' nội dung xung đột · bản trên máy đã được giữ');
  document.getElementById('cloudResolve').hidden=false;
  document.getElementById('cloudConflictPaths').textContent=result.conflicts.join('\n');
  toast('Có xung đột dữ liệu. Mở tab Sync để xử lý.');
}
async function cloudResolve(preference){
  if(CLOUD.busy||!CLOUD.remote)return;
  const current=cloudData(),remote=CLOUD.remote;
  const merged=AuditSyncCore.merge(CLOUD.base,current,remote.data,preference);
  if(!confirm(preference==='local'?'Giữ giá trị trên máy cho các mục xung đột đang hiển thị?':'Giữ giá trị trên cloud cho các mục xung đột đang hiển thị?'))return;
  // Save both alternatives before changing any value; the backup is also downloadable.
  await idbSet('cloudConflictBackup',{local:current,remote:remote.data,base:CLOUD.base,at:Date.now()});
  cloudApply(merged.data);CLOUD.base=remote.data;CLOUD.version=remote.version;
  CLOUD.conflicts=[];CLOUD.remote=null;document.getElementById('cloudResolve').hidden=true;
  await cloudJournal();cloudSchedule();
  cloudStatus('Đã lưu lựa chọn · đang gửi lại');
}
function cloudRefresh(){
  // Receiving data must not destroy a partially typed form or scoring draft.
  const tab=document.querySelector('.tab.active')?.dataset.tab;
  if(['dash','report','log','sections'].includes(tab)&&!document.activeElement?.matches('input,textarea,select')&&!document.querySelector('.modalBack.show')){
    renderActive();return;
  }
  document.getElementById('cloudRefresh').hidden=false;
}
async function cloudSync(){
  if(!CLOUD.ready||!CLOUD.token||CLOUD.busy||CLOUD.conflicts.length)return;
  if(!navigator.onLine){cloudStatus('Mất mạng · dữ liệu đã lưu trên máy, sẽ tự gửi lại');return;}
  CLOUD.busy=true;
  try{
    cloudStatus('Đang kiểm tra và đồng bộ…');
    const remote=await cloudRequest('state');
    if(remote.data){
      const merged=AuditSyncCore.merge(CLOUD.base,cloudData(),remote.data);
      if(merged.conflicts.length){cloudConflict(merged,remote);return;}
      const changed=!AuditSyncCore.equal(cloudData(),merged.data);
      cloudApply(merged.data);CLOUD.base=remote.data;CLOUD.version=remote.version;
      await cloudJournal();if(changed)cloudRefresh();
    }else if(CLOUD.version!==null){throw Error('Database cloud trống bất thường. Dừng gửi để kiểm tra cấu hình.');}
    if(!remote.data||cloudDirty()){
      const sent=cloudData();
      cloudStatus('Đã lưu trên máy · đang gửi lên Cloudflare…');
      const result=await cloudRequest('state',{method:'PUT',body:JSON.stringify({baseVersion:CLOUD.version,data:sent})});
      // Edits made during the network request stay in the local journal.
      CLOUD.base=sent;CLOUD.version=result.version;await cloudJournal();
    }
    CLOUD.retry=1000;CLOUD.error='';
    cloudStatus(cloudDirty()?'Đã lưu trên máy · còn thay đổi đang chờ gửi':'Đã được Cloudflare xác nhận · '+new Date().toLocaleTimeString('vi-VN'));
    if(cloudDirty()){clearTimeout(CLOUD.timer);CLOUD.timer=setTimeout(()=>cloudSync(),500);}
  }catch(e){
    CLOUD.error=e.message;cloudStatus('Chưa đồng bộ: '+e.message+' · giữ nguyên dữ liệu trên máy');
    if(e.status===401){CLOUD.token='';sessionStorage.removeItem('auditToken');CURRENT_USER=GUEST();applyUserUI();cloudAccountVisibility();cloudOpenLogin();}
    else if(![400,403,413].includes(e.status)){
      clearTimeout(CLOUD.timer);CLOUD.timer=setTimeout(()=>cloudSync(),CLOUD.retry+Math.random()*400);CLOUD.retry=Math.min(CLOUD.retry*2,30000);
    }
  }finally{CLOUD.busy=false;}
}
function cloudSocket(){
  CLOUD.ws?.close();if(!CLOUD.token)return;
  const ws=new WebSocket(location.origin.replace(/^http/,'ws')+'/api/events',['audit-sync','auth.'+CLOUD.token]);CLOUD.ws=ws;
  ws.onopen=()=>cloudSync();ws.onmessage=()=>cloudSync();
  ws.onclose=()=>{if(CLOUD.ws===ws&&CLOUD.token)setTimeout(cloudSocket,5000);};
}
async function cloudLogin(){
  try{
    const credentials={id:document.getElementById('loginUser').value.trim(),password:document.getElementById('loginPass').value};
    if(!CLOUD.gateToken){
      const result=await cloudRequest('login',{method:'POST',body:JSON.stringify(credentials)});
      CLOUD.gateToken=result.gateToken;sessionStorage.setItem('auditGateToken',CLOUD.gateToken);
      document.getElementById('loginPass').value='';await cloudOpenLogin();return;
    }
    if(!credentials.id)throw Error('Chọn người dùng trước khi vào app.');
    const result=await cloudRequest('member-login',{method:'POST',headers:{Authorization:'Bearer '+CLOUD.gateToken},body:JSON.stringify({id:credentials.id})});
    cloudIdentity(result.user);CLOUD.token=result.token;sessionStorage.setItem('auditToken',CLOUD.token);
    document.getElementById('loginPass').value='';document.getElementById('loginErr').textContent='';document.getElementById('loginOverlay').style.display='none';
    applyUserUI();renderActive();cloudSocket();await cloudSync();
  }catch(e){document.getElementById('loginErr').textContent=e.message;}
}
async function cloudLogout(full=false){
  if(CLOUD.busy){toast('Đang đồng bộ, hãy đợi trước khi đổi người dùng.');return;}
  if(CLOUD.token&&cloudDirty()){await cloudSync();if(cloudDirty()){toast('Cần đồng bộ thay đổi đang chờ trước khi đổi người dùng.');return;}}
  CLOUD.token='';sessionStorage.removeItem('auditToken');CLOUD.ws?.close();CURRENT_USER=GUEST();applyUserUI();
  document.getElementById('cloudRole')?.remove();CH.auditor='';
  if(full){CLOUD.gateToken='';sessionStorage.removeItem('auditGateToken');}
  cloudAccountVisibility();cloudStatus('Đã kết thúc phiên người dùng · dữ liệu trên máy được giữ');await cloudOpenLogin();
}
async function cloudBoot(){
  if(!navigator.locks)throw Error('Cần Chrome, Edge hoặc trình duyệt hỗ trợ Web Locks để tránh ghi đè giữa các tab.');
  await new Promise((resolve,reject)=>navigator.locks.request('ild-audit-editor',{ifAvailable:true},async lock=>{
    if(!lock){reject(Error('App đã mở trong tab khác. Đóng tab kia trước khi tiếp tục.'));return;}
    resolve();await new Promise(()=>{});
  }));
  const journal=await idbGet('cloudJournal');
  if(journal){cloudApply(journal.local);CLOUD.base=journal.base;CLOUD.version=journal.version;}
  else {CLOUD.base=cloudData();CLOUD.version=null;await cloudJournal();}
  CLOUD.ready=true;
  const panel=document.createElement('div');panel.className='card';panel.id='cloudSyncPanel';
  panel.innerHTML=`<h2>🔄 Đồng bộ dữ liệu</h2>
    <p class="muted" style="margin:4px 0 16px">Dữ liệu được lưu trên máy trước và tự động đồng bộ giữa các thiết bị qua Cloudflare khi có mạng.</p>
    <div class="hint" style="margin-bottom:16px"><strong>Trạng thái</strong><div id="cloudStatus" role="status" aria-live="polite" style="margin-top:6px">Đã lưu trên máy · chưa đăng nhập</div></div>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:20px"><button class="btn" id="cloudNow">🔄 Đồng bộ ngay</button><button class="btn gray" id="cloudRefresh" hidden>Cập nhật giao diện từ dữ liệu mới</button></div>
    <div style="border-top:1px solid var(--line);padding-top:16px"><h3>Sao lưu và chuyển dữ liệu</h3><p class="muted" style="margin:4px 0 12px">Tải bản sao JSON hoặc nhập dữ liệu từ app cũ.</p><div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn gray" id="cloudExport">⬇️ Sao lưu JSON</button><label class="btn gray">📂 Nhập JSON cũ<input type="file" id="cloudImport" accept=".json" hidden></label></div></div>
    <details id="cloudResolve" hidden open style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line)"><summary>Cần chọn cách xử lý xung đột</summary><pre id="cloudConflictPaths" style="white-space:pre-wrap"></pre><div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" id="cloudKeepLocal">Giữ bản trên máy cho mục xung đột</button><button class="btn gray" id="cloudKeepRemote">Giữ bản cloud cho mục xung đột</button><button class="btn gray" id="cloudBackupConflict">Tải hai bản để kiểm tra</button></div></details>`;
  document.getElementById('view-sync').append(panel);
  document.getElementById('cloudNow').onclick=()=>cloudSync();
  document.getElementById('cloudExport').onclick=backupJson;
  document.getElementById('cloudImport').onchange=async e=>{if(e.target.files[0])await restoreJson(e.target.files[0]);e.target.value='';};
  document.getElementById('cloudKeepLocal').onclick=()=>cloudResolve('local');
  document.getElementById('cloudKeepRemote').onclick=()=>cloudResolve('remote');
  document.getElementById('cloudBackupConflict').onclick=()=>{
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({local:cloudData(),remote:CLOUD.remote,base:CLOUD.base},null,2)],{type:'application/json'}));a.download='audit-conflict.backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  };
  document.getElementById('cloudRefresh').onclick=()=>{
    if(!confirm('Cập nhật màn hình từ dữ liệu đã đồng bộ? Hãy lưu các ô đang nhập trước.'))return;
    renderActive();document.getElementById('cloudRefresh').hidden=true;
  };
  if(location.hostname==='ngocthanhthien.github.io'){
    CLOUD.github=true;switchTab('sync');
    panel.insertAdjacentHTML('afterbegin','<p><strong>App đã chuyển sang Cloudflare.</strong> <a href="https://ild-internal-audit-api.dangthanhbinh53.workers.dev">Mở Internal Audit online</a>. Nếu đã lưu dữ liệu tại địa chỉ GitHub này, hãy bấm <b>Sao lưu JSON</b> trước rồi nhập vào app mới.</p>');
    cloudStatus('Địa chỉ GitHub chỉ dùng để chuyển dữ liệu cũ; đồng bộ online tại Cloudflare.');
    document.getElementById('cloudNow').disabled=true;
    return;
  }
  cloudAccountPanel();
  CLOUD.gateToken=sessionStorage.getItem('auditGateToken')||'';
  CLOUD.token=sessionStorage.getItem('auditToken')||'';
  if(CLOUD.token){
    try{cloudIdentity((await cloudRequest('me')).user);cloudSocket();}catch{CLOUD.token='';cloudStatus('Cần đăng nhập để đồng bộ · dữ liệu trên máy được giữ');}
  }
  window.addEventListener('online',()=>{cloudSocket();cloudSync();});
  window.addEventListener('offline',()=>cloudStatus('Mất mạng · dữ liệu lưu trên máy, sẽ tự gửi khi có mạng'));
  window.addEventListener('beforeunload',e=>{if(cloudDirty()||CLOUD.busy){e.preventDefault();e.returnValue='';}});
  window.addEventListener('unhandledrejection',()=>cloudStatus('Có lỗi lưu hoặc xử lý · hãy sao lưu JSON trước khi đóng app'));
  setInterval(()=>cloudSync(),30000);
  navigator.storage?.persist?.().catch(()=>{});
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
  if(!CLOUD.token)await cloudOpenLogin();
  cloudSync();
}
