import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyCommercialRobotTickRequest } from '../backend/commercial-robot-auth.mjs';

process.env.COMMERCIAL_ROBOT_TICK_SECRET = 'unit-test-commercial-robot-secret-32-chars-minimum';
const now = 1791291600000;
const timestamp = String(now);
const nonce = '01234567-89ab-cdef-0123-456789abcdef';
const message = ['zevanory-commercial-robot-tick-v1', timestamp, nonce].join('\n');
const signature = createHmac('sha256', process.env.COMMERCIAL_ROBOT_TICK_SECRET).update(message).digest('hex');
const headers = {
  'x-commercial-timestamp': timestamp,
  'x-commercial-nonce': nonce,
  'x-commercial-signature': signature,
};

assert.deepEqual(verifyCommercialRobotTickRequest(headers, now), { ok: true, status: 200 });
assert.deepEqual(verifyCommercialRobotTickRequest(headers, now), { ok: false, status: 409, error: 'commercial_robot_tick_replay' });
assert.equal(verifyCommercialRobotTickRequest({ ...headers, 'x-commercial-signature': '0'.repeat(64) }, now).status, 401);
assert.equal(verifyCommercialRobotTickRequest({ ...headers, 'x-commercial-timestamp': String(now - 121_000), 'x-commercial-nonce': 'fedcba98-7654-3210-fedc-ba9876543210' }, now).status, 401);
console.log('COMMERCIAL_ROBOT_TICK_AUTH=PASS');
