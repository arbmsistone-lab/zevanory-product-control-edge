import assert from 'node:assert/strict';
import { assessAdsReadiness, wilsonLower, type FunnelSummary } from '../src/ads-readiness.ts';

const product = (over: Partial<FunnelSummary['products'][string]> = {}) => ({ name: 'Combo IA + Vendas', sku: 'ZEV-CMB-011', views: 0, visitors: 0, checkouts: 0, paid: 0, refunded: 0, revenue: 0, checkoutErrors: 0, ...over });
const summary = (p: ReturnType<typeof product>, open = true): FunnelSummary => ({ schema: 'zevanory-funnel/v1', generatedAt: '2026-10-06T00:00:00Z', windowDays: 30, salesMode: open ? 'production' : 'test', salesOpen: open, products: { 'combo-ia-vendas': p } });

// Wilson lower bound is pessimistic and monotonic.
assert.ok(wilsonLower(3, 100) < 0.03);
assert.ok(wilsonLower(30, 1000) > wilsonLower(3, 100));
assert.equal(wilsonLower(0, 0), 0);

// Today: sales closed, no data -> AGUARDAR with a concrete next milestone.
const today = assessAdsReadiness(summary(product(), false));
assert.equal(today.status, 'AGUARDAR');
assert.match(today.nextMilestone, /Vendas abertas/);

// Lucky streak with tiny sample never triggers spending.
assert.equal(assessAdsReadiness(summary(product({ visitors: 40, paid: 6, checkouts: 8, revenue: 6 * 297 }))).status, 'AGUARDAR');

// Proven organic economics: 1000 visitors, 30 sales of R$297, 1 refund -> TESTAR with a stop-loss.
const proven = assessAdsReadiness(summary(product({ visitors: 1000, paid: 30, refunded: 1, checkouts: 60, revenue: 29 * 297 })));
assert.equal(proven.status, 'TESTAR', JSON.stringify(proven.criteria));
assert.ok(proven.metrics.maxCpc >= 1.2);
assert.ok(proven.plan && proven.plan.stopLossSpend > 0 && proven.plan.testBudget >= proven.plan.stopLossSpend);

// High refunds block even with volume.
assert.equal(assessAdsReadiness(summary(product({ visitors: 1000, paid: 30, refunded: 6, checkouts: 60, revenue: 24 * 297 }))).status, 'AGUARDAR');

// Campaign data with CPA under the max -> ESCALAR; above -> stays TESTAR.
assert.equal(assessAdsReadiness(summary(product({ visitors: 1000, paid: 30, refunded: 1, checkouts: 60, revenue: 29 * 297 })), { spend: 300, sales: 6 }).status, 'ESCALAR');
assert.equal(assessAdsReadiness(summary(product({ visitors: 1000, paid: 30, refunded: 1, checkouts: 60, revenue: 29 * 297 })), { spend: 3000, sales: 6 }).status, 'TESTAR');

console.log('ADS_READINESS_CONTRACT=PASS');
