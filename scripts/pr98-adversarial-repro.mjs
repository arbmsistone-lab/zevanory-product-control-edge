import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import {bootstrap} from './control-center-fixtures.mjs';
const browser=await chromium.launch({headless:true});
const results=[];
try {
 for(const theme of ['dark','light']) for(const viewport of [{width:360,height:800},{width:1366,height:768}]) for(const mode of ['nominal-expanded','long-product','runtime','extreme-commercial','extreme-creatives','extreme-approvals','extreme-form-0','extreme-form-1','extreme-form-2']) {
  const data=structuredClone(bootstrap);
  if(mode==='long-product') for(const p of data.products){p.name='Nome extenso '.repeat(40);p.description='Descrição completa com informações que precisam estar acessíveis. '.repeat(80);p.category='Categoria multilinha '.repeat(20);p.deliveryModel='Entrega assistida '.repeat(20);}
  if(mode.startsWith('extreme-')) {
   for(const p of data.products){p.name='Nome completo 😀 '.repeat(60);p.description='Descrição preservada\n'.repeat(150);p.category='Categoria '.repeat(50);p.deliveryModel='Entrega '.repeat(50);p.publicUrl='https://example.test/'+ 'path/'.repeat(100);p.notes='Notas completas '.repeat(100);}
   for(const key of ['leads','creatives','publications','events','support','finance','evidence']) data.commercial[key]=Array.from({length:40},(_,i)=>({...data.commercial[key][0],id:key+i,title:'Título íntegro 😀 '.repeat(50),detail:'Detalhe completo\n'.repeat(100),source:'Fonte '.repeat(40),evidence:Array.from({length:12},(_,n)=>'evidência '+n+' '+ 'texto '.repeat(40))}));
  }
  const c=await browser.newContext({viewport});await c.addInitScript(theme=>{localStorage.setItem('arbm_admin_session','test-session');localStorage.setItem('zpc_theme',theme)},theme);
  const page=await c.newPage();await page.route('**/api/admin/bootstrap',r=>r.fulfill({json:data}));await page.goto(process.env.CONTROL_CENTER_AUDIT_URL || 'http://127.0.0.1:4173');await page.getByRole('heading',{name:'ZEVANORY CONTROL CENTER',exact:true}).waitFor();
  const key=mode==='runtime'?'runtime':mode==='extreme-commercial'?'commercial':mode==='extreme-creatives'?'creatives':mode==='extreme-approvals'?'approvals':'products';
  if(await page.getByLabel('Selecionar área do Control Center').isVisible())await page.getByLabel('Selecionar área do Control Center').selectOption(key);else if(key==='runtime')await page.getByRole('button',{name:'Abrir evidência da Trust Chain'}).click();else await page.getByRole('navigation',{name:'Áreas do ZEVANORY CONTROL CENTER'}).getByRole('button',{name:({products:'Produtos',commercial:'Comercial',creatives:'Criativos',approvals:'Aprovações'})[key],exact:true}).click();
  if(mode==='nominal-expanded'){const detail=page.locator('.productDisclosureToggle').first();if(await detail.isVisible())await detail.click();else await page.getByRole('button',{name:'Abrir produto integral',exact:true}).click();}
  if(mode.startsWith('extreme-form-')) {
   await page.getByRole('button',{name:'Editar produto',exact:true}).first().click();
   for(let step=0;step<Number(mode.slice(-1));step++) await page.getByRole('navigation',{name:'Etapas do produto'}).getByRole('button',{name:'Próxima',exact:true}).click();
  }
  const geometry=await page.evaluate(()=>{
   const issues=[];
   for(const el of document.querySelectorAll('body *')){
    const r=el.getBoundingClientRect(),s=getComputedStyle(el);if(!r.width||!r.height||s.visibility==='hidden')continue;
    if(r.bottom>innerHeight+1||r.right>innerWidth+1||r.left< -1)issues.push({kind:'out-of-viewport',element:el.tagName+'.'+el.className});
    if((el.scrollHeight>el.clientHeight+2&&['hidden','clip','auto','scroll'].includes(s.overflowY))||(el.scrollWidth>el.clientWidth+2&&['hidden','clip','auto','scroll'].includes(s.overflowX)))issues.push({kind:'overflow-or-clipping',element:el.tagName+'.'+el.className});
   }
   return{globalX:document.documentElement.scrollWidth-innerWidth,globalY:document.documentElement.scrollHeight-innerHeight,issues};
  });
  results.push({theme,viewport,mode,...geometry});await c.close();
 }
}finally{await fs.mkdir('audit/pr98-final',{recursive:true});await fs.writeFile(process.env.REPRO_REPORT || 'audit/pr98-final/adversarial-reproduction.json',JSON.stringify({scope:'Expanded adversarial reproduction; not full layout certification',testedSha:process.env.TESTED_SHA || process.env.CANDIDATE_SHA || 'working-tree-uncommitted',results},null,2));await browser.close()}
console.log(JSON.stringify(results.map(r=>({...r,issues:r.issues.length}))));

assert.ok(results.every(r=>r.globalX<=1&&r.globalY<=1&&!r.issues.length),"content bounds or clipping");
