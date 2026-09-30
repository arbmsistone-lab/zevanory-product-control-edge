import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const out='pin-regression';fs.mkdirSync(out,{recursive:true});
const fixture={dashboard:{systems:[],audits:[],improvements:[],incidents:[],policy:{zeroSpend:true,failClosed:true,destructiveActions:false,greenRule:'FALSE_GREEN=0'},lastEngineRun:'2026-09-30T00:00:00Z',certificationRuns:[]},globalTrust:{state:'BLOCKED',sha:null,evidenceRoot:null,policyVersion:'ZEA-10',quorum:{passed:0,total:3,required:3,conflicts:0,independentKeys:0},zea10:{proven:0,partial:0,blocked:10},engines:[],checkedAt:'2026-09-30T00:00:00Z'},operations:null,commercial:null,cfo:null,products:[],certificationTargets:[],summary:{total:0,salesEnabled:0,commercialReady:0,blocked:0,certified:0,inCertification:0,zeesBlocked:0}};
const browser=await chromium.launch();const checks={};
const fulfill=(r,status,body)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
async function setup(base,cached=false,viewport={width:1365,height:900},theme='dark'){
 const context=await browser.newContext({viewport});await context.addInitScript(({cached,theme})=>{localStorage.setItem('zpc_theme',theme);if(cached&&!localStorage.getItem('arbm_admin_session'))localStorage.setItem('arbm_admin_session','old-test-session');},{cached,theme});
 const page=await context.newPage();await page.route('**/api/_auth_diagnostic',r=>fulfill(r,200,{secretValid:true,locked:false,sessionRoundtrip:true,bootstrapOk:true}));await page.route('**/global-trust.json*',r=>fulfill(r,200,fixture.globalTrust));return {context,page,base};
}
// Causal reproduction on the actual pre-hotfix domain. The 42s wait is explicitly injected,
// not represented as an observed provider outage.
if(process.env.REPRODUCE_BASELINE==='true'){
 const {context,page}=await setup('https://controle.zevanory.api.br/',true);await page.route('**/api/admin/bootstrap',async r=>{await new Promise(resolve=>setTimeout(resolve,42000));await fulfill(r,401,{error:'controlled expired session'});});
 const t=Date.now();await page.goto('https://controle.zevanory.api.br/',{waitUntil:'domcontentloaded'});assert.equal(await page.getByLabel('PIN de 4 numeros').count(),0);await page.getByLabel('PIN de 4 numeros').waitFor({timeout:60000});const ms=Date.now()-t;assert(ms>=42000);checks.baseline_causal_reproduction={ms,mode:'real-domain with controlled 42s bootstrap response delay',protected_ui_before_auth:false};fs.writeFileSync(out+'/baseline-causal-reproduction.json',JSON.stringify(checks.baseline_causal_reproduction,null,2));await context.close();
}
const base='http://127.0.0.1:4173';
{
 const {context,page}=await setup(base,true);let diagnosticCalls=0;page.on('request',r=>{if(r.url().includes('_auth_diagnostic'))diagnosticCalls++;});let pending;const request=new Promise(resolve=>pending=resolve);await page.route('**/api/admin/bootstrap',async r=>{pending(r);await new Promise(()=>{});});
 const t=Date.now();await page.goto(base,{waitUntil:'domcontentloaded'});await request;const pin=page.getByLabel('PIN de 4 numeros');await pin.waitFor({timeout:3000});await pin.fill('a123');assert.equal(await pin.inputValue(),'123');assert.equal(await page.locator('.zpcAppShell').count(),0);assert(Date.now()-t<3000);assert.equal(diagnosticCalls,0);checks.no_duplicate_diagnostic_bootstrap=true;checks.pin_independent_of_hung_bootstrap=true;await page.screenshot({path:out+'/pending-bootstrap.png'});await context.close();
}
{
 const {context,page}=await setup(base);let loginCalls=0;await page.route('**/api/pin/login',r=>{loginCalls++;return fulfill(r,401,{error:'PIN incorreto.'});});
 await page.goto(base);const pin=page.getByLabel('PIN de 4 numeros');await pin.fill('123');await pin.press('Enter');assert.equal(loginCalls,0);await pin.fill('1234');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.getByText('PIN incorreto.',{exact:true}).waitFor();assert.equal(await page.locator('.zpcAppShell').count(),0);checks.pin_validation_and_denial=true;await context.close();
}
{
 const {context,page}=await setup(base,true);let releaseOld;const oldReleased=new Promise(resolve=>releaseOld=resolve);let oldStarted;const oldRequest=new Promise(resolve=>oldStarted=resolve);
 await page.route('**/api/admin/bootstrap',async r=>{const body=r.request().postDataJSON();if(body.sessionToken==='old-test-session'){oldStarted();await oldReleased;try{await fulfill(r,401,{error:'expired'});}catch{}}else await fulfill(r,200,fixture);});
 await page.route('**/api/pin/login',r=>fulfill(r,200,{sessionToken:'new-test-session'}));await page.route('**/api/pin/logout',r=>fulfill(r,200,{ok:true}));
 await page.goto(base,{waitUntil:'domcontentloaded'});await oldRequest;await page.getByLabel('PIN de 4 numeros').fill('1234');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator('.zpcAppShell').waitFor();releaseOld();await page.waitForLoadState('networkidle');assert.equal(await page.evaluate(()=>localStorage.getItem('arbm_admin_session')),'new-test-session');assert.equal(await page.locator('.zpcAppShell').count(),1);checks.stale_response_cannot_revoke_new_session=true;
 await page.reload();await page.locator('.zpcAppShell').waitFor();checks.valid_session_reload=true;await page.getByRole('button',{name:'Sair',exact:true}).click();await page.getByLabel('PIN de 4 numeros').waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('arbm_admin_session')),null);checks.logout=true;await context.close();
}
// Same fixture, viewport, theme and diagnostics on baseline and candidate. CSS is unchanged.
for(const viewport of [{width:1365,height:900},{width:375,height:812}])for(const theme of ['dark','light'])for(const state of ['pin','authenticated']){
 const images=[];for(const port of [4174,4173]){const {context,page}=await setup('http://127.0.0.1:'+port,state==='authenticated',viewport,theme);await page.route('**/api/admin/bootstrap',r=>fulfill(r,200,fixture));await page.goto('http://127.0.0.1:'+port);await page.locator(state==='pin'?'.authDiagnostic':'.zpcAppShell').waitFor();if(state==='pin')await page.getByText(/PIN:OK/).waitFor();await page.evaluate(()=>document.fonts.ready);const image=await page.screenshot({animations:'disabled'});images.push(image);fs.writeFileSync(out+'/'+port+'-'+state+'-'+viewport.width+'-'+theme+'.png',image);await context.close();}assert.equal(crypto.createHash('sha256').update(images[0]).digest('hex'),crypto.createHash('sha256').update(images[1]).digest('hex'),'layout pixel mismatch '+state+viewport.width+theme);
}
checks.layout_pixels_identical_8_pairs=true;fs.writeFileSync(out+'/regression.json',JSON.stringify({status:'PASS',checks},null,2));console.log(JSON.stringify(checks));await browser.close();
