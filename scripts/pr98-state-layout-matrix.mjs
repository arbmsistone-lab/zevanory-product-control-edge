import {measureLayout} from './pr98-layout-measure.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {fixture,sizes,views} from './pr98-layout-fixtures.mjs';
const sourceSha=process.env.CANDIDATE_SHA||'working-tree-uncommitted';
const origin=process.env.CONTROL_CENTER_AUDIT_URL||'http://127.0.0.1:4173';
const out=process.env.LAYOUT_MATRIX_OUT||'control-center-truth-audit/state-layout-matrix.json';
const selectedSizes=(process.env.LAYOUT_PREFLIGHT?sizes.filter(([w,h])=>h===640||h===600):sizes).filter(([w,h],i)=>!process.env.LAYOUT_SIZES||process.env.LAYOUT_SIZES.split(',').includes(w+'x'+h)).filter((_,i)=>process.env.LAYOUT_SHARD===undefined||i%3===Number(process.env.LAYOUT_SHARD));
const states=(process.env.LAYOUT_PREFLIGHT?['SUCCESS','MAX_REALISTIC_DATA','LONG_TEXT']:['EMPTY','SUCCESS','PARTIAL','MAX_REALISTIC_DATA','LONG_TEXT','UNICODE']).filter(state=>!process.env.LAYOUT_STATES||process.env.LAYOUT_STATES.split(',').includes(state));
const rows=[];let rowContext;
async function geometry(page,surface){
 const result=await measureLayout(page);rows.push({...rowContext,surface,...result});
}
async function area(page,key,label){const select=page.getByLabel('Selecionar área do Control Center');if(await select.isVisible())await select.selectOption(key);else await page.getByRole('navigation',{name:'Áreas do ZEVANORY CONTROL CENTER'}).getByRole('button',{name:label,exact:true}).click();}
async function reconstruct(page){await page.waitForFunction(()=>Number(document.querySelector('.readerText')?.dataset.pages)>0);let value='';for(let i=0;i<1500;i++){value+=await page.locator('.readerText').textContent();await geometry(page,'reader-page');const next=page.getByRole('button',{name:'Próxima',exact:true});if(!await next.isEnabled())return value;await next.click()}throw Error('NON_TERMINATING_READER');}
const browser=await chromium.launch();
try{
 for(const theme of ['dark','light'])for(const [width,height]of selectedSizes)for(const state of states){
  rowContext={theme,width,height,state};const data=fixture(state);const context=await browser.newContext({viewport:{width,height}});await context.addInitScript(theme=>{localStorage.setItem('arbm_admin_session','fixture');localStorage.setItem('zpc_theme',theme)},theme);
  const page=await context.newPage();await page.route('**/api/admin/bootstrap',r=>r.fulfill({json:data}));await page.route('**/api/commercial/**',r=>r.fulfill({status:503,json:{error:'Fixture de erro de ação íntegra 😀'}}));await page.goto(origin);await page.getByRole('heading',{name:'ZEVANORY CONTROL CENTER',exact:true}).waitFor();
  for(const [key,label]of views){
   await area(page,key,label);await geometry(page,key);
   if(key==='overview')for(const button of await page.getByRole('navigation',{name:'Páginas da visão geral'}).getByRole('button').all()){await button.click();await geometry(page,'overview-page');}
   if(key==='cfo'){
    const select=page.getByLabel('Área financeira');for(const [value,name]of [['summary','Resumo'],['adapters','Integrações'],['actions','Decisões'],['receivables','Recebíveis']]){if(await select.isVisible())await select.selectOption(value);else await page.getByRole('navigation',{name:'Páginas do CFO'}).getByRole('button',{name,exact:true}).click();await geometry(page,'cfo:'+value);}
    // Each complete snapshot field is reconstructible, including non-rendered transactions/evidence.
    if(!process.env.LAYOUT_PREFLIGHT&&width===360&&height===640&&['SUCCESS','LONG_TEXT','UNICODE'].includes(state)){
     await page.getByRole('button',{name:'Estado financeiro completo'}).click();for(const [i,[,value]]of Object.entries(Object.entries(data.cfo))){if(Number(i)>0)await page.getByRole('button',{name:'Próximo campo',exact:true}).click();assert.equal(await reconstruct(page),typeof value==='string'?value:JSON.stringify(value,null,2));}await page.getByRole('button',{name:'Voltar',exact:true}).click();
    }
   }
   if(key==='products'){
    await page.getByRole('button',{name:'Novo produto',exact:true}).click();for(let step=0;step<5;step++){await geometry(page,'form-step-'+step);if(step<4)await page.getByRole('navigation',{name:'Etapas do produto'}).getByRole('button',{name:'Próxima',exact:true}).click()}await page.getByRole('dialog').getByRole('button',{name:'Fechar',exact:true}).click();
   }
  }
  await context.close();console.log(JSON.stringify({completed:rowContext,rows:rows.length,failures:rows.filter(r=>r.issues.length||r.globalX>1||r.globalY>1).length}));
 }
 // Loading/error affect the shared shell before authenticated route content exists.
 for(const theme of ['dark','light'])for(const [width,height]of selectedSizes)for(const state of ['LOADING','ERROR']){rowContext={theme,width,height,state};const context=await browser.newContext({viewport:{width,height}});await context.addInitScript(theme=>{localStorage.setItem('arbm_admin_session','fixture');localStorage.setItem('zpc_theme',theme)},theme);const page=await context.newPage();await page.route('**/api/admin/bootstrap',r=>state==='LOADING'?new Promise(()=>{}):r.fulfill({status:503,json:{error:'indisponível'}}));await page.goto(origin,{waitUntil:'domcontentloaded'});if(state==='ERROR')await page.getByRole('heading',{name:'Conexão indisponível'}).waitFor();else await page.getByText('Validando PIN administrativo...', {exact:true}).waitFor();await geometry(page,'shared-shell');await context.close();}
}finally{await fs.mkdir(new URL('.', 'file://'+process.cwd()+'/'+out).pathname,{recursive:true});await fs.writeFile(out,JSON.stringify({sourceSha,scope:'application state/viewport matrix; native zoom and text scaling are separate required matrices; does not certify public product routes',states:[...states,'LOADING','ERROR'],sizes:selectedSizes,rows},null,2));await browser.close()}
const failures=rows.filter(r=>r.issues.length||r.globalX>1||r.globalY>1);console.log('STATE_LAYOUT_ROWS='+rows.length+' FAILURES='+failures.length);assert.equal(failures.length,0,'State layout matrix has bounds/clipping/overlap failures');
