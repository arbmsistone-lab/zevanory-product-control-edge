import assert from 'node:assert/strict';
import { computeCommercialMetrics, deriveCommercialRobotState, type CommercialRecord } from '../src/commercial-model';

const now = new Date('2026-09-26T14:30:00.000Z');
const base = (overrides: Partial<CommercialRecord>): CommercialRecord => ({
  id: overrides.id || crypto.randomUUID(),
  kind: overrides.kind || 'event',
  title: overrides.title || 'test',
  detail: overrides.detail || '',
  status: overrides.status || 'new',
  channel: overrides.channel ?? null,
  product: overrides.product ?? null,
  productId: overrides.productId ?? null,
  valueCents: overrides.valueCents ?? null,
  source: overrides.source || 'test',
  sourceKey: overrides.sourceKey ?? null,
  evidence: overrides.evidence || [],
  createdAt: overrides.createdAt || now.toISOString(),
  updatedAt: overrides.updatedAt || now.toISOString(),
  publishedAt: overrides.publishedAt ?? null,
});

const blocked = deriveCommercialRobotState(null, null);
assert.equal(blocked.state, 'BLOCKED');

const heartbeatOnly = deriveCommercialRobotState(null, new Date().toISOString());
assert.equal(heartbeatOnly.state, 'ACTIVE');
assert.equal(heartbeatOnly.externalProspecting, true);
assert.equal(heartbeatOnly.publishAdapterReady, false);

const readyOps = {
  available: true,
  health: { ready: true },
  runtime: { sales: 'active', checkout: 'ready', financial: 'ready', whatsapp: 'ready' },
  continuity: { quorumOk: true, channels: ['instagram'] },
  channels: [{ name: 'instagram', releaseGate: 'green', commercialExecution: 'active' }],
};
const active = deriveCommercialRobotState(readyOps, new Date().toISOString());
assert.equal(active.state, 'ACTIVE');
assert.equal(active.externalProspecting, true);

const activeWithoutPublishChannel = deriveCommercialRobotState({
  ...readyOps,
  runtime: { ...readyOps.runtime, sales: 'disabled' },
  channels: [],
}, new Date().toISOString());
assert.equal(activeWithoutPublishChannel.state, 'ACTIVE');
assert.equal(activeWithoutPublishChannel.externalProspecting, true);
assert.equal(activeWithoutPublishChannel.publishAdapterReady, false);

const staleHeartbeat = deriveCommercialRobotState(
  readyOps,
  new Date(Date.now() - 60 * 60 * 1000).toISOString(),
);
assert.equal(staleHeartbeat.state, 'STANDBY');
assert.equal(staleHeartbeat.externalProspecting, false);

const metrics = computeCommercialMetrics({
  leads: [
    base({ id:'lead-1', kind:'lead', status:'contacted' }),
    base({ id:'lead-2', kind:'lead', status:'new' }),
  ],
  creatives: [
    base({ id:'creative-1', kind:'creative', status:'testing' }),
    base({ id:'creative-2', kind:'creative', status:'approval' }),
  ],
  publications: [
    base({ id:'pub-1', kind:'publication', status:'approval' }),
    base({ id:'pub-2', kind:'publication', status:'published', publishedAt: now.toISOString() }),
  ],
  events: [
    base({ id:'evt-1', kind:'event', status:'contact' }),
  ],
  finance: [
    base({ id:'fin-1', kind:'finance', status:'confirmed', source:'payment', valueCents: 10000 }),
    base({ id:'fin-2', kind:'finance', status:'confirmed', source:'refund', valueCents: 5000 }),
    base({ id:'fin-3', kind:'finance', status:'pending', source:'payment', valueCents: 3000 }),
  ],
}, now);

assert.equal(metrics.leadsToday, 2);
assert.equal(metrics.contactsToday, 1, 'contact event must not double count lead state');
assert.equal(metrics.creativesInProduction, 2);
assert.equal(metrics.pendingApproval, 2);
assert.equal(metrics.publishedToday, 1);
assert.equal(metrics.salesCentsToday, 10000, 'refund/pending finance must not count as sales');

console.log('COMMERCIAL_MODEL_CONTRACT=PASS');
console.log('ROBOT_HEARTBEAT_CONTRACT=PASS');
console.log(JSON.stringify(metrics));
