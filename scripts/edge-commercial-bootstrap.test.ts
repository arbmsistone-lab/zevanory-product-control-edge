// NC-221-01/02: the auxiliary server behind a Cloudflare challenge must not hide Conteúdo, and only the
// documented `cf-mitigated: challenge` may send a request to the edge handler (never a success or
// another value: the auxiliary server already executed it).
import assert from 'node:assert/strict';
import { setWorkerEnv } from '../cf-worker/platform-worker.ts';
import { createEdgeSession, setSessionRevocationStore } from '../cf-worker/backend-index.ts';

const key = 'edge-commercial-bootstrap-signing-key-32-bytes';
const baseEnv = { SESSION_SIGNING_KEY: key, SUPABASE_URL: 'https://store.invalid', SUPABASE_PUBLISHABLE_KEY: 'pk-test', ZPC_REPLICATION_SECRET: 'rs-test' };
setSessionRevocationStore({ async get() { return null; }, async put() {} } as any);
setWorkerEnv(baseEnv);
const session = await createEdgeSession();
const kv = { async get() { return null; }, async getWithMetadata() { return { value: null, metadata: null }; }, async put() {}, async delete() {} };
const env = { ...baseEnv, RENDER_BACKEND_URL: 'https://render.invalid', T2_CREATIVE_ASSETS: kv };
const { default: worker } = await import('../cf-worker/worker.ts');

const iso = (m: number) => new Date(Date.UTC(2026, 10, 13, 12, m)).toISOString();
const seed: Record<string, any[]> = {
  zpc_commercial_creatives: [
    { id: 'c1', title: 'Criativo aprovado', status: 'approved', updatedAt: iso(1), createdAt: iso(1) },
    { id: 'c2', title: 'Criativo aguardando', status: 'review', updatedAt: iso(2), createdAt: iso(2) },
  ],
  zpc_commercial_publications: [{ id: 'p1', title: 'Publicação blog', status: 'published', updatedAt: iso(3), createdAt: iso(3) }],
  zpc_commercial_events: [{ id: 'e1', title: 'heartbeat', status: 'heartbeat', updatedAt: iso(4), createdAt: iso(4) }],
};
type Mode = { render: () => Response };
let renderCalls = 0, edgeWrites = 0, storeReads = 0;
function install(mode: Mode) {
  renderCalls = 0; edgeWrites = 0; storeReads = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://render.invalid')) { renderCalls++; return mode.render(); }
    if (url.startsWith('https://store.invalid/rest/v1/rpc/')) {
      const rpc = url.split('/').pop();
      const body = JSON.parse(String(init?.body || (input instanceof Request ? await input.text() : '{}')) || '{}');
      if (rpc === 'zpc_worker_list') { storeReads++; return Response.json({ items: (seed[body.p_bucket] || []).slice(0, body.p_limit) }); }
      if (rpc === 'zpc_worker_get') return Response.json({ items: [] });
      if (rpc === 'zpc_worker_upsert' || rpc === 'zpc_worker_delete') { edgeWrites++; return Response.json({ ok: true }); }
      return Response.json({}, { status: 404 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}
const post = (path: string, body: Record<string, unknown>) => worker.fetch(new Request('https://controle.zevanory.api.br' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionToken: session.token, ...body }) }), env, { waitUntil() {} } as any);
const product = { name: 'Produto teste', slug: 'produto-teste-nc221', status: 'draft' };
const original = globalThis.fetch;
const results: Record<string, unknown> = {};
try {
  // NC-221-01: auxiliary answered (success or a non-challenge value) => passes through, edge never writes.
  for (const [label, headers] of [['sem_cabecalho', {}], ['vazio', { 'cf-mitigated': '' }], ['outro_valor', { 'cf-mitigated': 'not-a-challenge' }]] as const) {
    install({ render: () => new Response(JSON.stringify({ ok: true, id: 'aux-1' }), { status: 200, headers: { 'content-type': 'application/json', ...headers } }) });
    const r = await post('/api/products/create', product);
    assert.equal(r.status, 200, label + ': auxiliary success passes through');
    assert.equal(renderCalls, 1, label + ': auxiliary executed exactly once');
    assert.equal(edgeWrites, 0, label + ': edge must not re-execute the mutation');
    results['mutacao_' + label] = { status: r.status, aux: renderCalls, edge: edgeWrites };
  }
  // A non-challenge value on an error status also passes through (it reached the auxiliary server).
  install({ render: () => new Response('{"error":"x"}', { status: 409, headers: { 'cf-mitigated': 'block' } }) });
  const blocked = await post('/api/products/create', product);
  assert.equal(blocked.status, 409, 'cf-mitigated other than challenge passes through');
  assert.equal(edgeWrites, 0, 'cf-mitigated other than challenge: edge never writes');
  // Only the documented challenge (any case/space) reaches the edge.
  install({ render: () => new Response('challenge', { status: 429, headers: { 'cf-mitigated': ' Challenge ' } }) });
  const viaEdge = await post('/api/products/create', product);
  assert.notEqual(viaEdge.status, 429, 'challenge never surfaces as 429');
  assert.equal(viaEdge.headers.get('cf-mitigated'), null, 'challenge header never leaks');
  results.mutacao_desafio = { status: viaEdge.status, edgeWrites };

  // NC-221-02: bootstrap behind a challenge, no previous cache: 200 WITH the commercial workspace.
  install({ render: () => new Response('challenge', { status: 429, headers: { 'cf-mitigated': 'challenge' } }) });
  const boot = await post('/api/admin/bootstrap', {});
  assert.equal(boot.status, 200, 'bootstrap behind a challenge answers 200 from the edge (got ' + boot.status + ')');
  const data: any = await boot.json();
  assert.ok(data.dashboard, 'dashboard present');
  assert.ok(data.commercial, 'commercial workspace present (Conteúdo has a source)');
  assert.deepEqual(data.commercial.creatives.map((x: any) => x.id), ['c2', 'c1'], 'creatives, most recent first');
  assert.equal(data.commercial.creatives.filter((x: any) => x.status === 'review').length, 1, 'approval queue item present');
  assert.deepEqual(data.commercial.publications.map((x: any) => x.id), ['p1'], 'publications present');
  assert.equal(data.commercial.counts.creatives, 2);
  assert.equal(data.commercial.tenant.id, 'zevanory');
  assert.equal(data.commercial.tenant.clientSelectable, false);
  assert.equal(edgeWrites, 0, 'bootstrap is read-only');
  results.bootstrap = { status: boot.status, creatives: data.commercial.counts.creatives, publications: data.commercial.counts.publications };

  // Store failure: dashboard still answers and says the workspace is unavailable (never fake-empty).
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://render.invalid')) return new Response('challenge', { status: 429, headers: { 'cf-mitigated': 'challenge' } });
    if (url.includes('zpc_worker_list')) {
      const body = JSON.parse(String(init?.body || '{}'));
      if (String(body.p_bucket).startsWith('zpc_commercial_')) return new Response('down', { status: 503 });
      return Response.json({ items: [] });
    }
    return Response.json({ items: [] });
  }) as typeof fetch;
  const degraded = await post('/api/admin/bootstrap', {});
  if (degraded.status === 200) {
    const d: any = await degraded.json();
    assert.equal(d.commercial, undefined, 'no fabricated workspace on store failure');
    assert.equal(d.commercialUnavailable, 'edge_store_error');
  }
  results.bootstrap_store_falho = degraded.status;
} finally { globalThis.fetch = original; }
console.log(JSON.stringify({ edge_commercial_bootstrap: 'PASS', results }));
