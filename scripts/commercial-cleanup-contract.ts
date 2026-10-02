import assert from 'node:assert/strict';
import { loadM1ProspectingConfig, reviewCommercialCleanupRecord } from '../backend/commercial.ts';
import type { CommercialRecord } from '../src/commercial-model.ts';

const now = new Date().toISOString();
const make = (title: string, kind: 'lead' | 'evidence', status: string, source = 'public-search'): CommercialRecord => ({
  id: crypto.randomUUID(),
  kind,
  title,
  detail: title,
  status,
  channel: 'web',
  product: 'ZEVANORY',
  productId: null,
  valueCents: null,
  source,
  sourceKey: 'bing:https://example.com/' + encodeURIComponent(title.toLowerCase()),
  evidence: ['https://example.com/' + encodeURIComponent(title.toLowerCase()), 'query:empresa brasil', 'stage:raw-discovery'],
  createdAt: now,
  updatedAt: now,
  publishedAt: null,
});

const fixtures: Array<{title:string; kind:'lead'|'evidence'; status:string; expectedType:'lead'|'prospecting'}> = [
  { title: 'Atlanta Falcons NFL', kind: 'lead', status: 'new', expectedType: 'lead' },
  { title: 'Peppa Pig Brasil', kind: 'evidence', status: 'raw-discovery', expectedType: 'prospecting' },
  { title: 'Loja Province', kind: 'lead', status: 'new', expectedType: 'lead' },
  { title: 'Microsoft Store Brasil', kind: 'evidence', status: 'raw-discovery', expectedType: 'prospecting' },
];

for (const fixture of fixtures) {
  const reviewed = reviewCommercialCleanupRecord(
    fixture.kind,
    make(fixture.title, fixture.kind, fixture.status),
  );
  assert.ok(reviewed, fixture.title + ' must be a cleanup candidate');
  assert.equal(reviewed.reportType, fixture.expectedType, fixture.title + ' report type');
}

const legacyLead = make('Peppa Pig legacy CRM', 'lead', 'new', 'public-search');
legacyLead.sourceKey = 'legacy-search:peppa';
legacyLead.evidence = ['query:peppa brasil', 'https://example.com/peppa'];
assert.ok(reviewCommercialCleanupRecord('lead', legacyLead), 'legacy public-search lead must be included regardless of zevanory-sales source');

const config = loadM1ProspectingConfig();
assert.equal(config.policy.primary_region, 'Brasil');
assert.equal(config.policy.country, 'BR');
assert.equal(config.policy.cold_outreach, false);

console.log('COMMERCIAL_CLEANUP_FIXTURES=PASS');
console.log('KNOWN_JUNK_CANDIDATES=Falcons,Peppa Pig,Loja Province,Microsoft Store');
console.log('M1_MARKET_SCOPE=Brasil');
