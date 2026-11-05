import assert from 'node:assert/strict';
import { adminPinState, completePortableAccessMigration, setWorkerEnv, verifyAdminPin } from '../cf-worker/platform-worker.ts';
import { createEdgeSession, verifyEdgeSession } from '../cf-worker/backend-index.ts';

const signingKey = 'nc027-session-signing-secret-32-characters-minimum';
const firstPhrase = 'Frase forte de teste para o proprietario 2026!';
const rotatedPhrase = 'Outra frase diferente e igualmente longa 2026!';

setWorkerEnv({ SESSION_SIGNING_KEY: signingKey, ADMIN_PIN: '1234' });
const oldSession = await createEdgeSession();
assert.equal(await verifyEdgeSession(oldSession.token), true);

setWorkerEnv({ SESSION_SIGNING_KEY: signingKey, ADMIN_PIN: '1234', ADMIN_AUTH_MODE: 'passphrase', ADMIN_PASSPHRASE: firstPhrase });
const state = await adminPinState();
assert.equal(state.configured, true);
assert.equal(state.source, 'runtime-passphrase');
assert.equal((await verifyAdminPin(firstPhrase)).valid, true);
assert.equal((await verifyAdminPin('1234')).valid, false);
assert.equal((await verifyAdminPin('frase curta')).valid, false);
assert.equal((await verifyAdminPin(firstPhrase.toLowerCase())).valid, false);
assert.equal(await verifyEdgeSession(oldSession.token), false, 'legacy PIN session must not survive cutover');
const newSession = await createEdgeSession();
assert.equal(await verifyEdgeSession(newSession.token), true);
assert.equal((await completePortableAccessMigration('5678', 'anything')).status, 403, 'legacy migration must be unavailable');

setWorkerEnv({ SESSION_SIGNING_KEY: signingKey, ADMIN_AUTH_MODE: 'passphrase', ADMIN_PASSPHRASE: rotatedPhrase });
assert.equal((await verifyAdminPin(firstPhrase)).valid, false);
assert.equal((await verifyAdminPin(rotatedPhrase)).valid, true);
assert.equal(await verifyEdgeSession(newSession.token), false, 'rotating owner passphrase must revoke prior sessions');
const rotatedSession = await createEdgeSession();
assert.equal(await verifyEdgeSession(rotatedSession.token), true);

setWorkerEnv({ SESSION_SIGNING_KEY: signingKey, ADMIN_AUTH_MODE: 'passphrase', ADMIN_PASSPHRASE: 'curta' });
assert.equal((await adminPinState()).configured, false);
assert.equal((await verifyAdminPin('curta')).valid, false);
assert.equal(await verifyEdgeSession(rotatedSession.token), false);
await assert.rejects(createEdgeSession(), /admin_passphrase_unconfigured/);

setWorkerEnv({ SESSION_SIGNING_KEY: '', ADMIN_AUTH_MODE: 'passphrase', ADMIN_PASSPHRASE: firstPhrase });
assert.equal((await adminPinState()).configured, false, 'missing pepper fails closed');

setWorkerEnv({});
console.log('PASSPHRASE_MIGRATION_PASS legacy_rejected=true rotation_revoked=true invalid_config_denied=true migration_disabled=true');
