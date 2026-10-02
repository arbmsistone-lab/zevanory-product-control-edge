import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const baseline = process.env.BASELINE_URL || 'http://127.0.0.1:4174';
const candidate = process.env.CANDIDATE_URL || 'http://127.0.0.1:4173';
const delayMs = Number(process.env.BOOTSTRAP_DELAY_MS || 10000);
const runs = Number(process.env.RUNS || 5);

const fixture = {
  dashboard: {
    systems: [], audits: [], improvements: [], incidents: [],
    policy: { zeroSpend: true, failClosed: true, destructiveActions: false, greenRule: 'Somente com evidencia reproduzivel' },
    lastEngineRun: new Date().toISOString(), certificationRuns: [],
  },
  globalTrust: { state: 'BLOCKED', sha: null, evidenceRoot: null, policyVersion: 'ZEA-10', quorum: { passed: 0, total: 3, required: 3, conflicts: 0, independentKeys: 0 }, zea10: { proven: 0, partial: 0, blocked: 10 }, engines: [], checkedAt: null },
  operations: null, commercial: null, cfo: null, products: [], certificationTargets: [],
  summary: { total: 0, salesEnabled: 0, commercialReady: 0, blocked: 0, certified: 0, inCertification: 0, zeesBlocked: 0 },
};

const browser = await chromium.launch({ headless: true });
const result = { delayMs, runs, baseline: [], candidate: [] };

async function sample(base, bucket) {
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext({ viewport: { width: 1536, height: 730 } });
    const page = await context.newPage();
    let bootstrapCompleted = false;
    const requestTimeline = [];

    page.on('request', r => {
      if (/\/api\/(pin\/login|admin\/bootstrap)/.test(r.url())) requestTimeline.push({ phase: 'request', url: r.url(), at: Date.now() });
    });
    page.on('response', r => {
      if (/\/api\/(pin\/login|admin\/bootstrap)/.test(r.url())) requestTimeline.push({ phase: 'response', url: r.url(), status: r.status(), at: Date.now() });
    });

    await page.route('**/api/_auth_diagnostic', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ secretValid: true, locked: false, sessionRoundtrip: true, bootstrapOk: true }) }));
    await page.route('**/global-trust.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.globalTrust) }));
    await page.route('**/api/pin/login', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sessionToken: 'zpc1.test.signature', expiresAt: new Date(Date.now()+3600000).toISOString() }) }));
    await page.route('**/api/admin/bootstrap', async r => {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      bootstrapCompleted = true;
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
    });

    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('PIN de 4 numeros').fill('1234');
    const start = performance.now();
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.locator('.zpcAppShell').waitFor({ state: 'visible', timeout: delayMs + 5000 });
    const elapsed = performance.now() - start;
    const navUsable = await page.getByRole('button', { name: 'Produtos', exact: true }).isEnabled();
    const bootstrapReady = await page.locator('.zpcWorkspace').getAttribute('data-bootstrap-ready').catch(() => null);
    bucket.push({ elapsedMs: Math.round(elapsed), navUsable, bootstrapCompletedAtPaint: bootstrapCompleted, bootstrapReady, requestTimeline });
    await context.close();
  }
}

await sample(baseline, result.baseline);
await sample(candidate, result.candidate);

const stats = rows => {
  const values = rows.map(x => x.elapsedMs).sort((a,b)=>a-b);
  return { values, medianMs: values[Math.floor(values.length/2)], maxMs: Math.max(...values), minMs: Math.min(...values) };
};
result.baselineStats = stats(result.baseline);
result.candidateStats = stats(result.candidate);
result.negativeDelayIsolation = result.candidate.every(x => x.bootstrapCompletedAtPaint === false && x.navUsable === true);
result.pass = result.candidateStats.medianMs < 2000 && result.candidateStats.maxMs < 4000 && result.negativeDelayIsolation;

fs.mkdirSync('perf-evidence', { recursive: true });
fs.writeFileSync('perf-evidence/post-login.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
assert.equal(result.pass, true, 'POST_LOGIN_PERFORMANCE_GATE_FAILED');
await browser.close();
