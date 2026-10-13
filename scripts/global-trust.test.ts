// Regression suite for the live trust strip (owner audit 13/10/2026, Mission 1).
// Runs with `tsx scripts/global-trust.test.ts` (part of `npm run build`).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveGlobalTrust, loadGlobalTrust, PROOF_MAX_AGE_MS, SNAPSHOT_MAX_AGE_MS } from '../cf-worker/global-trust.ts';

const SHA = '2cf3649dfa446f693f721f1cc9a2c9bc7cdaa085';
const OLD = '1d40daa1fb5a15e042bed22d984cf6729782cf6c';
const NOW = Date.parse('2026-10-13T13:06:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const snapshot = (over: Record<string, any> = {}) => ({
  release_sha: SHA,
  generated_at: iso(5_000),
  invariants: { exact_release_bound: true, health_ready: true, quorum_ok: true },
  continuity: { min_quorum: 3, quorum_ok: true, available_channels: ['zevanory', 'email', 'youtube', 'google'] },
  status: { channel_readiness: { zevanory: {}, email: {}, youtube: {}, google: {}, whatsapp: {} } },
  zees16: { release_sha: SHA, observed_at: iso(20 * 60_000), counts: { proven: 16, partial: 0, blocked: 0 }, persistence: 'kv-append-only', decision_hash: 'abc', policy_version: 'ZEES-16/x' },
  zea10: { release_sha: SHA, counts: { proven: 10, partial: 0, blocked: 0, unknown: 0 }, authority: true, external_review_required: false, evaluator: 'ZEA-10/2026.09-internal-v2' },
  ...over,
});
const decision = (over: Record<string, any> = {}) => ({
  decision: 'ALLOW', eligible_for_critical_promotion: true, blockers: [], release_sha: SHA,
  checks: { evidence_integrity_ok: true, zees16_complete: true, zea10_complete: true }, ...over,
});
const controlPlane = (over: Record<string, any> = {}) => ({
  release: { deployment: { commit_sha: SHA } },
  zea10_live: { ready: true, fail_closed: false, report: { release_sha: SHA, counts: { proven: 10, partial: 0, blocked: 0, unknown: 0 } } },
  trust_chain: { state: 'GREEN' },
  ...over,
});
const derive = (s: any = snapshot(), d: any = decision(), c: any = controlPlane(), now = NOW) => deriveGlobalTrust({ snapshot: s, decision: d, controlPlane: c, now });

let n = 0;
const test = (name: string, fn: () => void | Promise<void>) => Promise.resolve().then(fn).then(() => { n++; console.log('ok', name); });

await test('1. fully proven, bound, fresh and consistent => GREEN with real channel quorum', () => {
  const t = derive();
  assert.equal(t.state, 'GREEN');
  assert.deepEqual(t.reasons, []);
  assert.equal(t.sha, SHA);
  assert.deepEqual(t.quorum, { basis: 'continuity_channels', passed: 4, total: 5, required: 3, ok: true, channels: ['zevanory', 'email', 'youtube', 'google'], conflicts: 0 });
  assert.equal(t.engines.every(e => e.state === 'GREEN'), true);
  assert.equal(Date.parse(t.validUntil!), Math.min(NOW - 5_000 + SNAPSHOT_MAX_AGE_MS, NOW - 20 * 60_000 + PROOF_MAX_AGE_MS));
});

await test('2. no fabricated participants: quorum is never 3/3 unless 3 channels really exist', () => {
  const t = derive(snapshot({ continuity: { min_quorum: 3, quorum_ok: true, available_channels: ['zevanory'] } }));
  assert.equal(t.quorum.passed, 1);
  assert.equal(t.quorum.ok, false, 'a quorum_ok flag with 1 channel must not count as quorum');
  assert.equal(t.state, 'DEGRADED');
  assert.ok(t.reasons.includes('quorum_below_minimum'));
  assert.equal('independentKeys' in t.quorum, false, 'no invented signing keys');
  const missing = derive(snapshot({ continuity: { quorum_ok: true, available_channels: ['a', 'b', 'c'] } }));
  assert.equal(missing.quorum.required, null);
  assert.equal(missing.state, 'DEGRADED');
});

await test('3. stale snapshot, expired proof, future timestamp => SEM PROVA (NO_PROOF)', () => {
  assert.equal(derive(snapshot({ generated_at: iso(SNAPSHOT_MAX_AGE_MS + 1) })).state, 'NO_PROOF');
  const expired = derive(snapshot({ zees16: { ...snapshot().zees16, observed_at: iso(PROOF_MAX_AGE_MS + 1) } }));
  assert.equal(expired.state, 'NO_PROOF');
  assert.ok(expired.reasons.includes('proof_expired'));
  assert.equal(derive(snapshot({ generated_at: new Date(NOW + 10 * 60_000).toISOString() })).state, 'NO_PROOF');
});

await test('4. missing data => SEM PROVA, never GREEN', () => {
  assert.equal(derive(null, null, null).state, 'NO_PROOF');
  assert.equal(deriveGlobalTrust({ snapshot: null, decision: decision(), controlPlane: controlPlane(), now: NOW, sourceError: 'timeout' }).reasons[0], 'core_unavailable:timeout');
  assert.equal(derive(snapshot({ release_sha: undefined })).state, 'NO_PROOF');
  assert.equal(derive(snapshot({ zees16: undefined })).state, 'NO_PROOF');
  assert.equal(derive(snapshot({ zea10: undefined })).state, 'NO_PROOF');
  assert.equal(derive(snapshot({ generated_at: undefined })).state, 'NO_PROOF');
  assert.equal(derive(snapshot(), null).state, 'NO_PROOF', 'no core decision => no proof');
  assert.equal(derive(snapshot({ invariants: { health_ready: true } })).state, 'NO_PROOF', 'release identity must be proven');
});

await test('5. proof of another release (the 13/10 incident: 1d40daa vs 2cf3649) => SEM PROVA', () => {
  const t = derive(snapshot({ zees16: { ...snapshot().zees16, release_sha: OLD } }));
  assert.equal(t.state, 'NO_PROOF');
  assert.ok(t.reasons.includes('zees16_not_bound_to_release'));
  assert.equal(derive(snapshot({ zea10: { ...snapshot().zea10, release_sha: OLD } })).state, 'NO_PROOF');
  assert.equal(derive(snapshot(), decision({ release_sha: OLD })).state, 'NO_PROOF');
});

await test('6. incomplete evidence => BLOCKED (criteria unchanged)', () => {
  assert.equal(derive(snapshot({ zea10: { ...snapshot().zea10, counts: { proven: 9, partial: 1, blocked: 0, unknown: 0 } } })).state, 'BLOCKED');
  assert.equal(derive(snapshot({ zees16: { ...snapshot().zees16, counts: { proven: 15, partial: 0, blocked: 1 } } })).state, 'BLOCKED');
  assert.equal(derive(snapshot({ zees16: { ...snapshot().zees16, persistence: 'memory' } })).state, 'BLOCKED');
  assert.equal(derive(snapshot({ zea10: { ...snapshot().zea10, external_review_required: true } })).state, 'BLOCKED');
  assert.equal(derive(snapshot(), decision({ decision: 'DENY', blockers: ['x'] })).state, 'BLOCKED');
});

await test('7. contradicting or unavailable secondary source => DEGRADED, never upgraded', () => {
  const blockedLegacy = derive(snapshot(), decision(), controlPlane({ trust_chain: { state: 'BLOCKED' } }));
  assert.equal(blockedLegacy.state, 'DEGRADED');
  assert.equal(blockedLegacy.crossCheck.state, 'contradicts');
  assert.ok(blockedLegacy.crossCheck.details.includes('trust_chain_blocked_vs_core'));
  const counts = derive(snapshot(), decision(), controlPlane({ zea10_live: { ready: true, fail_closed: false, report: { release_sha: SHA, counts: { proven: 0, partial: 10, blocked: 0 } } } }));
  assert.ok(counts.crossCheck.details.includes('zea10_counts_differ'));
  assert.equal(derive(snapshot(), decision(), controlPlane({ release: { deployment: { commit_sha: OLD } } })).state, 'DEGRADED');
  assert.equal(derive(snapshot(), decision(), null).state, 'DEGRADED');
  // A green secondary source cannot rescue a blocked core.
  assert.equal(derive(snapshot({ zea10: { ...snapshot().zea10, counts: { proven: 9, partial: 1, blocked: 0, unknown: 0 } } }), decision(), controlPlane()).state, 'BLOCKED');
});

await test('8. health not ready => DEGRADED', () => {
  assert.equal(derive(snapshot({ invariants: { exact_release_bound: true, health_ready: false, quorum_ok: true } })).state, 'DEGRADED');
});

await test('9. loader never throws and fails closed on network errors', async () => {
  const down = { fetch: async () => { throw new Error('econnrefused'); } };
  const t = await loadGlobalTrust(down, NOW);
  assert.equal(t.state, 'NO_PROOF');
  assert.match(String(t.source_error), /econnrefused/);
  const http500 = { fetch: async () => new Response('x', { status: 500 }) };
  assert.equal((await loadGlobalTrust(http500, NOW)).state, 'NO_PROOF');
  const ok = { fetch: async (r: Request) => Response.json(new URL(r.url).pathname.endsWith('snapshot') ? snapshot() : new URL(r.url).pathname.endsWith('decision') ? decision() : controlPlane()) };
  assert.equal((await loadGlobalTrust(ok, NOW)).state, 'GREEN');
});

await test('10. the panel serves trust live, never from a deploy-time file, and the UI cannot show stale GREEN', () => {
  const worker = readFileSync(new URL('../cf-worker/worker.ts', import.meta.url), 'utf8');
  assert.match(worker, /if \(normalizedPath === '\/global-trust\.json'\) \{[\s\S]{0,400}globalTrustResponse\(/);
  assert.doesNotMatch(worker, /exactDeployArtifact = normalizedPath === '\/global-trust\.json'/);
  const wrangler = readFileSync(new URL('../cf-worker/wrangler.toml', import.meta.url), 'utf8');
  assert.match(wrangler, /\[\[services\]\]\nbinding = "CORE_WORKER"\nservice = "zevanory"/);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /if \(trust\.schema !== 'zpc-global-trust\/v2'\) return \{ key: 'noproof'/, 'legacy baked artifact must render SEM PROVA');
  assert.match(app, /if \(!Number\.isFinite\(until\) \|\| now > until\) return \{ key: 'noproof'/, 'expired proof must render SEM PROVA');
  assert.match(app, /className=\{'trustStrip ' \+ tv\.key\}/);
  assert.doesNotMatch(app, /globalTrust\.state === 'GREEN' \? 'trustStrip green'/);
});

console.log(`global-trust: ${n} tests passed`);
