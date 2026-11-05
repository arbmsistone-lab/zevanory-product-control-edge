// DEC-13(a): anti-lockout throttling for the passphrase administrative login.
//
// Design (see docs/dec09-passphrase-cutover.md, section "DEC-13(a)"):
// 1. Per-source limits come FIRST and are keyed on CF-Connecting-IP only (set by Cloudflare at the
//    edge, overwritten on every request; client-supplied X-Forwarded-For / X-Real-IP / True-Client-IP
//    are never read). IPv6 addresses are grouped by /64 so one allocation cannot rotate addresses.
// 2. There is NO global lock: anonymous failures only ever lock the source that produced them.
// 3. An aggregate counter (Worker rate-limit bucket + durable backend window) is only a SIGNAL. When it
//    is hot, sources WITHOUT a valid trusted-device cookie get stricter per-source limits; it never
//    rejects a request by itself. A trusted-device cookie is minted only after a successful login, is
//    HMAC-signed with SESSION_SIGNING_KEY (domain-separated) and grants nothing except bypassing that
//    aggregate tightening; it is never an authentication factor.
// 4. Missing/failed limiter or store => fail closed (503), unchanged.

export const PASSPHRASE_SOURCE_BUCKET_PREFIX = 'passphrase-src:';
export const PASSPHRASE_AGGREGATE_BUCKET = 'admin-passphrase-aggregate';
export const TRUSTED_DEVICE_COOKIE = '__Host-zpc_td';
export const TRUSTED_DEVICE_DAYS = 30;

/** Durable per-source lock policy (backend). */
export const SOURCE_MAX_FAILURES = 5;
/** Per-source failure threshold for untrusted sources while the aggregate signal is hot. */
export const SOURCE_MAX_FAILURES_UNDER_ATTACK = 3;
export const SOURCE_LOCK_MINUTES = 15;
export const SOURCE_LOCK_CAP_MINUTES = 120;
/** Durable aggregate signal: failures across all sources inside a rolling-start window. */
export const AGGREGATE_WINDOW_MINUTES = 15;
export const AGGREGATE_HOT_FAILURES = 25;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function expandIpv6(value: string): string[] | null {
  let v = value.toLowerCase();
  const zone = v.indexOf('%');
  if (zone >= 0) v = v.slice(0, zone);
  // IPv4-mapped / embedded tail (e.g. ::ffff:192.0.2.1)
  const tail = v.match(/:(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    if (!IPV4.test(tail[1])) return null;
    const p = tail[1].split('.').map(Number);
    v = v.slice(0, -tail[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
  }
  if (!/^[0-9a-f:]+$/.test(v) || (v.match(/::/g) || []).length > 1) return null;
  const [head, rest] = v.includes('::') ? v.split('::') : [v, null];
  const left = head ? head.split(':') : [];
  const right = rest === null ? [] : rest ? rest.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (rest === null ? left.length !== 8 : missing < 1) return null;
  const groups = [...left, ...Array(rest === null ? 0 : missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map(g => g.replace(/^0+(?=.)/, ''));
}

/**
 * Trustworthy source identity for authentication throttling. Reads ONLY CF-Connecting-IP.
 * A missing or malformed value maps to one shared 'unattributed' source (never to a bypass).
 */
export function adminAuthSourceKey(headers: Headers): string {
  const raw = String(headers.get('cf-connecting-ip') || '').trim();
  if (IPV4.test(raw)) return 'ip4:' + raw;
  const v6 = raw.includes(':') ? expandIpv6(raw) : null;
  if (v6) {
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) is the IPv4 host itself.
    if (v6.slice(0, 5).every(g => g === '0') && v6[5] === 'ffff') {
      const a = parseInt(v6[6], 16), b = parseInt(v6[7], 16);
      return 'ip4:' + [a >> 8, a & 255, b >> 8, b & 255].join('.');
    }
    return 'ip6:' + v6.slice(0, 4).join(':') + '::/64';
  }
  return 'unattributed';
}

function b64url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('zpc-trusted-device-v1\u0000' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let m = 0;
  for (let i = 0; i < a.length; i++) m |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return m === 0;
}

export async function mintTrustedDevice(secret: string, now = Date.now()) {
  if (String(secret || '').length < 32) return null;
  const exp = now + TRUSTED_DEVICE_DAYS * 86400e3;
  const body = 'td1.' + exp.toString(36) + '.' + crypto.randomUUID().replace(/-/g, '');
  return { value: body + '.' + await hmac(secret, body), maxAge: TRUSTED_DEVICE_DAYS * 86400 };
}

export function trustedDeviceSetCookie(value: string, maxAge: number) {
  return `${TRUSTED_DEVICE_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

function readCookie(headers: Headers, name: string) {
  for (const part of String(headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

/** True only for an unexpired cookie signed with the current signing key. Never throws. */
export async function hasTrustedDevice(headers: Headers, secret: string, now = Date.now()) {
  try {
    if (String(secret || '').length < 32) return false;
    const value = readCookie(headers, TRUSTED_DEVICE_COOKIE);
    const m = value.match(/^(td1\.([0-9a-z]{1,12})\.[0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/);
    if (!m) return false;
    if (parseInt(m[2], 36) <= now) return false;
    return safeEqual(await hmac(secret, m[1]), m[3]);
  } catch {
    return false;
  }
}

/** Deterministic UUID-shaped record id for a source (the raw IP is never stored). */
export async function sourceRecordId(source: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('zpc-auth-source-v1\u0000' + source)));
  const hex = Array.from(digest.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
  // RFC 9562 version 8 (custom) + variant bits so the store accepts it as a uuid.
  const v = hex.slice(0, 12) + '8' + hex.slice(13, 16) + ((parseInt(hex[16], 16) & 3) | 8).toString(16) + hex.slice(17);
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20, 32)}`;
}

export const AGGREGATE_RECORD_ID = '00000000-0000-8000-8000-00000000da13';
