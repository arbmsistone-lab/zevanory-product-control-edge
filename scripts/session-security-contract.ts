import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setWorkerEnv } from '../cf-worker/platform-worker.ts';
import {
  createEdgeSession,
  guardProxiedEdgeSession,
  revokeEdgeSession,
  setSessionRevocationStore,
  verifyEdgeSession,
} from '../cf-worker/backend-index.ts';

function revocationStore(){
  const values=new Map<string,string>();
  const puts:Array<{key:string;ttl:number}>=[];
  return {
    values,puts,
    async get(key:string){return values.get(key)??null;},
    async put(key:string,value:string,options:{expirationTtl:number}){
      puts.push({key,ttl:options.expirationTtl});
      values.set(key,value);
    },
  };
}

const current='current-session-signing-key-32-bytes-minimum';
const previous='previous-session-signing-key-32-bytes-minimum';
const store=revocationStore();
setSessionRevocationStore(store);

setWorkerEnv({SESSION_SIGNING_KEY:current,SESSION_SIGNING_KEY_PREVIOUS:previous});
const session=await createEdgeSession();
assert.equal(await verifyEdgeSession(session.token),true);
assert.equal(await revokeEdgeSession(session.token),true);
assert.equal(await verifyEdgeSession(session.token),false);
assert.equal(store.puts.length,1);
assert.ok(store.puts[0].key.startsWith('zpc-session-revoked:'));
assert.ok(store.puts[0].ttl>0&&store.puts[0].ttl<=8*3600);

const proxyDenied=await guardProxiedEdgeSession(new Request('https://controle.zevanory.api.br/api/proxied',{
  headers:{authorization:'Bearer '+session.token},
}));
assert.equal(proxyDenied?.status,401);
assert.equal(proxyDenied?.headers.get('cache-control'),'no-store');
assert.deepEqual(await proxyDenied?.json(),{ok:false,error:'session_revoked_or_invalid'});

const originalFetch=globalThis.fetch;
let renderCalls=0;
globalThis.fetch=(async()=>{renderCalls++;return new Response('render-called',{status:200});}) as typeof fetch;
try {
  const {default:worker}=await import('../cf-worker/worker.ts');
  const env={
    SESSION_SIGNING_KEY:current,
    SESSION_SIGNING_KEY_PREVIOUS:previous,
    RENDER_BACKEND_URL:'https://render.invalid',
    T2_CREATIVE_ASSETS:store,
  };
  const bodyDenied=await worker.fetch(new Request('https://controle.zevanory.api.br/api/proxied',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({sessionToken:session.token,preserved:'original-body'}),
  }),env);
  assert.equal(bodyDenied.status,401);
  assert.equal(bodyDenied.headers.get('cache-control'),'no-store');
  assert.deepEqual(await bodyDenied.json(),{ok:false,error:'session_revoked_or_invalid'});
  assert.equal(renderCalls,0);
} finally {
  globalThis.fetch=originalFetch;
}

setWorkerEnv({SESSION_SIGNING_KEY:previous});
const oldSession=await createEdgeSession();
setWorkerEnv({SESSION_SIGNING_KEY:current,SESSION_SIGNING_KEY_PREVIOUS:previous});
assert.equal(await verifyEdgeSession(oldSession.token),true);
assert.equal(await guardProxiedEdgeSession(new Request('https://controle.zevanory.api.br/api/proxied',{headers:{authorization:'Bearer '+oldSession.token}})),null);

setWorkerEnv({SESSION_SIGNING_KEY:current,SESSION_SIGNING_KEY_PREVIOUS:'unknown-session-signing-key-32-bytes-min'});
assert.equal(await verifyEdgeSession(oldSession.token),false);

const worker=await readFile(new URL('../cf-worker/worker.ts',import.meta.url),'utf8');
const backend=await readFile(new URL('../backend/index.ts',import.meta.url),'utf8');
assert.match(worker,/const sessionGuard = await guardProxiedEdgeSession\(request\)/);
assert.match(backend,/const SESSION_HOURS = 8;/);
assert.match(backend,/SESSION_SIGNING_KEY_PREVIOUS/);
const revocationSection=(await readFile(new URL('../cf-worker/backend-index.ts',import.meta.url),'utf8')).slice(
  (await readFile(new URL('../cf-worker/backend-index.ts',import.meta.url),'utf8')).indexOf('export async function verifyEdgeSession'),
  (await readFile(new URL('../cf-worker/backend-index.ts',import.meta.url),'utf8')).indexOf('async function securityState'),
);
assert.ok(!revocationSection.includes('cacheTtl'));

console.log(JSON.stringify({
  session_security:'PASS',
  actual_issue_verify_logout_verify:[true,true,false],
  previous_key_accepted:true,
  unknown_key_rejected:true,
  proxied_revoked_bearer_401:true,
  proxied_revoked_body_401:true,
  render_fake_calls:renderCalls,
  proxy_cache_control:'no-store',
  kv_revocation_read_uncached:true,
  session_hours:8,
}));
