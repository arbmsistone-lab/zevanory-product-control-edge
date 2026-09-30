import assert from 'node:assert/strict';
import { shouldEndSession, trustPresentation, MAX_STATE_AGE_MS } from '../src/runtime-state';

const now = Date.now();
const valid = {
  state: 'GREEN', sha: 'a'.repeat(40), evidenceRoot: 'b'.repeat(64), checkedAt: new Date(now).toISOString(),
  quorum: { passed: 3, required: 3, conflicts: 0 }, zea10: { proven: 10, partial: 0, blocked: 0 },
  engines: ['zees16-core', 'zea10-evaluator', 'control-core'].map(id => ({ id, state: 'GREEN' })),
};
assert.equal(trustPresentation(valid, now, now).approved, true);
for (const input of [
  null,
  { ...valid, checkedAt: null },
  { ...valid, checkedAt: new Date(now - MAX_STATE_AGE_MS - 1).toISOString() },
  { ...valid, checkedAt: new Date(now + 31000).toISOString() },
  { ...valid, sha: 'unknown' },
  { ...valid, evidenceRoot: null },
  { ...valid, engines: [] },
  { ...valid, engines: valid.engines.map(e => ({ ...e, state: 'BLOCKED' })) },
  { ...valid, quorum: { passed: 2, required: 3, conflicts: 0 } },
  { ...valid, quorum: { passed: 3, required: 3, conflicts: 1 } },
  { ...valid, zea10: { proven: 0, partial: 2, blocked: 8 } },
]) assert.equal(trustPresentation(input, now, now).approved, false);
assert.equal(trustPresentation(valid, now + MAX_STATE_AGE_MS + 1, now).freshness, 'STALE');
assert.equal(shouldEndSession({ response: { status: 401 } }), true);
for (const cause of [new TypeError('Failed to fetch'), new Error('timeout'), { response: { status: 403 } }, { response: { status: 500 } }, { response: { status: 503 } }]) {
  assert.equal(shouldEndSession(cause), false);
}
console.log('RUNTIME_STATE_CONTRACT=PASS');
