import { createHmac, timingSafeEqual } from 'node:crypto';

type HeaderMap = Record<string, string | string[] | undefined>;
type AuthResult =
  | { ok: true; status: 200 }
  | { ok: false; status: 401 | 409 | 503; error: string };

const usedNonces = new Map<string, number>();

function cleanNonceCache(now: number) {
  for (const [nonce, at] of usedNonces) {
    if (at < now - 120_000) usedNonces.delete(nonce);
  }
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

export function verifyCommercialRobotTickRequest(headers: HeaderMap, now = Date.now()): AuthResult {
  const secret = String(process.env.COMMERCIAL_ROBOT_TICK_SECRET || '');
  if (secret.length < 32) return { ok: false, status: 503, error: 'commercial_robot_tick_secret_missing' };

  const timestamp = headerValue(headers['x-commercial-timestamp']);
  const nonce = headerValue(headers['x-commercial-nonce']);
  const signature = headerValue(headers['x-commercial-signature']).toLowerCase();
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 120_000) {
    return { ok: false, status: 401, error: 'commercial_robot_tick_auth_required' };
  }
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) {
    return { ok: false, status: 401, error: 'commercial_robot_tick_auth_required' };
  }

  const message = ['zevanory-commercial-robot-tick-v1', timestamp, nonce].join('\n');
  const expected = createHmac('sha256', secret).update(message).digest();
  const supplied = Buffer.from(signature, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) {
    return { ok: false, status: 401, error: 'commercial_robot_tick_auth_required' };
  }

  cleanNonceCache(now);
  if (usedNonces.has(nonce)) return { ok: false, status: 409, error: 'commercial_robot_tick_replay' };
  usedNonces.set(nonce, now);
  return { ok: true, status: 200 };
}
