// Regression: Instagram/Facebook alerts written by this panel Worker without `category` were silently DELETED by the
// central digest (runOwnerAlertDigest forwards only ALLOWED_OWNER_ALERTS categories and deletes every listed key).
// This test runs the REAL central digest: scripts/fixtures/central-owner-alerts/owner-alerts.mjs is a verbatim copy of
// zevanory-public-mirror worker/owner-alerts.mjs at gh-pages 9880c879 (git blob be263eaad4100a40cfa46cab251e27edd2f458e8;
// checked below, so a central change must be re-vendored on purpose). activity-ledger.mjs beside it is a stub.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildOwnerAlertEntry, ownerAlertCategory, PANEL_ALERT_CATEGORIES } from '../cf-worker/owner-alert-entry.ts';
// @ts-ignore vendored JS fixture
import { runOwnerAlertDigest } from './fixtures/central-owner-alerts/owner-alerts.mjs';

let n = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); n += 1; console.log('ok - ' + name); }

const FIXTURE = new URL('./fixtures/central-owner-alerts/owner-alerts.mjs', import.meta.url);
function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    async get(k: string) { return store.get(k) ?? null; },
    async put(k: string, v: string) { store.set(k, v); },
    async delete(k: string) { store.delete(k); },
    async list({ prefix, limit }: { prefix: string; limit: number }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).slice(0, limit).map(name => ({ name })) }; },
  };
}
function captureResend() {
  const sent: { subject: string; text: string; to: string[] }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    if (String(url) === 'https://api.resend.com/emails') { sent.push(JSON.parse(String(init.body))); return new Response('{"id":"x"}', { status: 200 }); }
    throw new Error('unexpected network ' + url);
  }) as typeof fetch;
  return sent;
}
const ENV = (kv: unknown) => ({ ZEVANORY_PRIVATE_ARTIFACTS: kv, RESEND_API_KEY: 'test-resend-key-not-real', OWNER_ALERT_EMAIL: 'owner@example.test' });

await test('AC0 vendored central digest is the exact gh-pages 9880c879 blob', () => {
  const blob = execFileSync('git', ['hash-object', FIXTURE.pathname], { encoding: 'utf8' }).trim();
  assert.equal(blob, 'be263eaad4100a40cfa46cab251e27edd2f458e8', 'AC0-blob');
  const src = readFileSync(FIXTURE, 'utf8');
  for (const c of PANEL_ALERT_CATEGORIES) assert.match(src, new RegExp(`ALLOWED_OWNER_ALERTS = new Set\\(\\[[^\\]]*"${c}"`), 'AC0-allowed ' + c);
});

await test('AC1 category rule mirrors the central WhatsApp rule (refund wording -> refund, else complaint)', () => {
  assert.equal(ownerAlertCategory('quero reembolso agora'), 'refund', 'AC1-refund');
  assert.equal(ownerAlertCategory('vou pedir ESTORNO no cartão'), 'refund');
  assert.equal(ownerAlertCategory('quero cancelar'), 'refund');
  assert.equal(ownerAlertCategory('isso é golpe?'), 'complaint', 'AC1-complaint');
  assert.equal(ownerAlertCategory('qual o horário de atendimento?'), 'complaint', 'AC1-unanswered');
});

await test('AC2 real central digest DELIVERS the panel alerts (Instagram, Facebook, DMs) and only then deletes them', async () => {
  const kv = fakeKv();
  const sent = captureResend();
  const t = Date.parse('2026-10-25T18:00:00Z');
  const inputs = [
    { channel: 'instagram', reason: 'atencao', excerpt: 'quero reembolso, meu email é ana@x.com', eventId: 'igc:1789' },
    { channel: 'facebook', reason: 'sem-resposta-na-base', excerpt: 'vocês emitem nota fiscal?', eventId: 'fbc:55' },
    { channel: 'instagram-dm', reason: 'atencao', excerpt: 'isso é golpe? pedido 12345678', eventId: 'dm:abc' },
  ];
  inputs.forEach((x, i) => { const e = buildOwnerAlertEntry(x, t + i); kv.store.set(e.key, e.value); });
  const out = await runOwnerAlertDigest(ENV(kv));
  assert.equal(out.alerts, 3, 'AC2-all-three-forwarded'); assert.equal(out.sent, true, 'AC2-sent');
  assert.equal(sent.length, 1, 'AC2-one-digest-email');
  assert.match(sent[0].text, /\[instagram\] refund/, 'AC2-instagram-line'); assert.match(sent[0].text, /\[facebook\] complaint/, 'AC2-facebook-line');
  assert.match(sent[0].text, /\[instagram-dm\] complaint/, 'AC2-dm-line');
  assert.doesNotMatch(sent[0].text, /ana@x\.com|12345678/, 'AC2-masked');
  assert.equal([...kv.store.keys()].filter(k => k.startsWith('zpc-alert:v1:')).length, 0, 'AC2-deleted-after-send');
});

await test('AC3 the old entry shape (no category) is dropped unsent by the same digest: the defect this fixes', async () => {
  const kv = fakeKv();
  const sent = captureResend();
  kv.store.set('zpc-alert:v1:1:igc:1', JSON.stringify({ channel: 'instagram', reason: 'atencao', excerpt: 'quero reembolso', at: '2026-10-25T18:00:00.000Z' }));
  const out = await runOwnerAlertDigest(ENV(kv));
  assert.equal(out.alerts, 0, 'AC3-not-forwarded'); assert.equal(sent.length, 0, 'AC3-no-email');
  assert.equal(kv.store.size, 0, 'AC3-silently-deleted');
});

await test('AC4 alertOwner in worker.ts writes through buildOwnerAlertEntry (no inline entry without category)', () => {
  const src = readFileSync(new URL('../cf-worker/worker.ts', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('async function alertOwner('), src.indexOf('async function handleMetaWebhook('));
  assert.match(fn, /const entry = buildOwnerAlertEntry\(input, Date\.now\(\)\);/, 'AC4-uses-builder');
  assert.match(fn, /kv\.put\(entry\.key, entry\.value, \{ expirationTtl: entry\.ttl \}\)/, 'AC4-puts-entry');
  assert.doesNotMatch(src, /kv\.put\('zpc-alert:v1:'/, 'AC4-no-inline-writer');
  const e = JSON.parse(buildOwnerAlertEntry({ channel: 'facebook-dm', reason: 'atencao', excerpt: 'oi', eventId: 'dm:x y' }, 0).value);
  assert.ok((PANEL_ALERT_CATEGORIES as readonly string[]).includes(e.category), 'AC4-category-present');
});

console.log(`panel-alert-category: ${n} tests passed`);
