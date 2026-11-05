import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
const out='pin-regression';fs.mkdirSync(out,{recursive:true});
const fixture={dashboard:{systems:[],audits:[],improvements:[],incidents:[],policy:{zeroSpend:true,failClosed:true,destructiveActions:false,greenRule:'FALSE_GREEN=0'},lastEngineRun:'2026-09-30T00:00:00Z',certificationRuns:[]},globalTrust:{state:'BLOCKED',sha:null,evidenceRoot:null,policyVersion:'ZEA-10',quorum:{passed:0,total:3,required:3,conflicts:0,independentKeys:0},zea10:{proven:0,partial:0,blocked:10},engines:[],checkedAt:'2026-09-30T00:00:00Z'},operations:null,commercial:null,cfo:null,products:[],certificationTargets:[],summary:{total:0,salesEnabled:0,commercialReady:0,blocked:0,certified:0,inCertification:0,zeesBlocked:0}};
// Partial raster re-rasterizes only invalidated tiles after the injected normalization/freeze styles,
// which produced non-deterministic anti-aliasing at tile edges (e.g. the .ccFresh status dot and the
// active .ccTabs pill, 7-15 px with channel delta up to 14). Full-tile raster is deterministic and is
// applied to BOTH previews; the raster tolerance below stays exactly <=1.
const browser=await chromium.launch({args:['--disable-partial-raster']});const checks={};
const fulfill=(r,status,body)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
async function setup(base,cached=false,viewport={width:1365,height:900},theme='dark'){
 const context=await browser.newContext({viewport});await context.addInitScript(({cached,theme})=>{localStorage.setItem('zpc_theme',theme);if(cached&&!localStorage.getItem('arbm_admin_session'))localStorage.setItem('arbm_admin_session','old-test-session');},{cached,theme});
 const page=await context.newPage();await page.route('**/api/_auth_diagnostic',r=>fulfill(r,200,{secretValid:true,locked:false,sessionRoundtrip:true,bootstrapOk:true}));await page.route('**/global-trust.json*',r=>fulfill(r,200,fixture.globalTrust));
  // R111: existing password regressions run with Turnstile deliberately inactive.
  await page.route('**/api/auth/turnstile-config',r=>fulfill(r,200,{enabled:false,sitekey:null,action:'zpc_owner_login'}));return {context,page,base};
}
// Causal reproduction on the actual pre-hotfix domain. The 42s wait is explicitly injected,
// not represented as an observed provider outage.
if(process.env.REPRODUCE_BASELINE==='true'){
 const {context,page}=await setup('https://controle.zevanory.api.br/',true);await page.route('**/api/commercial/funnel',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,summary:null,readiness:{status:'AGUARDAR',headline:'Ainda não é hora de pagar anúncios.',nextMilestone:'Vendas abertas em produção: vendas ainda fechadas (modo teste).',criteria:[{id:'sales-open',label:'Vendas abertas em produção',ok:false,detail:''}],metrics:{visitors:0,paid:0,conversion:0,conversionLow:0,aov:0,refundRate:0,maxCpa:0,maxCpc:0,breakEvenRoas:0},plan:null}})}));
    await page.route(/\/api\/sales\/(state|switch)$/,r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,requested:false,open:false,switchedAt:null,preflightFresh:true,preflight:{ok:false,at:'2026-09-26T16:00:00.000Z',checks:[{id:'mercadopago_production_token',ok:false,detail:'credencial de teste'}]}})}));
    await page.route('**/api/admin/bootstrap',async r=>{await new Promise(resolve=>setTimeout(resolve,42000));await fulfill(r,401,{error:'controlled expired session'});});
 const t=Date.now();await page.goto('https://controle.zevanory.api.br/',{waitUntil:'domcontentloaded'});assert.equal(await page.getByLabel('PIN de 4 números').count(),0);await page.getByLabel('PIN de 4 números').waitFor({timeout:60000});const ms=Date.now()-t;assert(ms>=42000);checks.baseline_causal_reproduction={ms,mode:'real-domain with controlled 42s bootstrap response delay',protected_ui_before_auth:false};fs.writeFileSync(out+'/baseline-causal-reproduction.json',JSON.stringify(checks.baseline_causal_reproduction,null,2));await context.close();
}
const base='http://127.0.0.1:4173';
{
 const {context,page}=await setup(base,true);let diagnosticCalls=0;page.on('request',r=>{if(r.url().includes('_auth_diagnostic'))diagnosticCalls++;});let pending;const request=new Promise(resolve=>pending=resolve);await page.route('**/api/admin/bootstrap',async r=>{pending(r);await new Promise(()=>{});});
 const t=Date.now();await page.goto(base,{waitUntil:'domcontentloaded'});await request;const pin=page.getByLabel('Frase-senha administrativa (12 caracteres ou mais)');await pin.waitFor({timeout:3000});await pin.fill('senha curta');assert.equal(await pin.inputValue(),'senha curta');assert.equal(await page.locator('.zpcAppShell').count(),0);assert(Date.now()-t<3000);assert.equal(diagnosticCalls,0);checks.no_duplicate_diagnostic_bootstrap=true;checks.pin_independent_of_hung_bootstrap=true;await page.screenshot({path:out+'/pending-bootstrap.png'});await context.close();
}
{
 const {context,page}=await setup(base);let loginCalls=0;await page.route('**/api/pin/login',r=>{loginCalls++;return fulfill(r,401,{error:'Credencial incorreta.'});});
 await page.goto(base);const pin=page.getByLabel('Frase-senha administrativa (12 caracteres ou mais)');await pin.fill('1234');await pin.press('Enter');assert.equal(loginCalls,0);await pin.fill('frase-senha-forte-de-teste-2026');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.getByText('Credencial incorreta.',{exact:true}).waitFor();assert.equal(await page.locator('.zpcAppShell').count(),0);checks.pin_validation_and_denial=true;await context.close();
}
{
 const {context,page}=await setup(base,true);let releaseOld;const oldReleased=new Promise(resolve=>releaseOld=resolve);let oldStarted;const oldRequest=new Promise(resolve=>oldStarted=resolve);
 await page.route('**/api/admin/bootstrap',async r=>{const body=r.request().postDataJSON();if(body.sessionToken==='old-test-session'){oldStarted();await oldReleased;try{await fulfill(r,401,{error:'expired'});}catch{}}else await fulfill(r,200,fixture);});
 await page.route('**/api/pin/login',r=>fulfill(r,200,{sessionToken:'new-test-session'}));await page.route('**/api/pin/logout',r=>fulfill(r,200,{ok:true}));
 await page.goto(base,{waitUntil:'domcontentloaded'});await oldRequest;await page.getByLabel('Frase-senha administrativa (12 caracteres ou mais)').fill('frase-senha-forte-de-teste-2026');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator('.zpcAppShell').waitFor();releaseOld();await page.waitForLoadState('networkidle');assert.equal(await page.evaluate(()=>localStorage.getItem('arbm_admin_session')),'new-test-session');assert.equal(await page.locator('.zpcAppShell').count(),1);checks.stale_response_cannot_revoke_new_session=true;
 await page.reload();await page.locator('.zpcAppShell').waitFor();checks.valid_session_reload=true;await page.getByRole('button',{name:'Sair',exact:true}).click();await page.getByLabel('Frase-senha administrativa (12 caracteres ou mais)').waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('arbm_admin_session')),null);checks.logout=true;await context.close();
}
{
  // R111: enabled-UI mock verifies a missing token disables login, and one accepted token is consumed.
  const {context,page}=await setup(base);
  await page.unroute('**/api/auth/turnstile-config');
  await page.route('**/api/auth/turnstile-config',r=>fulfill(r,200,{enabled:true,sitekey:'1x00000000000000000000AA',action:'zpc_owner_login'}));
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',r=>r.fulfill({
    status:200,contentType:'application/javascript',
    body:'window.turnstile={render:(el,opts)=>{window.__r111TurnstileCallback=opts.callback;return "test-widget"},reset:()=>{},remove:()=>{}}'
  }));
  let supplied='';
  await page.route('**/api/pin/login',async r=>{supplied=r.request().postDataJSON()?.turnstileToken || '';await fulfill(r,401,{error:'Credencial incorreta.'});});
  await page.goto(base);
  await page.getByLabel('Frase-senha administrativa (12 caracteres ou mais)').fill('frase-senha-forte-de-teste-2026');
  const submit=page.getByRole('button',{name:'Entrar',exact:true});
  await page.waitForFunction(()=>typeof window.__r111TurnstileCallback === 'function');
  assert.equal(await submit.isDisabled(),true,'enabled Turnstile cannot submit without token');
  await page.evaluate(()=>window.__r111TurnstileCallback('fake-token-for-test'));
  await submit.click();
  await page.getByText('Credencial incorreta.',{exact:true}).waitFor();
  assert.equal(supplied,'fake-token-for-test');
  assert.equal(await submit.isDisabled(),true,'token must reset after attempted use');
  checks.r111_enabled_challenge_ui_token_single_attempt=true;
  await context.close();
}
{
  // R112: a failed config lookup must NOT lock the owner out when Turnstile isn't enforced.
  // The Worker remains authoritative for a later enabled=true environment.
  const {context,page}=await setup(base);
  await page.unroute('**/api/auth/turnstile-config');
  await page.route('**/api/auth/turnstile-config',r=>fulfill(r,503,{error:'simulated-config-down'}));
  let loginCalls=0,token=null;
  await page.route('**/api/pin/login',r=>{loginCalls++;token=r.request().postDataJSON()?.turnstileToken;return fulfill(r,200,{sessionToken:'r112-owner-success-session'});});
  await page.route('**/api/admin/bootstrap',r=>fulfill(r,200,fixture));
  await page.goto(base);
  await page.getByLabel('Frase-senha administrativa (12 caracteres ou mais)').fill('frase-senha-forte-de-teste-2026');
  const submit=page.getByRole('button',{name:'Entrar',exact:true});
  await page.getByText('O servidor verificará sua tentativa.',{exact:false}).waitFor();
  assert.equal(await submit.isEnabled(),true,'R112 config failure must not disable login');
  await submit.click();
  await page.locator('.zpcAppShell').waitFor({timeout:15000});
  assert.equal(await page.evaluate(()=>localStorage.getItem('arbm_admin_session')),'r112-owner-success-session');
  assert.equal(loginCalls,1,'R112 owner login succeeds when config endpoint is down and server allows it');
  assert.ok(!token,'R112 no token is allowed by client only; Worker is authority');
  checks.r112_config_unavailable_owner_login_possible=true;
  await context.close();
}
{
  // /control prefix is the same normalized API entrypoint as the existing login.
  const {context,page}=await setup('http://127.0.0.1:4173/control');
  await page.unroute('**/api/auth/turnstile-config');
  let seenConfig=false;
  await page.route('**/control/api/auth/turnstile-config',r=>{seenConfig=true;return fulfill(r,200,{enabled:false,sitekey:null,action:'zpc_owner_login'});});
  await page.goto('http://127.0.0.1:4173/control');
  await page.getByLabel('Frase-senha administrativa (12 caracteres ou mais)').waitFor();
  // Candidate may redirect legacy /control; only assert API router directly if path remains /control.
  if(new URL(page.url()).pathname.startsWith('/control')) {
    await page.waitForFunction(()=>document.querySelector('.loginCard .primary') !== null);
    assert.equal(seenConfig,true,'R112 config must use /control prefix');
  }
  checks.r112_config_uses_api_prefix=true;
  await context.close();
}
// Intentional PIN-screen change: no public diagnostic. Authenticated UI retains visual-parity coverage.
for(const viewport of [{width:1365,height:900},{width:375,height:812}])for(const theme of ['dark','light']){
 const {context,page}=await setup('http://127.0.0.1:4173',false,viewport,theme);
 await page.goto('http://127.0.0.1:4173');
 await page.getByLabel('Frase-senha administrativa (12 caracteres ou mais)').waitFor();
 assert.equal(await page.locator('.authDiagnostic').count(),0,'internal diagnostic must not render');
 assert.equal(await page.getByText(/PIN:OK|LOCK:|SESSÃO:|BOOT:|ETAPA:/).count(),0,'no diagnostic status before login');
 assert(await page.getByText('Controle de produtos, governança e certificação.',{exact:false}).isVisible());
 checks['pin_public_safe_'+viewport.width+'_'+theme]=true;
 await context.close();
}
for(const viewport of [{width:1365,height:900},{width:375,height:812}])for(const theme of ['dark','light']){
 const images=[],geometries=[];for(const port of [4174,4173]){
  const {context,page}=await setup('http://127.0.0.1:'+port,true,viewport,theme);
  await page.route('**/api/admin/bootstrap',r=>fulfill(r,200,fixture));
  await page.goto('http://127.0.0.1:'+port);await page.locator('.zpcAppShell').waitFor();
  if(port===4173) assert(await page.getByText('ACESSO ADMINISTRATIVO ATIVO',{exact:false}).count()>0,'candidate administrative label must be correct');
  // Normalize ONLY the intentionally renamed authenticated chip for structural/raster regression;
  // every other pixel and geometry must remain identical to baseline.
  await page.evaluate(()=>{const x=document.querySelector('.adminChip');if(x){const t=Array.from(x.childNodes).find(n=>n.nodeType===Node.TEXT_NODE);if(t)t.textContent=' ACESSO ADMINISTRATIVO';}});

  // Freeze CSS transitions and animations in BOTH previews before measuring geometry.
  // Keep the exact raster tolerance; do not hide genuine layout differences.
  await page.addStyleTag({content:'*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; caret-color: transparent !important; }'});
  await page.evaluate(()=>document.fonts.ready);await page.waitForLoadState('networkidle');
  geometries.push(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,cls:String(e.className),x:r.x,y:r.y,w:r.width,h:r.height}})));
  const image=await page.screenshot({animations:'disabled'});images.push(image);await context.close();
 }
 assert.deepEqual(geometries[0],geometries[1],'authenticated layout changed '+viewport.width+theme);
 const a=PNG.sync.read(images[0]),b=PNG.sync.read(images[1]);let maxChannelDelta=0;for(let i=0;i<a.data.length;i++)maxChannelDelta=Math.max(maxChannelDelta,Math.abs(a.data[i]-b.data[i]));
 assert(maxChannelDelta<=1,'authenticated raster changed');
 checks['authenticated_visual_'+viewport.width+'_'+theme]=true;
}
fs.writeFileSync(out+'/regression.json',JSON.stringify({status:'PASS',checks},null,2));console.log(JSON.stringify(checks));await browser.close();
