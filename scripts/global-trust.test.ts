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
  authority: 'server-side-core-only', source_of_truth: true, fail_closed: true, ui_can_authorize: false,
  invariants: { exact_release_bound: true, control_plane_ready: true, health_ready: true, quorum_ok: true, evidence_to_evaluation_unidirectional: true },
  continuity: { min_quorum: 3, quorum_ok: true, available_channels: ['zevanory', 'email', 'youtube', 'google'] },
  status: { channel_readiness: { zevanory: {}, email: {}, youtube: {}, google: {}, whatsapp: {} } },
  zees16: { release_sha: SHA, observed_at: iso(20 * 60_000), counts: { proven: 16, partial: 0, blocked: 0, na: 0 }, persistence: 'kv-append-only', decision_hash: 'abc', policy_version: 'ZEES-16/x' },
  zea10: { release_sha: SHA, counts: { proven: 10, partial: 0, blocked: 0, unknown: 0 }, authority: true, external_review_required: false, evaluator: 'ZEA-10/2026.09-internal-v2' },
  ...over,
});
const decision = (over: Record<string, any> = {}) => ({
  decision: 'ALLOW', eligible_for_critical_promotion: true, blockers: [], release_sha: SHA, generated_at: iso(3_000),
  checks: { evidence_integrity_ok: true, zees16_complete: true, zea10_complete: true }, ...over,
});
const controlPlane = (over: Record<string, any> = {}) => ({
  release: { deployment: { commit_sha: SHA } },
  zea10_live: { ready: true, fail_closed: false, report: { release_sha: SHA, counts: { proven: 10, partial: 0, blocked: 0, unknown: 0 } } },
  trust_chain: { state: 'GREEN', artifact_sha: SHA, ledger: { checked_at: iso(15 * 60_000) }, passed: 3, total: 3, required: 2, independent_keys: 3, conflicts: 0, evidence_root: 'sha256:root' },
  ...over,
});
const derive = (s: any = snapshot(), d: any = decision(), c: any = controlPlane(), now = NOW) => deriveGlobalTrust({ snapshot: s, decision: d, controlPlane: c, now });

let n = 0;
const test = (name: string, fn: () => void | Promise<void>) => Promise.resolve().then(fn).then(() => { n++; console.log('ok', name); });

await test('1. fully proven, bound, fresh, consistent and independently quorate => GREEN', () => {
  const t = derive();
  assert.equal(t.state, 'GREEN');
  assert.deepEqual(t.reasons, []);
  assert.equal(t.sha, SHA);
  assert.deepEqual(t.quorum, { basis: 'independent_signers', source: '/api/control-plane trust_chain', passed: 3, total: 3, required: 2, independentKeys: 3, ok: true, conflicts: 0 });
  assert.deepEqual(t.continuity, { channels: ['zevanory', 'email', 'youtube', 'google'], total: 5, required: 3, ok: true });
  assert.equal(t.engines.every(e => e.state === 'GREEN'), true);
  assert.equal(Date.parse(t.validUntil!), Math.min(NOW - 5_000 + SNAPSHOT_MAX_AGE_MS, NOW - 20 * 60_000 + PROOF_MAX_AGE_MS));
});

await test('2. no fabricated participants: GREEN requires a real independent quorum', () => {
  // The live shape after #792: legacy indicators ok, no independent quorum => UNVERIFIED 0/0.
  const unverified = derive(snapshot(), decision(), controlPlane({ trust_chain: { state: 'UNVERIFIED', passed: 0, total: 0, required: 2, independent_keys: 0, conflicts: 0, evidence_root: null } }));
  assert.equal(unverified.state, 'DEGRADED');
  assert.ok(unverified.reasons.includes('independent_quorum_unproven'));
  assert.equal(unverified.crossCheck.state, 'agree', 'UNVERIFIED is consistent, not a contradiction');
  assert.equal(unverified.quorum.passed, 0);
  assert.equal(unverified.quorum.ok, false);
  // Missing numbers stay null, never a default.
  const missing = derive(snapshot(), decision(), controlPlane({ trust_chain: { state: 'UNVERIFIED' } }));
  assert.equal(missing.quorum.passed, null);
  assert.equal(missing.quorum.required, null);
  assert.equal(missing.state, 'DEGRADED');
  // Weak quorums (1 signer, shared keys, conflicts, no evidence root) are not proven.
  for (const tc of [
    { state: 'GREEN', artifact_sha: SHA, ledger: { checked_at: iso(60_000) }, passed: 1, total: 3, required: 2, independent_keys: 1, conflicts: 0, evidence_root: 'r' },
    { state: 'GREEN', artifact_sha: SHA, ledger: { checked_at: iso(60_000) }, passed: 3, total: 3, required: 2, independent_keys: 1, conflicts: 0, evidence_root: 'r' },
    { state: 'GREEN', artifact_sha: SHA, ledger: { checked_at: iso(60_000) }, passed: 3, total: 3, required: 2, independent_keys: 3, conflicts: 1, evidence_root: 'r' },
    { state: 'GREEN', artifact_sha: SHA, ledger: { checked_at: iso(60_000) }, passed: 3, total: 3, required: 2, independent_keys: 3, conflicts: 0, evidence_root: '' },
    { state: 'GREEN', artifact_sha: SHA, ledger: { checked_at: iso(60_000) }, passed: 1, total: 1, required: 1, independent_keys: 1, conflicts: 0, evidence_root: 'r' },
  ]) assert.equal(derive(snapshot(), decision(), controlPlane({ trust_chain: tc })).state, 'DEGRADED', JSON.stringify(tc));
  // Continuity channels below their minimum also degrade (and are never shown as trust quorum).
  const fewChannels = derive(snapshot({ continuity: { min_quorum: 3, quorum_ok: true, available_channels: ['zevanory'] } }));
  assert.equal(fewChannels.state, 'DEGRADED');
  assert.ok(fewChannels.reasons.includes('continuity_below_minimum'));
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
  const blockedLegacy = derive(snapshot(), decision(), controlPlane({ trust_chain: { ...controlPlane().trust_chain, state: 'BLOCKED' } }));
  assert.equal(blockedLegacy.state, 'DEGRADED');
  assert.equal(blockedLegacy.crossCheck.state, 'contradicts');
  assert.ok(blockedLegacy.crossCheck.details.includes('trust_chain_blocked_vs_core'));
  const counts = derive(snapshot(), decision(), controlPlane({ zea10_live: { ready: true, fail_closed: false, report: { release_sha: SHA, counts: { proven: 0, partial: 10, blocked: 0 } } } }));
  assert.ok(counts.crossCheck.details.includes('zea10_counts_differ'));
  assert.equal(derive(snapshot(), decision(), controlPlane({ release: { deployment: { commit_sha: OLD } } })).state, 'NO_PROOF', 'another deployed release => proof unbound');
  assert.equal(derive(snapshot(), decision(), null).state, 'DEGRADED');
  // A green secondary source cannot rescue a blocked core.
  assert.equal(derive(snapshot({ zea10: { ...snapshot().zea10, counts: { proven: 9, partial: 1, blocked: 0, unknown: 0 } } }), decision(), controlPlane()).state, 'BLOCKED');
});

await test('8. old deploy-gate criteria kept: health, invariants, ZEES N/A, continuity floor', () => {
  assert.equal(derive(snapshot({ invariants: { ...snapshot().invariants, health_ready: false } })).state, 'BLOCKED');
  assert.equal(derive(snapshot({ invariants: { ...snapshot().invariants, quorum_ok: false } })).state, 'BLOCKED');
  assert.equal(derive(snapshot({ invariants: { ...snapshot().invariants, control_plane_ready: false } })).state, 'BLOCKED');
  assert.equal(derive(snapshot({ ui_can_authorize: true })).state, 'BLOCKED');
  assert.equal(derive(snapshot({ authority: 'ui' })).state, 'BLOCKED');
  assert.equal(derive(snapshot({ zees16: { ...snapshot().zees16, counts: { proven: 16, partial: 0, blocked: 0, na: 1 } } })).state, 'BLOCKED');
  assert.equal(derive(snapshot({ continuity: { ...snapshot().continuity, min_quorum: 1 } })).state, 'DEGRADED', 'continuity floor of 3');
});

await test('8b. quorum must be bound to this release and fresh; decision and proof timestamps are checked', () => {
  const tc = controlPlane().trust_chain;
  const other = derive(snapshot(), decision(), controlPlane({ trust_chain: { ...tc, artifact_sha: OLD } }));
  assert.equal(other.state, 'DEGRADED');
  assert.ok(other.reasons.includes('independent_quorum_other_release'));
  const stale = derive(snapshot(), decision(), controlPlane({ trust_chain: { ...tc, ledger: { checked_at: iso(PROOF_MAX_AGE_MS + 1) } } }));
  assert.ok(stale.reasons.includes('independent_quorum_stale'));
  assert.equal(derive(snapshot(), decision(), controlPlane({ trust_chain: { ...tc, ledger: undefined } })).state, 'DEGRADED');
  assert.equal(derive(snapshot(), decision({ generated_at: iso(SNAPSHOT_MAX_AGE_MS + 1) })).state, 'NO_PROOF');
  assert.equal(derive(snapshot(), decision({ generated_at: undefined })).state, 'NO_PROOF');
  assert.equal(derive(snapshot({ zees16: { ...snapshot().zees16, observed_at: new Date(NOW + 60 * 60_000).toISOString() } })).state, 'NO_PROOF');
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
  assert.match(app, /\} catch \{\n\s+\/\/ Never keep painting[^\n]*\n\s+setGlobalTrust\(null\);/, 'a failed read must not keep showing the previous GREEN');
  assert.doesNotMatch(app, /globalTrust\.state === 'GREEN' \? 'trustStrip green'/);
});

console.log(`global-trust: ${n} tests passed`);
