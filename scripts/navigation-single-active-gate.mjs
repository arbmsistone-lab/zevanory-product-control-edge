import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const base = process.env.CANDIDATE_URL || 'http://127.0.0.1:4173';
const fixture = {
  dashboard: { systems: [], audits: [], improvements: [], incidents: [], policy: { zeroSpend: true, failClosed: true, destructiveActions: false, greenRule: 'proof' }, lastEngineRun: new Date().toISOString(), certificationRuns: [] },
  globalTrust: { state: 'BLOCKED', sha: null, evidenceRoot: null, policyVersion: 'ZEA-10', quorum: { passed: 0, total: 3, required: 3, conflicts: 0, independentKeys: 0 }, zea10: { proven: 0, partial: 0, blocked: 10 }, engines: [], checkedAt: null },
  operations: null, commercial: null, cfo: null, products: [], certificationTargets: [],
  summary: { total: 0, salesEnabled: 0, commercialReady: 0, blocked: 0, certified: 0, inCertification: 0, zeesBlocked: 0 },
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1536, height: 730 } });
const page = await context.newPage();
const fulfill=(r,body)=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
await page.route('**/api/_auth_diagnostic', r=>fulfill(r,{secretValid:true,locked:false,sessionRoundtrip:true,bootstrapOk:true}));
await page.route('**/api/pin/login', r=>fulfill(r,{ok:true,sessionToken:'zpc1.test.signature'}));
await page.route('**/api/admin/bootstrap', r=>fulfill(r,fixture));
await page.route('**/global-trust.json*', r=>fulfill(r,fixture.globalTrust));
await page.goto(base,{waitUntil:'domcontentloaded'});
await page.getByLabel('PIN de 4 numeros').fill('1234');
await page.getByRole('button',{name:'Entrar',exact:true}).click();
await page.locator('.zpcAppShell').waitFor();

const nav=page.locator('.zpcNavigation');
assert.equal(await nav.locator('.tab').count(),8,'expected exactly 8 primary navigation items');
for(let i=0;i<8;i++) assert.equal(await nav.locator('.tab').nth(i).locator('svg').count(),1,'every primary item must have one icon');
const forbidden=['ZEES-16 / Governança','Operações técnicas','ZEVANORY CFO'];
const navText=await nav.innerText();
for(const value of forbidden) assert.equal(navText.includes(value),false,'technical/duplicated label leaked into primary navigation: '+value);

async function singleActive(label){
  const active=nav.locator('.tab.active');
  assert.equal(await active.count(),1,'more than one primary nav item active at '+label);
  assert.equal(await nav.locator('.tab[aria-pressed="true"]').count(),1,'aria-pressed mismatch at '+label);
  const bg=await active.evaluate(el=>getComputedStyle(el).backgroundColor);
  const inactiveBg=await nav.locator('.tab:not(.active)').first().evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.notEqual(bg,inactiveBg,'active item must use a filled background at '+label);
  return {label,active:await active.innerText(),background:bg};
}
const checks=[];
checks.push(await singleActive('initial'));
for(const item of ['Produtos','Comercial','Conteúdo','Atendimento','Financeiro','Evidências','Sistema','Visão Geral']){
  await page.getByRole('button',{name:item,exact:true}).click();
  checks.push(await singleActive(item));
}
for(const sub of ['Prospecção','CRM/Vendas']){
  await page.getByRole('button',{name:'Comercial',exact:true}).click();
  await nav.getByRole('button',{name:sub,exact:true}).click();
  checks.push(await singleActive('Comercial/'+sub));
}
for(const sub of ['Aprovações','Publicações']){
  await page.getByRole('button',{name:'Conteúdo',exact:true}).click();
  await nav.getByRole('button',{name:sub,exact:true}).click();
  checks.push(await singleActive('Conteúdo/'+sub));
}
await page.getByRole('button',{name:'Financeiro',exact:true}).click();
await nav.getByRole('button',{name:'Inteligência financeira',exact:true}).click();
checks.push(await singleActive('Financeiro/Inteligência financeira'));
await page.getByRole('button',{name:'Sistema',exact:true}).click();
await nav.getByRole('button',{name:'Qualidade e certificação',exact:true}).click();
checks.push(await singleActive('Sistema/Qualidade e certificação'));

const labelSize=parseFloat(await nav.locator('.zpcNavLabel').evaluate(el=>getComputedStyle(el).fontSize));
const itemSize=parseFloat(await nav.locator('.tab').first().evaluate(el=>getComputedStyle(el).fontSize));
assert(labelSize < itemSize,'group label must be visually smaller than navigation items');

const result={status:'PASS',primaryItems:8,allPrimaryItemsHaveIcons:true,singleActive:true,labelFontPx:labelSize,itemFontPx:itemSize,checks};
fs.mkdirSync('menu-evidence',{recursive:true});
fs.writeFileSync('menu-evidence/navigation.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
await browser.close();
