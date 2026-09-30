import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {bootstrap} from './control-center-fixtures.mjs';
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'pr98-font-'));
const extension=path.resolve('scripts/native-zoom-extension');
const c=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension],viewport:null});
const w=c.serviceWorkers()[0]||await c.waitForEvent('serviceworker'),p=c.pages()[0],cdp=await c.newCDPSession(p),{windowId}=await cdp.send('Browser.getWindowForTarget');
const rows=[],data=structuredClone(bootstrap);
data.products[0].description='Texto completo: á 😀\n'.repeat(140);
await c.addInitScript(()=>localStorage.setItem('arbm_admin_session','test-session'));
await p.route('**/api/admin/bootstrap',r=>r.fulfill({json:data}));
async function record(context){
 const geometry=await p.evaluate(()=>{
  const issues=[];
  for(const e of document.querySelectorAll('body *')){
   const r=e.getBoundingClientRect(),s=getComputedStyle(e);
   if(!r.width||!r.height||s.visibility==='hidden')continue;
   const bounds=r.bottom>innerHeight+1||r.right>innerWidth+1||r.left< -1||r.top< -1;
   const x=e.scrollWidth>e.clientWidth+2&&['hidden','clip','auto','scroll'].includes(s.overflowX);
   const y=e.scrollHeight>e.clientHeight+2&&['hidden','clip','auto','scroll'].includes(s.overflowY);
   if(bounds||x||y)issues.push({element:e.tagName+'.'+e.getAttribute('class'),text:e.textContent?.slice(0,100),rect:r.toJSON(),bounds,x,y});
  }
  return{viewport:{width:innerWidth,height:innerHeight},globalX:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,globalY:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight)-innerHeight,issues};
 });
 rows.push({...context,...geometry});
}
try{
 for(const theme of ['dark','light'])for(const [width,height]of[[1366,768],[360,800]])for(const minimum of[16,24,28]){
  await cdp.send('Browser.setWindowBounds',{windowId,bounds:{width,height}});
  const settings=await w.evaluate(async minimum=>{await chrome.fontSettings.setMinimumFontSize({pixelSize:minimum});return await chrome.fontSettings.getMinimumFontSize({})},minimum);
  assert.equal(settings.pixelSize,minimum);
  await p.goto('http://127.0.0.1:4173');
  await p.getByRole('heading',{name:'ZEVANORY CONTROL CENTER',exact:true}).waitFor();
  if(await p.evaluate(()=>document.documentElement.dataset.theme)!==theme)await p.getByRole('button',{name:theme==='light'?'Ativar tema claro':'Ativar tema escuro'}).click();
  await p.getByRole('button',{name:'Abrir evidência da Trust Chain'}).click();
  const context={width,height,minimum,theme,settings};
  for(const label of ['Decisão','Linhagem','Políticas']){
   await p.getByRole('navigation',{name:'Páginas da evidência'}).getByRole('button',{name:label,exact:true}).click();
   await p.waitForFunction(()=>Number(document.querySelector('.readerText')?.getAttribute('data-pages'))>0);
   await record({...context,surface:'runtime:'+label});
  }
  if(minimum===28){
   await fs.mkdir('control-center-truth-audit',{recursive:true});
   await p.screenshot({path:`control-center-truth-audit/font-${theme}-${width}-${minimum}.png`});
  }
  await p.getByRole('button',{name:'Voltar',exact:true}).click();
  if(await p.getByLabel('Selecionar área do Control Center').isVisible())await p.getByLabel('Selecionar área do Control Center').selectOption('products');
  else await p.getByRole('navigation',{name:'Áreas do ZEVANORY CONTROL CENTER'}).getByRole('button',{name:'Produtos',exact:true}).click();
  const productDetails=p.locator('.productDisclosureToggle').first(), compactProduct=!await productDetails.isVisible();
 if(compactProduct)await p.getByRole('button',{name:'Abrir produto integral',exact:true}).click();else await productDetails.click();
  for(let field=0;field<(compactProduct?Object.keys(data.products[0]).indexOf('description'):2);field++)await p.getByRole('button',{name:'Próximo campo',exact:true}).click();
  await p.waitForFunction(()=>Number(document.querySelector('.readerText')?.getAttribute('data-pages'))>0);
  let reconstructed='',count=0;
  do{
   reconstructed+=await p.locator('.readerText').textContent();
   await record({...context,surface:'description',page:++count});
   if(!await p.getByRole('button',{name:'Próxima',exact:true}).isEnabled())break;
   await p.getByRole('button',{name:'Próxima',exact:true}).click();
  }while(count<1000);
  assert.equal(reconstructed,data.products[0].description,'pagination must retain every code point');
  await p.getByRole('button',{name:'Voltar',exact:true}).click();
  await assert.doesNotReject(()=>compactProduct?p.getByRole('button',{name:'Abrir produto integral',exact:true}).waitFor():p.locator('.productDisclosureToggle').first().waitFor(),'Back must restore the task');
 }
 console.log('TEXT_SCALING_ROWS='+rows.length+' FAILURES='+rows.filter(r=>r.issues.length||r.globalX>1||r.globalY>1).length);
}finally{
 await fs.writeFile('audit/pr98-final/text-scaling.json',JSON.stringify({source:process.env.CANDIDATE_SHA||'working-tree-uncommitted',scope:'browser minimum font size 16/24/28; two themes, two native windows, three runtime tabs and full description reconstruction; not ALL_STATES certification',rows},null,2));
 await c.close();await fs.rm(profile,{recursive:true,force:true});
}
assert.ok(rows.every(r=>!r.issues.length&&r.globalX<=1&&r.globalY<=1),'text scaling clips or overflows; promotion blocked');
