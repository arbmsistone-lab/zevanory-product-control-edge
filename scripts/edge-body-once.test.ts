// A valid session must reach the edge handler WITH its body when the auxiliary server refuses or is
// down (owner audit, Mission 10: Produtos answered "sessão inválida" with the PIN active).
import assert from 'node:assert/strict';
import { setWorkerEnv } from '../cf-worker/platform-worker.ts';
import { createEdgeSession, setSessionRevocationStore } from '../cf-worker/backend-index.ts';

const key = 'edge-body-once-signing-key-32-bytes-minimum';
setSessionRevocationStore({ async get() { return null; }, async put() {} } as any);
setWorkerEnv({ SESSION_SIGNING_KEY: key });
const session = await createEdgeSession();
const env = { SESSION_SIGNING_KEY: key, RENDER_BACKEND_URL: 'https://render.invalid', T2_CREATIVE_ASSETS: { async get() { return null; }, async put() {}, async delete() {} } };
const { default: worker } = await import('../cf-worker/worker.ts');
const original = globalThis.fetch;
const results: Record<string, number> = {};
try {
  for (const [mode, fake] of [
    ['auxiliar_401', async () => new Response(JSON.stringify({ error: 'Sessao invalida ou expirada.' }), { status: 401 })],
    ['auxiliar_503', async () => new Response('down', { status: 503 })],
    ['auxiliar_fora', async () => { throw new Error('network'); }],
  ] as const) {
    globalThis.fetch = fake as typeof fetch;
    // Edge route that validates the session first, then the input: 400 proves the body arrived.
    const r = await worker.fetch(new Request('https://controle.zevanory.api.br/api/certification/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionToken: session.token }) }), env);
    assert.equal(r.status, 400, mode + ': valid session must reach the edge handler with its body (got ' + r.status + ')');
    results[mode] = r.status;
    // Route that exists only on the auxiliary server: honest 503, never "sessão inválida".
    const only = await worker.fetch(new Request('https://controle.zevanory.api.br/api/rota-so-no-auxiliar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionToken: session.token }) }), env);
    if (mode !== 'auxiliar_401') assert.equal(only.status, 503, mode + ': auxiliary-only route answers 503');
  }
} finally { globalThis.fetch = original; }
console.log(JSON.stringify({ edge_body_once: 'PASS', results }));
