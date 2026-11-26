// E2: owner-chat widget layout certification on the candidate preview (127.0.0.1:4173), fictitious data only.
// The chat iframe origin is fulfilled locally with a fixture page: no production dependency, no real PIN.
// E3: the button now sits in the top bar (first header action). Checks per viewport x theme: button inside viewport, topmost at its centre, not covering any pre-existing control;
// widget adds no page scroll; open panel inside viewport (full-screen inset on <=640px); close/reopen keeps the iframe.
// Built-in negative proofs show the detectors catch real overflow and real obstruction.
import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out='pin-regression/owner-chat-layout';fs.mkdirSync(out,{recursive:true});
const base='http://127.0.0.1:4173';
const fixture={dashboard:{systems:[],audits:[],improvements:[],incidents:[],policy:{zeroSpend:true,failClosed:true,destructiveActions:false,greenRule:'FALSE_GREEN=0'},lastEngineRun:'2026-09-30T00:00:00Z',certificationRuns:[]},globalTrust:{state:'BLOCKED',sha:null,evidenceRoot:null,policyVersion:'ZEA-10',quorum:{passed:0,total:3,required:3,conflicts:0,independentKeys:0},zea10:{proven:0,partial:0,blocked:10},engines:[],checkedAt:'2026-09-30T00:00:00Z'},operations:null,commercial:null,cfo:null,products:[],certificationTargets:[],summary:{total:0,salesEnabled:0,commercialReady:0,blocked:0,certified:0,inCertification:0,zeesBlocked:0}};
const fulfill=(r,status,body)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
const browser=await chromium.launch({args:['--disable-partial-raster']});
const checks={};const report=[];
const INTERACTIVE='button,a[href],input,select,textarea,[role="button"],[role="tab"],[tabindex]:not([tabindex="-1"])';

async function open(viewport,theme){
 const context=await browser.newContext({viewport});
 await context.addInitScript(({theme})=>{localStorage.setItem('zpc_theme',theme);localStorage.setItem('arbm_admin_session','fixture-session');},{theme});
 const page=await context.newPage();let frameLoads=0;
 await page.route('**/api/_auth_diagnostic',r=>fulfill(r,200,{secretValid:true,locked:false,sessionRoundtrip:true,bootstrapOk:true}));
 await page.route('**/global-trust.json*',r=>fulfill(r,200,fixture.globalTrust));
 await page.route('**/api/auth/turnstile-config',r=>fulfill(r,200,{enabled:false,sitekey:null,action:'zpc_owner_login'}));
 await page.route('**/api/admin/bootstrap',r=>fulfill(r,200,fixture));
 await context.route('https://zevanory.api.br/**',r=>{frameLoads++;return r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>fixture</title><p>chat fixture</p>'});});
 await page.goto(base);await page.locator('.zpcAppShell').waitFor();
 await page.addStyleTag({content:'*, *::before, *::after { animation: none !important; transition: none !important; }'});
 await page.evaluate(()=>document.fonts.ready);await page.waitForLoadState('networkidle');
 return {context,page,frameLoads:()=>frameLoads};
}
const rect=(page,sel)=>page.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return {x:r.x,y:r.y,w:r.width,h:r.height,display:cs.display,visibility:cs.visibility}},sel);
const scroll=page=>page.evaluate(()=>{const s=document.scrollingElement;return {sw:s.scrollWidth,sh:s.scrollHeight,iw:innerWidth,ih:innerHeight}});
const inside=(r,vp)=>r.x>=0&&r.y>=0&&r.x+r.w<=vp.width+0.5&&r.y+r.h<=vp.height+0.5;
// Controls under the FAB area that would be blocked: sample a 5x5 grid with the FAB hidden.
const obstruction=page=>page.evaluate(sel=>{const fab=document.querySelector('.ownerChatFab');const r=fab.getBoundingClientRect();const prev=fab.style.visibility;fab.style.visibility='hidden';const hits=new Set();
 for(let i=0;i<5;i++)for(let j=0;j<5;j++){const x=r.x+r.width*(i+0.5)/5,y=r.y+r.height*(j+0.5)/5;const el=document.elementFromPoint(x,y);const c=el&&el.closest(sel);if(c&&!c.closest('[data-owner-chat-widget]'))hits.add(c.tagName+'.'+String(c.className).slice(0,60));}
 fab.style.visibility=prev;return [...hits];},INTERACTIVE);
const fabOnTop=page=>page.evaluate(()=>{const f=document.querySelector('.ownerChatFab');const r=f.getBoundingClientRect();const el=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!el&&f.contains(el);});

const viewports=[{width:320,height:568},{width:375,height:812},{width:768,height:1024},{width:1024,height:768},{width:1365,height:900},{width:1920,height:1080}];
for(const viewport of viewports)for(const theme of ['dark','light']){
 const id=viewport.width+'x'+viewport.height+'-'+theme;const {context,page,frameLoads}=await open(viewport,theme);
 const fab=await rect(page,'.ownerChatFab');assert(fab,'FAB missing '+id);
 assert(inside(fab,viewport),'FAB outside viewport '+id);
 assert(fab.w>=44&&fab.h>=44,'FAB touch target below 44px '+id);
 assert(await fabOnTop(page),'FAB covered by another element '+id);
 const blocked=await obstruction(page);assert.deepEqual(blocked,[],'FAB obstructs pre-existing controls '+id+': '+blocked.join(', '));
 const sClosed=await scroll(page);
 await page.screenshot({path:`${out}/${id}-closed.png`});
 // Widget adds no page scroll: identical scroll extents with and without it.
 const sWithout=await page.evaluate(()=>{const n=[...document.querySelectorAll('[data-owner-chat-widget]')];n.forEach(e=>e.style.display='none');const s=document.scrollingElement;const v={sw:s.scrollWidth,sh:s.scrollHeight,iw:innerWidth,ih:innerHeight};n.forEach(e=>e.style.display='');return v;});
 assert.deepEqual(sClosed,sWithout,'widget changed page scroll extents '+id);
 // Open.
 await page.locator('.ownerChatFab').click();await page.locator('.ownerChatPanel.isOpen').waitFor();
 await page.locator('.ownerChatFrame').evaluate(f=>{window.__ownerChatFrame=f;});
 const panel=await rect(page,'.ownerChatPanel');assert(inside(panel,viewport),'open panel outside viewport '+id+' '+JSON.stringify(panel));
 const mobile=viewport.width<=640;
 if(mobile){assert(Math.abs(panel.x)<0.5&&Math.abs(panel.y)<0.5&&Math.abs(panel.w-viewport.width)<0.5&&Math.abs(panel.h-viewport.height)<0.5,'mobile panel must fill the viewport exactly '+id+' '+JSON.stringify(panel));
  assert.equal((await rect(page,'.ownerChatFab')).visibility,'hidden','mobile FAB must hide (covered) while open '+id);}
 else{const f=await rect(page,'.ownerChatFab');const ix=Math.min(panel.x+panel.w,f.x+f.w)-Math.max(panel.x,f.x),iy=Math.min(panel.y+panel.h,f.y+f.h)-Math.max(panel.y,f.y);assert(!(ix>0&&iy>0),'desktop panel must not overlap the chat button '+id);}
 const close=await rect(page,'.ownerChatClose');assert(close&&inside(close,viewport)&&close.w>=(mobile?44:36),'close button reachable '+id);
 assert.deepEqual(await scroll(page),sClosed,'open panel changed page scroll extents '+id);
 await page.screenshot({path:`${out}/${id}-open.png`});
 // Close and reopen keep the same iframe (no reload, conversation preserved).
 await page.locator('.ownerChatClose').click();assert.equal((await rect(page,'.ownerChatPanel')).display,'none','panel must close '+id);
 await page.locator('.ownerChatFab').click();await page.locator('.ownerChatPanel.isOpen').waitFor();
 assert(await page.locator('.ownerChatFrame').evaluate(f=>f===window.__ownerChatFrame),'iframe must persist across close/reopen '+id);
 assert.equal(frameLoads(),1,'iframe must load once '+id);
 report.push({id,fab,panel,scroll:sClosed,blocked});checks['owner_chat_layout_'+id]=true;await context.close();
}
// Negative proofs: the detectors must fail on real defects.
{
 const viewport={width:375,height:812};const {context,page}=await open(viewport,'dark');
 await page.locator('.ownerChatFab').click();await page.locator('.ownerChatPanel.isOpen').waitFor();
 await page.addStyleTag({content:'.ownerChatPanel.isOpen{width:calc(100% + 40px)!important;right:auto!important}'});
 assert.equal(inside(await rect(page,'.ownerChatPanel'),viewport),false,'negative: overflowing panel must be detected');
 checks.negative_overflow_detected=true;await context.close();
}
{
 const viewport={width:1365,height:900};const {context,page}=await open(viewport,'dark');
 const target=await page.evaluate(sel=>{const c=[...document.querySelectorAll(sel)].filter(e=>!e.closest('[data-owner-chat-widget]')).map(e=>e.getBoundingClientRect()).find(r=>r.width>=16&&r.height>=16&&r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight);return c?{x:c.x+c.width/2,y:c.y+c.height/2}:null},INTERACTIVE);
 assert(target,'negative: need a visible control');
 await page.addStyleTag({content:`.zpcAppShell .zpcHeaderActions>.ownerChatFab{position:fixed!important;z-index:9999!important;right:auto!important;bottom:auto!important;left:${target.x-22}px!important;top:${target.y-22}px!important}`});
 assert.notDeepEqual(await obstruction(page),[],'negative: FAB over a control must be detected');
 checks.negative_obstruction_detected=true;await context.close();
}
fs.writeFileSync(out+'/report.json',JSON.stringify({status:'PASS',checks,report},null,2));
console.log('OWNER_CHAT_LAYOUT=PASS '+JSON.stringify(checks));await browser.close();
