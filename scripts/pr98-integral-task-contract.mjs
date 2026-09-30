import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {bootstrap} from './control-center-fixtures.mjs';
const browser=await chromium.launch(),rows=[];
const geometry=async page=>page.evaluate(()=>{
 const issues=[];
 for(const e of document.querySelectorAll('body *')){const r=e.getBoundingClientRect(),s=getComputedStyle(e);if(!r.width||!r.height||s.visibility==='hidden')continue;
 if(r.bottom>innerHeight+1||r.right>innerWidth+1||r.left< -1||r.top< -1||e.scrollHeight>e.clientHeight+2&&['hidden','clip','auto','scroll'].includes(s.overflowY)||e.scrollWidth>e.clientWidth+2&&['hidden','clip','auto','scroll'].includes(s.overflowX))issues.push(e.tagName+'.'+e.className);}
 return {issues,globalX:document.documentElement.scrollWidth-innerWidth,globalY:document.documentElement.scrollHeight-innerHeight};
});
async function reconstruct(page,editable=false){
 await page.waitForFunction(()=>Number(document.querySelector('.readerText')?.getAttribute('data-pages'))>0);
 let result='',pages=0;
 do{result+=editable?await page.getByRole('textbox',{name:'Texto do campo'}).inputValue():await page.locator('.readerText').textContent();rows.push({surface:editable?'editor':'reader',...await geometry(page)});if(!await page.getByRole('button',{name:'Próxima',exact:true}).isEnabled())break;await page.getByRole('button',{name:'Próxima',exact:true}).click();}while(++pages<1000);
 assert.ok(pages<1000,'pagination must terminate');return result;
}
try{
 for(const theme of ['dark','light'])for(const viewport of [{width:360,height:800},{width:1366,height:768}]){
 const data=structuredClone(bootstrap);data.products[0].name='Nome íntegro 😀 '.repeat(80);
 const record={...data.commercial.creatives[0],title:'Título íntegro 😀 '.repeat(50),evidence:Array.from({length:12},(_,i)=>'Evidência '+i+' '+ 'á😀 '.repeat(50))};
 data.commercial.creatives=Array.from({length:40},(_,i)=>({...record,id:'creative-'+i}));
 const context=await browser.newContext({viewport});await context.addInitScript(theme=>{localStorage.setItem('arbm_admin_session','fixture-session');localStorage.setItem('zpc_theme',theme)},theme);
 const page=await context.newPage();await page.route('**/api/admin/bootstrap',r=>r.fulfill({json:data}));await page.goto(process.env.CONTROL_CENTER_AUDIT_URL||'http://127.0.0.1:4173');await page.getByRole('heading',{name:'ZEVANORY CONTROL CENTER',exact:true}).waitFor();
 await page.getByLabel('Selecionar área do Control Center').selectOption('creatives');
 for(let i=0;i<39;i++)await page.getByRole('navigation',{name:'Registros comerciais'}).getByRole('button',{name:'Próximo',exact:true}).click();
 assert.ok((await page.getByRole('navigation',{name:'Registros comerciais'}).textContent()).includes('40/40'));
 await page.getByRole('button',{name:'Abrir registro integral'}).click();
 assert.equal(await reconstruct(page),data.commercial.creatives[39].id);
 for(let field=0;field<Object.keys(record).indexOf('evidence');field++)await page.getByRole('button',{name:'Próximo campo',exact:true}).click();
 assert.equal(await reconstruct(page),JSON.stringify(record.evidence,null,2),'all evidence entries and code points must remain reachable');
 await page.getByRole('button',{name:'Voltar',exact:true}).click();
 assert.ok((await page.getByRole('navigation',{name:'Registros comerciais'}).textContent()).includes('40/40'),'return must preserve reviewed record');
 await page.getByLabel('Selecionar área do Control Center').selectOption('products');await page.getByRole('button',{name:'Editar produto',exact:true}).first().click();
 await page.locator('.formGrid > label').first().getByRole('button').click();
 assert.equal(await reconstruct(page,true),data.products[0].name);
 while(await page.getByRole('button',{name:'Anterior',exact:true}).isEnabled())await page.getByRole('button',{name:'Anterior',exact:true}).click();
 const first=await page.getByRole('textbox',{name:'Texto do campo'}).inputValue(),expected=first+' NOVO 😀'+data.products[0].name.slice(first.length);
 await page.getByRole('textbox',{name:'Texto do campo'}).fill(first+' NOVO 😀');
 await page.getByRole('button',{name:'Voltar',exact:true}).click();
 await page.locator('.formGrid > label').first().getByRole('button').click();
 assert.equal(await reconstruct(page,true),expected,'editing a page must preserve every other page');
 await context.close();
 }
 assert.ok(rows.every(r=>!r.issues.length&&r.globalX<=1&&r.globalY<=1),'task content must fit without scrolling or clipping');
 console.log('INTEGRAL_TASK_ROWS='+rows.length+' ALL_CONTENT_REACHABLE=PASS (tested tasks)');
}finally{
 await fs.writeFile(process.env.TASK_REPORT||'audit/pr98-final/integral-tasks.json',JSON.stringify({testedSha:process.env.CANDIDATE_SHA||'working-tree-uncommitted',scope:'two themes/two viewports; 40 records, all evidence, unicode text edit and full reconstruction; not full layout matrix',rows},null,2));await browser.close();
}
