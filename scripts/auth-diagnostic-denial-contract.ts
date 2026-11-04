import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handler as edgeHandler } from '../cf-worker/backend-index.ts';
import worker from '../cf-worker/worker.ts';
import { setWorkerEnv } from '../cf-worker/platform-worker.ts';

const modes = [
  { ADMIN_PIN:'1234', ADMIN_AUTH_MODE:'pin', SESSION_SIGNING_KEY:'this-is-a-long-test-signing-secret-key-1234' },
  { ADMIN_PIN:'1234', ADMIN_AUTH_MODE:'passphrase', ADMIN_PASSPHRASE:'frase longa de auditoria somente teste', SESSION_SIGNING_KEY:'this-is-a-long-test-signing-secret-key-1234' },
];
for(const env of modes){
  setWorkerEnv(env);
  const req = () => new Request('https://controle.zevanory.api.br/api/_auth_diagnostic', {method:'GET'});
  const direct = await edgeHandler(req());
  assert.equal(direct.status,403);
  assert.equal((await direct.json() as any).error,'Diagnóstico interno indisponível.');
  const response = await worker.fetch(req(), env);
  assert.equal(response.status,403,'Edge must reject anonymous diagnostic in both modes');
  assert.equal(response.headers.get('cache-control'),'no-store');
  const payload = await response.json() as any;
  assert.equal(payload.error,'diagnostic_disabled');
}
const edge = await readFile(new URL('../cf-worker/backend-index.ts',import.meta.url),'utf8');
const origin = await readFile(new URL('../backend/index.ts',import.meta.url),'utf8');
const workflow = await readFile(new URL('../.github/workflows/temp-cert-diagnostic.yml',import.meta.url),'utf8');
const edgeRoute = edge.slice(edge.indexOf("'GET /api/_auth_diagnostic'"),edge.indexOf("'POST /api/_session_verify'"));
const originRoute = origin.slice(origin.indexOf("'GET /api/_auth_diagnostic'"),origin.indexOf("'POST /api/_session_verify'"));
assert.match(edgeRoute,/status|403|error\(/);
assert.match(originRoute,/403/);
for(const code of [edgeRoute,originRoute]){
  assert.doesNotMatch(code,/pinLogin|db\.add|createEdgeSession|PIN_CURRENT_SESSION|ADMIN_PIN/,'diagnostic must not mint a session');
}
assert.doesNotMatch(workflow,/curl[^\n]*api\/_auth_diagnostic/,'workflow must not call legacy endpoint');
console.log('AUTH_DIAGNOSTIC_DENIED_PASS edge=403 origin=403 modes=pin,passphrase side_effects=none');
