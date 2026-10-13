// Live, fail-closed derivation of the panel's global trust strip (owner audit 13/10/2026, Mission 1).
//
// Before this module, /global-trust.json was a static file baked at deploy time: it kept saying
// GREEN for a release that was no longer running (sha 1d40daa… while production ran 2cf3649…),
// with a quorum of "3/3 · 3 independent keys" that was hard-coded from a single boolean.
//
// Rules enforced here:
//  - The only authority is ZEVANORY Control Core (/api/core/v1/snapshot + /api/core/v1/decision).
//  - Proof must be bound to the running release SHA (snapshot, ZEES-16 and ZEA-10 all on the same SHA).
//  - Proof has a timestamp and an explicit validity window; expired or missing proof is NO_PROOF.
//  - Quorum is the independent trust quorum (>= 2 signers, independent keys, evidence root, no
//    conflicts), the same rule as worker/trust-projection.mjs (#792). Absent => DEGRADED, never GREEN.
//    Continuity channels are reported separately and are not presented as a trust quorum.
//  - A contradicting secondary source (/api/control-plane) degrades the state; it never upgrades it.
//  - Certification criteria are the same ones the canonical build already applied (no loosening).

export type TrustState = 'GREEN' | 'DEGRADED' | 'BLOCKED' | 'NO_PROOF';
export type EngineState = 'GREEN' | 'BLOCKED' | 'NO_PROOF';

export type GlobalTrust = {
  schema: 'zpc-global-trust/v2';
  state: TrustState;
  reasons: string[];
  sha: string | null;
  evidenceRoot: string | null;
  policyVersion: string | null;
  checkedAt: string | null;
  proofObservedAt: string | null;
  validUntil: string | null;
  derivedAt: string;
  /** Independent trust quorum (signers/engines), as published by /api/control-plane trust_chain. */
  quorum: {
    basis: 'independent_signers';
    source: '/api/control-plane trust_chain';
    passed: number | null;
    total: number | null;
    required: number | null;
    independentKeys: number | null;
    ok: boolean;
    conflicts: number;
  };
  /** Technical continuity channels reported by the core (not a trust quorum). */
  continuity: { channels: string[]; total: number; required: number | null; ok: boolean };
  zea10: { proven: number; partial: number; blocked: number; unknown: number };
  zees16: { proven: number; partial: number; blocked: number };
  engines: Array<{ id: string; state: EngineState }>;
  crossCheck: { source: '/api/control-plane'; state: 'agree' | 'contradicts' | 'unavailable'; details: string[] };
  source: string;
  source_error: string | null;
};

/** Core snapshot older than this (read time) is not a live reading. */
export const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
/** ZEES-16 proof older than this is expired (reconciler runs hourly; GitHub cron can slip). */
export const PROOF_MAX_AGE_MS = 3 * 60 * 60 * 1000;

const SHA_RE = /^[0-9a-f]{40}$/;
/** Same threshold as worker/trust-projection.mjs MIN_INDEPENDENT_QUORUM (#792). */
export const MIN_INDEPENDENT_QUORUM = 2;
const finiteOrNull = (value: unknown) => (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null);

export function independentQuorumProven(t: any): boolean {
  if (!t || typeof t !== 'object') return false;
  const passed = Number(t.passed) || 0;
  const required = Number(t.required) || 0;
  const keys = Number(t.independent_keys) || 0;
  const conflicts = Number(t.conflicts) || 0;
  return required >= MIN_INDEPENDENT_QUORUM && passed >= required && keys >= required && conflicts === 0
    && typeof t.evidence_root === 'string' && t.evidence_root.length > 0;
}
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const parseTime = (value: unknown) => {
  const t = Date.parse(String(value ?? ''));
  return Number.isFinite(t) ? t : null;
};
const lowerSha = (value: unknown) => {
  const s = String(value ?? '').trim().toLowerCase();
  return SHA_RE.test(s) ? s : null;
};

export function deriveGlobalTrust(input: {
  snapshot: any;
  decision: any;
  controlPlane: any;
  now?: number;
  sourceError?: string | null;
}): GlobalTrust {
  const now = input.now ?? Date.now();
  const s = input.snapshot && typeof input.snapshot === 'object' ? input.snapshot : null;
  const d = input.decision && typeof input.decision === 'object' ? input.decision : null;
  const cp = input.controlPlane && typeof input.controlPlane === 'object' ? input.controlPlane : null;
  const reasons: string[] = [];

  const sha = lowerSha(s?.release_sha);
  const checkedAtMs = parseTime(s?.generated_at);
  const proofAtMs = parseTime(s?.zees16?.observed_at);
  const zeaC = s?.zea10?.counts || {};
  const zeesC = s?.zees16?.counts || {};
  const zea10 = { proven: num(zeaC.proven), partial: num(zeaC.partial), blocked: num(zeaC.blocked), unknown: num(zeaC.unknown) };
  const zees16 = { proven: num(zeesC.proven), partial: num(zeesC.partial), blocked: num(zeesC.blocked) };

  // ---- Proof presence, binding and validity (any failure => NO_PROOF) ----
  let proofOk = true;
  const noProof = (reason: string) => { proofOk = false; reasons.push(reason); };
  if (!s) noProof(input.sourceError ? `core_unavailable:${input.sourceError}` : 'core_snapshot_missing');
  else {
    if (!sha) noProof('release_sha_missing');
    if (checkedAtMs === null) noProof('snapshot_timestamp_missing');
    else if (now - checkedAtMs > SNAPSHOT_MAX_AGE_MS) noProof('snapshot_stale');
    else if (checkedAtMs - now > 5 * 60 * 1000) noProof('snapshot_timestamp_in_future');
    if (proofAtMs === null) noProof('proof_timestamp_missing');
    else if (now - proofAtMs > PROOF_MAX_AGE_MS) noProof('proof_expired');
    if (!s.zees16 || typeof s.zees16 !== 'object') noProof('zees16_missing');
    else if (lowerSha(s.zees16.release_sha) !== sha) noProof('zees16_not_bound_to_release');
    if (!s.zea10 || typeof s.zea10 !== 'object') noProof('zea10_missing');
    else if (lowerSha(s.zea10.release_sha) !== sha) noProof('zea10_not_bound_to_release');
    if (s.invariants?.exact_release_bound !== true) noProof('release_identity_not_proven');
  }

  // ---- Engines: identical criteria to the canonical build (zpc-canonical-build.yml) ----
  const zeesGreen = zees16.proven === 16 && zees16.partial === 0 && zees16.blocked === 0
    && ['kv-append-only', 'recomputed-immutable-sources'].includes(String(s?.zees16?.persistence || ''));
  const zeaGreen = zea10.proven === 10 && zea10.partial === 0 && zea10.blocked === 0 && zea10.unknown === 0
    && s?.zea10?.authority === true && s?.zea10?.external_review_required !== true;
  let coreState: EngineState;
  if (!d) { coreState = 'NO_PROOF'; reasons.push('core_decision_missing'); }
  else if (lowerSha(d.release_sha) !== sha) { coreState = 'NO_PROOF'; reasons.push('core_decision_not_bound_to_release'); }
  else if (d.decision === 'ALLOW' && d.eligible_for_critical_promotion === true && Array.isArray(d.blockers) && d.blockers.length === 0
    && d.checks?.evidence_integrity_ok === true && d.checks?.zees16_complete === true && d.checks?.zea10_complete === true) coreState = 'GREEN';
  else { coreState = 'BLOCKED'; reasons.push('core_decision_not_allow'); }
  const engines: GlobalTrust['engines'] = [
    { id: 'ZEES-16', state: !s?.zees16 ? 'NO_PROOF' : zeesGreen ? 'GREEN' : 'BLOCKED' },
    { id: 'ZEA-10', state: !s?.zea10 ? 'NO_PROOF' : zeaGreen ? 'GREEN' : 'BLOCKED' },
    { id: 'CORE', state: coreState },
  ];
  if (engines[0].state === 'BLOCKED') reasons.push('zees16_incomplete');
  if (engines[1].state === 'BLOCKED') reasons.push('zea10_incomplete');

  // ---- Continuity channels from the core (technical continuity, NOT a trust quorum) ----
  const channels: string[] = Array.isArray(s?.continuity?.available_channels) ? s.continuity.available_channels.map(String) : [];
  const readinessKeys = s?.status?.channel_readiness && typeof s.status.channel_readiness === 'object'
    ? Object.keys(s.status.channel_readiness) : [];
  const continuityRequired = Number.isFinite(Number(s?.continuity?.min_quorum)) && Number(s?.continuity?.min_quorum) > 0
    ? Number(s.continuity.min_quorum) : null;
  const continuityOk = s?.continuity?.quorum_ok === true && continuityRequired !== null && channels.length >= continuityRequired;
  if (s && !continuityOk) reasons.push(continuityRequired === null ? 'continuity_requirement_missing' : 'continuity_below_minimum');
  if (s && s.invariants?.health_ready !== true) reasons.push('health_not_ready');

  // ---- Independent trust quorum (published by /api/control-plane; never invented here) ----
  const tc = cp?.trust_chain && typeof cp.trust_chain === 'object' ? cp.trust_chain : null;
  const quorumOk = independentQuorumProven(tc);
  if (!quorumOk) reasons.push('independent_quorum_unproven');

  // ---- Cross-check against /api/control-plane (can only degrade) ----
  const crossDetails: string[] = [];
  let cross: GlobalTrust['crossCheck']['state'] = 'agree';
  if (!cp) { cross = 'unavailable'; crossDetails.push('control_plane_unavailable'); }
  else {
    const cpSha = lowerSha(cp?.release?.deployment?.commit_sha || cp?.proof_chain?.sha);
    if (sha && cpSha && cpSha !== sha) crossDetails.push('release_sha_differs');
    const live = cp?.zea10_live;
    const liveCounts = live?.report?.counts || null;
    if (!live) crossDetails.push('zea10_live_missing');
    else {
      if (lowerSha(live?.report?.release_sha) && lowerSha(live.report.release_sha) !== sha) crossDetails.push('zea10_live_release_differs');
      if (liveCounts && (num(liveCounts.proven) !== zea10.proven || num(liveCounts.partial) !== zea10.partial || num(liveCounts.blocked) !== zea10.blocked)) crossDetails.push('zea10_counts_differ');
      const liveGreen = live.ready === true && live.fail_closed === false;
      if (liveGreen !== zeaGreen) crossDetails.push('zea10_live_state_differs');
    }
    // trust_chain may legitimately be UNVERIFIED (no independent quorum, #792). A BLOCKED chain
    // against an all-green core, or a GREEN chain against a non-green core, is a contradiction.
    const cpTrust = String(tc?.state || '');
    const coreAllGreen = engines.every(e => e.state === 'GREEN');
    if ((cpTrust === 'BLOCKED' && coreAllGreen) || (cpTrust === 'GREEN' && !coreAllGreen)) crossDetails.push(`trust_chain_${cpTrust.toLowerCase()}_vs_core`);
    if (crossDetails.length) cross = 'contradicts';
  }
  if (cross !== 'agree') reasons.push(`cross_check_${cross}`);

  // ---- Final state, most severe wins: NO_PROOF > BLOCKED > DEGRADED > GREEN ----
  let state: TrustState;
  if (!proofOk || engines.some(e => e.state === 'NO_PROOF')) state = 'NO_PROOF';
  else if (engines.some(e => e.state === 'BLOCKED')) state = 'BLOCKED';
  else if (!quorumOk || !continuityOk || s?.invariants?.health_ready !== true || cross !== 'agree') state = 'DEGRADED';
  else state = 'GREEN';

  const validUntilMs = checkedAtMs !== null && proofAtMs !== null
    ? Math.min(checkedAtMs + SNAPSHOT_MAX_AGE_MS, proofAtMs + PROOF_MAX_AGE_MS) : null;

  return {
    schema: 'zpc-global-trust/v2',
    state,
    reasons: Array.from(new Set(reasons)),
    sha,
    evidenceRoot: typeof s?.zees16?.decision_hash === 'string' ? s.zees16.decision_hash : null,
    policyVersion: typeof s?.zea10?.evaluator === 'string' ? s.zea10.evaluator : typeof s?.zees16?.policy_version === 'string' ? s.zees16.policy_version : null,
    checkedAt: checkedAtMs !== null ? new Date(checkedAtMs).toISOString() : null,
    proofObservedAt: proofAtMs !== null ? new Date(proofAtMs).toISOString() : null,
    validUntil: validUntilMs !== null ? new Date(validUntilMs).toISOString() : null,
    derivedAt: new Date(now).toISOString(),
    quorum: {
      basis: 'independent_signers',
      source: '/api/control-plane trust_chain',
      passed: finiteOrNull(tc?.passed),
      total: finiteOrNull(tc?.total),
      required: finiteOrNull(tc?.required),
      independentKeys: finiteOrNull(tc?.independent_keys),
      ok: quorumOk,
      conflicts: crossDetails.length + (Number(tc?.conflicts) || 0),
    },
    continuity: { channels, total: Math.max(readinessKeys.length, channels.length), required: continuityRequired, ok: continuityOk },
    zea10,
    zees16,
    engines,
    crossCheck: { source: '/api/control-plane', state: cross, details: crossDetails },
    source: 'ZEVANORY Control Core /api/core/v1/snapshot + /api/core/v1/decision (live)',
    source_error: input.sourceError ?? null,
  };
}

type Fetcher = { fetch: (request: Request) => Promise<Response> };

async function readJson(path: string, core: Fetcher | null, timeoutMs: number): Promise<any> {
  const url = 'https://zevanory.api.br' + path;
  const init = { headers: { accept: 'application/json', 'user-agent': 'ZEVANORY-Panel-Trust/2' }, signal: AbortSignal.timeout(timeoutMs) };
  // A service binding reaches the core Worker directly (no same-zone routing ambiguity, no egress).
  const response = core ? await core.fetch(new Request(url, init)) : await fetch(url, init);
  if (!response.ok) throw new Error(path + '_http_' + response.status);
  return response.json();
}

/** Builds the live trust document. Never throws; any failure becomes NO_PROOF / cross-check unavailable. */
export async function loadGlobalTrust(core: Fetcher | null, now = Date.now()): Promise<GlobalTrust> {
  const [snap, dec, cp] = await Promise.allSettled([
    readJson('/api/core/v1/snapshot', core, 8000),
    readJson('/api/core/v1/decision', core, 8000),
    readJson('/api/control-plane', core, 8000),
  ]);
  const err = (r: PromiseSettledResult<any>) => (r.status === 'rejected' ? String((r.reason as any)?.message || r.reason).slice(0, 120) : null);
  return deriveGlobalTrust({
    snapshot: snap.status === 'fulfilled' ? snap.value : null,
    decision: dec.status === 'fulfilled' ? dec.value : null,
    controlPlane: cp.status === 'fulfilled' ? cp.value : null,
    sourceError: err(snap),
    now,
  });
}

const CACHE_KEY = 'https://controle.zevanory.api.br/__cache/global-trust/v2';
/** Shared edge cache: at most one core read per colo per TTL, however many panels poll. */
export const TRUST_CACHE_TTL_S = 30;

export async function globalTrustResponse(env: Record<string, any>, ctx?: { waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, max-age=0', 'x-zpc-trust-source': 'live-control-core' };
  const cache: Cache | null = (globalThis as any).caches?.default ?? null;
  if (cache) {
    const hit = await cache.match(CACHE_KEY).catch(() => undefined);
    if (hit) {
      const body = await hit.text();
      return new Response(body, { headers: { ...headers, 'x-zpc-trust-cache': 'hit' } });
    }
  }
  const core = env?.CORE_WORKER && typeof env.CORE_WORKER.fetch === 'function' ? env.CORE_WORKER as Fetcher : null;
  const trust = await loadGlobalTrust(core);
  const body = JSON.stringify(trust);
  if (cache) {
    const put = cache.put(CACHE_KEY, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${TRUST_CACHE_TTL_S}` } })).catch(() => undefined);
    if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
  }
  return new Response(body, { headers: { ...headers, 'x-zpc-trust-cache': 'miss' } });
}
