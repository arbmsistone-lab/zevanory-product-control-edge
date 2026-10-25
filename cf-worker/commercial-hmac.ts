// R9-D1 (Sol 233/237): HMAC x-commercial-signature verification for the T2 commercial routes of the control
// Worker (controle.zevanory.api.br). Single place for the accepted-secret candidates, so every route verifies with
// the same rule and the operator-token migration window is applied once.
//
// Candidates (each must be >= 32 chars; shorter or absent values are ignored):
//   - COMMERCIAL_ROBOT_TICK_SECRET  -> category "tick"    (always, as today)
//   - CERTIFICATION_E2E_TOKEN       -> category "legacy"  (always, as today; removed only by the follow-up PR A2)
//   - ZEVANORY_OPERATOR_TOKEN       -> category "primary" (ONLY inside the migration window)
//
// Migration window: same non-secret flag and same code ceiling as the main Worker (zevanory-public-mirror
// worker/operator-credential.mjs, PR #923): OPERATOR_TOKEN_MIGRATION_UNTIL=YYYY-MM-DD, open until 23:59:59.999Z of that
// day (UTC). Absent, malformed, impossible date, expired or beyond MIGRATION_CODE_CEILING => closed, and the candidate
// set is EXACTLY today's [tick, legacy]. Extending the date requires a new deploy with a new, separately authorised
// flag value; the code never extends it by itself and never accepts a date past the ceiling.
//
// Verification: HMAC-SHA256 over the route's canonical string; crypto.subtle.verify (constant time) is evaluated
// against ALL candidates, with no early exit, and the first matching category is returned. Timestamp format, nonce
// format and the +/-5 min skew window are unchanged. Only the category is ever logged (primary|legacy|tick|none),
// never a value, length, hash or signature.

export const OPERATOR_TOKEN_NAME = 'ZEVANORY_OPERATOR_TOKEN';
export const LEGACY_OPERATOR_TOKEN_NAME = 'CERTIFICATION_E2E_TOKEN';
export const TICK_SECRET_NAME = 'COMMERCIAL_ROBOT_TICK_SECRET';
export const MIGRATION_FLAG_NAME = 'OPERATOR_TOKEN_MIGRATION_UNTIL';
export const MIGRATION_CODE_CEILING = '2026-12-31';
export const MIN_SECRET_LENGTH = 32;
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type CommercialAuthCategory = 'primary' | 'legacy' | 'tick';
export type CommercialAuthResult = CommercialAuthCategory | 'none';
type Env = Record<string, unknown>;
type Logger = { info?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void } | null | undefined;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (value: unknown) => (value === undefined || value === null ? '' : String(value));

export function migrationDayEnd(day: string) {
  if (!ISO_DAY.test(day)) return NaN;
  const t = Date.parse(day + 'T23:59:59.999Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === day ? t : NaN;
}

export function operatorTokenMigration(env: Env, now = Date.now()) {
  const value = text(env?.[MIGRATION_FLAG_NAME]).trim();
  if (!value) return { open: false, state: 'absent' } as const;
  const until = migrationDayEnd(value);
  if (!Number.isFinite(until)) return { open: false, state: 'invalid' } as const;
  if (value > MIGRATION_CODE_CEILING) return { open: false, state: 'beyond_code_ceiling' } as const;
  if (now > until) return { open: false, state: 'expired' } as const;
  return { open: true, state: 'open', until: value } as const;
}

// Secrets accepted to VERIFY an incoming signature (never used to sign). Order is irrelevant for the result
// because every candidate is always evaluated.
export function commercialHmacCandidates(env: Env, now = Date.now()) {
  const list: { secret: string; category: CommercialAuthCategory }[] = [];
  const add = (name: string, category: CommercialAuthCategory) => {
    const secret = text(env?.[name]);
    if (secret.length >= MIN_SECRET_LENGTH) list.push({ secret, category });
  };
  add(TICK_SECRET_NAME, 'tick');
  if (operatorTokenMigration(env, now).open) add(OPERATOR_TOKEN_NAME, 'primary');
  add(LEGACY_OPERATOR_TOKEN_NAME, 'legacy');
  return list;
}

const authCounts: Record<CommercialAuthResult, number> = { primary: 0, legacy: 0, tick: 0, none: 0 };
const authLogged = new Set<string>();

export function recordCommercialAuth(category: CommercialAuthResult, log: Logger = console) {
  const key: CommercialAuthResult = Object.prototype.hasOwnProperty.call(authCounts, category) ? category : 'none';
  authCounts[key] += 1;
  if (!authLogged.has(key)) {
    authLogged.add(key);
    try {
      const fn = key === 'legacy' || key === 'none' ? log?.warn : log?.info;
      fn?.call(log, 'commercial_hmac_auth', JSON.stringify({ category: key }));
    } catch {}
  }
  return key;
}

export function commercialAuthCounts() {
  return { ...authCounts };
}

// Verifies x-commercial-{timestamp,nonce,signature} for the canonical string
// [purpose, timestamp, nonce, ...extra].join('\n'). Returns the accepted category or 'none'.
export async function verifyCommercialSignature(
  headers: Headers,
  env: Env,
  purpose: string,
  extra: string[] = [],
  { now = Date.now(), log = console as Logger }: { now?: number; log?: Logger } = {},
): Promise<CommercialAuthResult> {
  const candidates = commercialHmacCandidates(env, now);
  const timestamp = String(headers.get('x-commercial-timestamp') || '');
  const nonce = String(headers.get('x-commercial-nonce') || '');
  const signature = String(headers.get('x-commercial-signature') || '').toLowerCase();
  if (!candidates.length || !/^\d{13}$/.test(timestamp) || !/^[0-9a-f-]{36}$/i.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) {
    return recordCommercialAuth('none', log);
  }
  if (Math.abs(now - Number(timestamp)) > MAX_CLOCK_SKEW_MS) return recordCommercialAuth('none', log);
  const bytes = Uint8Array.from(signature.match(/.{2}/g) || [], pair => parseInt(pair, 16));
  const message = new TextEncoder().encode([purpose, timestamp, nonce, ...extra].join('\n'));
  let hit: CommercialAuthResult = 'none';
  for (const candidate of candidates) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(candidate.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, bytes, message);
    if (ok && hit === 'none') hit = candidate.category;
  }
  return recordCommercialAuth(hit, log);
}

// Canonical purposes. COMMERCIAL_AUTH_PROBE_PURPOSE is domain-separated from the route purposes: a probe signature
// can never be replayed against a route that has side effects, and vice versa.
export const CREATIVE_FACTORY_PURPOSE = 'zevanory-commercial-creative-factory-v1';
export const CREATIVE_UPLOAD_PURPOSE = 'zevanory-commercial-creative-upload-v1';
export const COMMERCIAL_AUTH_PROBE_PURPOSE = 'zevanory-commercial-auth-probe-v1';
