import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { bootstrap, views } from './control-center-fixtures.mjs';

const origin = process.env.CONTROL_CENTER_AUDIT_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const fixture = structuredClone(bootstrap);
fixture.globalTrust = {
  ...fixture.globalTrust, sha: 'a'.repeat(40), evidenceRoot: 'b'.repeat(64),
  engines: ['zees16-core', 'zea10-evaluator', 'control-core'].map(id => ({ id, state: 'GREEN' })),
};
fixture.cfo = {
 schema:'zevanory-cfo-workspace/v1',generatedAt:new Date().toISOString(),
 engine:{state:'BLOCKED',failClosed:true,autonomousMutations:false,reason:'Provedor financeiro aguarda evidência atual.'},
 metrics:{balanceCents:100000000,receivableOpenCents:800000,overdueCents:500000,dueTodayCents:90000,inflow30dCents:500000,outflow30dCents:100000,projected30dCents:900000,taxReserveSuggestedCents:60000,highRiskReceivables:2},
 adapters:[{id:'adapter',label:'Adaptador financeiro de auditoria',state:'UNCONFIGURED',mode:'READ',lastSyncAt:null,evidence:[],blocker:'Integração permanece bloqueada até prova externa.'}],
 actions:[{id:'action',kind:'RECONCILE',title:'Conferir recebível',detail:'Ação sugerida, sem execução externa.',state:'SUGGESTED',requiresApproval:true,sourceIds:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}],
 receivables:[{id:'receivable',customer:'Cliente com nome longo de auditoria',document:null,dueAt:'2026-10-10',amountCents:800000,paidCents:0,openCents:800000,daysLate:0,risk:'HIGH',status:'OPEN',source:'audit-fixture',evidence:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}],recentTransactions:[]
};
async function assertNoScroll(page, label) {
 const scroll = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
  const r=el.getBoundingClientRect(),s=getComputedStyle(el);
  return r.width>0 && r.height>0 && s.visibility!=='hidden' && ((el.scrollHeight>el.clientHeight+1 && ['auto','scroll'].includes(s.overflowY)) || (el.scrollWidth>el.clientWidth+1 && ['auto','scroll'].includes(s.overflowX)));
 }).map(el=>el.tagName+'.'+el.className));
 assert.deepEqual(scroll, [], label+': internal scroll');
}
const rows = [];
const sizes = [[1920,1080],[1680,1050],[1536,864],[1440,900],[1366,768],[1280,720],[1024,768],[768,1024],[430,932],[412,915],[390,844],[375,812],[360,800]];
await fs.mkdir('control-center-truth-audit', { recursive: true });
try {
  for (const [width, height] of sizes) for (const scale of [0.8,0.9,1,1.1,1.25]) {
    // Effective CSS viewport models browser zoom reflow; this is not a native browser-zoom certificate.
    const viewport = { width: Math.round(width / scale), height: Math.round(height / scale) };
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('arbm_admin_session', 'test-session'));
    const page = await context.newPage();
    await page.route('**/api/admin/bootstrap', route => route.fulfill({ json: { ...fixture, globalTrust: { ...fixture.globalTrust, checkedAt: new Date().toISOString() } } }));
    await page.goto(origin);
    await page.getByRole('heading', { name: 'ZEVANORY CONTROL CENTER', exact: true }).waitFor();
    assert.equal(await page.locator('.trustStrip').getAttribute('data-state'), 'PASS');
    const geometry = await page.evaluate(() => {
      const root = document.documentElement, body = document.body;
      const chrome = [...document.querySelectorAll('.topbar, .policybar, .trustStrip, .areaSelectWrap')].filter(el => getComputedStyle(el).display !== 'none');
      const overflow = chrome.flatMap(el => {
        const r = el.getBoundingClientRect();
        return r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || el.scrollHeight > el.clientHeight + 2 ? [el.className] : [];
      });
      return { x: Math.max(root.scrollWidth, body.scrollWidth) - innerWidth, y: Math.max(root.scrollHeight, body.scrollHeight) - innerHeight, overflow };
    });
    rows.push({ width, height, scale, effectiveViewport: viewport, geometry });
    if (scale === 1 && [1920,1366,390,360].includes(width)) await page.screenshot({ path: `control-center-truth-audit/${width}x${height}.png` });
    assert.ok(geometry.x <= 1 && geometry.y <= 1, JSON.stringify(rows.at(-1)));
    assert.deepEqual(geometry.overflow, [], JSON.stringify(rows.at(-1)));
    if (scale === 1) {
      for (const [key,label] of views) {
        if (await page.getByLabel('Selecionar área do Control Center').isVisible()) await page.getByLabel('Selecionar área do Control Center').selectOption(key);
        else await page.getByRole('navigation',{name:'Áreas do ZEVANORY CONTROL CENTER'}).getByRole('button',{name:label,exact:true}).click();
        const documentFits = await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1);
        assert.ok(documentFits, `${width}x${height} ${key}: global overflow`);
        await assertNoScroll(page, `${width}x${height} ${key}`);
        if (key === 'cfo') {
          for (const label of ['Resumo','Integrações','Decisões','Recebíveis']) {
            const area=page.getByLabel('Área financeira');
            if(await area.isVisible()) await area.selectOption(({Resumo:'summary',Integrações:'adapters',Decisões:'actions',Recebíveis:'receivables'})[label]);
            else await page.getByRole('navigation',{name:'Páginas do CFO'}).getByRole('button',{name:label,exact:true}).click();
            await assertNoScroll(page, `${width}x${height} cfo ${label}`);
          }
        }
        if (key === 'products') {
          await page.getByRole('button',{name:'Novo produto',exact:true}).click();
          for (let step=0;step<5;step++) {
            await assertNoScroll(page, `${width}x${height} form ${step}`);
            const fits = await page.getByRole('dialog').evaluate(el => {const r=el.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight+1 && el.scrollHeight<=el.clientHeight+1;});
            assert.ok(fits, `${width}x${height} form ${step}: clipped`);
            if (step<4) await page.getByRole('navigation',{name:'Etapas do produto'}).getByRole('button',{name:'Próxima'}).click();
          }
          await page.getByRole('dialog').getByRole('button',{name:'Fechar',exact:true}).click();
        }
        // Every final action must already fit without moving any viewport.
        const actions = await page.locator('main button:visible:not([disabled]), main a:visible[href], main summary:visible').all();
        if (actions.length) {
          await actions.at(-1).focus();
          const reachable = await actions.at(-1).evaluate(el => { const r=el.getBoundingClientRect();return r.top >= 0 && r.bottom <= innerHeight + 1; });
          assert.ok(reachable, `${width}x${height} ${key}: final action unreachable`);
        }
      }
    }
    await context.close();
  }

  for (const status of [500,503,401]) {
    const context = await browser.newContext();
    await context.addInitScript(() => localStorage.setItem('arbm_admin_session', 'test-session'));
    const page = await context.newPage();
    let recover = false;
    await page.route('**/api/admin/bootstrap', route => recover ? route.fulfill({ json: fixture }) : route.fulfill({ status, json: { error: 'test failure' } }));
    await page.route('**/api/pin/diagnostic', route => route.fulfill({ json: {} }));
    await page.goto(origin);
    if (status === 401) {
      await page.getByRole('heading', { name: 'ZEVANORY PRODUCT CONTROL', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem('arbm_admin_session')), null);
    } else {
      await page.getByRole('heading', { name: 'Conexão indisponível' }).waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem('arbm_admin_session')), 'test-session');
      recover = true;
      await page.getByRole('button', { name: 'Tentar novamente' }).click();
      await page.getByRole('heading', { name: 'ZEVANORY CONTROL CENTER', exact: true }).waitFor();
    }
    await context.close();
  }
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('arbm_admin_session', 'test-session'));
  const page = await context.newPage();
  await page.route('**/api/admin/bootstrap', route => route.fulfill({ json: { ...fixture, globalTrust: { ...fixture.globalTrust, checkedAt: new Date(Date.now()-180000).toISOString() } } }));
  await page.goto(origin);
  await page.getByRole('heading', { name: 'ZEVANORY CONTROL CENTER', exact: true }).waitFor();
  assert.equal(await page.locator('.trustStrip').getAttribute('data-state'), 'BLOCKED');
  assert.equal(await page.locator('.trustStrip').getAttribute('data-freshness'), 'STALE');
  await context.close();
  console.log('TRUTH_RUNTIME=PASS AUTH_TRANSIENT=PASS AUTH_401=PASS STALE_FAIL_CLOSED=PASS VIEWPORT_CASES=' + rows.length);
} finally {
  await fs.writeFile('control-center-truth-audit/report.json', JSON.stringify({ at: new Date().toISOString(), observer: 'local-playwright-synthetic-fixtures', rows }, null, 2));
  await browser.close();
}
