// P0 false TRUST CHAIN GREEN: every state the Central can show, derived fail-closed from the core.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveGlobalTrust, loadLiveGlobalTrust, TRUST_MAX_AGE_MS } from '../cf-worker/global-trust.ts';

const SHA = '7e1a6eba57007fa0f5e36330f5d028f435505651';
const OTHER = '1d40daa1fb5a15e042bed22d984cf6729782cf6c';
const NOW = Date.parse('2026-10-13T14:10:00Z');
const proven = { state: 'GREEN', artifact_sha: SHA, passed: 3, total: 3, required: 2, independent_keys: 3, conflicts: 0, evidence_root: 'sha256:root', engines: [{ id: 'q1', state: 'GREEN' }] };
const snap = (trust: any, extra: any = {}) => ({
  release_sha: SHA, generated_at: new Date(NOW - 30_000).toISOString(),
  zea10: { counts: { proven: 10, partial: 0, blocked: 0, unknown: 0 } }, zees16: { counts: { proven: 16, partial: 0, blocked: 0 } },
  continuity: { quorum_ok: true, min_quorum: 3 }, invariants: { quorum_ok: true },
  control: { trust_chain: trust }, ...extra,
});
let n = 0; const check = (name: string, fn: () => void | Promise<void>) => Promise.resolve(fn()).then(() => { n++; console.log('ok', name); });

await check('GREEN only with a proven independent quorum bound to the running SHA', () => {
  const t = deriveGlobalTrust(snap(proven), NOW);
  assert.equal(t.state, 'GREEN'); assert.equal(t.sha, SHA); assert.equal(t.quorum.independentKeys, 3);
});
await check('BLOCKED from the core stays BLOCKED (production today)', () => {
  const t = deriveGlobalTrust(snap({ state: 'BLOCKED', reason: 'legacy_indicators_not_met', artifact_sha: SHA, passed: 0, total: 0, required: 2, independent_keys: 0, evidence_root: null }), NOW);
  assert.equal(t.state, 'BLOCKED'); assert.equal(t.reason, 'legacy_indicators_not_met'); assert.equal(t.quorum.passed, 0);
});
await check('UNVERIFIED: GREEN claimed without quorum, without evidence root, with conflicts, or no trust_chain', () => {
  for (const patch of [{ passed: 0, total: 0, required: 0, independent_keys: 0 }, { evidence_root: null }, { evidence_root: '' }, { conflicts: 1 }, { independent_keys: 1 }, { required: 1, passed: 1, independent_keys: 1 }]) {
    assert.equal(deriveGlobalTrust(snap({ ...proven, ...patch }), NOW).state, 'UNVERIFIED', JSON.stringify(patch));
  }
  assert.equal(deriveGlobalTrust(snap(undefined), NOW).state, 'UNVERIFIED');
  assert.equal(deriveGlobalTrust(snap({ ...proven, state: 'UNVERIFIED', reason: 'legacy_indicators_only_no_independent_quorum' }), NOW).state, 'UNVERIFIED');
});
await check('sales-channel continuity (quorum_ok) never becomes a trust quorum', () => {
  const t = deriveGlobalTrust(snap({ state: 'BLOCKED', artifact_sha: SHA, passed: 0, total: 0, required: 2, independent_keys: 0 }, { continuity: { quorum_ok: true, min_quorum: 3 } }), NOW);
  assert.notEqual(t.state, 'GREEN'); assert.equal(t.quorum.passed, 0); assert.equal(t.quorum.independentKeys, 0);
});
await check('STALE: old, future or undated snapshot never shows its claim', () => {
  assert.equal(deriveGlobalTrust(snap(proven, { generated_at: new Date(NOW - TRUST_MAX_AGE_MS - 1000).toISOString() }), NOW).state, 'STALE');
  assert.equal(deriveGlobalTrust(snap(proven, { generated_at: '2026-10-13T03:21:08.719Z' }), NOW).state, 'STALE');
  assert.equal(deriveGlobalTrust(snap(proven, { generated_at: null }), NOW).state, 'STALE');
  assert.equal(deriveGlobalTrust(snap(proven, { generated_at: new Date(NOW + 10 * 60_000).toISOString() }), NOW).state, 'STALE');
});
await check('SHA_MISMATCH: trust bound to another release (the frozen 1d40daa1 artifact)', () => {
  assert.equal(deriveGlobalTrust(snap({ ...proven, artifact_sha: OTHER }), NOW).state, 'SHA_MISMATCH');
  assert.equal(deriveGlobalTrust(snap({ ...proven, artifact_sha: null }), NOW).state, 'SHA_MISMATCH');
  assert.equal(deriveGlobalTrust(snap(proven, { release_sha: 'x' }), NOW).state, 'SHA_MISMATCH');
});
await check('UNAVAILABLE on network error, timeout, HTTP 4xx/5xx and invalid JSON', async () => {
  const cases: Array<[typeof fetch, string]> = [
    [(async () => { throw new TypeError('fetch failed'); }) as any, 'network'],
    [(async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }) as any, 'timeout'],
    [(async () => new Response('x', { status: 503 })) as any, 'http_5xx'],
    [(async () => new Response('x', { status: 404 })) as any, 'http_4xx'],
    [(async () => new Response('not json', { status: 200 })) as any, 'parse'],
  ];
  for (const [f, err] of cases) {
    const t = await loadLiveGlobalTrust(f, () => NOW);
    assert.equal(t.state, 'UNAVAILABLE', err); assert.equal(t.source_error, err); assert.equal(t.quorum.passed, 0);
  }
  const ok = await loadLiveGlobalTrust((async () => Response.json(snap(proven))) as any, () => NOW);
  assert.equal(ok.state, 'GREEN');
});
await check('worker serves the live derivation before static assets; UI guards GREEN', () => {
  const w = readFileSync(new URL('../cf-worker/worker.ts', import.meta.url), 'utf8');
  const live = w.indexOf("normalizedPath === '/global-trust.json' && (request.method === 'GET'");
  const assets = w.indexOf('const exactDeployArtifact');
  assert.ok(live > 0 && assets > live, 'live route must come before the asset lookup');
  const ui = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(ui, /trustIsProvenGreen\(globalTrust\) \? 'trustStrip green'/);
  assert.doesNotMatch(ui, /globalTrust\.state === 'GREEN' \? 'trustStrip green'/);
});
console.log(`GLOBAL_TRUST_TESTS=PASS (${n})`);
