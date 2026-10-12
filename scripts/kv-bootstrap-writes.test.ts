// The panel's bootstrap snapshot must not spend the account's 1,000 KV writes/day: unchanged data
// is not rewritten, and revalidation happens at most every 10 minutes (12/10 quota incident).
import assert from 'node:assert/strict';
import { setWorkerEnv } from '../cf-worker/platform-worker.ts';
import { createEdgeSession, setSessionRevocationStore } from '../cf-worker/backend-index.ts';

const key = 'kv-bootstrap-writes-signing-key-32-bytes-min';
setSessionRevocationStore({ async get() { return null; }, async put() {} } as any);
setWorkerEnv({ SESSION_SIGNING_KEY: key });
const session = await createEdgeSession();
const values = new Map<string, { value: string; metadata: any }>();
let puts = 0;
const store = {
  async get(k: string) { return values.get(k)?.value ?? null; },
  async getWithMetadata(k: string) { const v = values.get(k); return { value: v?.value ?? null, metadata: v?.metadata ?? null }; },
  async put(k: string, value: string, opts: any) { puts++; values.set(k, { value, metadata: opts?.metadata }); },
  async delete(k: string) { values.delete(k); },
};
const body = JSON.stringify({ dashboard: { systems: [] }, commercial: { leads: [] }, products: [] });
const original = globalThis.fetch;
globalThis.fetch = (async () => new Response(body, { status: 200 })) as typeof fetch;
const waits: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p) };
const env = { SESSION_SIGNING_KEY: key, RENDER_BACKEND_URL: 'https://render.invalid', T2_CREATIVE_ASSETS: store };
const { default: worker } = await import('../cf-worker/worker.ts');
const call = () => worker.fetch(new Request('https://controle.zevanory.api.br/api/admin/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionToken: session.token }) }), env, ctx);
try {
  for (let i = 0; i < 20; i++) { const r = await call(); assert.equal(r.status, 200); await Promise.all(waits.splice(0)); }
  assert.equal(puts, 1, '20 panel loads in a row write the snapshot once (got ' + puts + ')');
  // Stale but unchanged: revalidation does not rewrite identical content.
  const v = values.get('zpc-admin-bootstrap-snapshot:v1')!;
  v.metadata.at -= 11 * 60_000;
  await call(); await Promise.all(waits.splice(0));
  assert.equal(puts, 1, 'unchanged content is not rewritten');
} finally { globalThis.fetch = original; }
console.log(JSON.stringify({ kv_bootstrap_writes: 'PASS', puts }));
