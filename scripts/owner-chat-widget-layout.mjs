// E2: owner-chat widget layout certification on the candidate preview (127.0.0.1:4173), fictitious data only.
// The chat iframe origin is fulfilled locally with a fixture page: no production dependency, no real PIN.
// 27/11: Epaminondas FIXO na coluna esquerda (logo abaixo de "Sistema"); até 900px, numa faixa própria no fim da grade.
// Fora do endereço oficial (esta prévia em 127.0.0.1) o espaço do chat mostra só um aviso; o iframe real é provado no
// E3-D (scripts/e3/owner-chat-dock-e3.mjs). Aqui, por viewport x tema: chat inteiro na tela, abaixo de "Sistema" e dentro
// da coluna (acima de 900px), sem cobrir nenhum controle preexistente, página sem rolagem; menu completo visível.
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
const rect=(page,sel)=>page.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};},sel);
const scroll=page=>page.evaluate(()=>{const s=document.scrollingElement;return {sw:s.scrollWidth,sh:s.scrollHeight,iw:innerWidth,ih:innerHeight}});
const inside=(r,vp)=>r.x>=-0.5&&r.y>=-0.5&&r.x+r.w<=vp.width+0.5&&r.y+r.h<=vp.height+0.5;
// Controles preexistentes que o chat cobriria: grade 7x7 sobre a área do chat, com o chat escondido.
const obstruction=page=>page.evaluate(sel=>{const d=document.querySelector('.ownerChatDock');const r=d.getBoundingClientRect();const prev=d.style.visibility;d.style.visibility='hidden';const hits=new Set();
 for(let i=0;i<7;i++)for(let j=0;j<7;j++){const x=r.x+r.width*(i+0.5)/7,y=r.y+r.height*(j+0.5)/7;const el=document.elementFromPoint(x,y);const c=el&&el.closest(sel);if(c&&!c.closest('[data-owner-chat-widget]')&&c.getBoundingClientRect().width>0)hits.add(c.tagName+'.'+String(c.className).slice(0,40));}
 d.style.visibility=prev;return [...hits];},INTERACTIVE);
const MENU=['Visão Geral','Produtos','Comercial','Conteúdo','Atendimento','Financeiro','Evidências','Sistema'];
const viewports=[{width:320,height:568},{width:375,height:812},{width:768,height:1024},{width:1024,height:768},{width:1365,height:900},{width:1920,height:1080}];
for(const viewport of viewports)for(const theme of ['dark','light']){
 const id=viewport.width+'x'+viewport.height+'-'+theme;const {context,page}=await open(viewport,theme);
 if(viewport.width<=900){
  // Até 900px: fora da vista por padrão (nada encolhe); a 1ª opção do seletor abre o chat na área de trabalho.
  const hidden=await page.locator('.ownerChatDock').evaluate(e=>{const r=e.getBoundingClientRect();return r.width<=2||r.height<=2||getComputedStyle(e.closest('.zpcNavigation')).opacity==='0';});
  assert(hidden,'chat out of view by default on narrow screens '+id);
  assert.equal(await page.locator('.areaSelectWrap select option').first().getAttribute('value'),'owner-chat','chat is the first area '+id);
  await page.locator('.areaSelectWrap select').selectOption('owner-chat');
  assert.equal(await page.locator('.zpcAppShell>main.shell').count()>0?await page.locator('.zpcAppShell>main.shell').isVisible():false,false,'workspace hidden while the chat area is open '+id);
 }
 const dock=await rect(page,'.ownerChatDock');assert(dock,'chat missing '+id);
 assert(inside(dock,viewport),'chat outside viewport '+id+' '+JSON.stringify(dock));
 assert(dock.h>=150&&dock.w>=150,'chat too small '+id+' '+JSON.stringify(dock));
 assert.equal(await page.locator('.ownerChatFab, .ownerChatClose, .ownerChatPanel').count(),0,'no open/close button nor floating panel '+id);
 const s=await scroll(page);assert(s.sh<=s.ih+1&&s.sw<=s.iw+1,'page must not scroll '+id+' '+JSON.stringify(s));
 const blocked=await obstruction(page);assert.deepEqual(blocked,[],'chat covers pre-existing controls '+id+': '+blocked.join(', '));
 if(viewport.width>900){
  for(const t of MENU)assert(await page.locator('.zpcNavGroup .tab',{hasText:t}).isVisible(),'menu item '+t+' visible '+id);
  const sistema=await page.locator('.zpcNavGroup .tab',{hasText:'Sistema'}).evaluate(e=>e.getBoundingClientRect().bottom);
  const nav=await rect(page,'.zpcNavigation');
  assert(dock.y>=sistema&&dock.x>=nav.x-0.5&&dock.x+dock.w<=nav.x+nav.w+0.5,'chat below Sistema inside the column '+id);
 } else {
  const sel=await rect(page,'.areaSelectWrap');assert(dock.y>=sel.y+sel.h-0.5,'chat area below the area selector '+id);
  await page.locator('.areaSelectWrap select').selectOption('overview');
  assert(await page.locator('.zpcAppShell>main.shell').isVisible(),'workspace back when another area is chosen '+id);
 }
 await page.screenshot({path:`${out}/${id}.png`});
 report.push({id,dock,scroll:s,blocked});checks['owner_chat_dock_layout_'+id]=true;await context.close();
}
// Contraprovas: os detectores precisam reprovar defeitos reais.
{
 const viewport={width:375,height:812};const {context,page}=await open(viewport,'dark');
 await page.locator('.areaSelectWrap select').selectOption('owner-chat');
 await page.addStyleTag({content:'.ownerChatDock{position:fixed!important;left:0!important;top:0!important;width:calc(100vw + 40px)!important;height:200px!important}'});
 assert.equal(inside(await rect(page,'.ownerChatDock'),viewport),false,'negative: overflowing chat must be detected');
 checks.negative_overflow_detected=true;await context.close();
}
{
 const viewport={width:1365,height:900};const {context,page}=await open(viewport,'dark');
 await page.addStyleTag({content:'.ownerChatDock{position:fixed!important;z-index:9999!important;left:0!important;top:40px!important;width:220px!important;height:300px!important}'});
 assert.notDeepEqual(await obstruction(page),[],'negative: chat over the menu must be detected');
 checks.negative_obstruction_detected=true;await context.close();
}
fs.writeFileSync(out+'/report.json',JSON.stringify({status:'PASS',checks,report},null,2));
console.log('OWNER_CHAT_LAYOUT=PASS '+JSON.stringify(checks));await browser.close();
