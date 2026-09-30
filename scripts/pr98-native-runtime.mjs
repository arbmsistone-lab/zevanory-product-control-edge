import {reachTaskControl} from './pr98-layout-measure.mjs';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {bootstrap} from './control-center-fixtures.mjs';
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'pr98-zoom-'));
const extension=path.resolve('scripts/native-zoom-extension');
const c=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension],viewport:null});
const worker=c.serviceWorkers()[0]||await c.waitForEvent('serviceworker');
const page=c.pages()[0];const cdp=await c.newCDPSession(page);const {windowId}=await cdp.send('Browser.getWindowForTarget');
const rows=[];
let bootstrapCalls=0;
const data=structuredClone(bootstrap);data.products[0].description='Texto integral de auditoria: á 😀\n'.repeat(140);
await c.addInitScript(()=>localStorage.setItem('arbm_admin_session','test-session'));
await page.route('**/api/admin/bootstrap',r=>{bootstrapCalls++;return r.fulfill({json:data})});
const sizes=[[1920,1080],[1680,1050],[1536,864],[1440,900],[1366,768],[1280,720],[1024,768],[768,1024],[430,932],[412,915],[390,844],[375,812],[360,800]];
async function geometry(){return await page.evaluate(()=>{
 const issues=[];
 for(const el of document.querySelectorAll('main *,.topbar,.trustStrip,.areaSelectWrap')){
  const r=el.getBoundingClientRect(),s=getComputedStyle(el);if(!r.width||!r.height||s.visibility==='hidden')continue;
  if(r.bottom>innerHeight+1||r.right>innerWidth+1||r.left< -1)issues.push(el.tagName+'.'+el.className+':bounds');
  if((el.scrollHeight>el.clientHeight+2&&['hidden','clip','auto','scroll'].includes(s.overflowY))||(el.scrollWidth>el.clientWidth+2&&['hidden','clip','auto','scroll'].includes(s.overflowX)))issues.push(el.tagName+'.'+el.className+':overflow');
 }
 return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,globalX:document.documentElement.scrollWidth-innerWidth,globalY:document.documentElement.scrollHeight-innerHeight,issues};
})}
try {
 for(const theme of ['dark','light']) for(const [width,height] of sizes) for(const zoom of [.8,.9,1,1.1,1.25]) {
  await cdp.send('Browser.setWindowBounds',{windowId,bounds:{width,height}});
  await page.goto('http://127.0.0.1:4173');
  await worker.evaluate(async zoom=>{const [tab]=await chrome.tabs.query({url:'http://127.0.0.1:4173/*'});await chrome.tabs.setZoom(tab.id,zoom)},zoom);
  await page.waitForFunction(z=>Math.abs(devicePixelRatio-z)<.001,zoom);
  await page.getByRole('heading',{name:'ZEVANORY CONTROL CENTER',exact:true}).waitFor();
  const activeTheme=await page.evaluate(()=>document.documentElement.dataset.theme);
  if(activeTheme!==theme)await page.getByRole('button',{name:theme==='light'?'Ativar tema claro':'Ativar tema escuro'}).click();
  await page.getByRole('button',{name:'Abrir evidência da Trust Chain'}).click();
  for(const label of ['Decisão','Linhagem','Políticas']) {
   await page.getByRole('navigation',{name:'Páginas da evidência'}).getByRole('button',{name:label,exact:true}).click();
   rows.push({theme,screenWidth:width,screenHeight:height,zoom,surface:'runtime:'+label,...await geometry()});
  }
 }
 // Full long-text reconstruction on mobile, including code points/newlines.
 await cdp.send('Browser.setWindowBounds',{windowId,bounds:{width:360,height:800}});
 await worker.evaluate(async()=>{const [t]=await chrome.tabs.query({url:'http://127.0.0.1:4173/*'});await chrome.tabs.setZoom(t.id,1)});
 await page.waitForFunction(()=>devicePixelRatio===1);
 await page.getByRole('button',{name:'Voltar',exact:true}).click();
 await page.getByLabel('Selecionar área do Control Center').selectOption('products');
 const productDetails=page.locator('.productDisclosureToggle').first(), compactProduct=!await productDetails.isVisible();
 if(compactProduct){const open=page.getByRole('button',{name:'Abrir produto integral',exact:true});await reachTaskControl(page,open);await open.click()}else await productDetails.click();
 for(let i=0;i<(compactProduct?Object.keys(data.products[0]).indexOf('description'):2);i++)await page.getByRole('button',{name:'Próximo campo',exact:true}).click();
 await page.waitForFunction(()=>Number(document.querySelector('.readerText')?.getAttribute('data-pages'))>1);
 let reconstructed='';let count=0;
 do {reconstructed+=await page.locator('.readerText').textContent();rows.push({surface:'reader-description',page:++count,...await geometry()});if(!await page.getByRole('button',{name:'Próxima',exact:true}).isEnabled())break;await page.getByRole('button',{name:'Próxima',exact:true}).click()}while(count<1000);
 // textContent preserves every newline and code point across all pages.
 assert.equal(reconstructed,data.products[0].description);
 console.log('NATIVE_ZOOM_ROWS='+rows.length+' FAILURES='+rows.filter(r=>r.issues.length||r.globalX>1||r.globalY>1).length+' BOOTSTRAP_CALLS='+bootstrapCalls);
 assert.ok(rows.every(r=>!r.issues.length&&r.globalX<=1&&r.globalY<=1),'native runtime or reader bounds');
}finally{
 await fs.mkdir('audit/pr98-final',{recursive:true});await fs.writeFile('audit/pr98-final/native-runtime.json',JSON.stringify({source:process.env.CANDIDATE_SHA||'working-tree-uncommitted',nativeZoomAPI:'chrome.tabs.setZoom',rows},null,2));await c.close();await fs.rm(profile,{recursive:true,force:true});
}
