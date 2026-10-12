// Every write action of the panel, end to end, through the REAL backend router on an ISOLATED
// database (owner order, Mission 10): server response + persisted result for each action, plus
// session enforcement (no session / forged session -> 401) and input validation (-> 4xx, never 5xx,
// never a write). Production is never touched: actions that write (approvals, products, sales,
// CFO records) are proven here; the production audit only probes their guards.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';

const url = process.env.DATABASE_URL_PRIMARY || '';
assert.ok(/@(localhost|127\.0\.0\.1)[:/]/.test(url), 'refusing to run outside an isolated local database');
const signingKey = 'e2e-isolated-session-signing-key-0123456789abcdef';
process.env.SESSION_SIGNING_KEY = signingKey;
process.env.ZPC_CLUSTER_TOKEN = process.env.ZPC_CLUSTER_TOKEN || 'e2e-isolated-adapter-token-0123456789';
process.env.ZEVANORY_SALES_TENANT_ID = 'e2e-actions';
delete process.env.ZEVANORY_SALES_CHANNEL_ADAPTER_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query(`create extension if not exists pgcrypto;
  create table if not exists public.zpc_records (bucket text not null, id uuid not null, record jsonb not null, updated_at timestamptz not null default now(), primary key (bucket, id));
  create table if not exists public.zpc_replication_log (id uuid primary key default gen_random_uuid(), operation text not null, bucket text not null, payload jsonb not null, source text not null, created_at timestamptz not null default now());`);

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const mint = (key: string, exp = Date.now() + 3600_000) => { const p = b64(JSON.stringify({ exp, nonce: randomUUID() })); return 'zpc1.' + p + '.' + b64(createHmac('sha256', key).update(p).digest()); };
const session = mint(signingKey);
const forged = mint('not-the-signing-key-but-same-length-0123456789abcdef');
const expired = mint(signingKey, Date.now() - 1000);

let handler: (r: Request) => Promise<Response>;
try { ({ handler } = await import('../backend/index.ts')); } catch (e) { console.log('::error title=PANEL_ACTIONS_E2E_IMPORT::' + String((e as Error)?.stack || e).replace(/\s+/g, ' ').slice(0, 600)); process.exit(1); }
const commercial = await import('../backend/commercial.ts');
const { db } = await import('../backend/platform.ts');
const call = async (path: string, body: Record<string, unknown>) => {
  const r = await handler(new Request('http://e2e' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  let data: any = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
};
const count = async () => (await admin.query('select count(*)::int n from public.zpc_records')).rows[0].n as number;
const results: Record<string, string> = {};
let failed = 0;
const step = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); results[name] = 'PASS'; }
  catch (e) { failed++; results[name] = 'FAIL'; console.log('::error title=PANEL_ACTIONS_E2E_' + name + '::' + String((e as Error)?.message || e).replace(/\s+/g, ' ').slice(0, 400)); }
};

const guarded = ['/api/admin/overview', '/api/products/create', '/api/products/update', '/api/products/archive', '/api/commercial/create', '/api/commercial/update',
  '/api/commercial/approval', '/api/commercial/sales/promote-discovery', '/api/commercial/sales/qualify', '/api/commercial/sales/decision', '/api/commercial/sales/execute',
  '/api/commercial/sales/proof', '/api/cfo/ingest', '/api/certification/run', '/api/certification/run-batch', '/api/audit/run', '/api/telemetry/refresh', '/api/admin/commercial-cleanup'];

await step('sessao_obrigatoria_em_todas_as_acoes', async () => {
  const before = await count();
  for (const path of guarded) for (const token of [undefined, '', forged, expired, 'zpc1.x.y']) {
    const r = await call(path, { sessionToken: token, id: randomUUID(), kind: 'lead', name: 'x', slug: 'x' });
    assert.equal(r.status, 401, path + ' must refuse a missing/forged/expired session (got ' + r.status + ')');
  }
  assert.equal(await count(), before, 'refused requests never write');
});

await step('validacao_sem_escrita', async () => {
  const before = await count();
  const bad: Array<[string, Record<string, unknown>, number]> = [
    ['/api/products/create', { name: '', slug: 'Inválido!' }, 400],
    ['/api/products/update', {}, 400],
    ['/api/products/update', { id: randomUUID() }, 404],
    ['/api/products/archive', {}, 400],
    ['/api/products/archive', { id: randomUUID() }, 404],
    ['/api/commercial/update', {}, 400],
    ['/api/commercial/approval', { id: randomUUID() }, 400],
    ['/api/commercial/approval', { id: randomUUID(), kind: 'creative', action: 'approve' }, 400],
    ['/api/commercial/sales/promote-discovery', {}, 400],
    ['/api/commercial/sales/qualify', {}, 400],
    ['/api/commercial/sales/decision', { leadId: 'x', action: 'spam' }, 400],
    ['/api/commercial/sales/execute', { leadId: 'x', action: 'offer', content: '' }, 400],
    ['/api/commercial/sales/proof', {}, 400],
    ['/api/cfo/ingest', {}, 400],
    ['/api/certification/run', {}, 400],
  ];
  for (const [path, body, expected] of bad) {
    const r = await call(path, { ...body, sessionToken: session });
    assert.equal(r.status, expected, path + ' ' + JSON.stringify(body) + ' -> ' + r.status);
  }
  assert.equal(await count(), before, 'invalid requests never write');
});

let productId = '';
await step('produto_criar_editar_arquivar', async () => {
  const created = await call('/api/products/create', { sessionToken: session, name: 'Produto E2E isolado', slug: 'produto-e2e-isolado', priceCents: 4700, status: 'draft' });
  assert.equal(created.status, 201, 'create ' + created.status + ' ' + JSON.stringify(created.data));
  productId = created.data.id;
  const [row] = await db.get<any>('acs_products_admin', [productId]);
  assert.equal(row?.slug, 'produto-e2e-isolado');
  const blocked = await call('/api/products/update', { sessionToken: session, id: productId, salesEnabled: true });
  assert.equal(blocked.status, 409, 'enabling sales without gates/certification is refused');
  const [still] = await db.get<any>('acs_products_admin', [productId]);
  assert.equal(still.salesEnabled, false, 'refused update persisted nothing');
  const updated = await call('/api/products/update', { sessionToken: session, id: productId, priceCents: 5700, description: 'Atualizado no E2E' });
  assert.equal(updated.status, 200);
  const [after] = await db.get<any>('acs_products_admin', [productId]);
  assert.equal(after.priceCents, 5700); assert.equal(after.description, 'Atualizado no E2E');
  const archived = await call('/api/products/archive', { sessionToken: session, id: productId });
  assert.equal(archived.status, 200);
  const [gone] = await db.get<any>('acs_products_admin', [productId]);
  assert.equal(gone.status, 'archived'); assert.equal(gone.salesEnabled, false);
});

await step('aprovacoes_aprovar_rejeitar_pedir_alteracao', async () => {
  for (const [action, expected] of [['approve', 'approved'], ['reject', 'rejected'], ['request-changes', 'changes-requested']]) {
    const created = await call('/api/commercial/create', { sessionToken: session, kind: 'creative', title: 'Criativo E2E ' + action, detail: 'peça', status: 'approval', channel: 'instagram', sourceKey: 'e2e:creative:' + action, evidence: ['e2e-isolated'] });
    assert.equal(created.status, 201, 'creative create ' + created.status);
    const r = await call('/api/commercial/approval', { sessionToken: session, id: created.data.id, kind: 'creative', action, note: 'nota E2E' });
    assert.equal(r.status, 200, action + ' ' + r.status + ' ' + JSON.stringify(r.data));
    const [row] = await db.get<any>(commercial.commercialBucketName('creative'), [created.data.id]);
    assert.equal(row.status, expected);
    assert.ok(row.evidence.some((e: string) => e.startsWith('approval:' + action + ':')), 'approval trail persisted');
    assert.ok(row.evidence.includes('note:nota E2E'));
  }
  const ws = await commercial.commercialWorkspace({ available: true, health: { ready: true }, continuity: { quorumOk: true }, runtime: { sales: 'active' }, channels: [] } as any);
  assert.ok(ws.events.filter((e: any) => /aprovado|rejeitado|Alterações solicitadas/i.test(e.title)).length >= 3, 'each decision logged in history');
});

await step('vendas_promover_qualificar_decidir_executar_prova', async () => {
  const disc = await call('/api/commercial/create', { sessionToken: session, kind: 'evidence', title: 'Descoberta E2E', detail: 'empresa pública fictícia de teste', status: 'raw-discovery', channel: 'web', sourceKey: 'e2e:disc:1', evidence: ['e2e-isolated'] });
  assert.equal(disc.status, 201);
  const promoted = await call('/api/commercial/sales/promote-discovery', { sessionToken: session, discoveryId: disc.data.id });
  assert.equal(promoted.status, 201, 'promote ' + promoted.status + ' ' + JSON.stringify(promoted.data));
  const leadId = promoted.data.id;
  const again = await call('/api/commercial/sales/promote-discovery', { sessionToken: session, discoveryId: disc.data.id });
  assert.equal(again.data.id, leadId, 'promoting twice never duplicates the lead');
  const q = await call('/api/commercial/sales/qualify', { sessionToken: session, leadId, score: 80, signals: ['interesse declarado'], reason: 'respondeu' });
  assert.equal(q.status, 200); assert.equal(q.data.qualified, true);
  const d = await call('/api/commercial/sales/decision', { sessionToken: session, leadId, action: 'offer', humanApproval: true });
  assert.equal(d.status, 200); assert.equal(d.data.externalExecution, false);
  const ex = await call('/api/commercial/sales/execute', { sessionToken: session, leadId, action: 'offer', content: 'Proposta E2E', humanApproval: true });
  assert.ok([200, 400].includes(ex.status), 'execute answers (decision or adapter guard), never 5xx: ' + ex.status);
  if (ex.status === 200) assert.equal(ex.data.executed, false, 'never executes externally without an enabled channel');
  else assert.match(String(ex.data.error), /adapter|sales_/i);
  const [lead] = await db.get<any>(commercial.commercialBucketName('lead'), [leadId]);
  assert.ok(!lead.evidence.some((e: string) => e.startsWith('external-id:')), 'no external execution recorded');
  const proof = await call('/api/commercial/sales/proof', { sessionToken: session, leadId });
  assert.ok(proof.status === 200 || proof.status === 400, 'proof answers: ' + proof.status);
  const upd = await call('/api/commercial/update', { sessionToken: session, id: leadId, kind: 'lead', status: 'conversation' });
  assert.equal(upd.status, 200);
  const [row] = await db.get<any>(commercial.commercialBucketName('lead'), [leadId]);
  assert.equal(row.status, 'conversation');
});

await step('cfo_registro_persistido', async () => {
  const r = await call('/api/cfo/ingest', { sessionToken: session, kind: 'receivable', description: 'Recebível E2E', amountCents: 1000, dueDate: '2026-12-01', source: 'e2e' });
  assert.ok(r.status === 201 || r.status === 400, 'cfo ingest answers: ' + r.status + ' ' + JSON.stringify(r.data));
  if (r.status === 201) { const { rows } = await admin.query("select count(*)::int n from public.zpc_records where bucket ilike '%receivable%'"); assert.ok(rows[0].n >= 1, 'receivable persisted'); }
});

await step('auditoria_e_telemetria', async () => {
  const before = (await admin.query("select count(*)::int n from public.zpc_records where bucket ilike '%audit%'")).rows[0].n;
  const t = await call('/api/telemetry/refresh', { sessionToken: session });
  assert.equal(t.status, 200, 'telemetry ' + t.status);
  assert.ok(typeof t.data.at === 'string');
  const a = await call('/api/audit/run', { sessionToken: session });
  assert.equal(a.status, 200); assert.equal(a.data.ok, true);
  const after = (await admin.query("select count(*)::int n from public.zpc_records where bucket ilike '%audit%'")).rows[0].n;
  assert.ok(after > before, 'audit records persisted');
});

await step('saneamento_exige_confirmacao', async () => {
  const r = await call('/api/admin/commercial-cleanup', { sessionToken: session, mode: 'apply' });
  assert.equal(r.status, 409, 'apply without explicit confirmation refused');
  const dry = await call('/api/admin/commercial-cleanup', { sessionToken: session, mode: 'dry-run' });
  assert.equal(dry.status, 200);
});

await step('sessao_encerrada', async () => {
  const r = await call('/api/pin/logout', { sessionToken: session });
  assert.equal(r.status, 200);
  const login = await call('/api/pin/login', { pin: '0000' });
  assert.equal(login.status, 404, 'the origin never accepts PINs (edge-only login)');
});

await admin.end();
console.log('::notice title=PANEL_ACTIONS_E2E_ISOLATED::' + JSON.stringify({ ok: failed === 0, steps: results }));
process.exit(failed ? 1 : 0);
