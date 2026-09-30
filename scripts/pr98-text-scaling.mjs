import assert from'node:assert/strict';import{chromium}from'playwright';import fs from'node:fs/promises';import path from'node:path';import os from'node:os';import{bootstrap}from'./control-center-fixtures.mjs';
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'pr98-font-')),extension=path.resolve('scripts/native-zoom-extension');const c=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension],viewport:null});const w=c.serviceWorkers()[0]||await c.waitForEvent('serviceworker'),p=c.pages()[0],cdp=await c.newCDPSession(p),{windowId}=await cdp.send('Browser.getWindowForTarget');const rows=[];
await c.addInitScript(()=>localStorage.setItem('arbm_admin_session','test-session'));await p.route('**/api/admin/bootstrap',r=>r.fulfill({json:bootstrap}));
try{
 for(const [width,height]of[[1366,768],[360,800]])for(const minimum of[16,24,28]){
  await cdp.send('Browser.setWindowBounds',{windowId,bounds:{width,height}});
  await w.evaluate(async minimum=>{await chrome.fontSettings.setMinimumFontSize({pixelSize:minimum});return await chrome.fontSettings.getMinimumFontSize({})},minimum);
  await p.goto('http://127.0.0.1:4173');await p.getByRole('heading',{name:'ZEVANORY CONTROL CENTER',exact:true}).waitFor();await p.getByRole('button',{name:'Abrir evidência da Trust Chain'}).click();
  rows.push({width,height,minimum,settings:await w.evaluate(()=>chrome.fontSettings.getMinimumFontSize({})),issues:await p.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&(r.bottom>innerHeight+1||r.right>innerWidth+1||e.scrollHeight>e.clientHeight+2&&['hidden','clip','auto','scroll'].includes(s.overflowY))}).map(e=>e.tagName+'.'+e.className))});
 }
 console.log('TEXT_SCALING_CASES='+rows.length+' FAILURES='+rows.filter(r=>r.issues.length).length);
}finally{await fs.writeFile('audit/pr98-final/text-scaling.json',JSON.stringify({source:process.env.CANDIDATE_SHA||'working-tree-uncommitted',scope:'browser minimum font size; exploratory evidence, not ALL_STATES certificate',rows},null,2));await c.close();await fs.rm(profile,{recursive:true,force:true})}

assert.ok(rows.every(r=>!r.issues.length),"text scaling still clips or overflows; promotion blocked");
