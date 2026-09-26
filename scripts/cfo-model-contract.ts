import assert from 'node:assert/strict';
import { computeCfoMetrics, daysLate, openCents, receivableRisk, type CfoReceivable, type CfoTransaction } from '../src/cfo-model';

const now = new Date('2026-09-26T15:00:00.000Z');
const receivable = (overrides: Partial<CfoReceivable>): CfoReceivable => ({
  id: overrides.id || crypto.randomUUID(),
  customer: overrides.customer || 'Cliente',
  document: overrides.document ?? null,
  dueAt: overrides.dueAt || '2026-09-20T12:00:00.000Z',
  amountCents: overrides.amountCents ?? 200_000,
  paidCents: overrides.paidCents ?? 0,
  status: overrides.status || 'OPEN',
  source: overrides.source || 'test',
  sourceKey: overrides.sourceKey ?? null,
  evidence: overrides.evidence || [],
  createdAt: overrides.createdAt || now.toISOString(),
  updatedAt: overrides.updatedAt || now.toISOString(),
});
const tx = (overrides: Partial<CfoTransaction>): CfoTransaction => ({
  id: overrides.id || crypto.randomUUID(),
  kind: overrides.kind || 'INFLOW',
  amountCents: overrides.amountCents ?? 100_000,
  occurredAt: overrides.occurredAt || '2026-09-25T12:00:00.000Z',
  category: overrides.category || 'Venda',
  counterparty: overrides.counterparty ?? null,
  source: overrides.source || 'test',
  sourceKey: overrides.sourceKey ?? null,
  reconciled: overrides.reconciled ?? true,
  evidence: overrides.evidence || [],
  createdAt: overrides.createdAt || now.toISOString(),
});

assert.equal(openCents(receivable({ amountCents: 100_000, paidCents: 25_000 })), 75_000);
assert.equal(daysLate('2026-09-20T12:00:00.000Z', now), 6);
assert.equal(receivableRisk(receivable({ dueAt:'2026-08-20T12:00:00.000Z', amountCents:100_000 }), now), 'HIGH');
assert.equal(receivableRisk(receivable({ dueAt:'2026-09-10T12:00:00.000Z', amountCents:100_000 }), now), 'MEDIUM');
assert.equal(receivableRisk(receivable({ dueAt:'2026-10-10T12:00:00.000Z', amountCents:50_000 }), now), 'LOW');

const metrics = computeCfoMetrics([
  tx({ id:'in', kind:'INFLOW', amountCents:1_000_000 }),
  tx({ id:'out', kind:'OUTFLOW', amountCents:400_000 }),
], [
  receivable({ id:'late', dueAt:'2026-08-20T12:00:00.000Z', amountCents:500_000 }),
  receivable({ id:'future', dueAt:'2026-10-01T12:00:00.000Z', amountCents:300_000 }),
], now);

assert.equal(metrics.balanceCents, 600_000);
assert.equal(metrics.inflow30dCents, 1_000_000);
assert.equal(metrics.outflow30dCents, 400_000);
assert.equal(metrics.receivableOpenCents, 800_000);
assert.equal(metrics.overdueCents, 500_000);
assert.equal(metrics.projected30dCents, 500_000);
assert.equal(metrics.taxReserveSuggestedCents, 60_000);
assert.equal(metrics.highRiskReceivables, 1);

console.log('ZEVANORY_CFO_CONTRACT=PASS');
