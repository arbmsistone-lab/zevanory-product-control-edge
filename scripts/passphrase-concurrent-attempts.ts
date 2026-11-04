import assert from 'node:assert/strict';
import worker from '../cf-worker/worker.ts';

// Adversarial concurrent request test: no real credentials and no live destination.
const counters = new Map<string, number>();
const limiter = {
  async limit(input: {key:string}) {
    const seen = (counters.get(input.key) || 0) + 1;
    counters.set(input.key, seen);
    return { success: seen <= 5 };
  },
};
const url = 'https://controle.zevanory.api.br/api/pin/login';
const env = {
  ADMIN_AUTH_MODE: 'passphrase',
  ADMIN_PASSPHRASE: 'sample fake 22-character phrase',
  SESSION_SIGNING_KEY: 'test-only-signing-key-32-characters-minimum',
  PIN_LIMITER: limiter,
  RENDER_BACKEND_URL: '',
};
const makeRequest = (ip:string) => new Request(url, {
  method: 'POST',
  headers: { 'content-type':'application/json','cf-connecting-ip':ip },
  body: JSON.stringify({pin:'incorrect phrase of sufficient length'}),
});
const responses = await Promise.all(Array.from({length:12},(_,i)=>worker.fetch(makeRequest('198.51.100.'+(i+1)),env)));
const statuses=responses.map(r=>r.status);
assert.equal(counters.get('admin-passphrase-global'),12,'global quota required for all IPs');
assert.equal(statuses.filter(x=>x===429).length,7,'seven parallel requests must be rejected by global limiter');
assert.equal(statuses.filter(x=>x===200).length,0,'invalid phrases must never authenticate');
for(const r of responses.filter(x=>x.status===429))assert.equal(r.headers.get('cache-control'),'no-store');

const noBinding = await worker.fetch(makeRequest('192.0.2.1'), { ADMIN_AUTH_MODE:'passphrase' });
assert.equal(noBinding.status,503,'missing limiter cannot fail open');
const failing = await worker.fetch(makeRequest('192.0.2.2'), {...env,PIN_LIMITER:{limit:async()=>{throw Error('provider-unavailable')}}});
assert.equal(failing.status,503,'limiter failure cannot fail open');
console.log('PASSPHRASE_CONCURRENT_LIMITER_PASS global_429=7/12 no_binding_503=true failure_503=true');

// Note: this mock verifies application wiring, NOT globally atomic provider guarantees;
// DB read-modify-write lock behavior still requires a real concurrent backend contract.
