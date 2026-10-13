// Live TRUST CHAIN for the Central (/global-trust.json).
//
// P0 false GREEN (13/10/2026): /global-trust.json was a static asset written once at deploy time
// by zpc-control-worker-deploy.yml. It hard-coded independentKeys:3 and conflicts:0 and turned
// the core's continuity.quorum_ok (at least 3 *sales channels* available) into "quorum 3/3".
// It was never refreshed, so the panel kept showing GREEN bound to an old release SHA while the
// core's own trust_chain said BLOCKED with zero independent keys.
//
// Now the file is derived on every request from the core snapshot, fail-closed:
//   GREEN       only when the core's trust_chain is GREEN AND carries a proven independent quorum,
//               an evidence root, the same SHA as the running core release, and fresh data.
//   BLOCKED     the core says BLOCKED (or anything unknown).
//   UNVERIFIED  the core says GREEN/UNVERIFIED without a proven quorum, or has no trust_chain.
//   STALE       the snapshot is older than TRUST_MAX_AGE_MS or has no timestamp.
//   SHA_MISMATCH the trust artifact is bound to a different SHA than the running release.
//   UNAVAILABLE the core could not be read (network, timeout, HTTP error, invalid JSON).
export const TRUST_MAX_AGE_MS = 15 * 60 * 1000;
export const MIN_INDEPENDENT_QUORUM = 2;
export const CORE_SNAPSHOT_URL = 'https://zevanory.api.br/api/core/v1/snapshot';

export type TrustState = 'GREEN' | 'BLOCKED' | 'UNVERIFIED' | 'STALE' | 'SHA_MISMATCH' | 'UNAVAILABLE';

export type LiveGlobalTrust = {
  state: TrustState;
  reason: string;
  sha: string | null;
  artifactSha: string | null;
  evidenceRoot: string | null;
  policyVersion: string | null;
  quorum: { passed: number; total: number; required: number; conflicts: number; independentKeys: number };
  zea10: { proven: number; partial: number; blocked: number };
  zees16: { proven: number; partial: number; blocked: number };
  engines: Array<{ id: string; state: string }>;
  checkedAt: string | null;
  ageSeconds: number | null;
  source: string;
  source_error: string | null;
};

const SHA_RE = /^[0-9a-f]{40}$/;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);

export function quorumProven(t: any): boolean {
  if (!t || typeof t !== 'object') return false;
  const required = num(t.required);
  return required >= MIN_INDEPENDENT_QUORUM
    && num(t.passed) >= required
    && num(t.independent_keys) >= required
    && num(t.conflicts) === 0
    && typeof t.evidence_root === 'string' && t.evidence_root.length > 0;
}

export function unavailableTrust(sourceError: string): LiveGlobalTrust {
  return {
    state: 'UNAVAILABLE', reason: 'core_unreadable', sha: null, artifactSha: null, evidenceRoot: null, policyVersion: null,
    quorum: { passed: 0, total: 0, required: MIN_INDEPENDENT_QUORUM, conflicts: 0, independentKeys: 0 },
    zea10: { proven: 0, partial: 0, blocked: 0 }, zees16: { proven: 0, partial: 0, blocked: 0 },
    engines: [], checkedAt: null, ageSeconds: null, source: 'core-snapshot', source_error: sourceError,
  };
}

export function deriveGlobalTrust(snapshot: any, now: number = Date.now()): LiveGlobalTrust {
  if (!snapshot || typeof snapshot !== 'object') return unavailableTrust('parse');
  const t = snapshot?.control?.trust_chain;
  const releaseSha = SHA_RE.test(String(snapshot.release_sha || '')) ? String(snapshot.release_sha) : null;
  const artifactSha = SHA_RE.test(String(t?.artifact_sha || '')) ? String(t.artifact_sha) : null;
  const generatedAt = str(snapshot.generated_at);
  const generatedMs = generatedAt ? Date.parse(generatedAt) : NaN;
  const ageMs = Number.isFinite(generatedMs) ? now - generatedMs : NaN;
  const zea = snapshot?.zea10?.counts || {};
  const zees = snapshot?.zees16?.counts || {};
  const base: LiveGlobalTrust = {
    state: 'BLOCKED', reason: '', sha: releaseSha, artifactSha,
    evidenceRoot: str(t?.evidence_root), policyVersion: str(t?.policy_version),
    quorum: {
      passed: num(t?.passed), total: num(t?.total), required: num(t?.required),
      conflicts: num(t?.conflicts), independentKeys: num(t?.independent_keys),
    },
    zea10: { proven: num(zea.proven), partial: num(zea.partial), blocked: num(zea.blocked) + num(zea.unknown) },
    zees16: { proven: num(zees.proven), partial: num(zees.partial), blocked: num(zees.blocked) },
    engines: Array.isArray(t?.engines)
      ? t.engines.map((e: any) => ({ id: String(e?.id || ''), state: String(e?.state || 'UNKNOWN') })).filter((e: any) => e.id)
      : [],
    checkedAt: generatedAt,
    ageSeconds: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 1000)) : null,
    source: 'core-snapshot#control.trust_chain',
    source_error: null,
  };
  // Order matters: data that cannot be trusted at all is reported before what it claims.
  if (!Number.isFinite(ageMs) || ageMs > TRUST_MAX_AGE_MS || ageMs < -60_000) return { ...base, state: 'STALE', reason: 'snapshot_stale_or_undated' };
  if (!t || typeof t !== 'object') return { ...base, state: 'UNVERIFIED', reason: 'core_has_no_trust_chain' };
  if (!releaseSha || !artifactSha || releaseSha !== artifactSha) return { ...base, state: 'SHA_MISMATCH', reason: 'trust_artifact_not_bound_to_running_release' };
  if (t.state === 'GREEN') {
    return quorumProven(t)
      ? { ...base, state: 'GREEN', reason: 'independent_quorum_proven' }
      : { ...base, state: 'UNVERIFIED', reason: 'green_without_proven_quorum' };
  }
  if (t.state === 'UNVERIFIED') return { ...base, state: 'UNVERIFIED', reason: String(t.reason || 'core_unverified') };
  return { ...base, state: 'BLOCKED', reason: String(t.reason || 'core_blocked') };
}

export async function loadLiveGlobalTrust(fetcher: typeof fetch = fetch, now: () => number = Date.now): Promise<LiveGlobalTrust> {
  let response: Response;
  try {
    response = await fetcher(CORE_SNAPSHOT_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return unavailableTrust(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
  }
  if (!response.ok) return unavailableTrust(response.status >= 500 ? 'http_5xx' : 'http_4xx');
  let snapshot: unknown;
  try { snapshot = await response.json(); } catch { return unavailableTrust('parse'); }
  return deriveGlobalTrust(snapshot, now());
}
