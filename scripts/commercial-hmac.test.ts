// R9-D1 (Sol 237): control Worker HMAC dual acceptance during the operator-token migration window.
// Behavioural tests of cf-worker/commercial-hmac.ts plus static checks that every T2 route verifies through it.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  COMMERCIAL_AUTH_PROBE_PURPOSE, CREATIVE_FACTORY_PURPOSE, CREATIVE_UPLOAD_PURPOSE, MIGRATION_CODE_CEILING,
  commercialAuthCounts, commercialHmacCandidates, migrationDayEnd, operatorTokenMigration, verifyCommercialSignature,
} from '../cf-worker/commercial-hmac.ts';
import { assertWranglerConfigHasNoCredentialVars, migrationFlagVarArgs, MIGRATION_CODE_CEILING as DEPLOY_CEILING } from './operator-token-migration-flag.mjs';

const TICK = 'tick-secret-value-0123456789abcdef-TICK';
const LEGACY = 'legacy-cert-e2e-value-0123456789abcdef-OLD';
const NEW = 'new-operator-token-value-0123456789abcdef-NEW';
const UNKNOWN = 'unknown-value-not-configured-0123456789abcdef';
const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const UNTIL = '2026-11-20';
const windowEnv = { COMMERCIAL_ROBOT_TICK_SECRET: TICK, CERTIFICATION_E2E_TOKEN: LEGACY, ZEVANORY_OPERATOR_TOKEN: NEW, OPERATOR_TOKEN_MIGRATION_UNTIL: UNTIL };

function capture() {
  const lines: string[] = [];
  const push = (...args: unknown[]) => { lines.push(args.map(a => String(a)).join(' ')); };
  return { log: { info: push, warn: push }, lines };
}
function headers(secret: string, purpose: string, extra: string[] = [], { ts = NOW, nonce = randomUUID() }: { ts?: number; nonce?: string } = {}) {
  const timestamp = String(ts);
  const signature = createHmac('sha256', secret).update([purpose, timestamp, nonce, ...extra].join('\n')).digest('hex');
  return new Headers({ 'x-commercial-timestamp': timestamp, 'x-commercial-nonce': nonce, 'x-commercial-signature': signature });
}
const verify = (env: Record<string, unknown>, h: Headers, purpose = CREATIVE_FACTORY_PURPOSE, extra: string[] = [], now = NOW, log: any = null) =>
  verifyCommercialSignature(h, env, purpose, extra, { now, log });

// H1 new value accepted inside the window (category primary), for every T2 canonical string.
assert.equal(operatorTokenMigration(windowEnv, NOW).open, true, '[H1.0] window open');
assert.equal(await verify(windowEnv, headers(NEW, CREATIVE_FACTORY_PURPOSE)), 'primary', '[H1.1] factory/background/publish canonical');
assert.equal(await verify(windowEnv, headers(NEW, CREATIVE_UPLOAD_PURPOSE, ['ia-na-pratica', 'ab'.repeat(32)]), CREATIVE_UPLOAD_PURPOSE, ['ia-na-pratica', 'ab'.repeat(32)]), 'primary', '[H1.2] upload canonical');
assert.equal(await verify(windowEnv, headers(NEW, COMMERCIAL_AUTH_PROBE_PURPOSE), COMMERCIAL_AUTH_PROBE_PURPOSE), 'primary', '[H1.3] probe canonical');

// H2 legacy and tick keep working, inside and outside the window (today's behaviour).
assert.equal(await verify(windowEnv, headers(LEGACY, CREATIVE_FACTORY_PURPOSE)), 'legacy', '[H2.1] legacy in window');
assert.equal(await verify(windowEnv, headers(TICK, CREATIVE_FACTORY_PURPOSE)), 'tick', '[H2.2] tick in window');
const closedEnv = { ...windowEnv, OPERATOR_TOKEN_MIGRATION_UNTIL: '' };
assert.equal(await verify(closedEnv, headers(LEGACY, CREATIVE_FACTORY_PURPOSE)), 'legacy', '[H2.3] legacy outside window');
assert.equal(await verify(closedEnv, headers(TICK, CREATIVE_FACTORY_PURPOSE)), 'tick', '[H2.4] tick outside window');

// H3 unknown value, wrong canonical, upload body/slug binding: rejected.
assert.equal(await verify(windowEnv, headers(UNKNOWN, CREATIVE_FACTORY_PURPOSE)), 'none', '[H3.1] unknown value');
assert.equal(await verify(windowEnv, headers(NEW, COMMERCIAL_AUTH_PROBE_PURPOSE)), 'none', '[H3.2] probe signature never valid on a T2 route');
assert.equal(await verify(windowEnv, headers(NEW, CREATIVE_FACTORY_PURPOSE), COMMERCIAL_AUTH_PROBE_PURPOSE), 'none', '[H3.3] T2 signature never valid on the probe');
assert.equal(await verify(windowEnv, headers(NEW, CREATIVE_UPLOAD_PURPOSE, ['ia-na-pratica', 'ab'.repeat(32)]), CREATIVE_UPLOAD_PURPOSE, ['ia-na-pratica', 'cd'.repeat(32)]), 'none', '[H3.4] upload bound to body hash');
const bad = headers(NEW, CREATIVE_FACTORY_PURPOSE); bad.set('x-commercial-signature', '0'.repeat(64));
assert.equal(await verify(windowEnv, bad), 'none', '[H3.5] zero signature');

// H4 absent / short secrets fail closed.
assert.equal(commercialHmacCandidates({}, NOW).length, 0, '[H4.1] no candidates');
assert.equal(await verify({}, headers(NEW, CREATIVE_FACTORY_PURPOSE)), 'none', '[H4.2] nothing configured');
assert.equal(await verify({ OPERATOR_TOKEN_MIGRATION_UNTIL: UNTIL }, headers(NEW, CREATIVE_FACTORY_PURPOSE)), 'none', '[H4.3] window open but no secret');
const shortEnv = { COMMERCIAL_ROBOT_TICK_SECRET: 'short', CERTIFICATION_E2E_TOKEN: 'short', ZEVANORY_OPERATOR_TOKEN: 'short', OPERATOR_TOKEN_MIGRATION_UNTIL: UNTIL };
assert.equal(commercialHmacCandidates(shortEnv, NOW).length, 0, '[H4.4] short values ignored');
assert.equal(await verify(shortEnv, headers('short', CREATIVE_FACTORY_PURPOSE)), 'none', '[H4.5] short value rejected');
assert.equal(await verify({ ZEVANORY_OPERATOR_TOKEN: NEW }, headers(NEW, CREATIVE_FACTORY_PURPOSE)), 'none', '[H4.6] new value alone, no flag: closed');

// H5 timestamp/nonce/skew rules unchanged (13-digit ms, UUID nonce, 64-hex signature, +/-5 min).
assert.equal(await verify(windowEnv, headers(NEW, CREATIVE_FACTORY_PURPOSE, [], { ts: NOW - 5 * 60_000 })), 'primary', '[H5.1] 5 min old accepted');
assert.equal(await verify(windowEnv, headers(NEW, CREATIVE_FACTORY_PURPOSE, [], { ts: NOW - 5 * 60_000 - 1 })), 'none', '[H5.2] older than 5 min');
assert.equal(await verify(windowEnv, headers(NEW, CREATIVE_FACTORY_PURPOSE, [], { ts: NOW + 5 * 60_000 + 1 })), 'none', '[H5.3] future beyond 5 min');
assert.equal(await verify(windowEnv, headers(LEGACY, CREATIVE_FACTORY_PURPOSE, [], { ts: NOW - 5 * 60_000 - 1 })), 'none', '[H5.4] legacy same skew');
assert.equal(await verify(windowEnv, headers(NEW, CREATIVE_FACTORY_PURPOSE, [], { nonce: 'not-a-uuid' })), 'none', '[H5.5] nonce format');
const secTs = headers(NEW, CREATIVE_FACTORY_PURPOSE); secTs.set('x-commercial-timestamp', String(Math.floor(NOW / 1000)));
assert.equal(await verify(windowEnv, secTs), 'none', '[H5.6] seconds timestamp rejected');

// H6 window expiry and flag validation (same semantics as the main Worker).
const endOfDay = Date.parse(UNTIL + 'T23:59:59.999Z');
assert.equal(migrationDayEnd(UNTIL), endOfDay, '[H6.1] day end');
assert.equal(await verify(windowEnv, headers(NEW, CREATIVE_FACTORY_PURPOSE, [], { ts: endOfDay }), CREATIVE_FACTORY_PURPOSE, [], endOfDay), 'primary', '[H6.2] last ms open');
assert.equal(await verify(windowEnv, headers(NEW, CREATIVE_FACTORY_PURPOSE, [], { ts: endOfDay + 1 }), CREATIVE_FACTORY_PURPOSE, [], endOfDay + 1), 'none', '[H6.3] new value rejected after expiry');
assert.equal(await verify(windowEnv, headers(LEGACY, CREATIVE_FACTORY_PURPOSE, [], { ts: endOfDay + 1 }), CREATIVE_FACTORY_PURPOSE, [], endOfDay + 1), 'legacy', '[H6.4] legacy unchanged after expiry');
assert.equal(operatorTokenMigration(windowEnv, endOfDay + 1).state, 'expired', '[H6.5] expired state');
for (const [value, state] of [['', 'absent'], ['2026-02-30', 'invalid'], ['20261120', 'invalid'], ['2026-11-20T00:00', 'invalid'], ['2027-01-01', 'beyond_code_ceiling'], ['2026-12-31', 'open']] as const) {
  assert.equal(operatorTokenMigration({ OPERATOR_TOKEN_MIGRATION_UNTIL: value }, NOW).state, state, '[H6.6] flag ' + JSON.stringify(value));
}
assert.equal(commercialHmacCandidates({ ...windowEnv, OPERATOR_TOKEN_MIGRATION_UNTIL: '2027-01-01' }, NOW).some(c => c.category === 'primary'), false, '[H6.7] beyond ceiling never opens');
assert.deepEqual(commercialHmacCandidates(closedEnv, NOW).map(c => c.category).sort(), ['legacy', 'tick'], '[H6.8] closed window = exactly today\'s candidates');

// H7 no secret, length, hash or signature ever logged; only categories.
{
  const { log, lines } = capture();
  const h = headers(NEW, CREATIVE_FACTORY_PURPOSE);
  const sig = String(h.get('x-commercial-signature'));
  for (const s of [NEW, LEGACY, TICK, UNKNOWN]) await verify(windowEnv, headers(s, CREATIVE_FACTORY_PURPOSE), CREATIVE_FACTORY_PURPOSE, [], NOW, log);
  await verify(windowEnv, h, CREATIVE_FACTORY_PURPOSE, [], NOW, log);
  const all = lines.join('\n');
  for (const secret of [NEW, LEGACY, TICK, UNKNOWN, sig]) {
    assert.equal(all.includes(secret), false, '[H7.1] value never logged');
    assert.equal(all.includes(secret.slice(0, 12)), false, '[H7.2] no prefix logged');
  }
  for (const line of lines) assert.match(line, /^commercial_hmac_auth \{"category":"(primary|legacy|tick|none)"\}$/, '[H7.3] category-only line');
  const counts = commercialAuthCounts();
  for (const k of ['primary', 'legacy', 'tick', 'none'] as const) assert.ok(counts[k] >= 1, '[H7.4] counter ' + k);
}

// H8 every candidate is evaluated (no early exit): a match on the first candidate still verifies the others.
{
  const original = crypto.subtle.verify.bind(crypto.subtle);
  let calls = 0;
  (crypto.subtle as any).verify = (...args: any[]) => { calls += 1; return (original as any)(...args); };
  try {
    assert.equal(await verify(windowEnv, headers(TICK, CREATIVE_FACTORY_PURPOSE)), 'tick');
    assert.equal(calls, 3, '[H8.1] all three candidates evaluated');
  } finally { (crypto.subtle as any).verify = original; }
}

// H9 deploy flag validation mirrors the main Worker deploy; wrangler.toml never pins the flag or a credential.
assert.equal(DEPLOY_CEILING, MIGRATION_CODE_CEILING, '[H9.1] single ceiling');
assert.deepEqual(migrationFlagVarArgs(undefined), { state: 'absent', args: [] }, '[H9.2] absent');
assert.deepEqual(migrationFlagVarArgs('2026-11-20').args, ['--var', 'OPERATOR_TOKEN_MIGRATION_UNTIL:2026-11-20'], '[H9.3] set');
for (const v of ['2027-01-01', '2026-02-30', 'tomorrow', '2026/11/20']) {
  assert.throws(() => migrationFlagVarArgs(v), /OPERATOR_TOKEN_MIGRATION_UNTIL_INVALID/, '[H9.4] refused ' + v);
}
const toml = readFileSync(new URL('../cf-worker/wrangler.toml', import.meta.url), 'utf8');
assertWranglerConfigHasNoCredentialVars(toml);
assert.throws(() => assertWranglerConfigHasNoCredentialVars(toml + '\n[vars]\nOPERATOR_TOKEN_MIGRATION_UNTIL = "2026-12-31"\n'), /MUST_NOT_PIN/, '[H9.5] pinned flag refused');

// H10 static: every HMAC route goes through commercial-hmac.ts; no route keeps its own candidate list.
const worker = readFileSync(new URL('../cf-worker/worker.ts', import.meta.url), 'utf8');
assert.doesNotMatch(worker, /\[env\.COMMERCIAL_ROBOT_TICK_SECRET, env\.CERTIFICATION_E2E_TOKEN\]/, '[H10.1] no local candidate list');
assert.doesNotMatch(worker, /crypto\.subtle\.verify\(/, '[H10.2] no local verify');
assert.equal((worker.match(/await verifyFactoryRequest\(request, env\)/g) || []).length, 4, '[H10.3] background, publish/status, publish/tick, factory/tick');
assert.match(worker, /await verifyCreativeUploadRequest\(request, env, slug, bodyHash\)/, '[H10.4] upload');
assert.match(worker, /verifyCommercialSignature\(request\.headers, env, CREATIVE_FACTORY_PURPOSE\)/, '[H10.5] factory purpose');
assert.match(worker, /verifyCommercialSignature\(request\.headers, env, CREATIVE_UPLOAD_PURPOSE, \[slug, bodyHash\]\)/, '[H10.6] upload purpose');
const probe = worker.slice(worker.indexOf("url.pathname === '/api/commercial/auth/probe'"), worker.indexOf("url.pathname === '/api/commercial/creative/background'"));
assert.match(probe, /COMMERCIAL_AUTH_PROBE_PURPOSE/, '[H10.7] probe uses its own purpose');
assert.doesNotMatch(probe, /T2_CREATIVE_ASSETS|\.put\(|t2Store|runT2|runT3|metaPublish|env\.AI|fetch\(/, '[H10.8] probe has no side effects');

console.log('COMMERCIAL_HMAC_OPERATOR_TOKEN_WINDOW=PASS');
