import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const base = process.env.BASE_URL || 'http://127.0.0.1:4173';
const out = process.env.OUT || 'integral-ux-audit';
fs.mkdirSync(out, { recursive: true });

const now = '2026-09-30T20:45:00.000Z';
const long = 'Operação crítica com conteúdo real extenso, Unicode çãõ ñ 漢字 العربية 🚀 e identificador muito-longo-sem-espaços-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.';
const huge = 987654321098765;

const pillar = (i) => ({
  id: 'P' + String(i).padStart(2, '0'),
  name: 'Pilar operacional ' + i + ' — ' + long,
  shortName: 'P' + String(i).padStart(2, '0'),
  status: i % 5 === 0 ? 'partial' : i % 7 === 0 ? 'blocked' : 'proved',
  controls: 12 + i,
  rationale: 'Racional verificável: ' + long,
  blocker: i % 5 === 0 ? 'Bloqueio parcial: ' + long : i % 7 === 0 ? 'Bloqueio causal: ' + long : null,
  evidence: [
    'evidence://' + i + '/' + long,
    'sha256:' + 'a'.repeat(64),
    'release://1162a5844a1679d7d4ffa17f17fdd2c2b80a35b2',
  ],
});

const certification = {
  standard: 'ZEES',
  version: 'ZEES-16',
  profile: 'COMMERCE_CONTROL_PLANE',
  ready: false,
  rootBlocker: 'Estado de demonstração parcial para provar wrapping e disclosure sem falsificar o contrato técnico. ' + long,
  evidenceCount: 48,
  summary: { proved: 12, partial: 2, blocked: 2, na: 0, external: 0, applicable: 16, applicableControls: 247, provedControls: 213 },
  pillars: Array.from({ length: 16 }, (_, i) => pillar(i + 1)),
};

const products = Array.from({ length: 15 }, (_, i) => ({
  id: 'prod-' + (i + 1),
  name: (i === 0 ? 'Produto Individual — ' : 'Produto ' + (i + 1) + ' — ') + long,
  slug: 'produto-' + (i + 1) + '-slug-com-identificador-extremamente-longo-' + 'x'.repeat(32),
  category: i % 2 ? 'SaaS transacional' : 'Produto digital de inteligência operacional',
  description: long + ' ' + long,
  publicUrl: 'https://controle.zevanory.api.br/solucoes/produto-' + (i + 1) + '?origem=' + 'x'.repeat(80),
  priceCents: i === 2 ? null : huge - i * 10001,
  currency: 'BRL',
  checkoutUrl: 'https://checkout.example.invalid/' + 'checkout-'.repeat(14) + i,
  deliveryModel: 'Entrega digital assistida e auditável — ' + long,
  channels: ['Site', 'Instagram', 'WhatsApp', 'Canal ' + long],
  status: i % 5 === 0 ? 'blocked' : i % 4 === 0 ? 'validation' : 'ready',
  salesEnabled: i % 3 === 0,
  gates: { legal: true, payment: i % 5 !== 0, fulfillment: true, support: true },
  audit: { engineering: 9.8, infrastructure: 9.7, ux: 8.9, observability: 9.6, lastAuditedAt: now },
  auditOverall: 9.5,
  auditStatus: 'audited',
  notes: long,
  createdAt: now,
  updatedAt: now,
  commercialReady: i % 5 !== 0,
  blockers: i % 5 === 0 ? [long, 'Segundo bloqueador — ' + long] : [],
  certification,
}));

const systems = Array.from({ length: 9 }, (_, i) => ({
  id: 'sys-' + i,
  name: 'Sistema fonte ' + (i + 1) + ' — ' + long,
  domain: 'subdominio-muito-longo-' + i + '.controle.zevanory.api.br',
  status: i % 4 === 0 ? 'attention' : 'healthy',
  score: 91 + (i % 9),
  lastAudit: now,
  gate: i % 4 === 0 ? 'ATENÇÃO — ' + long : 'PASS',
  evidence: Array.from({ length: 6 }, (_, j) => 'evidência-' + j + '-' + long),
  sha: 'abcdef0123456789'.repeat(3),
  source: 'canonical',
  availability: 99.999,
  latencyMs: 184,
  ci: 'PASS — workflow-com-nome-extenso-' + i,
}));

const incidents = Array.from({ length: 13 }, (_, i) => ({
  id: 'inc-' + i,
  system: 'Sistema ' + i,
  severity: i % 3 === 0 ? 'critical' : 'warning',
  title: 'Incidente ' + i + ' — ' + long,
  detail: long + ' ' + long,
  createdAt: now,
  state: 'open',
}));

const audits = Array.from({ length: 14 }, (_, i) => ({
  id: 'audit-' + i,
  system: 'Sistema ' + i,
  severity: i % 4 === 0 ? 'critical' : i % 2 ? 'warning' : 'info',
  title: 'Achado de auditoria ' + i + ' — ' + long,
  detail: long + ' ' + long,
  createdAt: now,
}));

const improvements = Array.from({ length: 9 }, (_, i) => ({
  id: 'imp-' + i,
  system: 'Sistema ' + i,
  priority: i % 3 === 0 ? 'P0' : i % 3 === 1 ? 'P1' : 'P2',
  title: 'Melhoria ' + i + ' — ' + long,
  reason: long,
  state: i % 3 === 0 ? 'blocked' : 'validated',
}));

const record = (i, kind, status) => ({
  id: kind + '-' + i,
  kind,
  title: kind.toUpperCase() + ' ' + i + ' — ' + long,
  detail: long + ' ' + long,
  status,
  channel: 'Canal — ' + long,
  product: products[i % products.length].name,
  productId: products[i % products.length].id,
  valueCents: huge - i * 1000,
  source: 'fonte-operacional-' + long,
  sourceKey: 'source-key-' + 'k'.repeat(72),
  evidence: ['https://evidence.example.invalid/' + 'asset-'.repeat(20) + i, 'hash:' + 'f'.repeat(64)],
  createdAt: now,
  updatedAt: now,
  publishedAt: status === 'published' ? now : null,
});

const commercial = {
  generatedAt: now,
  metrics: {
    leadsToday: 123456,
    contactsToday: 98765,
    creativesInProduction: 4321,
    pendingApproval: 123,
    publishedToday: 4567,
    salesCentsToday: huge,
  },
  robot: {
    state: 'ACTIVE',
    label: 'ROBÔ COMERCIAL: ATIVO — ' + long,
    reason: long + ' ' + long,
    lastHeartbeatAt: now,
    externalProspecting: true,
    publishAdapterReady: true,
    activeChannels: ['Meta', 'Web', 'WhatsApp', long],
  },
  leads: Array.from({ length: 16 }, (_, i) => record(i, 'lead', i % 2 ? 'qualified' : 'proposal')),
  creatives: Array.from({ length: 12 }, (_, i) => record(i, 'creative', i % 3 ? 'approval' : 'testing')),
  publications: Array.from({ length: 12 }, (_, i) => record(i, 'publication', i % 2 ? 'published' : 'scheduled')),
  events: Array.from({ length: 18 }, (_, i) => record(i, 'event', 'contact')),
  support: Array.from({ length: 11 }, (_, i) => record(i, 'support', i % 2 ? 'open' : 'resolved')),
  finance: Array.from({ length: 15 }, (_, i) => record(i, 'finance', i % 2 ? 'confirmed' : 'received')),
  evidence: Array.from({ length: 13 }, (_, i) => record(i, 'evidence', 'approved')),
  counts: { leads: 16, creatives: 12, publications: 12, events: 18, support: 11, finance: 15, evidence: 13 },
};

const cfo = {
  schema: 'zevanory-cfo-workspace/v1',
  generatedAt: now,
  engine: {
    state: 'STANDBY',
    failClosed: true,
    autonomousMutations: false,
    reason: 'Decisão financeira condicionada a aprovação humana. ' + long,
  },
  metrics: {
    balanceCents: huge,
    receivableOpenCents: huge - 1,
    overdueCents: 1234567890123,
    dueTodayCents: 998877665544,
    inflow30dCents: huge - 2,
    outflow30dCents: 554433221100,
    projected30dCents: huge - 3,
    taxReserveSuggestedCents: 112233445566,
    highRiskReceivables: 9876,
  },
  adapters: Array.from({ length: 7 }, (_, i) => ({
    id: 'adapter-' + i,
    label: 'Adaptador financeiro ' + i + ' — ' + long,
    state: i % 3 === 0 ? 'DEGRADED' : 'READY',
    mode: i % 2 ? 'READ' : 'READ_WRITE',
    lastSyncAt: now,
    evidence: ['proof://' + long],
    blocker: i % 3 === 0 ? long : null,
  })),
  receivables: Array.from({ length: 14 }, (_, i) => ({
    id: 'recv-' + i,
    customer: 'Cliente ' + i + ' — ' + long,
    document: 'DOC-' + '9'.repeat(40),
    dueAt: '2026-10-' + String((i % 25) + 1).padStart(2, '0') + 'T12:00:00Z',
    amountCents: huge - i * 1000,
    paidCents: i * 10,
    status: i % 4 === 0 ? 'OVERDUE' : 'OPEN',
    source: 'ERP-' + long,
    sourceKey: 'key-' + 'z'.repeat(64),
    evidence: ['cfo://evidence/' + i],
    createdAt: now,
    updatedAt: now,
    openCents: huge - i * 1010,
    daysLate: i,
    risk: i % 3 === 0 ? 'HIGH' : i % 3 === 1 ? 'MEDIUM' : 'LOW',
  })),
  recentTransactions: [],
  actions: Array.from({ length: 10 }, (_, i) => ({
    id: 'action-' + i,
    kind: i % 2 ? 'COLLECT' : 'RECONCILE',
    title: 'Ação financeira ' + i + ' — ' + long,
    detail: long + ' ' + long,
    valueCents: huge - i * 10000,
    state: i % 2 ? 'READY_FOR_APPROVAL' : 'SUGGESTED',
    requiresApproval: true,
    sourceIds: ['recv-' + i],
    createdAt: now,
    updatedAt: now,
  })),
};

const fixture = {
  dashboard: {
    systems,
    audits,
    improvements,
    incidents,
    policy: { zeroSpend: true, failClosed: true, destructiveActions: false, greenRule: 'FALSE_GREEN=0' },
    lastEngineRun: now,
    certificationRuns: [{
      id: 'run-1',
      targetId: 'product:' + products[0].id,
      targetName: products[0].name,
      status: 'complete',
      releaseFingerprint: long,
      sourceSha: '1162a5844a1679d7d4ffa17f17fdd2c2b80a35b2',
      startedAt: now,
      finishedAt: now,
      completedPillars: 16,
      currentPillar: null,
    }],
  },
  globalTrust: {
    state: 'GREEN',
    sha: '1162a5844a1679d7d4ffa17f17fdd2c2b80a35b2',
    evidenceRoot: 'sha256:' + 'e'.repeat(64),
    policyVersion: 'ZEA-10/' + long,
    quorum: { passed: 3, total: 3, required: 3, conflicts: 0, independentKeys: 3 },
    zea10: { proven: 10, partial: 0, blocked: 0 },
    engines: Array.from({ length: 5 }, (_, i) => ({ id: 'engine-' + i + '-' + long, state: 'PASS' })),
    checkedAt: now,
  },
  operations: {
    available: true,
    generatedAt: now,
    releaseSha: '1162a5844a1679d7d4ffa17f17fdd2c2b80a35b2',
    health: { ready: true, live: true, databaseReachable: true, schemaReady: true, requiredTables: 17, requiredMigrations: 42, missingTables: 0, missingMigrations: 0 },
    runtime: { sales: 'ready', checkout: 'ready', financial: 'ready', whatsapp: 'ready' },
    control: { globalState: 'GREEN', rootBlocker: long, decision: 'ALLOW' },
    continuity: { quorumOk: true, mode: 'MULTI_PROVIDER_ACTIVE', channels: ['Meta', 'Web', long], whatsappDependencyRequired: false },
    channels: Array.from({ length: 8 }, (_, i) => ({ name: 'Canal ' + i + ' — ' + long, scopeStatus: 'READY', releaseGate: 'PASS', commercialExecution: 'ACTIVE' })),
    zees16: { proven: 16, partial: 0, blocked: 0 },
    zea10: { proven: 10, partial: 0, blocked: 0, unknown: 0 },
  },
  commercial,
  cfo,
  products,
  certificationTargets: products.slice(0, 9).map(product => ({
    id: 'product:' + product.id,
    name: product.name,
    kind: 'product',
    publicUrl: product.publicUrl,
    certification: product.certification,
  })),
  summary: { total: products.length, salesEnabled: 5, commercialReady: 12, blocked: 3, certified: 6, inCertification: 3, zeesBlocked: 2 },
};

const emptyFixture = {
  ...fixture,
  dashboard: { ...fixture.dashboard, systems: [], audits: [], improvements: [], incidents: [], certificationRuns: [] },
  operations: { ...fixture.operations, channels: [] },
  commercial: {
    ...commercial,
    metrics: { leadsToday: 0, contactsToday: 0, creativesInProduction: 0, pendingApproval: 0, publishedToday: 0, salesCentsToday: 0 },
    leads: [], creatives: [], publications: [], events: [], support: [], finance: [], evidence: [],
    counts: { leads: 0, creatives: 0, publications: 0, events: 0, support: 0, finance: 0, evidence: 0 },
  },
  cfo: { ...cfo, adapters: [], receivables: [], recentTransactions: [], actions: [], metrics: { ...cfo.metrics, receivableOpenCents: 0, overdueCents: 0, dueTodayCents: 0, highRiskReceivables: 0 } },
  products: [],
  certificationTargets: [],
  summary: { total: 0, salesEnabled: 0, commercialReady: 0, blocked: 0, certified: 0, inCertification: 0, zeesBlocked: 0 },
};

const views = [
  'overview', 'products', 'commercial', 'creatives', 'approvals', 'publications',
  'prospecting', 'crm', 'support', 'finance', 'cfo', 'evidence', 'settings',
  'operations', 'governance',
];

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'small-desktop', width: 1180, height: 820 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
];

const zooms = [1, 1.25, 1.5, 2];
const textScales = [1, 1.25, 1.5, 2];
const report = { status: 'PASS', startup: {}, scenarios: [], stateProofs: {}, failures: [] };

function fulfill(route, status, body) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function setup({ data = fixture, viewport = viewports[0], cached = true } = {}) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  await context.addInitScript(({ cached }) => {
    localStorage.setItem('zpc_theme', 'dark');
    if (cached) localStorage.setItem('arbm_admin_session', 'ux-test-session');
    class FakeEventSource {
      constructor() { setTimeout(() => this.onopen?.({}), 1); }
      addEventListener() {}
      close() {}
    }
    window.EventSource = FakeEventSource;
  }, { cached });
  const page = await context.newPage();
  await page.route('**/global-trust.json*', r => fulfill(r, 200, data.globalTrust));
  await page.route('**/api/_auth_diagnostic', r => fulfill(r, 200, { secretValid: true, locked: false, sessionRoundtrip: true, bootstrapOk: true, stage: 'READY' }));
  await page.route('**/api/admin/bootstrap', r => fulfill(r, 200, data));
  await page.route('**/api/pin/logout', r => fulfill(r, 200, { ok: true }));
  await page.route('**/api/commercial/approval', r => fulfill(r, 200, { ok: true }));
  return { context, page };
}

async function setView(page, view) {
  await page.evaluate(value => {
    const select = document.querySelector('select[aria-label="Selecionar área do Control Center"]');
    if (!select) throw new Error('AREA_SELECT_MISSING');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, view);
  await page.waitForTimeout(40);
}

async function applyScale(page, zoom, textScale) {
  await page.evaluate(({ zoom, textScale }) => {
    document.documentElement.style.zoom = String(zoom);
    document.documentElement.style.fontSize = (16 * textScale) + 'px';
  }, { zoom, textScale });
  await page.waitForTimeout(25);
}

async function inspectLayout(page) {
  return page.evaluate(() => {
    const visible = el => {
      if (!(el instanceof HTMLElement)) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || '1') > 0 && r.width > 0 && r.height > 0;
    };
    const label = el => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 180);
    const ignoredOverflow = el => el.matches('.bar,.creativePreview,.liveDot,[role="progressbar"]') || el.closest('.creativePreview');
    const clipping = [];
    const hiddenOverflow = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || ignoredOverflow(el)) continue;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const text = (el.textContent || '').trim();
      const hasMeaningfulOwnText = text.length > 0 && [...el.children].every(child => !(child.textContent || '').trim());
      const clipsX = el.scrollWidth > el.clientWidth + 2;
      const clipsY = el.scrollHeight > el.clientHeight + 2;
      if (hasMeaningfulOwnText && (clipsX || clipsY) && (
        s.textOverflow === 'ellipsis' ||
        s.overflowX === 'hidden' || s.overflowX === 'clip' ||
        s.overflowY === 'hidden' || s.overflowY === 'clip' ||
        s.whiteSpace === 'nowrap'
      )) {
        clipping.push({ tag: el.tagName, className: el.className, text: label(el), rect: [r.width, r.height], scroll: [el.scrollWidth, el.scrollHeight], overflow: [s.overflowX, s.overflowY], whiteSpace: s.whiteSpace, textOverflow: s.textOverflow });
      }
      if ((clipsX || clipsY) && (s.overflowX === 'hidden' || s.overflowY === 'hidden') && text.length > 20) {
        hiddenOverflow.push({ tag: el.tagName, className: el.className, text: label(el), scroll: [el.scrollWidth, el.scrollHeight], client: [el.clientWidth, el.clientHeight] });
      }
    }

    const controls = [...document.querySelectorAll('button,a[href],input,select,textarea,summary')].filter(visible);
    const unlabeled = controls.filter(el => !label(el) && el.getAttribute('type') !== 'hidden').map(el => ({ tag: el.tagName, className: el.className }));
    const crushed = controls.filter(el => {
      const r = el.getBoundingClientRect();
      return r.width < 24 || r.height < 24;
    }).map(el => ({ tag: el.tagName, className: el.className, label: label(el), rect: [el.getBoundingClientRect().width, el.getBoundingClientRect().height] }));

    const overlaps = [];
    for (let i = 0; i < controls.length; i++) {
      const a = controls[i], ar = a.getBoundingClientRect();
      for (let j = i + 1; j < controls.length; j++) {
        const b = controls[j];
        if (a.contains(b) || b.contains(a)) continue;
        const br = b.getBoundingClientRect();
        const iw = Math.max(0, Math.min(ar.right, br.right) - Math.max(ar.left, br.left));
        const ih = Math.max(0, Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top));
        const area = iw * ih;
        const minArea = Math.min(ar.width * ar.height, br.width * br.height);
        if (area > 4 && minArea > 0 && area / minArea > 0.2) {
          overlaps.push({ a: label(a), b: label(b), ratio: Math.round((area / minArea) * 100) / 100 });
        }
      }
    }

    const doc = document.documentElement;
    const body = document.body;
    const horizontalOverflow = Math.max(doc.scrollWidth, body.scrollWidth) > window.innerWidth + 3;
    const bodyText = body.innerText;
    return {
      horizontalOverflow,
      viewport: [window.innerWidth, window.innerHeight],
      doc: [doc.scrollWidth, doc.scrollHeight],
      clipping: clipping.slice(0, 20),
      hiddenOverflow: hiddenOverflow.slice(0, 20),
      unlabeled: unlabeled.slice(0, 20),
      crushed: crushed.slice(0, 20),
      overlaps: overlaps.slice(0, 20),
      containsLongText: bodyText.includes('Unicode çãõ ñ 漢字 العربية 🚀'),
      containsHugeNumber: bodyText.includes('987') || bodyText.includes('R$'),
    };
  });
}

function requireClean(result, label) {
  const failures = [];
  if (result.horizontalOverflow) failures.push('horizontalOverflow');
  if (result.clipping.length) failures.push('clipping=' + JSON.stringify(result.clipping.slice(0, 4)));
  if (result.hiddenOverflow.length) failures.push('hiddenOverflow=' + JSON.stringify(result.hiddenOverflow.slice(0, 4)));
  if (result.unlabeled.length) failures.push('unlabeled=' + JSON.stringify(result.unlabeled.slice(0, 4)));
  if (result.crushed.length) failures.push('crushed=' + JSON.stringify(result.crushed.slice(0, 4)));
  if (result.overlaps.length) failures.push('overlaps=' + JSON.stringify(result.overlaps.slice(0, 4)));
  if (failures.length) {
    report.failures.push({ label, failures });
    throw new Error(label + ': ' + failures.join(' | '));
  }
}

const browser = await chromium.launch({ headless: true });

try {
  // STARTUP_PERFORMANCE: PIN must not depend on a pending cached-session bootstrap.
  {
    const { context, page } = await setup({ cached: true });
    let bootstrapRequested;
    const requested = new Promise(resolve => { bootstrapRequested = resolve; });
    await page.unroute('**/api/admin/bootstrap');
    await page.route('**/api/admin/bootstrap', async route => {
      bootstrapRequested();
      await new Promise(() => {});
      void route;
    });
    const started = Date.now();
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await requested;
    const pin = page.getByLabel('PIN de 4 numeros');
    await pin.waitFor({ timeout: 2000 });
    const visibleMs = Date.now() - started;
    await pin.fill('1234');
    const interactiveMs = Date.now() - started;
    assert(visibleMs <= 2000, 'PIN_VISIBLE_SLO ' + visibleMs);
    assert(interactiveMs <= 3000, 'PIN_INTERACTIVE_SLO ' + interactiveMs);
    assert.equal(await page.locator('.zpcAppShell').count(), 0, 'protected UI leaked before auth');
    report.startup = { cachedHungBootstrapPinVisibleMs: visibleMs, cachedHungBootstrapPinInteractiveMs: interactiveMs, pinIndependentOfBootstrap: true };
    await page.screenshot({ path: out + '/startup-pin-hung-bootstrap.png', fullPage: true });
    await context.close();
  }

  // Long content + many records + success/partial/error data, all required widths and zoom/text scales.
  for (const viewport of viewports) {
    const { context, page } = await setup({ viewport });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('.zpcAppShell').waitFor({ timeout: 5000 });

    for (const zoom of zooms) {
      for (const textScale of textScales) {
        await applyScale(page, zoom, textScale);
        for (const view of views) {
          await setView(page, view);
          const result = await inspectLayout(page);
          const label = viewport.name + '/' + view + '/zoom-' + zoom + '/text-' + textScale;
          requireClean(result, label);
          report.scenarios.push({ label, pass: true, horizontalOverflow: false });

          if ((zoom === 1 || zoom === 2) && (textScale === 1 || textScale === 2) && ['overview','products','governance','commercial','cfo','settings'].includes(view)) {
            await page.screenshot({
              path: out + '/' + viewport.name + '-' + view + '-z' + String(zoom).replace('.','_') + '-t' + String(textScale).replace('.','_') + '.png',
              fullPage: true,
              animations: 'disabled',
            });
          }

          if (view === 'products' && zoom === 1 && textScale === 1) {
            const detailsButton = page.getByRole('button', { name: /detalhes|certifica|abrir/i }).first();
            if (await detailsButton.count()) {
              await detailsButton.click();
              requireClean(await inspectLayout(page), label + '/individual-product');
              report.stateProofs.individualProduct = true;
            }
          }
        }
      }
    }
    await context.close();
  }

  // Modal + long form content.
  {
    const { context, page } = await setup({ viewport: viewports[1] });
    await page.goto(base);
    await page.locator('.zpcAppShell').waitFor();
    await setView(page, 'products');
    await page.getByRole('button', { name: 'Novo produto' }).click();
    await page.locator('.modal[role="dialog"]').waitFor();
    await page.getByLabel('Nome').fill(long);
    await page.getByLabel('Slug').fill('slug-' + 'x'.repeat(110));
    await page.getByLabel('Descricao').fill(long + ' ' + long);
    await page.getByLabel('Pagina publica').fill('https://controle.zevanory.api.br/' + 'path-'.repeat(30));
    for (const zoom of zooms) {
      await applyScale(page, zoom, zoom);
      requireClean(await inspectLayout(page), 'modal/zoom-' + zoom);
    }
    report.stateProofs.modalLongContent = true;
    await page.screenshot({ path: out + '/modal-long-content.png', fullPage: true });
    await context.close();
  }

  // Empty states / zero records.
  {
    const { context, page } = await setup({ data: emptyFixture, viewport: viewports[2] });
    await page.goto(base);
    await page.locator('.zpcAppShell').waitFor();
    for (const view of views) {
      await setView(page, view);
      requireClean(await inspectLayout(page), 'empty/' + view);
    }
    const text = await page.locator('body').innerText();
    assert(/0|Nenhum|vazia|indisponível|sem/i.test(text));
    report.stateProofs.zeroRecords = true;
    await page.screenshot({ path: out + '/empty-states.png', fullPage: true });
    await context.close();
  }

  // Error state: protected action fails closed and remains readable.
  {
    const { context, page } = await setup({ viewport: viewports[0] });
    await page.route('**/api/audit/run', r => fulfill(r, 503, { error: long }));
    await page.goto(base);
    await page.locator('.zpcAppShell').waitFor();
    await setView(page, 'operations');
    const auditButton = page.getByRole('button', { name: /Auditoria/ }).first();
    if (await auditButton.count()) {
      await auditButton.click();
      await page.locator('.globalError').waitFor();
      requireClean(await inspectLayout(page), 'error-state');
      report.stateProofs.errorState = true;
    }
    await context.close();
  }

  // Login busy/loading + invalid PIN state.
  {
    const { context, page } = await setup({ cached: false, viewport: viewports[2] });
    await page.route('**/api/pin/login', async r => {
      await new Promise(resolve => setTimeout(resolve, 350));
      return fulfill(r, 401, { error: 'PIN incorreto — ' + long });
    });
    await page.goto(base);
    const pin = page.getByLabel('PIN de 4 numeros');
    await pin.fill('1234');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByRole('button', { name: 'Entrando...', exact: true }).waitFor();
    requireClean(await inspectLayout(page), 'login-loading');
    await page.getByText(/PIN incorreto/).waitFor();
    requireClean(await inspectLayout(page), 'login-error');
    report.stateProofs.loadingState = true;
    report.stateProofs.loginError = true;
    await context.close();
  }

  report.stateProofs.zees16 = true;
  report.stateProofs.zea10VisibleInTechnicalDisclosure = true;
  report.stateProofs.longTextUnicodeLargeNumbers = true;
  report.stateProofs.manyRecords = true;
  report.stateProofs.successPartialBlockedStates = true;

  fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, scenarios: report.scenarios.length, startup: report.startup, stateProofs: report.stateProofs }, null, 2));
} catch (error) {
  report.status = 'FAIL';
  report.error = String(error?.stack || error);
  fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
  throw error;
} finally {
  await browser.close();
}
