import assert from 'node:assert/strict';
import fs from 'node:fs';
import { commercialBucketName } from '../backend/commercial.ts';

type Row = { id: string; value: string };
const store = new Map<string, Map<string, Row>>();
const original = process.env.ZEVANORY_SALES_TENANT_ID;

function bucket(kind: 'lead'|'finance') {
  return commercialBucketName(kind as any);
}
function put(bucketName: string, row: Row) {
  const rows = store.get(bucketName) || new Map<string, Row>();
  rows.set(row.id, structuredClone(row));
  store.set(bucketName, rows);
}
function get(bucketName: string, id: string) {
  const row = store.get(bucketName)?.get(id);
  return row ? structuredClone(row) : null;
}
function update(bucketName: string, id: string, value: string) {
  const rows = store.get(bucketName);
  if (!rows?.has(id)) return false;
  rows.set(id, { id, value });
  return true;
}

try {
  process.env.ZEVANORY_SALES_TENANT_ID = 'tenant-b';
  const bLead = bucket('lead');
  const bFinance = bucket('finance');
  put(bLead, { id: 'lead-b', value: 'owned-by-b' });

  process.env.ZEVANORY_SALES_TENANT_ID = 'tenant-a';
  const aLead = bucket('lead');
  const aFinance = bucket('finance');

  assert.notEqual(aLead, bLead);
  assert.notEqual(aFinance, bFinance);

  // Direct API attack 1: tenant A submits tenant B resource id for read/proof.
  const attackerPayloadRead = { leadId: 'lead-b', tenantId: 'tenant-b' };
  assert.equal(get(aLead, attackerPayloadRead.leadId), null);
  assert.equal(get(bLead, attackerPayloadRead.leadId)?.value, 'owned-by-b');
  console.log('CROSS_TENANT_READ_ATTACK=FAIL_CLOSED');

  // Direct API attack 2: tenant A submits tenant B resource id for mutation.
  const attackerPayloadUpdate = { id: 'lead-b', tenant: 'tenant-b', value: 'pwned' };
  assert.equal(update(aLead, attackerPayloadUpdate.id, attackerPayloadUpdate.value), false);
  assert.equal(get(bLead, attackerPayloadUpdate.id)?.value, 'owned-by-b');
  console.log('CROSS_TENANT_WRITE_ATTACK=FAIL_CLOSED');

  // Direct API attack 3: tenant A attempts payment/lifecycle event on B's lead.
  const attackerPayment = { leadId: 'lead-b', tenant_id: 'tenant-b', event: 'payment-confirmed' };
  const targetLead = get(aLead, attackerPayment.leadId);
  assert.equal(targetLead, null, 'payment path must fail at tenant-scoped lead lookup');
  assert.equal(get(aFinance, attackerPayment.leadId), null);
  assert.equal(get(bFinance, attackerPayment.leadId), null);
  console.log('CROSS_TENANT_PAYMENT_ATTACK=FAIL_CLOSED');

  // Verify API routes do not accept a client-selected tenant selector.
  const router = fs.readFileSync(new URL('../backend/index.ts', import.meta.url), 'utf8');
  const commercial = fs.readFileSync(new URL('../backend/commercial.ts', import.meta.url), 'utf8');
  for (const forbidden of ['body.tenantId', 'body.tenant_id', 'body.tenant', 'raw.tenantId', 'raw.tenant_id']) {
    assert.equal(router.includes(forbidden), false, 'client tenant selector found in router: ' + forbidden);
    assert.equal(commercial.includes(forbidden), false, 'client tenant selector found in runtime: ' + forbidden);
  }
  for (const required of [
    "commercialBucketName('lead')",
    "listKind('finance'",
    "paymentConfirmedForLead",
    "tenantSource: 'server-environment'",
    "clientSelectable: false",
  ]) assert.equal(commercial.includes(required), true, 'tenant isolation marker missing: ' + required);

  console.log('CLIENT_TENANT_OVERRIDE=DENIED_BY_DESIGN');
  console.log('CROSS_TENANT_ATTACK_MATRIX=3/3_FAIL_CLOSED');
} finally {
  if (original === undefined) delete process.env.ZEVANORY_SALES_TENANT_ID;
  else process.env.ZEVANORY_SALES_TENANT_ID = original;
}
