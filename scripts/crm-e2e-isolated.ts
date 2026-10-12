// CRM end-to-end proof on an ISOLATED database (owner order, Mission 5): capture -> qualification
// -> persistence -> update -> proposal -> result -> report, plus idempotency, empty states,
// history and tenant isolation. Runs the real backend code against a throwaway Postgres in CI;
// production data is never touched and no synthetic contact is ever created in production.
import assert from 'node:assert/strict';

const url = process.env.DATABASE_URL_PRIMARY || '';
assert.ok(/@(localhost|127\.0\.0\.1)[:/]/.test(url), 'refusing to run outside an isolated local database');
process.env.ZPC_CLUSTER_TOKEN = process.env.ZPC_CLUSTER_TOKEN || 'e2e-isolated-adapter-token-0123456789';
process.env.ZEVANORY_SALES_TENANT_ID = 'e2e-tenant-a';

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query(`create extension if not exists pgcrypto;
  create table if not exists public.zpc_records (bucket text not null, id uuid not null, record jsonb not null, updated_at timestamptz not null default now(), primary key (bucket, id));
  create table if not exists public.zpc_replication_log (id uuid primary key default gen_random_uuid(), operation text not null, bucket text not null, payload jsonb not null, source text not null, created_at timestamptz not null default now());`);

const commercial = await import('../backend/commercial.ts');
const { db } = await import('../backend/platform.ts');
const readyOps = { available: true, health: { ready: true }, continuity: { quorumOk: true }, runtime: { sales: 'active' }, channels: [{ name: 'web', releaseGate: 'green', commercialExecution: 'active' }] } as any;
const steps: Record<string, string> = {};
const step = async (name: string, fn: () => Promise<void>) => { await fn(); steps[name] = 'PASS'; };

// Empty state: a fresh tenant reports zero, never invented data.
await step('estado_vazio', async () => {
  const ws = await commercial.commercialWorkspace(readyOps);
  assert.equal(ws.leads.length, 0);
  assert.equal(ws.metrics.leadsToday, 0);
});

let leadId = '';
await step('captura', async () => {
  const lead = await commercial.commercialAdminCreate({ kind: 'lead', title: 'Lead E2E isolado', detail: 'Salão de beleza, pediu material', status: 'new', channel: 'web', source: 'e2e', sourceKey: 'e2e:lead:1', evidence: ['e2e-isolated'] } as any);
  leadId = lead.id;
  assert.ok(leadId);
});

await step('idempotencia_captura', async () => {
  const again = await commercial.commercialAdminCreate({ kind: 'lead', title: 'Lead E2E isolado', detail: 'Salão de beleza, pediu material', status: 'new', channel: 'web', source: 'e2e', sourceKey: 'e2e:lead:1', evidence: ['e2e-isolated'] } as any);
  assert.equal(again.id, leadId, 'same source key must update, not duplicate');
  const ws = await commercial.commercialWorkspace(readyOps);
  assert.equal(ws.leads.length, 1);
});

await step('qualificacao', async () => {
  await assert.rejects(commercial.commercialSalesQualifyLead({ leadId, score: 90, signals: [] }), /evidence_required/);
  const r = await commercial.commercialSalesQualifyLead({ leadId, score: 82, signals: ['interesse declarado', 'ramo atendido'], reason: 'pediu material e respondeu' });
  assert.equal(r.qualified, true);
  assert.equal(r.status, 'qualified');
});

await step('persistencia', async () => {
  const [row] = await db.get<any>(commercial.commercialBucketName('lead'), [leadId]);
  assert.equal(row?.status, 'qualified');
  assert.ok(row.evidence.some((e: string) => e === 'qualification-score:82'));
  const { rows } = await admin.query("select count(*)::int n from public.zpc_records where bucket like 'zpc_commercial_leads%'");
  assert.equal(rows[0].n, 1);
});

await step('atualizacao', async () => {
  await commercial.commercialAdminUpdate(leadId, 'lead', { status: 'conversation', evidence: ['e2e-isolated', 'conversa iniciada'] } as any);
  const [row] = await db.get<any>(commercial.commercialBucketName('lead'), [leadId]);
  assert.equal(row?.status, 'conversation');
});

await step('proposta', async () => {
  const d = await commercial.commercialSalesDecision(readyOps, { leadId, action: 'offer', humanApproval: true });
  assert.equal(d.externalExecution, false, 'a decision never executes externally');
  assert.equal(d.leadStatus, 'conversation');
  const blocked = await commercial.commercialAdminCreate({ kind: 'lead', title: 'Lead não qualificado', status: 'new', channel: 'web', source: 'e2e', sourceKey: 'e2e:lead:2', evidence: ['e2e-isolated'] } as any);
  const d2 = await commercial.commercialSalesDecision(readyOps, { leadId: blocked.id, action: 'offer', humanApproval: true });
  assert.equal(d2.decision.allowed, false); assert.equal(d2.decision.reason, 'lead_not_qualified');
});

await step('resultado', async () => {
  const auth = { authorization: 'Bearer ' + process.env.ZPC_CLUSTER_TOKEN, 'content-type': 'application/json' };
  const denied = await commercial.commercialSalesLifecycle(new Request('http://e2e/lifecycle', { method: 'POST' }), { leadId, event: 'checkout-completed' });
  assert.equal(denied.status, 401, 'lifecycle requires the adapter token');
  const body = { leadId, event: 'checkout-completed', externalId: 'e2e-checkout-1', valueCents: 19700, currency: 'BRL' };
  const ok = await commercial.commercialSalesLifecycle(new Request('http://e2e/lifecycle', { method: 'POST', headers: auth }), body);
  assert.ok(ok.status < 300, 'lifecycle accepted: ' + ok.status);
  const twice = await commercial.commercialSalesLifecycle(new Request('http://e2e/lifecycle', { method: 'POST', headers: auth }), body);
  assert.ok(twice.status < 300);
  const [row] = await db.get<any>(commercial.commercialBucketName('lead'), [leadId]);
  assert.equal(row.evidence.filter((e: string) => e === 'checkout-completed:true').length, 1, 'repeated event recorded once');
});

await step('relatorio_e_historico', async () => {
  const ws = await commercial.commercialWorkspace(readyOps);
  assert.equal(ws.leads.length, 2);
  assert.ok(ws.events.some((e: any) => /qualificado/i.test(e.title)), 'qualification event in history');
  assert.ok(ws.evidence.some((e: any) => e.status === 'sales-decision-allowed' || e.status === 'sales-decision-blocked'), 'decisions in history');
});

await step('isolamento_entre_tenants', async () => {
  process.env.ZEVANORY_SALES_TENANT_ID = 'e2e-tenant-b';
  const ws = await commercial.commercialWorkspace(readyOps);
  assert.equal(ws.leads.length, 0, 'tenant B never sees tenant A');
  await assert.rejects(commercial.commercialSalesQualifyLead({ leadId, score: 99, signals: ['x'] }), /lead_not_found/);
  process.env.ZEVANORY_SALES_TENANT_ID = 'e2e-tenant-a';
});

await admin.end();
console.log('::notice title=CRM_E2E_ISOLATED::' + JSON.stringify({ ok: true, steps }));
process.exit(0);
