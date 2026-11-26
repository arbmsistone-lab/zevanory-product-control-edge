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
 const images=[],geometries=[],widgets=[];for(const port of [4174,4173]){
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
  // E2/CA-07: the owner-chat FAB is the ONLY intentional addition to the authenticated shell.
  // The candidate must render exactly one node tagged data-owner-chat-widget, and it must be the closed FAB
  // (so the tag cannot be used to hide any other element). It is measured, captured and archived, then removed
  // before the unchanged comparison below: every pre-existing node keeps exact geometry parity and raster delta <=1.
  const widget=await page.evaluate(()=>[...document.querySelectorAll('[data-owner-chat-widget]')].map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,cls:String(e.className),x:r.x,y:r.y,w:r.width,h:r.height,descendants:e.querySelectorAll('*').length}}));
  if(port===4173){
   assert.equal(widget.length,1,'candidate must render exactly one owner-chat node while closed '+viewport.width+theme);
   assert.equal(widget[0].tag+'.'+widget[0].cls,'BUTTON.ownerChatFab','only the closed FAB may carry data-owner-chat-widget');
   assert(widget[0].x>=0&&widget[0].y>=0&&widget[0].x+widget[0].w<=viewport.width&&widget[0].y+widget[0].h<=viewport.height,'owner-chat FAB must stay inside the viewport');
   await page.screenshot({path:out+'/owner-chat-fab-'+viewport.width+'-'+theme+'.png',animations:'disabled'});
  } else assert.equal(widget.length,0,'baseline (main) must not contain the owner-chat widget');
  widgets.push(widget);
  await page.evaluate(()=>document.querySelectorAll('[data-owner-chat-widget]').forEach(e=>e.remove()));
  geometries.push(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,cls:String(e.className),x:r.x,y:r.y,w:r.width,h:r.height}})));
  if(port===4173&&viewport.width===1365&&theme==='dark'){
   // CA-07 negative proof: after the normalization, a 4px change in a pre-existing element is still detected.
   const mutated=await page.evaluate(()=>{const x=document.querySelector('.adminChip');x.style.marginLeft='4px';return [...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,cls:String(e.className),x:r.x,y:r.y,w:r.width,h:r.height}})});
   assert.notDeepEqual(mutated,geometries[0],'negative proof: pre-existing change must be detected');
   await page.evaluate(()=>{document.querySelector('.adminChip').style.marginLeft='';});
   checks.ca07_negative_preexisting_change_detected=true;
  }
  const image=await page.screenshot({animations:'disabled'});images.push(image);await context.close();
 }
 const diff=[];const n=Math.max(geometries[0].length,geometries[1].length);for(let i=0;i<n;i++)if(JSON.stringify(geometries[0][i])!==JSON.stringify(geometries[1][i]))diff.push({i,baseline:geometries[0][i]??null,candidate:geometries[1][i]??null});
 fs.writeFileSync(out+'/owner-chat-geometry-diff-'+viewport.width+'-'+theme+'.json',JSON.stringify({viewport,theme,baseline_nodes:geometries[0].length,candidate_nodes_without_widget:geometries[1].length,widget_nodes_removed:widgets[1],preexisting_differences:diff.length,differences:diff.slice(0,50)},null,2));
 assert.deepEqual(geometries[0],geometries[1],'authenticated layout changed '+viewport.width+theme);
 const a=PNG.sync.read(images[0]),b=PNG.sync.read(images[1]);let maxChannelDelta=0;for(let i=0;i<a.data.length;i++)maxChannelDelta=Math.max(maxChannelDelta,Math.abs(a.data[i]-b.data[i]));
 assert(maxChannelDelta<=1,'authenticated raster changed');
 checks['authenticated_visual_'+viewport.width+'_'+theme]=true;
}
// E3b/CA-07: comparação TAMBÉM com o botão do chat presente (sem retirá-lo), em 5 larguras x 2 temas.
// Regras: nenhum elemento preexistente some ou aparece; só pode mudar geometria quem está dentro das ações do
// cabeçalho (.zpcHeaderActions), e lá cada controle continua visível, inteiro na tela, >=24px, sem texto cortado e
// sem encostar no botão do chat; o botão não cobre nenhum controle; fora da barra superior, raster idêntico (delta<=1).
const CTRL='a[href],button,input,select,textarea,summary,[role="button"],[role="tab"]';
async function snapWithButton(page){return page.evaluate((CTRL)=>{const nodes=[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,cls:String(e.className),x:r.x,y:r.y,w:r.width,h:r.height,widget:!!e.closest('[data-owner-chat-widget]'),header:!!e.closest('.zpcHeaderActions'),control:e.matches(CTRL),clipped:e.matches(CTRL)&&e.scrollWidth>e.clientWidth+1}});
 const top=document.querySelector('.zpcAppShell>.topbar');const t=top?top.getBoundingClientRect():null;
 // Área VISUAL das ações do cabeçalho (caixa + contorno de foco), que pode passar um pouco da caixa da barra superior.
 const headerVisual=[...document.querySelectorAll('.zpcHeaderActions, .zpcHeaderActions *')].map(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);const o=cs.outlineStyle!=='none'?(parseFloat(cs.outlineWidth)||0)+Math.max(0,parseFloat(cs.outlineOffset)||0):0;return {x:r.x-o,y:r.y-o,w:r.width+2*o,h:r.height+2*o};}).filter(b=>b.w>0&&b.h>0);
 return {nodes,topbar:t&&{x:t.x,y:t.y,w:t.width,h:t.height},headerVisual,vw:innerWidth,vh:innerHeight};},CTRL);}
const inter=(a,b)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>0.5&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>0.5;
function withButtonViolations(base,cand){
 const v=[];const pre=cand.nodes.filter(n=>!n.widget);const btn=cand.nodes.find(n=>n.widget&&n.tag==='BUTTON');
 if(!btn)v.push('chat button missing');
 if(pre.length!==base.nodes.length)v.push('pre-existing element count changed '+base.nodes.length+'->'+pre.length);
 const n=Math.min(pre.length,base.nodes.length);
 for(let i=0;i<n;i++){const a=base.nodes[i],b=pre[i];
  if(a.tag!==b.tag||a.cls!==b.cls){v.push('element sequence changed at '+i+': '+a.tag+'.'+a.cls+' -> '+b.tag+'.'+b.cls);break;}
  const moved=Math.abs(a.x-b.x)>0.5||Math.abs(a.y-b.y)>0.5||Math.abs(a.w-b.w)>0.5||Math.abs(a.h-b.h)>0.5;
  if(moved&&!b.header)v.push('moved outside header actions: '+b.tag+'.'+b.cls.slice(0,60)+' '+JSON.stringify({from:[a.x,a.y,a.w,a.h],to:[b.x,b.y,b.w,b.h]}));
  if(b.header&&b.control){
   if(b.x<-0.5||b.y<-0.5||b.x+b.w>cand.vw+0.5||b.y+b.h>cand.vh+0.5)v.push('header control outside viewport: '+b.cls.slice(0,40));
   if(b.w<24||b.h<24)v.push('header control below 24px: '+b.cls.slice(0,40)+' '+b.w+'x'+b.h);
   if(b.clipped&&!a.clipped)v.push('header control text clipped: '+b.cls.slice(0,40));
   if(btn&&inter(b,btn))v.push('chat button touches header control: '+b.cls.slice(0,40));
  }
 }
 if(btn){if(btn.x<-0.5||btn.y<-0.5||btn.x+btn.w>cand.vw+0.5||btn.y+btn.h>cand.vh+0.5)v.push('chat button outside viewport');
  for(const c of pre)if(c.control&&inter(c,btn))v.push('chat button covers control: '+c.tag+'.'+c.cls.slice(0,40));}
 if(JSON.stringify(base.topbar)!==JSON.stringify(cand.topbar))v.push('top bar box changed '+JSON.stringify([base.topbar,cand.topbar]));
 return [...new Set(v)];
}
function rasterOutside(imgA,imgB,boxes){const inBox=(x,y)=>boxes.some(b=>x>=b.x-1&&x<b.x+b.w+1&&y>=b.y-1&&y<b.y+b.h+1);const a=PNG.sync.read(imgA),b=PNG.sync.read(imgB);if(a.width!==b.width||a.height!==b.height)return {max:255,bbox:null,pixels:-1};let max=0,n=0,x0=1e9,y0=1e9,x1=-1,y1=-1;
 for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){if(inBox(x,y))continue;const i=(y*a.width+x)*4;let d=0;for(let k=0;k<4;k++)d=Math.max(d,Math.abs(a.data[i+k]-b.data[i+k]));if(d>1){n++;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}max=Math.max(max,d);}
 return {max,pixels:n,bbox:n?{x:x0,y:y0,w:x1-x0+1,h:y1-y0+1}:null};}
for(const viewport of [{width:1365,height:900},{width:1024,height:768},{width:768,height:1024},{width:375,height:812},{width:320,height:568}])for(const theme of ['dark','light']){
 const snaps=[],imgs=[];let negatives=null;
 for(const port of [4174,4173]){
  const {context,page}=await setup('http://127.0.0.1:'+port,true,viewport,theme);
  await page.route('**/api/admin/bootstrap',r=>fulfill(r,200,fixture));
  await page.goto('http://127.0.0.1:'+port);await page.locator('.zpcAppShell').waitFor();
  await page.evaluate(()=>{const x=document.querySelector('.adminChip');if(x){const t=Array.from(x.childNodes).find(n=>n.nodeType===Node.TEXT_NODE);if(t)t.textContent=' ACESSO ADMINISTRATIVO';}});
  await page.addStyleTag({content:'*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; caret-color: transparent !important; }'});
  await page.evaluate(()=>document.fonts.ready);await page.waitForLoadState('networkidle');
  snaps.push(await snapWithButton(page));imgs.push(await page.screenshot({animations:'disabled'}));
  if(port===4173){
   await page.screenshot({path:out+'/owner-chat-with-button-'+viewport.width+'-'+theme+'.png',animations:'disabled'});
   if(viewport.width===1365&&theme==='dark'){
    // Contraprovas: deslocar um elemento fora do cabeçalho e encostar o botão num controle precisam ser detectados.
    await page.addStyleTag({content:'.zpcWorkspace{margin-top:4px!important}'});const n1=withButtonViolations(snaps[0],await snapWithButton(page));
    await page.addStyleTag({content:'.zpcWorkspace{margin-top:0!important}.zpcAppShell .zpcHeaderActions>.ownerChatFab{position:relative;left:40px}'});const n2=withButtonViolations(snaps[0],await snapWithButton(page));
    negatives={workspaceShift:n1,buttonOverlap:n2};
   }
  }
  await context.close();
 }
 const violations=withButtonViolations(snaps[0],snaps[1]);const delta=rasterOutside(imgs[0],imgs[1],[snaps[0].topbar,snaps[1].topbar,...snaps[0].headerVisual,...snaps[1].headerVisual].filter(Boolean));
 fs.writeFileSync(out+'/owner-chat-with-button-'+viewport.width+'-'+theme+'.json',JSON.stringify({viewport,theme,baseline_nodes:snaps[0].nodes.length,candidate_nodes:snaps[1].nodes.length,topbar:snaps[1].topbar,moved_inside_header:snaps[1].nodes.filter(n=>!n.widget&&n.header).length,violations,raster_delta_outside_topbar:delta.max,raster_diff_pixels:delta.pixels,raster_diff_bbox:delta.bbox,negatives},null,2));
 assert.deepEqual(violations,[],'with chat button '+viewport.width+theme+': '+violations.join(' | '));
 if(delta.max>1){fs.writeFileSync(out+'/owner-chat-with-button-'+viewport.width+'-'+theme+'-BASE.png',imgs[0]);fs.writeFileSync(out+'/owner-chat-with-button-'+viewport.width+'-'+theme+'-CAND.png',imgs[1]);}
 assert(delta.max<=1,'raster outside the top bar changed with the chat button '+viewport.width+theme+' delta='+delta.max+' pixels='+delta.pixels+' bbox='+JSON.stringify(delta.bbox)+' topbar='+JSON.stringify(snaps[1].topbar));
 if(negatives){assert(negatives.workspaceShift.some(x=>x.startsWith('moved outside header actions')),'negative: workspace shift must be detected');assert(negatives.buttonOverlap.some(x=>/touches header control|covers control/.test(x)),'negative: button overlap must be detected');checks.ca07_with_button_negatives_detected=true;}
 checks['authenticated_with_chat_button_'+viewport.width+'_'+theme]=true;
}
fs.writeFileSync(out+'/regression.json',JSON.stringify({status:'PASS',checks},null,2));console.log(JSON.stringify(checks));await browser.close();
