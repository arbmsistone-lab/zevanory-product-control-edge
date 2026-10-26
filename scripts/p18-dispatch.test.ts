// P18 external trigger (AVAL Sol 253/254): behavioural tests of cf-worker/p18-dispatch.ts with mocked fetch and KV,
// plus the real scheduled() handler of cf-worker/worker.ts (legacy duties untouched, P18 in its own waitUntil).
// No network: every fetch is a fake; a test that reaches the real network fails (globalThis.fetch is replaced).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALERT_CATEGORY, ALERT_CHANNEL, ALERT_PREFIX, CHECKPOINT_MS, HEARTBEAT_SCHEMA, MAX_FETCH_SUBREQUESTS, P18_DISPATCH_URL, P18_HEARTBEAT_URL,
  MAX_CRON_FETCH_SUBREQUESTS, P18_REF, P18_WATCHDOG_DISPATCH_URL, STATE_KEY, WATCHDOG_STATE_KEY, WATCHDOG_STATE_TTL_S,
  WRITE_CAP_PER_HOUR, classifyDispatch, decide, dispatchMonitor, dispatchWatchdog, isLegacyDutyMinute, isWatchdogDispatchMinute,
  readHeartbeat, runHourlyWatchdogDispatch, runP18ExternalTrigger, watchdogWindowIdOf, windowIdOf,
  type DispatchResult, type HeartbeatResult, type P18State,
} from '../cf-worker/p18-dispatch.ts';

const TOKEN = 'github_pat_FAKE_TEST_VALUE_0123456789abcdef_NOT_A_REAL_TOKEN';
const T = (hms: string, day = '2026-10-25') => Date.parse(`${day}T${hms}Z`);
let n = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  n += 1;
  console.log('ok - ' + name);
}
// AbortSignal.timeout timers are unref'd in Node: keep the loop alive while hung fakes wait for the abort.
const keepAlive = setInterval(() => {}, 1000);
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error('REAL_NETWORK_FORBIDDEN_IN_TEST'); }) as typeof fetch;

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = async (url: string, init: RequestInit = {}) => { calls.push({ url, init }); return handler(url, init); };
  return { calls, f };
}
const hbDoc = (lastSuccessMs: number, extra: Record<string, unknown> = {}) => JSON.stringify({ schema: HEARTBEAT_SCHEMA, last_success_at: new Date(lastSuccessMs).toISOString(), run_id: '123', window_id: 'p18w-20261025T1000Z', dispatch_to_start_s: 19, ...extra });
function net({ dispatchStatus = 204, dispatchHeaders = {}, dispatchBody = '', hb = (now: number) => new Response(hbDoc(now - 60_000), { status: 200 }) }: {
  dispatchStatus?: number; dispatchHeaders?: Record<string, string>; dispatchBody?: string; hb?: (now: number) => Response;
} = {}, nowRef: { t: number }) {
  return fakeFetch((url) => {
    if (url === P18_DISPATCH_URL) return new Response(dispatchStatus === 204 ? null : dispatchBody, { status: dispatchStatus, headers: dispatchHeaders });
    if (url === P18_HEARTBEAT_URL) return hb(nowRef.t);
    return new Response('unexpected url', { status: 599 });
  });
}
function fakeKv() {
  const store = new Map<string, string>();
  const puts: { key: string; value: string; ttl?: number }[] = [];
  let failGet = false, failPut = false;
  return {
    store, puts,
    setFailGet(v: boolean) { failGet = v; }, setFailPut(v: boolean) { failPut = v; },
    async get(key: string) { if (failGet) throw new Error('kv down'); return store.get(key) ?? null; },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) { if (failPut) throw new Error('kv down'); store.set(key, value); puts.push({ key, value, ttl: opts?.expirationTtl }); },
    alerts() { return [...store.entries()].filter(([k]) => k.startsWith(ALERT_PREFIX)).map(([k, v]) => ({ key: k, ...JSON.parse(v) })); },
  };
}
// Same masking as the central digest (zevanory-public-mirror worker/owner-alerts.mjs maskExcerpt): the alert must
// survive it intact, i.e. carry no e-mail, no long digit run and no ISO timestamp.
const maskExcerpt = (t: string) => String(t || '').replace(/[^\s@<>()]+@[^\s@<>()]+/g, '***@***').replace(/\+?\d[\d\s().-]{7,}\d/g, '***').slice(0, 280);
const ALLOWED_OWNER_ALERTS = new Set(['channel_down', 'compliance_rejected_3x', 'refund', 'complaint', 'financial_proof_stale']);

await test('W1 window id: 5-minute window from scheduledTime, aligned to minute 0; legacy duties only at 0/15/30/45', () => {
  assert.equal(windowIdOf(T('10:04:59')), 'p18w-20261025T1000Z', 'W1-floor');
  assert.equal(windowIdOf(T('10:05:00')), 'p18w-20261025T1005Z', 'W1-edge');
  assert.equal(windowIdOf(T('23:59:59')), 'p18w-20261025T2355Z');
  for (const m of [0, 15, 30, 45]) assert.equal(isLegacyDutyMinute(T(`10:${String(m).padStart(2, '0')}:00`)), true, 'W1-legacy ' + m);
  for (const m of [5, 10, 20, 25, 35, 40, 50, 55]) assert.equal(isLegacyDutyMinute(T(`10:${String(m).padStart(2, '0')}:00`)), false, 'W1-not-legacy ' + m);
});

await test('W2 watchdog window: deterministic UTC hour and due only at minute 00 of the existing */5 cron', () => {
  assert.equal(watchdogWindowIdOf(T('10:59:59')), 'p18wd-20261025T10Z', 'W2-hour-floor');
  assert.equal(watchdogWindowIdOf(T('11:00:00')), 'p18wd-20261025T11Z', 'W2-hour-edge');
  assert.equal(isWatchdogDispatchMinute(T('10:00:00')), true, 'W2-due-00');
  for (const m of [5, 10, 15, 30, 55]) assert.equal(isWatchdogDispatchMinute(T(`10:${String(m).padStart(2, '0')}:00`)), false, 'W2-not-due-' + m);
});

await test('C1 every GitHub status code is classified (200/204 accepted; 401/403/404/422/429/5xx/other)', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  const cases: [number, Headers | undefined, string][] = [
    [200, undefined, 'accepted'], [204, undefined, 'accepted'], [401, undefined, 'auth'], [403, undefined, 'forbidden'],
    [403, h({ 'x-ratelimit-remaining': '0' }), 'rate_limited'], [403, h({ 'retry-after': '60' }), 'rate_limited'],
    [404, undefined, 'not_found'], [422, undefined, 'invalid'], [429, undefined, 'rate_limited'],
    [500, undefined, 'unavailable'], [502, undefined, 'unavailable'], [503, undefined, 'unavailable'], [504, undefined, 'unavailable'],
    [201, undefined, 'unexpected'], [301, undefined, 'unexpected'], [400, undefined, 'unexpected'], [418, undefined, 'unexpected'],
  ];
  for (const [s, hd, want] of cases) assert.equal(classifyDispatch(s, hd), want, `C1-${s}${hd ? '-limited' : ''}`);
});

await test('D1 dispatch request: exact endpoint, POST, Bearer token, ref gh-pages, window inputs, return_run_details; 200 gives the run id', async () => {
  const nowRef = { t: T('10:00:01') };
  const { calls, f } = net({ dispatchStatus: 200, dispatchBody: JSON.stringify({ workflow_run_id: 40299, run_url: 'x', html_url: 'https://github.com/arbmsistone-lab/zevanory-public-mirror/actions/runs/40299' }) }, nowRef);
  const r = await dispatchMonitor({ token: TOKEN, windowId: 'p18w-20261025T1000Z', dispatchedAt: '2026-10-25T10:00:01.000Z', fetchImpl: f });
  assert.equal(r.outcome, 'accepted', 'D1-accepted'); assert.equal(r.http_status, 200); assert.equal(r.run_id, 40299, 'D1-run-id');
  assert.equal(r.run_url, 'https://github.com/arbmsistone-lab/zevanory-public-mirror/actions/runs/40299');
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://api.github.com/repos/arbmsistone-lab/zevanory-public-mirror/actions/workflows/p18-external-monitor.yml/dispatches', 'D1-url');
  assert.equal(calls[0].init.method, 'POST');
  const hd = calls[0].init.headers as Record<string, string>;
  assert.equal(hd.authorization, 'Bearer ' + TOKEN); assert.equal(hd['x-github-api-version'], '2022-11-28'); assert.ok(hd['user-agent'], 'GitHub requires a User-Agent');
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body, { ref: P18_REF, inputs: { window_id: 'p18w-20261025T1000Z', dispatched_at: '2026-10-25T10:00:01.000Z', dispatch_source: 'cloudflare-cron' }, return_run_details: true }, 'D1-body');
  assert.ok(calls[0].init.signal instanceof AbortSignal, 'D1-timeout-signal');
  // 204 (older API behaviour): accepted, run id unknown.
  const r204 = await dispatchMonitor({ token: TOKEN, windowId: 'w', dispatchedAt: 'x', fetchImpl: net({ dispatchStatus: 204 }, nowRef).f });
  assert.equal(r204.outcome, 'accepted', 'D1-204'); assert.equal(r204.run_id, null, 'D1-204-no-run-id');
  // 200 with a foreign html_url or junk body: accepted but nothing invented.
  const rj = await dispatchMonitor({ token: TOKEN, windowId: 'w', dispatchedAt: 'x', fetchImpl: net({ dispatchStatus: 200, dispatchBody: '{"workflow_run_id":"9","html_url":"https://evil.example/x"}' }, nowRef).f });
  assert.equal(rj.run_id, null, 'D1-no-string-id'); assert.equal(rj.run_url, null, 'D1-no-foreign-url');
  // No token: no request at all.
  const u = fakeFetch(() => new Response(null, { status: 204 }));
  assert.equal((await dispatchMonitor({ token: '', windowId: 'w', dispatchedAt: 'x', fetchImpl: u.f })).outcome, 'unconfigured', 'D1-unconfigured');
  assert.equal(u.calls.length, 0, 'D1-unconfigured-no-fetch');
});

await test('D2 timeout and network: a hung GitHub is cut by the AbortSignal within the budget; a thrown fetch is "network"', async () => {
  const hung = (_u: string, init: RequestInit = {}) => new Promise<Response>((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const t0 = Date.now();
  const r = await dispatchMonitor({ token: TOKEN, windowId: 'w', dispatchedAt: 'x', fetchImpl: hung, timeoutMs: 80 });
  assert.equal(r.outcome, 'timeout', 'D2-timeout'); assert.equal(r.http_status, null);
  assert.ok(Date.now() - t0 < 1500, 'D2-timeout-bounded');
  const net2 = await dispatchMonitor({ token: TOKEN, windowId: 'w', dispatchedAt: 'x', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(net2.outcome, 'network', 'D2-network');
  const hb = await readHeartbeat({ fetchImpl: hung, nowMs: T('10:00:00'), timeoutMs: 80 });
  assert.equal(hb.state, 'TIMEOUT', 'D2-heartbeat-timeout');
  const ra = await dispatchMonitor({ token: TOKEN, windowId: 'w', dispatchedAt: 'x', fetchImpl: net({ dispatchStatus: 429, dispatchHeaders: { 'retry-after': '120' } }, { t: 0 }).f });
  assert.equal(ra.outcome, 'rate_limited', 'D2-429'); assert.equal(ra.retry_after_s, 120, 'D2-retry-after-recorded');
});

await test('WD1 watchdog request: exact workflow, same token, no invented inputs, run details recorded', async () => {
  const { calls, f } = fakeFetch(() => new Response(JSON.stringify({ workflow_run_id: 99001, html_url: 'https://github.com/arbmsistone-lab/zevanory-public-mirror/actions/runs/99001' }), { status: 200 }));
  const r = await dispatchWatchdog({ token: TOKEN, fetchImpl: f });
  assert.equal(r.outcome, 'accepted', 'WD1-accepted'); assert.equal(r.run_id, 99001, 'WD1-run-id');
  assert.equal(calls.length, 1, 'WD1-one-fetch');
  assert.equal(calls[0].url, 'https://api.github.com/repos/arbmsistone-lab/zevanory-public-mirror/actions/workflows/p18-monitor-watchdog.yml/dispatches', 'WD1-url');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { ref: P18_REF, return_run_details: true }, 'WD1-body');
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer ' + TOKEN, 'WD1-same-token');
  assert.equal((calls[0].init.headers as Record<string, string>)['user-agent'], 'zevanory-control-p18-watchdog-dispatch', 'WD1-user-agent');
});

await test('WD2 hourly idempotency: one request and one marker write; repeats and non-hour slots do no work', async () => {
  const kv = fakeKv(), lines: string[] = [];
  const { calls, f } = fakeFetch(() => new Response(null, { status: 204 }));
  const env = { P18_DISPATCH_TOKEN: TOKEN, T2_CREATIVE_ASSETS: kv };
  const first = await runHourlyWatchdogDispatch({ env, scheduledTime: T('10:00:00'), fetchImpl: f, now: () => T('10:00:02'), log: l => lines.push(l) });
  assert.equal(first.dispatch?.outcome, 'accepted', 'WD2-first-accepted'); assert.equal(first.window_id, 'p18wd-20261025T10Z');
  assert.equal(kv.store.get(WATCHDOG_STATE_KEY), first.window_id, 'WD2-marker');
  assert.equal(kv.puts.find(p => p.key === WATCHDOG_STATE_KEY)?.ttl, WATCHDOG_STATE_TTL_S, 'WD2-marker-ttl');
  const duplicate = await runHourlyWatchdogDispatch({ env, scheduledTime: T('10:00:00'), fetchImpl: f, now: () => T('10:00:03'), log: l => lines.push(l) });
  assert.equal(duplicate.duplicate, true, 'WD2-duplicate'); assert.equal(calls.length, 1, 'WD2-no-second-fetch');
  const quiet = await runHourlyWatchdogDispatch({ env, scheduledTime: T('10:05:00'), fetchImpl: f, now: () => T('10:05:01'), log: l => lines.push(l) });
  assert.equal(quiet.due, false, 'WD2-non-hour'); assert.equal(calls.length, 1, 'WD2-non-hour-no-fetch');
  assert.match(lines[0], /^p18_watchdog_dispatch \{/); assert.match(lines[0], /"window_id":"p18wd-20261025T10Z"/); assert.match(lines[0], /"http":204/);
});

await test('WD3 fail closed without KV idempotency; token is never logged or stored', async () => {
  const noKvCalls = fakeFetch(() => new Response(null, { status: 204 })), lines: string[] = [];
  const missing = await runHourlyWatchdogDispatch({ env: { P18_DISPATCH_TOKEN: TOKEN }, scheduledTime: T('10:00:00'), fetchImpl: noKvCalls.f, log: l => lines.push(l) });
  assert.equal(missing.kv, 'unavailable', 'WD3-no-kv'); assert.equal(noKvCalls.calls.length, 0, 'WD3-no-dispatch-without-idempotency');
  assert.ok(!lines.join('\n').includes(TOKEN), 'WD3-no-token-log');
  const kv = fakeKv(); kv.setFailGet(true);
  const readFail = await runHourlyWatchdogDispatch({ env: { P18_DISPATCH_TOKEN: TOKEN, T2_CREATIVE_ASSETS: kv }, scheduledTime: T('10:00:00'), fetchImpl: noKvCalls.f, log: () => {} });
  assert.equal(readFail.kv, 'read_failed', 'WD3-read-failed'); assert.equal(noKvCalls.calls.length, 0, 'WD3-read-failed-no-fetch');
});

await test('H1 heartbeat: fresh/stale at the 900/901 s edge, missing (404), malformed, oversize, future, unreadable', async () => {
  const now = T('12:00:00');
  const read = (resp: Response) => readHeartbeat({ fetchImpl: async () => resp, nowMs: now });
  const fresh = await read(new Response(hbDoc(T('11:45:00')), { status: 200, headers: { age: '120' } }));
  assert.equal(fresh.state, 'FRESH', 'H1-900'); assert.equal(fresh.age_s, 900); assert.equal(fresh.window_id, 'p18w-20261025T1000Z'); assert.equal(fresh.dispatch_to_start_s, 19); assert.equal(fresh.cache_age_s, 120, 'H1-cache-age');
  assert.equal((await read(new Response(hbDoc(T('11:44:59')), { status: 200 }))).state, 'STALE', 'H1-901');
  assert.equal((await read(new Response('Not Found', { status: 404 }))).state, 'MISSING', 'H1-missing');
  assert.equal((await read(new Response('{nope', { status: 200 }))).state, 'MALFORMED', 'H1-json');
  assert.equal((await read(new Response(JSON.stringify({ schema: 'other', last_success_at: '2026-10-25T11:59:00Z' }), { status: 200 }))).state, 'MALFORMED', 'H1-schema');
  assert.equal((await read(new Response(hbDoc(T('11:59:00'), { pad: 'x'.repeat(9000) }), { status: 200 }))).state, 'MALFORMED', 'H1-oversize');
  assert.equal((await read(new Response(hbDoc(T('12:02:01')), { status: 200 }))).state, 'FUTURE', 'H1-future');
  assert.equal((await read(new Response('', { status: 503 }))).state, 'UNREADABLE', 'H1-503');
  const { calls, f } = fakeFetch(() => new Response(hbDoc(now), { status: 200 }));
  await readHeartbeat({ fetchImpl: f, nowMs: now });
  assert.equal(calls[0].url, 'https://raw.githubusercontent.com/arbmsistone-lab/zevanory-public-mirror/evidence/b0-baseline/p18/heartbeat.json', 'H1-url');
  assert.equal(calls[0].init.method, 'GET'); assert.equal((calls[0].init.headers as Record<string, string>).authorization, undefined, 'H1-no-credential');
});

const D = (outcome: DispatchResult['outcome'], http: number | null = null): DispatchResult => ({ outcome, http_status: http, run_id: null, run_url: null, elapsed_ms: 1, retry_after_s: null });
const H = (state: HeartbeatResult['state'], age: number | null = 60): HeartbeatResult => ({ state, http_status: 200, age_s: age, last_success_at: null, window_id: null, run_id: null, dispatch_to_start_s: null, cache_age_s: null, elapsed_ms: 1 });

await test('A1 alert policy: first failure alerts at once; same failure repeats hourly (daily if unconfigured); recovery announced; flapping guard', () => {
  let s: P18State | null = null;
  let t = T('10:00:00');
  const step = (d: DispatchResult, h: HeartbeatResult) => { const r = decide(s, d, h, t, windowIdOf(t)); if (r.writeState) s = r.state; t += 300_000; return r; };
  const r0 = step(D('accepted', 204), H('FRESH'));
  assert.equal(r0.alerts.length, 0, 'A1-healthy-no-alert'); assert.equal(r0.writeState, true, 'first state is written');
  const r1 = step(D('auth', 401), H('FRESH'));
  assert.equal(r1.alerts.length, 1, 'A1-first-failure'); assert.equal(r1.alerts[0].check, 'dispatch'); assert.match(r1.alerts[0].text, /401/);
  let quiet = 0;
  for (let i = 0; i < 11; i++) quiet += step(D('auth', 401), H('FRESH')).alerts.length;
  assert.equal(quiet, 0, 'A1-no-repeat-within-60min');
  assert.equal(step(D('auth', 401), H('FRESH')).alerts.length, 1, 'A1-hourly-repeat');
  const changed = step(D('rate_limited', 429), H('FRESH'));
  assert.equal(changed.alerts.length, 0, 'A1-different-failure-respects-30min-gap');
  for (let i = 0; i < 4; i++) step(D('rate_limited', 429), H('FRESH'));
  const after30 = step(D('rate_limited', 429), H('FRESH'));
  assert.equal(after30.alerts.length, 1, 'A1-different-failure-after-30min'); assert.match(after30.alerts[0].text, /limite/);
  const rec = step(D('accepted', 204), H('FRESH'));
  assert.equal(rec.alerts.length, 0, 'A1-recovery-deferred-under-30min');
  for (let i = 0; i < 4; i++) step(D('accepted', 204), H('FRESH'));
  const rec2 = step(D('accepted', 204), H('FRESH'));
  assert.equal(rec2.alerts.length, 1, 'A1-recovery-announced'); assert.equal(rec2.alerts[0].kind, 'recovery');
  assert.equal(step(D('accepted', 204), H('FRESH')).alerts.length, 0, 'A1-single-recovery');
  // Unconfigured secret: one alert per day, not per hour.
  s = null; t = T('00:00:00', '2026-10-26');
  let unconf = 0;
  for (let i = 0; i < 288; i++) unconf += step(D('unconfigured'), H('FRESH')).alerts.length;
  assert.equal(unconf, 1, 'A1-unconfigured-daily');
});

await test('A2 HTTP 204 is not monitoring: dispatch accepted + stale heartbeat still alerts (runner never started)', () => {
  const r = decide(null, D('accepted', 204), H('STALE', 1500), T('10:00:00'), 'p18w-20261025T1000Z');
  assert.equal(r.alerts.length, 1, 'A2-204-stale-alerts'); assert.equal(r.alerts[0].check, 'heartbeat'); assert.match(r.alerts[0].text, /25 min/);
  assert.match(r.alerts[0].text, /204\/200 não prova monitoramento/);
  const both = decide(null, D('unavailable', 503), H('UNREADABLE'), T('10:00:00'), 'p18w-20261025T1000Z');
  assert.equal(both.alerts.length, 2, 'A2-both-checks');
});

await test('B1 KV write budget: healthy day = 24 hourly checkpoints; worst day (both checks flapping) <= 6 writes/hour', () => {
  let s: P18State | null = null, writes = 0;
  let t = T('00:00:00', '2026-10-27');
  for (let i = 0; i < 288; i++) { const r = decide(s, D('accepted', 204), H('FRESH'), t, windowIdOf(t)); if (r.writeState) { s = r.state; writes += 1; } writes += r.alerts.length ? 1 : 0; t += 300_000; }
  assert.ok(writes <= 25, `B1-healthy-writes ${writes}`);
  s = null; writes = 0; t = T('00:00:00', '2026-10-28');
  const perHour = new Map<number, number>();
  for (let i = 0; i < 288; i++) {
    const bad = i % 2 === 0;
    const r = decide(s, bad ? D('unavailable', 503) : D('accepted', 204), bad ? H('TIMEOUT') : H('FRESH'), t, windowIdOf(t));
    const w = (r.writeState ? 1 : 0) + (r.alerts.length ? 1 : 0);
    if (r.writeState) s = r.state;
    writes += w; const hr = Math.floor((t - T('00:00:00', '2026-10-28')) / 3_600_000); perHour.set(hr, (perHour.get(hr) || 0) + w);
    t += 300_000;
  }
  assert.ok([...perHour.values()].every(v => v <= WRITE_CAP_PER_HOUR), 'B1-cap-per-hour ' + JSON.stringify([...perHour.values()]));
  assert.ok(writes <= 24 * WRITE_CAP_PER_HOUR, `B1-worst-day ${writes}`);
  assert.equal(CHECKPOINT_MS, 3_600_000);
});

await test('E1 end to end per status code: recorded in KV state, alert entry the central digest accepts, token never stored or logged', async () => {
  const codes: [number, Record<string, string>, string][] = [
    [401, {}, 'auth'], [403, {}, 'forbidden'], [403, { 'x-ratelimit-remaining': '0' }, 'rate_limited'], [404, {}, 'not_found'],
    [422, {}, 'invalid'], [429, { 'retry-after': '30' }, 'rate_limited'], [500, {}, 'unavailable'], [503, {}, 'unavailable'],
  ];
  for (const [code, headers, want] of codes) {
    const nowRef = { t: T('10:00:03') };
    const kv = fakeKv(), lines: string[] = [];
    const { calls, f } = net({ dispatchStatus: code, dispatchHeaders: headers }, nowRef);
    const r = await runP18ExternalTrigger({ env: { P18_DISPATCH_TOKEN: TOKEN, T2_CREATIVE_ASSETS: kv }, scheduledTime: T('10:00:00'), fetchImpl: f, now: () => nowRef.t, log: l => lines.push(l) });
    assert.equal(r.dispatch.outcome, want, `E1-outcome-${code}`); assert.equal(r.dispatch.http_status, code, `E1-http-${code}`);
    const st = JSON.parse(kv.store.get(STATE_KEY) || 'null');
    assert.equal(st?.last_dispatch?.http_status, code, `E1-state-http-${code}`); assert.equal(st.checks.dispatch.status, 'failing');
    const al = kv.alerts();
    assert.equal(al.length, 1, `E1-alert-${code}`);
    assert.equal(al[0].category, ALERT_CATEGORY); assert.ok(ALLOWED_OWNER_ALERTS.has(al[0].category), 'E1-digest-accepts-category');
    assert.equal(al[0].channel, ALERT_CHANNEL); assert.match(al[0].key, /^zpc-alert:v1:\d+:p18-ext:p18w-20261025T1000Z$/);
    assert.equal(maskExcerpt(al[0].excerpt), al[0].excerpt, `E1-survives-digest-mask-${code}`);
    const everything = lines.join('\n') + JSON.stringify([...kv.store.entries()]);
    assert.ok(!everything.includes(TOKEN) && !everything.includes('FAKE_TEST_VALUE'), `E1-no-token-${code}`);
    assert.ok(calls.length <= MAX_FETCH_SUBREQUESTS, 'E1-subrequests');
    assert.ok(calls.every(c => c.url === P18_DISPATCH_URL || c.url === P18_HEARTBEAT_URL), 'E1-only-two-urls');
    assert.ok(calls.filter(c => c.url !== P18_DISPATCH_URL).every(c => !JSON.stringify(c.init).includes(TOKEN)), 'E1-token-only-to-github-api');
    assert.ok(kv.puts.filter(p => p.key.startsWith(ALERT_PREFIX)).every(p => p.ttl === 7 * 24 * 3600), 'E1-alert-ttl');
  }
  // Timeout (hung GitHub) and network failure end to end.
  for (const [label, impl, want] of [
    ['timeout', (u: string, init: RequestInit = {}) => u === P18_DISPATCH_URL ? new Promise<Response>((_, rej) => init.signal?.addEventListener('abort', () => rej(init.signal?.reason))) : Promise.resolve(new Response(hbDoc(T('10:00:00')), { status: 200 })), 'timeout'],
    ['network', (u: string) => u === P18_DISPATCH_URL ? Promise.reject(new TypeError('fetch failed')) : Promise.resolve(new Response(hbDoc(T('10:00:00')), { status: 200 })), 'network'],
  ] as const) {
    const kv = fakeKv();
    const r = await runP18ExternalTrigger({ env: { P18_DISPATCH_TOKEN: TOKEN, T2_CREATIVE_ASSETS: kv }, scheduledTime: T('10:00:00'), fetchImpl: impl as never, now: () => T('10:00:03'), log: () => {} });
    assert.equal(r.dispatch.outcome, want, 'E1-' + label); assert.equal(kv.alerts().length, 1, 'E1-alert-' + label);
  }
});

await test('E2 success path: 200 + fresh heartbeat = no alert, run id recorded, 2 fetches, writes only the state checkpoint', async () => {
  const nowRef = { t: T('10:05:02') };
  const kv = fakeKv(), lines: string[] = [];
  const { calls, f } = net({ dispatchStatus: 200, dispatchBody: JSON.stringify({ workflow_run_id: 777001, html_url: 'https://github.com/arbmsistone-lab/zevanory-public-mirror/actions/runs/777001' }) }, nowRef);
  const r = await runP18ExternalTrigger({ env: { P18_DISPATCH_TOKEN: TOKEN, T2_CREATIVE_ASSETS: kv }, scheduledTime: T('10:05:00'), fetchImpl: f, now: () => nowRef.t, log: l => lines.push(l) });
  assert.equal(r.dispatch.run_id, 777001, 'E2-run-id'); assert.equal(r.heartbeat.state, 'FRESH'); assert.equal(r.alerts, 0, 'E2-no-alert');
  assert.equal(calls.length, 2, 'E2-two-fetches'); assert.equal(kv.alerts().length, 0);
  assert.equal(JSON.parse(kv.store.get(STATE_KEY)!).last_run_id, 777001, 'E2-state-run-id');
  assert.equal(JSON.parse(String(calls.find(c => c.url === P18_DISPATCH_URL)!.init.body)).inputs.window_id, 'p18w-20261025T1005Z', 'E2-window-from-scheduledTime');
  assert.match(lines[0], /^p18_ext_trigger \{/); assert.match(lines[0], /"run_id":777001/, 'E2-log-run-id');
  // Second window, healthy: no write at all (checkpoint is hourly).
  nowRef.t = T('10:10:02');
  const before = kv.puts.length;
  await runP18ExternalTrigger({ env: { P18_DISPATCH_TOKEN: TOKEN, T2_CREATIVE_ASSETS: kv }, scheduledTime: T('10:10:00'), fetchImpl: f, now: () => nowRef.t, log: () => {} });
  assert.equal(kv.puts.length, before, 'E2-steady-state-no-write');
});

await test('E3 fail-safe storage: KV read failure writes nothing (no alert storm); missing token still watches the heartbeat', async () => {
  const kv = fakeKv(); kv.setFailGet(true);
  const nowRef = { t: T('10:00:03') };
  const r = await runP18ExternalTrigger({ env: { P18_DISPATCH_TOKEN: TOKEN, T2_CREATIVE_ASSETS: kv }, scheduledTime: T('10:00:00'), fetchImpl: net({ dispatchStatus: 503 }, nowRef).f, now: () => nowRef.t, log: () => {} });
  assert.equal(r.kv, 'read_failed', 'E3-read-failed'); assert.equal(kv.puts.length, 0, 'E3-no-writes');
  const kv2 = fakeKv();
  const { calls, f } = net({ hb: () => new Response(hbDoc(T('09:30:00')), { status: 200 }) }, nowRef);
  const r2 = await runP18ExternalTrigger({ env: { T2_CREATIVE_ASSETS: kv2 }, scheduledTime: T('10:00:00'), fetchImpl: f, now: () => nowRef.t, log: () => {} });
  assert.equal(r2.dispatch.outcome, 'unconfigured', 'E3-unconfigured'); assert.equal(r2.heartbeat.state, 'STALE', 'E3-heartbeat-still-watched');
  assert.equal(calls.length, 1, 'E3-no-dispatch-without-token');
  assert.equal(kv2.alerts().length, 1, 'E3-one-merged-alert'); assert.match(kv2.alerts()[0].reason, /dispatch:failure,heartbeat:failure/);
});

await test('E4 wall budget: a dependency that ignores aborts cannot hold the invocation past the budget', async () => {
  const never = () => new Promise<Response>(() => {});
  const t0 = Date.now();
  const r = await runP18ExternalTrigger({ env: { P18_DISPATCH_TOKEN: TOKEN, T2_CREATIVE_ASSETS: fakeKv() }, scheduledTime: T('10:00:00'), fetchImpl: never, log: () => {}, budgetMs: 150 });
  assert.equal(r.budget_exceeded, true, 'E4-budget-flag'); assert.ok(Date.now() - t0 < 1500, 'E4-bounded');
  assert.equal(r.dispatch.outcome, 'timeout');
});

await test('E5 timeout is recorded and alerted even when the dependency ignores the abort (own timer, inside the wall budget)', async () => {
  const never = () => new Promise<Response>(() => {});
  const kv = fakeKv();
  const t0 = Date.now();
  const r = await runP18ExternalTrigger({ env: { P18_DISPATCH_TOKEN: TOKEN, T2_CREATIVE_ASSETS: kv }, scheduledTime: T('10:00:00'), fetchImpl: never, now: () => T('10:00:03'), log: () => {}, dispatchTimeoutMs: 80, heartbeatTimeoutMs: 60, budgetMs: 1000 });
  assert.equal(r.budget_exceeded, false, 'E5-within-budget'); assert.equal(r.dispatch.outcome, 'timeout', 'E5-dispatch-timeout'); assert.equal(r.heartbeat.state, 'TIMEOUT', 'E5-heartbeat-timeout');
  assert.equal(kv.alerts().length, 1, 'E5-timeout-alerted'); assert.equal(JSON.parse(kv.store.get(STATE_KEY)!).last_dispatch.outcome, 'timeout', 'E5-timeout-recorded');
  assert.ok(Date.now() - t0 < 1000, 'E5-bounded');
});

await test('S1 real scheduled(): P18 every */5 in its own waitUntil; legacy duties only at 0/15/30/45; a hung P18 never blocks them', async () => {
  const worker = (await import('../cf-worker/worker.ts')).default as { scheduled: (c: unknown, e: Record<string, unknown>, x: unknown) => Promise<void> };
  const seen: string[] = [];
  const kvOps: string[] = [];
  const kv = {
    async get(k: string) { kvOps.push('get:' + k); return null; },
    async put(k: string, _v: string) { kvOps.push('put:' + k); },
    async delete(k: string) { kvOps.push('delete:' + k); },
    async list(o: { prefix: string }) { kvOps.push('list:' + o.prefix); return { keys: [] }; },
  };
  let hang = true;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(url);
    if (url === P18_DISPATCH_URL || url === P18_HEARTBEAT_URL || url === P18_WATCHDOG_DISPATCH_URL) return hang ? new Promise<Response>(() => {}) : Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as typeof fetch;
  const waited: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { waited.push(p.catch(() => undefined)); } };
  const env = { T2_CREATIVE_ASSETS: kv, P18_DISPATCH_TOKEN: TOKEN };
  // Minute 05: only P18 (dispatch + heartbeat started, never awaited by scheduled()).
  await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: T('10:05:00') }, env, ctx);
  assert.equal(waited.length, 1, 'S1-own-waituntil');
  assert.ok(seen.includes(P18_DISPATCH_URL) && seen.includes(P18_HEARTBEAT_URL), 'S1-p18-started');
  assert.ok(!kvOps.some(o => o.startsWith('list:zpc-activity')), 'S1-no-legacy-at-05');
  // Minute 15: legacy duties run to completion although the P18 fetches are still hanging.
  kvOps.length = 0;
  await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: T('10:15:00') }, env, ctx);
  assert.ok(kvOps.some(o => o === 'list:zpc-activity:v1:'), 'S1-legacy-at-15');
  assert.equal(waited.length, 2);
  // Minute 00: the same trigger also starts exactly one hourly watchdog dispatch; total GitHub/raw fetches <= 3.
  seen.length = 0; kvOps.length = 0;
  await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: T('11:00:00') }, env, ctx);
  assert.ok(seen.includes(P18_WATCHDOG_DISPATCH_URL), 'S1-watchdog-at-hour');
  assert.ok(seen.length <= MAX_CRON_FETCH_SUBREQUESTS, 'S1-total-subrequests');
  hang = false;
  globalThis.fetch = realFetch;
});

await test('S2 config: one Cron Trigger, */5; worker passes scheduledTime and never awaits P18 before the duties', () => {
  const toml = readFileSync(new URL('../cf-worker/wrangler.toml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(toml, /\[triggers\]\ncrons = \["\*\/5 \* \* \* \*"\]\n/, 'S2-single-trigger');
  assert.doesNotMatch(toml, /^\s*P18_DISPATCH_TOKEN\s*=/m, 'S2-token-never-in-config');
  assert.match(toml, /\[observability\]\nenabled = true\nhead_sampling_rate = 1\n/, 'S2-workers-logs');
  const src = readFileSync(new URL('../cf-worker/worker.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /await runP18ExternalTrigger|await p18\b/, 'S2-not-awaited');
  const mod = readFileSync(new URL('../cf-worker/p18-dispatch.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(mod, /console\.[a-z]+\([^)]*token/i, 'S2-token-not-logged');
});

await test('P1 CPU per invocation with instant fakes (Workers Free: 10 ms per Cron Trigger)', async () => {
  const kv = fakeKv();
  const nowRef = { t: T('10:00:02') };
  const { f } = net({ dispatchStatus: 200, dispatchBody: JSON.stringify({ workflow_run_id: 1 }) }, nowRef);
  const N = 300;
  for (let i = 0; i < 20; i++) await runP18ExternalTrigger({ env: { P18_DISPATCH_TOKEN: TOKEN, T2_CREATIVE_ASSETS: kv }, scheduledTime: T('10:00:00'), fetchImpl: f, now: () => nowRef.t, log: () => {} });
  const c0 = process.cpuUsage();
  for (let i = 0; i < N; i++) await runP18ExternalTrigger({ env: { P18_DISPATCH_TOKEN: TOKEN, T2_CREATIVE_ASSETS: kv }, scheduledTime: T('10:00:00'), fetchImpl: f, now: () => nowRef.t, log: () => {} });
  const c = process.cpuUsage(c0);
  const perMs = (c.user + c.system) / 1000 / N;
  console.log(`P18_CPU_PER_INVOCATION_MS=${perMs.toFixed(3)} (Node ${process.version}, fakes incl. Response objects; workerd differs, measure live)`);
  assert.ok(perMs < 3, 'P1-cpu-under-3ms');
});

await test('P2 CPU for the top-of-hour combined primary + watchdog paths stays below the Free-plan budget', async () => {
  const kv = fakeKv();
  let current = T('00:00:02', '2026-10-01');
  const f = async (url: string) => url === P18_HEARTBEAT_URL
    ? new Response(hbDoc(current - 60_000), { status: 200 })
    : new Response(JSON.stringify({ workflow_run_id: 1 }), { status: 200 });
  const N = 120;
  const c0 = process.cpuUsage();
  for (let i = 0; i < N; i++) {
    current = T('00:00:02', '2026-10-01') + i * 3_600_000;
    const scheduled = current - 2_000;
    await Promise.all([
      runP18ExternalTrigger({ env: { P18_DISPATCH_TOKEN: TOKEN, T2_CREATIVE_ASSETS: kv }, scheduledTime: scheduled, fetchImpl: f, now: () => current, log: () => {} }),
      runHourlyWatchdogDispatch({ env: { P18_DISPATCH_TOKEN: TOKEN, T2_CREATIVE_ASSETS: kv }, scheduledTime: scheduled, fetchImpl: f, now: () => current, log: () => {} }),
    ]);
  }
  const c = process.cpuUsage(c0);
  const perMs = (c.user + c.system) / 1000 / N;
  console.log(`P18_TOP_OF_HOUR_CPU_MS=${perMs.toFixed(3)} (Node ${process.version}, instant fakes; workerd differs, measure live)`);
  assert.ok(perMs < 5, 'P2-combined-cpu-under-5ms');
});

clearInterval(keepAlive);
console.log(`p18-dispatch: ${n} tests passed`);
