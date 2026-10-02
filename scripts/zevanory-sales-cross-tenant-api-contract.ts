import assert from 'node:assert/strict';
import { db, secrets } from '../backend/platform.ts';
import { handler } from '../backend/index.ts';

type AnyRecord = Record<string, any> & { id?: string };
const sessionToken = 'tenant-a-session';
const clusterToken = 'tenant-cross-attack-token';
const victimLeadId = '11111111-1111-4111-8111-111111111111';
const attackerTenant = 'tenant-a';
const victimTenant = 'tenant-b';
const victimLeadBucket = 'zpc_commercial_leads__tenant_' + victimTenant;
const attackerLeadBucket = 'zpc_commercial_leads__tenant_' + attackerTenant;
const store = new Map<string, Map<string, AnyRecord>>();

function bucket(name: string) {
  let current = store.get(name);
  if (!current) {
    current = new Map();
    store.set(name, current);
  }
  return current;
}

bucket(victimLeadBucket).set(victimLeadId, {
  id: victimLeadId,
  kind: 'lead',
  title: 'Victim lead',
  detail: 'Tenant B only',
  status: 'qualified',
  source: 'test',
  sourceKey: 'victim-lead',
  evidence: ['qualification-score:90','qualification-signal:tenant-b'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const original = {
  list: db.list,
  get: db.get,
  add: db.add,
  update: db.update,
  delete: db.delete,
  readSecret: secrets.readSecret,
};

try {
  process.env.ZEVANORY_SALES_TENANT_ID = attackerTenant;

  db.list = (async (bucketName: string) => {
    if (bucketName === 'acs_pin_current_session') {
      return { items: [{ id: 'session-1', token: sessionToken, expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString() }] };
    }
    if (bucketName === 'acs_pin_sessions') return { items: [] };
    return { items: Array.from(bucket(bucketName).values()) };
  }) as typeof db.list;

  db.get = (async (bucketName: string, ids: string[]) =>
    ids.map(id => bucket(bucketName).get(id) || null)
  ) as typeof db.get;

  db.add = (async (bucketName: string, records: any[]) => {
    const ids: string[] = [];
    for (const record of records) {
      const id = crypto.randomUUID();
      bucket(bucketName).set(id, { ...record, id });
      ids.push(id);
    }
    return ids;
  }) as typeof db.add;

  db.update = (async (bucketName: string, changes: Array<{ id: string; record: any }>) => {
    const updated: string[] = [];
    for (const item of changes) {
      if (bucket(bucketName).has(item.id)) {
        bucket(bucketName).set(item.id, { ...item.record, id: item.id });
        updated.push(item.id);
      }
    }
    return updated;
  }) as typeof db.update;

  db.delete = (async (bucketName: string, ids: string[]) => {
    const deleted: string[] = [];
    for (const id of ids) if (bucket(bucketName).delete(id)) deleted.push(id);
    return deleted;
  }) as typeof db.delete;

  secrets.readSecret = (async (name: string) => name === 'ZPC_CLUSTER_TOKEN' ? clusterToken : '') as typeof secrets.readSecret;

  const post = async (path: string, body: any, headers: Record<string,string> = {}) => {
    const response = await handler(new Request('https://control.test' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }));
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, payload };
  };

  const readAttempt = await post('/api/commercial/sales/proof', {
    sessionToken,
    leadId: victimLeadId,
    tenantId: victimTenant,
  });
  assert.equal(readAttempt.status, 400);
  assert.equal(bucket(attackerLeadBucket).has(victimLeadId), false);
  assert.equal(bucket(victimLeadBucket).has(victimLeadId), true);

  const alterAttempt = await post('/api/commercial/sales/qualify', {
    sessionToken,
    leadId: victimLeadId,
    tenantId: victimTenant,
    score: 100,
    signals: ['attacker-forged-signal'],
  });
  assert.equal(alterAttempt.status, 400);
  assert.equal(bucket(victimLeadBucket).get(victimLeadId)?.evidence.includes('qualification-signal:attacker-forged-signal'), false);

  const payAttempt = await post('/api/commercial/sales/lifecycle', {
    leadId: victimLeadId,
    tenantId: victimTenant,
    event: 'payment-confirmed',
    externalId: 'attacker-payment',
    valueCents: 1,
  }, { authorization: 'Bearer ' + clusterToken });
  assert.equal(payAttempt.status, 404);

  const victimFinance = Array.from(store.entries())
    .filter(([name]) => name.includes('finance') && name.includes(victimTenant))
    .flatMap(([, records]) => Array.from(records.values()));
  assert.equal(victimFinance.length, 0);
  assert.equal(bucket(victimLeadBucket).get(victimLeadId)?.status, 'qualified');

  console.log('CROSS_TENANT_DIRECT_API_READ=FAIL_CLOSED');
  console.log('CROSS_TENANT_DIRECT_API_ALTER=FAIL_CLOSED');
  console.log('CROSS_TENANT_DIRECT_API_PAY=FAIL_CLOSED');
  console.log('CROSS_TENANT_BODY_TENANT_OVERRIDE=IGNORED');
  console.log('ZEVANORY_SALES_CROSS_TENANT_API_ATTACK=PASS');
} finally {
  db.list = original.list;
  db.get = original.get;
  db.add = original.add;
  db.update = original.update;
  db.delete = original.delete;
  secrets.readSecret = original.readSecret;
  delete process.env.ZEVANORY_SALES_TENANT_ID;
}
