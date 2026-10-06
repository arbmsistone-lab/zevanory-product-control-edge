import { createHmac, timingSafeEqual } from 'node:crypto';

const usedNonces = new Map();

function cleanNonceCache(now) {
  for (const [nonce, at] of usedNonces) {
    if (at < now - 120_000) usedNonces.delete(nonce);
  }
}

export function verifyCommercialRobotTickRequest(headers, now = Date.now()) {
  const secret = String(process.env.COMMERCIAL_ROBOT_TICK_SECRET || '');
  if (secret.length < 32) return { ok: false, status: 503, error: 'commercial_robot_tick_secret_missing' };

  const timestamp = String(headers['x-commercial-timestamp'] || '');
  const nonce = String(headers['x-commercial-nonce'] || '');
  const signature = String(headers['x-commercial-signature'] || '').toLowerCase();
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
