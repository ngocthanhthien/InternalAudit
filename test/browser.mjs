import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.AUDIT_PLAYWRIGHT_PATH||'C:/Users/BinhDang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
let state={data:null,version:null},count=0;
const errors=[];
async function device(role='admin'){
  const context=await browser.newContext();
  await context.addInitScript(()=>{
    sessionStorage.setItem('auditToken','test');
    window.WebSocket=class {close(){} };
  });
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    const json=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    if(url.pathname==='/api/me')return json({user:{id:role,code:role,name:role==='auditor'?'Test Auditor':role==='auditee'?'Test PIC':'Admin',admin:role==='admin',role}});
    if(url.pathname==='/api/state'){
      if(req.method()==='GET')return json(state);
      const body=req.postDataJSON();
      if(body.baseVersion!==state.version)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Conflict'})});
      state={data:body.data,version:String(++count)};return json({version:state.version});
    }
    if(url.pathname.endsWith('sw.js'))return route.fulfill({status:404,body:''});
    return route.fulfill({status:200,contentType:'text/html',body:html});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://audit.test');
  await page.waitForFunction(()=>CLOUD.ready&&!CLOUD.busy&&CLOUD.version!==null);
  return {context,page};
}
try{
  const a=await device(),b=await device();
  await a.page.evaluate(async()=>{RECORDS.push({id:'test-a',action:'old',pic:'A',updatedAt:1});await saveRecords();await cloudSync();});
  await b.page.evaluate(async()=>{RECORDS.push({id:'test-b',action:'B',updatedAt:1});await saveRecords();await cloudSync();});
  await a.page.evaluate(()=>cloudSync());
  assert.equal(state.data.records.length,2);
  await a.page.evaluate(async()=>{RECORDS.find(r=>r.id==='test-a').action='from A';await saveRecords();await cloudSync();});
  await b.page.evaluate(async()=>{RECORDS.find(r=>r.id==='test-a').pic='from B';await saveRecords();await cloudSync();});
  assert.equal(state.data.records.find(r=>r.id==='test-a').action,'from A');
  assert.equal(state.data.records.find(r=>r.id==='test-a').pic,'from B');
  await a.page.evaluate(()=>cloudSync());
  await a.page.evaluate(async()=>{RECORDS.find(r=>r.id==='test-a').action='conflict A';await saveRecords();await cloudSync();});
  await b.page.evaluate(async()=>{RECORDS.find(r=>r.id==='test-a').action='conflict B';await saveRecords();await cloudSync();});
  assert.ok(await b.page.evaluate(()=>CLOUD.conflicts.includes('/records/test-a/action')));
  b.page.on('dialog',d=>d.accept());
  await b.page.evaluate(async()=>{await cloudResolve('local');await cloudSync();});
  assert.equal(state.data.records.find(r=>r.id==='test-a').action,'conflict B');
  await a.context.setOffline(true);
  await a.page.evaluate(async()=>{RECORDS.push({id:'offline',action:'keep me',updatedAt:1});await saveRecords();});
  await a.page.reload();
  await a.page.waitForFunction(()=>CLOUD.ready);
  assert.ok(await a.page.evaluate(()=>RECORDS.some(r=>r.id==='offline')));
  await a.context.setOffline(false);
  await a.page.evaluate(()=>cloudSync());
  await a.page.waitForFunction(()=>!CLOUD.busy);
  assert.ok(state.data.records.some(r=>r.id==='offline'));
  const auditor=await device('auditor'),pic=await device('auditee');
  assert.equal(await auditor.page.evaluate(()=>CURRENT_USER.role),'auditor');
  assert.equal(await auditor.page.evaluate(()=>CH.auditor),'Test Auditor');
  assert.equal(await auditor.page.locator('#cloudRole').textContent(),'· Auditor');
  assert.equal(await pic.page.evaluate(()=>isAdmin()),false);
  assert.equal(await pic.page.locator('#cloudRole').textContent(),'· PIC');
  const sortCheck=await a.page.evaluate(()=>{
    const before=JSON.stringify(PROGRAMME);
    renderChkEdit();renderProgramme();renderReport();
    for(const id of ['ceTable','progTable','reportTable']){
      const th=document.querySelector('#'+id+' thead th[aria-sort]');
      th.querySelector('button').click();
      if(document.querySelector('#'+id+' thead th[aria-sort]').getAttribute('aria-sort')!=='ascending')throw Error('Missing ascending sort '+id);
      document.querySelector('#'+id+' thead th[aria-sort] button').click();
      if(document.querySelector('#'+id+' thead th[aria-sort]').getAttribute('aria-sort')!=='descending')throw Error('Missing descending sort '+id);
      document.querySelector('#'+id+' thead th[aria-sort] button').click();
    }
    tableSortState.reportTable={key:'score',direction:1};
    const rows=[{score:10},{score:2},{score:''}];
    const asc=sortedTableRows('reportTable',rows).map(r=>r.score);
    tableSortState.reportTable.direction=-1;
    const desc=sortedTableRows('reportTable',rows).map(r=>r.score);
    tableSortState.reportTable=null;
    return {unchanged:before===JSON.stringify(PROGRAMME),asc,desc};
  });
  assert.equal(sortCheck.unchanged,true);assert.deepEqual(sortCheck.asc,[2,10,'']);assert.deepEqual(sortCheck.desc,[10,2,'']);
  console.log('PASS: all three tables toggle sorting; numeric sorting and blank placement; source data unchanged.');
  if(process.env.AUDIT_CHECKLIST_FILE){
    const bytes=Array.from(readFileSync(process.env.AUDIT_CHECKLIST_FILE));
    const result=await a.page.evaluate(async bytes=>{
      PROGRAMME=[];ceFuncF='ROA';
      const file=new File([new Uint8Array(bytes)],'checklist.xlsx');
      await importChkExcel(file);
      const count=PROGRAMME.length,visible=document.querySelectorAll('#ceTable tbody tr').length;
      await importChkExcel(file);
      let exported=0;XLSX.writeFile=wb=>{exported=parseChkSheet(wb.Sheets.Checklist).items.length;};
      ceFuncF='ROA';exportChkExcel();
      await cloudSync();
      return {count,visible,afterRepeat:PROGRAMME.length,exported,report:document.getElementById('ceImportReport').textContent};
    },bytes);
    assert.equal(result.count,170);assert.equal(result.visible,170);assert.equal(result.afterRepeat,170);assert.equal(result.exported,170);
    assert.equal(state.data.programme.length,170);
    console.log('PASS: supplied workbook imports, displays, syncs and exports 170 unique rows; reimport adds no duplicates.');
  }
  const deleteCheck=await a.page.evaluate(async()=>{
    const recordsBefore=JSON.stringify(RECORDS);
    PROGRAMME=[{id:'delete-a',dept:'PRO',func:'A',activity:'A',months:{1:'X'}},{id:'delete-b',dept:'PRO',func:'B',activity:'B',months:{}}];
    ceFuncF='A';renderChkEdit();openDeleteAllChecklist();
    document.querySelector('#ceDeletePassword').value='wrong';
    document.querySelector('#ceDeleteDialog form').requestSubmit();
    const wrongKept=PROGRAMME.length===2;
    document.querySelector('#ceDeleteCancel').click();
    await new Promise(resolve=>setTimeout(resolve,20));
    const cancelKept=PROGRAMME.length===2;
    openDeleteAllChecklist();document.querySelector('#ceDeletePassword').value='1234';
    document.querySelector('#ceDeleteDialog form').requestSubmit();
    for(let i=0;i<100&&document.querySelector('#ceDeleteDialog');i++)await new Promise(resolve=>setTimeout(resolve,10));
    await cloudSync();
    return {wrongKept,cancelKept,count:PROGRAMME.length,recordsKept:recordsBefore===JSON.stringify(RECORDS)};
  });
  assert.deepEqual(deleteCheck,{wrongKept:true,cancelKept:true,count:0,recordsKept:true});
  assert.equal(state.data.programme.length,0);
  assert.equal(await auditor.page.evaluate(()=>{renderChkEdit();openDeleteAllChecklist();return document.querySelector('#ceDeleteAllBtn').style.display==='none'&&!document.querySelector('#ceDeleteDialog');}),true);
  console.log('PASS: bulk delete requires correct password and Admin; cancel/wrong password retain rows; clears all filters and preserves reports; mock sync receives empty checklist.');
  await b.page.screenshot({path:new URL('../test-output/browser.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: two devices, disjoint edits, conflict resolution, offline reload, pending upload, Auditor/PIC identity; no browser errors.');
}finally{await browser.close();}
