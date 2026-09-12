/* Two-stage sign-in. QA unlocks the member directory, never Admin API privileges. */
async function cloudOpenLogin(){
  const box=document.querySelector('.loginbox');
  document.getElementById('loginOverlay').style.display='flex';
  document.getElementById('loginErr').textContent='';
  document.getElementById('loginPass').value='';
  document.getElementById('loginPass').placeholder='Mật khẩu';
  document.getElementById('loginPass').style.display=CLOUD.gateToken?'none':'';
  document.getElementById('loginPass').disabled=!!CLOUD.gateToken;
  document.getElementById('loginBtn').textContent=CLOUD.gateToken?'Vào app':'Đăng nhập';
  document.getElementById('loginCancelBtn').style.display='none';
  if(!CLOUD.gateToken){
    box.querySelector('h2').textContent='Bước 1 · Vào app bằng QA';
    box.querySelector('.muted').textContent='Đăng nhập chung trước khi chọn người dùng nội bộ.';
    const input=document.createElement('input');input.id='loginUser';input.value='QA';input.readOnly=true;input.autocomplete='username';
    document.getElementById('loginUser').replaceWith(input);return;
  }
  box.querySelector('h2').textContent='Bước 2 · Chọn người dùng';
  box.querySelector('.muted').textContent='Chọn người dùng để áp dụng quyền Admin / Auditor / PIC. Không cần nhập thêm mật khẩu.';
  try{
    const result=await cloudRequest('members',{headers:{Authorization:'Bearer '+CLOUD.gateToken}});
    const select=document.createElement('select');select.id='loginUser';
    select.innerHTML='<option value="">— Chọn tài khoản —</option>';
    for(const [role,label] of [['admin','Admin'],['auditor','Auditor'],['auditee','PIC / Auditee']]){
      const group=document.createElement('optgroup');group.label=label;
      for(const member of result.members.filter(u=>u.role===role)){
        const option=document.createElement('option');option.value=member.id;option.textContent=member.id===member.name?member.name:member.id+' — '+member.name;group.append(option);
      }
      if(group.children.length)select.append(group);
    }
    select.onchange=()=>document.getElementById('loginBtn').focus();
    document.getElementById('loginUser').replaceWith(select);
    if(!result.members.length)document.getElementById('loginErr').textContent='Chưa chuyển danh sách tài khoản nội bộ vào database.';
  }catch(e){
    if(e.status===401){CLOUD.gateToken='';sessionStorage.removeItem('auditGateToken');return cloudOpenLogin();}
    document.getElementById('loginErr').textContent=e.message;
  }
}
function cloudAccountVisibility(){
  const card=document.getElementById('memberAdmin');if(card)card.hidden=!isAdmin();
  const button=document.getElementById('logoutBtn');if(button)button.textContent='Đổi người dùng';
}
async function memberHash(password){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const digest=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256));
  const b64=x=>btoa(String.fromCharCode(...x)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return 'pbkdf2:100000:'+b64(salt)+':'+b64(digest);
}
function memberCandidates(backup){
  if(!Array.isArray(backup.auditors)||!Array.isArray(backup.auditees))throw Error('Cần file Backup JSON đầy đủ từ app cũ.');
  const accounts=new Map(),reserved=new Set(ADMIN_ACCOUNTS.map(a=>a.code.toLowerCase()));
  for(const name of backup.auditors){
    if(typeof name!=='string'||!name.trim())continue;
    const id=name.trim();if(reserved.has(id.toLowerCase()))throw Error('Tên Auditor trùng Admin: '+id);
    accounts.set(id.toLowerCase(),{id,name:id,role:'auditor'});
  }
  for(const row of backup.auditees){
    const id=String(row.pic||'').trim();if(!id)continue;
    if(reserved.has(id.toLowerCase()))throw Error('Tên PIC trùng Admin: '+id);
    // Preserve the old sign-in precedence: Auditor first, then first matching PIC.
    if(!accounts.has(id.toLowerCase()))accounts.set(id.toLowerCase(),{id,name:id,role:'auditee'});
  }
  return [...accounts.values()];
}
async function importMemberBackup(file){
  const status=document.getElementById('memberStatus');
  try{
    if(!isAdmin())throw Error('Đăng nhập Admin nội bộ trước.');
    const backup=JSON.parse(await file.text());
    const candidates=memberCandidates(backup);
    if(!candidates.length)throw Error('Không có tài khoản Auditor/PIC trong file.');
    if(!confirm('Chuyển '+candidates.length+' tài khoản Auditor/PIC vào Cloudflare và đặt mật khẩu tạm theo nhóm đã cấu hình? Tài khoản trùng tên sẽ được cập nhật.'))return;
    let saved=0;
    for(let i=0;i<candidates.length;i+=20){
      const accounts=[];
      for(const c of candidates.slice(i,i+20))accounts.push({id:c.id,name:c.name,role:c.role});
      await cloudRequest('members',{method:'POST',body:JSON.stringify({accounts})});
      saved+=accounts.length;status.textContent='Đã chuyển '+saved+'/'+candidates.length+' tài khoản';
    }
    status.textContent='Đã chuyển '+saved+' tài khoản. Dùng Đổi người dùng để xem danh sách. Mật khẩu không được lưu trong dữ liệu đánh giá.';
  }catch(e){status.textContent='Chưa hoàn tất: '+e.message;}
}
async function saveMemberAccount(){
  const status=document.getElementById('memberStatus');
  try{
    if(!isAdmin())throw Error('Chỉ Admin nội bộ quản lý tài khoản.');
    const id=document.getElementById('memberId').value.trim(),name=document.getElementById('memberName').value.trim(),role=document.getElementById('memberRole').value,password=document.getElementById('memberPassword').value;
    if(!id||!name||(role==='admin'&&!password))throw Error('Nhập đủ mã, tên; Admin cần mật khẩu riêng.');
    if(!confirm('Lưu tài khoản '+id+' và mật khẩu đã nhập hoặc mật khẩu mặc định theo nhóm? Nếu mã đã tồn tại, thông tin cũ sẽ được cập nhật.'))return;
    await cloudRequest('members',{method:'POST',body:JSON.stringify({accounts:[{id,name,role,...(password?{password_hash:await memberHash(password)}:{})}]})});
    document.getElementById('memberPassword').value='';status.textContent='Đã lưu tài khoản '+id;
    if(id.toLowerCase()===CURRENT_USER.id.toLowerCase()){CLOUD.token='';sessionStorage.removeItem('auditToken');CURRENT_USER=GUEST();applyUserUI();cloudAccountVisibility();await cloudOpenLogin();}
  }catch(e){status.textContent=e.message;}
}
function cloudAccountPanel(){
  const card=document.createElement('section');card.id='memberAdmin';card.className='card';card.hidden=true;
  card.innerHTML='<h2>Tài khoản nội bộ</h2><p>QA là cửa vào app. Quyền thao tác phụ thuộc tài khoản Admin / Auditor / PIC được chọn ở bước 2.</p><label class="btn">Nhập user từ JSON (mật khẩu theo nhóm)<input id="memberImport" type="file" accept=".json" hidden></label><p>Mật khẩu được lưu dạng băm, không hiển thị lại. Thay đổi Personnel không tự đổi mật khẩu đăng nhập.</p><div class="row"><input id="memberId" placeholder="Mã đăng nhập / tên cũ"><input id="memberName" placeholder="Tên hiển thị"><select id="memberRole"><option value="auditor">Auditor</option><option value="auditee">PIC</option><option value="admin">Admin</option></select><input id="memberPassword" type="password" autocomplete="new-password" placeholder="Mật khẩu (trống: theo nhóm)"><button id="memberSave" class="btn">Lưu tài khoản</button></div><p id="memberStatus" role="status"></p>';
  document.getElementById('view-master').prepend(card);
  document.getElementById('memberImport').onchange=async e=>{if(e.target.files[0])await importMemberBackup(e.target.files[0]);e.target.value='';};
  document.getElementById('memberSave').onclick=saveMemberAccount;
  const exit=document.createElement('button');exit.className='btn sm gray';exit.textContent='Thoát QA';exit.onclick=()=>cloudLogout(true);
  document.getElementById('cloudNow').after(exit);cloudAccountVisibility();
}
