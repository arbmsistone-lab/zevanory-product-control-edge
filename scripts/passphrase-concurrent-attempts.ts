import assert from 'node:assert/strict';
import worker from '../cf-worker/worker.ts';
import { adminAuthSourceKey, AGGREGATE_HOT_FAILURES, hasTrustedDevice, TRUSTED_DEVICE_COOKIE } from '../cf-worker/admin-auth-throttle.ts';

// DEC-13(a) adversarial contract: per-source limits first, no global lock, aggregate only tightens
// untrusted sources, fail closed. No real credentials and no live destination: the store RPC is an
// in-memory mock and any other outbound fetch fails the test.

// ---- Cloudflare rate-limit binding mock (single binding, 5 per key per window, like wrangler.toml) ----
const counters = new Map<string, number>();
const limiter = {
  calls: [] as string[],
  async limit(input: { key: string }) {
    this.calls.push(input.key);
    const seen = (counters.get(input.key) || 0) + 1;
    counters.set(input.key, seen);
    return { success: seen <= 5 };
  },
};
const nextMinute = () => counters.clear();

// ---- In-memory portable store (including the transactional RPC contract) ----
const STORE = 'https://store.example.invalid';
const records = new Map<string, Map<string, any>>();
const bucket = (name: string) => { if (!records.has(name)) records.set(name, new Map()); return records.get(name)!; };
const realFetch = globalThis.fetch;
let storeDown = false;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url || input);
  if (!url.startsWith(STORE + '/rest/v1/rpc/')) throw new Error('unexpected outbound fetch in contract: ' + url);
  if (storeDown) throw new Error('store-unavailable');
  const rpc = url.slice((STORE + '/rest/v1/rpc/').length);
  const body = JSON.parse(String(init?.body || '{}'));
  if (rpc === 'zpc_passphrase_attempt') {
    const sid = String(body.p_source_id);
    const fingerprint = String(body.p_fingerprint);
    const source = bucket('acs_passphrase_source_security');
    const aggregate = bucket('acs_passphrase_aggregate_security');
    const aid = '00000000-0000-8000-8000-00000000da13';
    const previous = source.get(sid);
    const state = previous?.fingerprint === fingerprint ? previous : { failedAttempts: 0, locks: 0, lockedUntil: null, fingerprint };
    const now = Date.now();
    if (state.lockedUntil && Date.parse(state.lockedUntil) > now)
      return new Response(JSON.stringify({status:429,locked:true}),{headers:{'content-type':'application/json'}});
    if (body.p_valid === true) {
      source.set(sid,{failedAttempts:0,locks:0,lockedUntil:null,fingerprint,updatedAt:new Date(now).toISOString()});
      return new Response(JSON.stringify({status:200,locked:false}),{headers:{'content-type':'application/json'}});
    }
    const priorAggregate = aggregate.get(aid);
    const windowOpen = priorAggregate && now-Date.parse(priorAggregate.windowStart)<15*60_000;
    const total = (windowOpen ? priorAggregate.failures : 0)+1;
    aggregate.set(aid,{windowStart:windowOpen?priorAggregate.windowStart:new Date(now).toISOString(),failures:total,updatedAt:new Date(now).toISOString()});
    const threshold = total>=25 && !body.p_trusted ? 3 : 5;
    const failures = Number(state.failedAttempts||0)+1;
    const locking = failures>=threshold;
    const locks = Number(state.locks||0)+(locking?1:0);
    source.set(sid,{failedAttempts:locking?0:failures,locks,lockedUntil:locking?new Date(now+Math.min(120,15*2**Math.max(0,locks-1))*60_000).toISOString():null,fingerprint,updatedAt:new Date(now).toISOString()});
    return new Response(JSON.stringify({status:401,locked:locking}),{headers:{'content-type':'application/json'}});
  }
  const b = bucket(String(body.p_bucket));
  const ok = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  if (rpc === 'zpc_worker_list') return ok({ items: [...b.entries()].slice(0, body.p_limit).map(([id, r]) => ({ ...r, id })) });
  if (rpc === 'zpc_worker_get') return ok({ items: (body.p_ids as string[]).filter(id => b.has(id)).map(id => ({ ...b.get(id), id })) });
  if (rpc === 'zpc_worker_upsert') {
    for (const item of body.p_items) {
      const id = String(item.id);
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'store ids must be uuids');
      const current = b.get(id);
      if (!current || String(item.record?.updatedAt || '') >= String(current.updatedAt || '')) b.set(id, item.record);
    }
    return ok({ ids: body.p_items.map((i: any) => i.id) });
  }
  if (rpc === 'zpc_worker_delete') { for (const id of body.p_ids) b.delete(id); return ok({ ids: body.p_ids }); }
  throw new Error('unsupported rpc ' + rpc);
}) as typeof fetch;

const OWNER_PHRASE = 'contract-only owner phrase 2026, not real';
const env = {
  ADMIN_AUTH_MODE: 'passphrase',
  ADMIN_PASSPHRASE: OWNER_PHRASE,
  SESSION_SIGNING_KEY: 'test-only-signing-key-32-characters-minimum',
  SUPABASE_URL: STORE,
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
  ZPC_REPLICATION_SECRET: 'test-replication',
  PIN_LIMITER: limiter,
  RENDER_BACKEND_URL: '',
};
const url = 'https://controle.zevanory.api.br/api/pin/login';
const attempt = (ip: string, pin = 'incorrect phrase of sufficient length', extra: Record<string, string> = {}, e: any = env) =>
  worker.fetch(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...extra }, body: JSON.stringify({ pin }) }), e);
const message = async (r: Response) => String((await r.clone().json().catch(() => ({})) as any)?.error || '');

// ---- 0. Identity: CF-Connecting-IP only; spoofable headers ignored; IPv6 grouped by /64 ----
const h = (o: Record<string, string>) => new Headers(o);
assert.equal(adminAuthSourceKey(h({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.9' })), 'ip4:198.51.100.7');
assert.equal(adminAuthSourceKey(h({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.9', 'true-client-ip': '203.0.113.9' })), 'unattributed');
assert.equal(adminAuthSourceKey(h({ 'cf-connecting-ip': '2001:db8:1:2:aaaa::1' })), adminAuthSourceKey(h({ 'cf-connecting-ip': '2001:0db8:0001:0002:ffff:1:2:3' })));
assert.notEqual(adminAuthSourceKey(h({ 'cf-connecting-ip': '2001:db8:1:2::1' })), adminAuthSourceKey(h({ 'cf-connecting-ip': '2001:db8:1:3::1' })));
assert.equal(adminAuthSourceKey(h({ 'cf-connecting-ip': '::ffff:198.51.100.7' })), 'ip4:198.51.100.7');
assert.equal(adminAuthSourceKey(h({ 'cf-connecting-ip': 'not-an-ip' })), 'unattributed');

// ---- 1. Per-source limit is consumed FIRST; aggregate bucket is consulted only afterwards ----
limiter.calls.length = 0;
assert.equal((await attempt('192.0.2.200')).status, 401);
assert.deepEqual(limiter.calls, ['passphrase-src:ip4:192.0.2.200', 'admin-passphrase-aggregate'], 'per-source before aggregate');
nextMinute();

// ---- 2. 12 simultaneous sources failing: every one is evaluated (401), nobody gets a global 429 ----
const parallel = await Promise.all(Array.from({ length: 12 }, (_, i) => attempt('198.51.100.' + (i + 1))));
const statuses = parallel.map(r => r.status);
assert.equal(statuses.filter(s => s === 401).length, 12, 'aggregate pressure must not reject sources by itself: ' + statuses);
assert.equal(statuses.filter(s => s === 200).length, 0, 'invalid phrases must never authenticate');
assert.equal(counters.get('admin-passphrase-aggregate'), 12, 'aggregate counts all untrusted sources');
for (let i = 1; i <= 12; i++) assert.ok((counters.get('passphrase-src:ip4:198.51.100.' + i) || 0) >= 1, 'per-source bucket per IP');
assert.equal(records.get('acs_pin_security')?.size || 0, 0, 'passphrase mode must never write the shared global lock record');
// While the aggregate bucket is hot, an untrusted source pays 2 tokens per attempt: 2 attempts, third is 429.
assert.equal((await attempt('198.51.100.50')).status, 401);
assert.equal((await attempt('198.51.100.50')).status, 401);
assert.equal((await attempt('198.51.100.50')).status, 429, 'stricter per-source edge limit under aggregate pressure');
// A clean source still reaches authentication during the attack (no global block).
const ownerDuringBurst = await attempt('203.0.113.10', OWNER_PHRASE);
assert.equal(ownerDuringBurst.status, 200, 'owner from a clean source must log in during a distributed burst');
nextMinute();

// ---- 3. One source repeating failures gets locked (edge per-minute AND durable progressive lock) ----
const repeat = '192.0.2.77';
for (let i = 1; i <= 5; i++) assert.equal((await attempt(repeat)).status, 401, 'attempt ' + i);
assert.equal((await attempt(repeat)).status, 429, 'edge per-source limit: 6th attempt inside one minute');
// Spoofing a different X-Forwarded-For does not grant a fresh bucket.
assert.equal((await attempt(repeat, 'x', { 'x-forwarded-for': '203.0.113.200' })).status, 429, 'XFF must not change identity');
nextMinute();
nextMinute();
// Durable lock persists across minutes and blocks even the correct phrase from THAT source only.
const lockedSourceOwner = await attempt(repeat, OWNER_PHRASE);
assert.equal(lockedSourceOwner.status, 429, 'locked source cannot brute-force through the lock');
assert.match(await message(lockedSourceOwner), /bloqueado/);
const otherSource = await attempt('203.0.113.11', OWNER_PHRASE);
assert.equal(otherSource.status, 200, 'a per-source lock must never lock the owner account globally');
nextMinute();

// ---- 4. Ongoing distributed attack across "colos"/minutes makes the durable aggregate hot ----
// The durable aggregate is a lossy read-modify-write signal: parallel bursts may under-count, so the
// attack continues in rounds (as a sustained attack would) until the signal is hot.
let attackers = 0;
const aggregateFailures = () => Number([...(records.get('acs_passphrase_aggregate_security')?.values() || [])][0]?.failures || 0);
for (let round = 0; aggregateFailures() < AGGREGATE_HOT_FAILURES; round++) {
  assert.ok(round < 40, 'aggregate signal never became hot');
  const batch = await Promise.all(Array.from({ length: 12 }, (_, i) => attempt(`10.${round}.0.${i + 1}`)));
  attackers += batch.filter(r => r.status === 401).length;
  assert.equal(batch.filter(r => r.status === 401).length, 12, 'distributed sources are each evaluated, never globally blocked');
  nextMinute();
}
// Under the hot aggregate an untrusted attacker source locks after 3 failures instead of 5.
const hotAttacker = '192.0.2.88';
for (let i = 1; i <= 3; i++) { assert.equal((await attempt(hotAttacker)).status, 401); nextMinute(); }
assert.equal((await attempt(hotAttacker, OWNER_PHRASE)).status, 429, 'untrusted source locks sooner under attack');
// Legitimate login from a clean source succeeds during the ongoing attack, and marks the device trusted.
const owner = await attempt('203.0.113.50', OWNER_PHRASE);
assert.equal(owner.status, 200, 'owner from clean source must succeed during ongoing distributed attack');
const body = await owner.json() as any;
assert.match(String(body.sessionToken), /^zpc1\./);
const setCookie = String(owner.headers.get('set-cookie') || '');
assert.match(setCookie, new RegExp('^' + TRUSTED_DEVICE_COOKIE + '=td1\\.'));
assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Strict/);
const cookie = setCookie.split(';')[0];
assert.equal(await hasTrustedDevice(new Headers({ cookie }), env.SESSION_SIGNING_KEY), true);
assert.equal(await hasTrustedDevice(new Headers({ cookie: cookie.slice(0, -2) + 'AA' }), env.SESSION_SIGNING_KEY), false, 'forged cookie rejected');
assert.equal(await hasTrustedDevice(new Headers({ cookie }), 'another-signing-key-of-32-characters-xx'), false, 'cookie bound to signing key');
// Trusted device bypasses the aggregate tightening (Worker bucket exhausted + durable aggregate hot):
for (let i = 0; i < 6; i++) await limiter.limit({ key: 'admin-passphrase-aggregate' });
limiter.calls.length = 0;
assert.equal((await attempt('203.0.113.51', 'owner typo phrase, long enough', { cookie })).status, 401);
assert.deepEqual(limiter.calls, ['passphrase-src:ip4:203.0.113.51'], 'trusted device: one per-source token, no aggregate penalty');
for (let i = 2; i <= 4; i++) { nextMinute(); assert.equal((await attempt('203.0.113.51', 'owner typo phrase, long enough', { cookie })).status, 401, 'trusted typo ' + i + ' keeps normal threshold'); }
nextMinute();
assert.equal((await attempt('203.0.113.51', OWNER_PHRASE, { cookie })).status, 200, 'trusted owner keeps the normal 5-failure threshold');
nextMinute();

// ---- 5. Fail closed ----
const noBinding = await attempt('192.0.2.1', 'x', {}, { ...env, PIN_LIMITER: undefined });
assert.equal(noBinding.status, 503, 'missing limiter cannot fail open');
const failing = await attempt('192.0.2.2', 'x', {}, { ...env, PIN_LIMITER: { limit: async () => { throw Error('provider-unavailable'); } } });
assert.equal(failing.status, 503, 'limiter failure cannot fail open');
let n = 0;
const failingAggregate = await attempt('192.0.2.3', 'x', {}, { ...env, PIN_LIMITER: { limit: async () => { if (n++) throw Error('aggregate-down'); return { success: true }; } } });
assert.equal(failingAggregate.status, 503, 'aggregate limiter failure cannot fail open');
storeDown = true;
const noStore = await attempt('192.0.2.4', OWNER_PHRASE);
assert.equal(noStore.status, 503, 'lock store unavailable fails closed, even for the correct phrase');
storeDown = false;
for (const r of [noBinding, failing, failingAggregate, noStore]) assert.equal(r.headers.get('cache-control'), 'no-store');

// ---- 6. Legacy PIN mode untouched: per-IP 'pin:' bucket only, shared global lock record still used ----
nextMinute(); limiter.calls.length = 0;
const pinEnv = { ...env, ADMIN_AUTH_MODE: '', ADMIN_PASSPHRASE: '', ADMIN_PIN: '4821' };
const pinFail = await attempt('198.51.100.9', '0000', {}, pinEnv);
assert.equal(pinFail.status, 401);
assert.deepEqual(limiter.calls, ['pin:198.51.100.9'], 'PIN mode keeps its original per-IP key and no aggregate');
assert.equal(records.get('acs_pin_security')?.size, 1, 'PIN mode keeps the global progressive lock record');
assert.equal(pinFail.headers.get('set-cookie'), null, 'no trusted-device cookie in PIN mode');

globalThis.fetch = realFetch;
console.log(`PASSPHRASE_CONCURRENT_LIMITER_PASS parallel_12_all_evaluated=true global_lock=none per_source_lock=true owner_during_attack=200 trusted_bypass=true fail_closed_503=4 pin_mode_unchanged=true attackers=${attackers}`);
// Note: the limiter mock verifies wiring/order, not Cloudflare's per-colo eventual consistency; the
// durable store mock applies the same monotonic-updatedAt upsert as zpc_worker_upsert but does not
// prove transaction isolation. The PostgreSQL integration gate must do that.
