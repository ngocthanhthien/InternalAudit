import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../app-template.html',import.meta.url),'utf8');
function app(){
  const c=vm.createContext({uid:()=>crypto.randomUUID(),toast:()=>{},todayISO:()=> 'test'});
  vm.runInContext(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1],c);
  vm.runInContext(html.slice(html.indexOf('const CE_COLS='),html.indexOf('function downloadChkTemplate')),c);
  vm.runInContext(html.slice(html.indexOf('const CE_FIELDS='),html.indexOf('async function importChkExcel')),c);
  vm.runInContext(html.slice(html.indexOf('function exportChkExcel'),html.indexOf('// Compare complete checklist')),c);
  return c;
}
test('175 input rows retain 170 unique questions; reimport is idempotent; filtered export keeps all rows',()=>{
  const c=app();
  const result=vm.runInContext(`(()=>{
    const data=Array.from({length:170},(_,i)=>['PRO',i%2?'ROA':'EVA','A','Topic '+(i%90),'SOP','','Question '+i,'Monthly','Owner']);
    data.push(...data.slice(0,5));
    const ws=XLSX.utils.aoa_to_sheet([CE_COLS,...data]);
    const parsed=parseChkSheet(ws), first=appendChkItems([],parsed.items);
    const before=JSON.stringify(first.additions);
    const second=appendChkItems(first.additions,parsed.items);
    globalThis.PROGRAMME=first.additions;globalThis.ceFuncF='ROA';
    let exported;
    XLSX.writeFile=wb=>{exported=XLSX.read(XLSX.write(wb,{type:'array',bookType:'xlsx'}),{type:'array'});};
    exportChkExcel();
    return [parsed.total,first.additions.length,first.duplicates,second.additions.length,second.duplicates,JSON.stringify(first.additions)===before,parseChkSheet(exported.Sheets.Checklist).items.length,new Set(first.additions.map(x=>x.id)).size];
  })()`,c);
  assert.deepEqual(Array.from(result),[175,170,5,0,175,true,170,170]);
});
test('merged Dept and Function supported; ordinary blanks reported by actual Excel row number',()=>{
  const c=app();
  const result=vm.runInContext(`(()=>{
    const ws=XLSX.utils.aoa_to_sheet([[],CE_COLS,['PRO','ROA','','Topic','','','Q1'],['','','','Topic','','','Q2'],['','','','Topic','','','Q3']]);
    ws['!merges']=[{s:{r:2,c:0},e:{r:3,c:0}},{s:{r:2,c:1},e:{r:3,c:1}}];
    ws['!ref']='A2:I5';
    const p=parseChkSheet(ws);return [p.total,p.items.length,p.invalid[0].line,p.invalid[0].missing.join(',')];
  })()`,c);
  assert.deepEqual(Array.from(result),[3,2,5,'Dept,Function']);
});
test('same topic with different sections, documents, questions or owners is preserved',()=>{
  const c=app();
  const result=vm.runInContext(`(()=>{
    const base={dept:'PRO',func:'ROA',section:'A',activity:'Topic',document:'SOP',questionnaire:'Q',freq:'Monthly',owner:'A'};
    const rows=[base,...['section','document','questionnaire','owner'].map(k=>({...base,[k]:'Different'})),{...base,activity:' Topic '}];
    const p=appendChkItems([],rows);return [p.additions.length,p.duplicates];
  })()`,c);
  assert.deepEqual(Array.from(result),[5,1]);
});
