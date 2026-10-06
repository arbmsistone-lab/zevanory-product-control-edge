import { readFileSync } from 'node:fs';
import { db, error, json, secrets } from './platform.ts';
import { assessMarketSignal } from '../src/prospect-signal.ts';
import {
  computeCommercialMetrics,
  deriveCommercialRobotState,
  isOperationallyActive,
  isOperationallyBlocked,
  type CommercialOperationsLike,
  type CommercialRecord,
  type CommercialRecordKind,
  type CommercialWorkspaceData,
} from '../src/commercial-model.ts';
import {
  evaluateZevanoryAutonomousSaleProof,
  evaluateZevanorySalesAction,
  type ZevanorySalesAction,
  type ZevanorySalesAutonomyLevel,
  type ZevanorySalesPolicy,
} from '../src/zevanory-sales-model.ts';

const BUCKETS: Record<CommercialRecordKind, string> = {
  lead: 'zpc_commercial_leads',
  creative: 'zpc_commercial_creatives',
  publication: 'zpc_commercial_publications',
  event: 'zpc_commercial_events',
  support: 'zpc_commercial_support',
  finance: 'zpc_commercial_finance',
  evidence: 'zpc_commercial_evidence',
};

const DEFAULT_SALES_TENANT = 'zevanory';
const SALES_TENANT_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

export function zevanorySalesTenantId() {
  const raw = String(process.env.ZEVANORY_SALES_TENANT_ID || DEFAULT_SALES_TENANT)
    .trim()
    .toLowerCase();
  if (!SALES_TENANT_RE.test(raw)) throw new Error('zevanory_sales_tenant_invalid');
  return raw;
}

export function commercialBucketName(kind: CommercialRecordKind) {
  const base = BUCKETS[kind];
  if (!base) throw new Error('commercial_kind_invalid');
  const tenantId = zevanorySalesTenantId();
  return tenantId === DEFAULT_SALES_TENANT
    ? base
    : `${base}__tenant_${tenantId}`;
}

export function zevanorySalesTenantIsolation() {
  const id = zevanorySalesTenantId();
  return Object.freeze({
    id,
    defaultTenant: id === DEFAULT_SALES_TENANT,
    tenantSource: 'server-environment',
    isolation: 'server-owned-bucket-v1',
    clientSelectable: false,
  });
}

function cleanString(value: unknown, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function cleanNullable(value: unknown, max = 500) {
  const text = cleanString(value, max);
  return text || null;
}

function cleanEvidence(value: unknown) {
  return Array.isArray(value)
    ? value.map(item => cleanString(item, 1000)).filter(Boolean).slice(0, 20)
    : [];
}

function normalizeCommercialRecord(
  raw: Partial<CommercialRecord>,
  existing?: CommercialRecord,
): Omit<CommercialRecord, 'id'> | null {
  const kind = cleanString(raw.kind || existing?.kind, 32) as CommercialRecordKind;
  if (!Object.prototype.hasOwnProperty.call(BUCKETS, kind)) return null;
  const title = cleanString(raw.title ?? existing?.title, 180);
  if (!title) return null;
  const now = new Date().toISOString();
  const valueRaw = raw.valueCents ?? existing?.valueCents ?? null;
  const valueCents = valueRaw === null || valueRaw === undefined
    ? null
    : Math.max(0, Math.round(Number(valueRaw)));
  if (valueCents !== null && !Number.isFinite(valueCents)) return null;
  const publishedAt = cleanNullable(raw.publishedAt ?? existing?.publishedAt, 64);
  return {
    kind,
    title,
    detail: cleanString(raw.detail ?? existing?.detail, 4000),
    status: cleanString(raw.status ?? existing?.status ?? 'new', 80).toLowerCase().replace(/\s+/g, '-'),
    channel: cleanNullable(raw.channel ?? existing?.channel, 120),
    product: cleanNullable(raw.product ?? existing?.product, 180),
    productId: cleanNullable(raw.productId ?? existing?.productId, 120),
    valueCents,
    source: cleanString(raw.source ?? existing?.source ?? 'control-center', 180),
    sourceKey: cleanNullable(raw.sourceKey ?? existing?.sourceKey, 220),
    evidence: cleanEvidence(raw.evidence ?? existing?.evidence),
    createdAt: existing?.createdAt ?? (cleanString(raw.createdAt, 64) || now),
    updatedAt: now,
    publishedAt,
    imageUrl: (() => {
      const value = cleanNullable((raw as any).imageUrl ?? (existing as any)?.imageUrl, 400);
      return value && /^https:\/\/controle\.zevanory\.api\.br\/api\/commercial\/creative\/assets\/[0-9a-f-]{36}\.(jpg|png)$/i.test(value) ? value : null;
    })(),
  } as Omit<CommercialRecord, 'id'>;
}

async function listKind(kind: CommercialRecordKind, limit = 200): Promise<CommercialRecord[]> {
  const result = await db.list<Omit<CommercialRecord, 'id'>>(commercialBucketName(kind), { limit });
  return result.items.map(item => ({ ...item, kind, id: item.id })) as CommercialRecord[];
}

async function listKindAllPrimary(kind: CommercialRecordKind, pageSize = 250): Promise<CommercialRecord[]> {
  const items: CommercialRecord[] = [];
  let offset = 0;
  while (true) {
    const page = await db.listPrimaryPage<Omit<CommercialRecord, 'id'>>(commercialBucketName(kind), { limit: pageSize, offset });
    const mapped = page.items.map(item => ({ ...item, kind, id: item.id })) as CommercialRecord[];
    items.push(...mapped);
    if (mapped.length < pageSize) break;
    offset += mapped.length;
  }
  return items;
}

async function upsertBySourceKey(raw: Partial<CommercialRecord>) {
  const kind = cleanString(raw.kind, 32) as CommercialRecordKind;
  if (!Object.prototype.hasOwnProperty.call(BUCKETS, kind)) throw new Error('commercial_kind_invalid');
  const normalized = normalizeCommercialRecord(raw);
  if (!normalized) throw new Error('commercial_record_invalid');
  const sourceKey = normalized.sourceKey;
  if (sourceKey) {
    const current = await listKind(kind, 1000);
    const found = current.find(item => item.source === normalized.source && item.sourceKey === sourceKey);
    if (found) {
      await db.update(commercialBucketName(kind), [{ id: found.id, record: normalized }]);
      return { ...normalized, id: found.id };
    }
  }
  const [id] = await db.add(commercialBucketName(kind), [normalized]);
  if (!id) throw new Error('commercial_record_create_failed');
  return { ...normalized, id };
}

async function heartbeatRecord() {
  const events = await listKind('event', 100);
  return events
    .filter(item => item.status === 'heartbeat')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
}

export async function commercialWorkspace(operations: CommercialOperationsLike): Promise<CommercialWorkspaceData> {
  const [leads, creatives, publications, events, support, finance, evidence, heartbeat] = await Promise.all([
    listKind('lead', 300),
    listKind('creative', 300),
    listKind('publication', 300),
    listKind('event', 500),
    listKind('support', 300),
    listKind('finance', 300),
    listKind('evidence', 500),
    heartbeatRecord(),
  ]);

  const sortRecent = (items: CommercialRecord[]) => [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const metrics = computeCommercialMetrics({ leads, creatives, publications, events, finance });

  return {
    generatedAt: new Date().toISOString(),
    tenant: zevanorySalesTenantIsolation(),
    metrics,
    robot: deriveCommercialRobotState(operations, heartbeat?.updatedAt ?? null),
    leads: sortRecent(leads),
    creatives: sortRecent(creatives),
    publications: sortRecent(publications),
    events: sortRecent(events),
    support: sortRecent(support),
    finance: sortRecent(finance),
    evidence: sortRecent(evidence),
    counts: {
      leads: leads.length,
      creatives: creatives.length,
      publications: publications.length,
      events: events.length,
      support: support.length,
      finance: finance.length,
      evidence: evidence.length,
    },
  };
}

export async function commercialAdminCreate(raw: Partial<CommercialRecord>) {
  return upsertBySourceKey({ ...raw, source: raw.source || 'control-center' });
}

export async function commercialAdminUpdate(id: string, kind: CommercialRecordKind, raw: Partial<CommercialRecord>) {
  const [existing] = await db.get<Omit<CommercialRecord, 'id'>>(commercialBucketName(kind), [id]);
  if (!existing) throw new Error('commercial_record_not_found');
  const normalized = normalizeCommercialRecord({ ...raw, kind }, { ...existing, id, kind } as CommercialRecord);
  if (!normalized) throw new Error('commercial_record_invalid');
  await db.update(commercialBucketName(kind), [{ id, record: normalized }]);
  return { ...normalized, id };
}

export type CommercialCleanupReportType = 'lead' | 'prospecting' | 'evidence';

function isPublicSearchDerived(record: CommercialRecord) {
  const evidenceItems = Array.isArray(record.evidence) ? record.evidence.map(String) : [];
  const source = String(record.source || '').toLowerCase();
  const sourceKey = String(record.sourceKey || '').toLowerCase();
  return source === 'public-search'
    || sourceKey.startsWith('bing:')
    || sourceKey.includes(':bing:')
    || evidenceItems.some(item =>
      item.startsWith('query:')
      || item.startsWith('query-source:M1')
      || item.startsWith('stage:raw-discovery')
      || item.startsWith('discovered-at:')
    );
}

export function reviewCommercialCleanupRecord(kind: 'lead' | 'evidence', record: CommercialRecord) {
  if (record.status === 'archived' || !isPublicSearchDerived(record)) return null;
  const evidenceItems = Array.isArray(record.evidence) ? record.evidence.map(String) : [];
  const url = evidenceItems.find(item => /^https?:\/\//i.test(item)) || '';
  const query = evidenceItems.find(item => item.startsWith('query:'))?.slice('query:'.length) || '';
  const review = scoreProspect({
    title: record.title,
    description: record.detail || '',
    url,
    query,
  });
  if (review.relevant) return null;
  const reportType: CommercialCleanupReportType =
    kind === 'lead' ? 'lead' : record.status === 'raw-discovery' ? 'prospecting' : 'evidence';
  return {
    kind,
    reportType,
    record,
    reason: review.reason,
    score: review.score,
  };
}

export async function commercialCleanup(input: { mode?: 'dry-run' | 'apply'; confirm?: string }) {
  const mode = input.mode === 'apply' ? 'apply' : 'dry-run';
  if (mode === 'apply' && input.confirm !== 'AUTORIZO_ARQUIVAMENTO') {
    throw new Error('commercial_cleanup_apply_confirmation_required');
  }

  const [leads, evidence] = await Promise.all([
    listKindAllPrimary('lead'),
    listKindAllPrimary('evidence'),
  ]);

  const candidates = [
    ...leads.map(record => reviewCommercialCleanupRecord('lead', record)).filter(Boolean),
    ...evidence.map(record => reviewCommercialCleanupRecord('evidence', record)).filter(Boolean),
  ] as Array<{
    kind: 'lead' | 'evidence';
    reportType: CommercialCleanupReportType;
    record: CommercialRecord;
    reason: string;
    score: number;
  }>;

  const inspected = {
    lead: leads.length,
    prospecting: evidence.filter(item => item.status === 'raw-discovery').length,
    evidence: evidence.filter(item => item.status !== 'raw-discovery').length,
    evidenceStorageTotal: evidence.length,
    total: leads.length + evidence.length,
  };

  const byType = candidates.reduce<Record<CommercialCleanupReportType, number>>((acc, item) => {
    acc[item.reportType] += 1;
    return acc;
  }, { lead: 0, prospecting: 0, evidence: 0 });

  if (mode === 'apply') {
    for (const item of candidates) {
      const archived = normalizeCommercialRecord({
        kind: item.kind,
        status: 'archived',
        evidence: [
          ...(item.record.evidence || []),
          'archive:premium-panel-cleanup-20261002',
          'archive-reason:' + item.reason,
          'archive-score:' + item.score,
          'archive-authority:owner-explicit-authorization',
          'archived-at:' + new Date().toISOString(),
        ].slice(-20),
      }, item.record);
      if (!archived) throw new Error('commercial_cleanup_record_invalid');
      await db.update(commercialBucketName(item.kind), [{ id: item.record.id, record: archived }]);
    }
  }

  return {
    ok: true,
    mode,
    inspected,
    wouldArchive: candidates.length,
    archived: mode === 'apply' ? candidates.length : 0,
    byType,
    deleteOperations: 0,
    samples: candidates.slice(0, 40).map(item => ({
      kind: item.kind,
      reportType: item.reportType,
      id: item.record.id,
      title: item.record.title,
      score: item.score,
      reason: item.reason,
    })),
    at: new Date().toISOString(),
  };
}

export async function commercialApprovalAction(input: {
  id: string;
  kind: 'creative' | 'publication';
  action: 'approve' | 'reject' | 'request-changes';
  note?: string;
}) {
  const [existing] = await db.get<Omit<CommercialRecord, 'id'>>(commercialBucketName(input.kind), [input.id]);
  if (!existing) throw new Error('commercial_record_not_found');
  const status = input.action === 'approve'
    ? 'approved'
    : input.action === 'reject'
      ? 'rejected'
      : 'changes-requested';
  const evidence = [
    ...(existing.evidence || []),
    `approval:${input.action}:${new Date().toISOString()}`,
    ...(input.note ? [`note:${cleanString(input.note, 500)}`] : []),
  ].slice(-20);
  const normalized = normalizeCommercialRecord(
    { kind: input.kind, status, evidence },
    { ...existing, id: input.id, kind: input.kind } as CommercialRecord,
  );
  if (!normalized) throw new Error('commercial_record_invalid');
  await db.update(commercialBucketName(input.kind), [{ id: input.id, record: normalized }]);
  await upsertBySourceKey({
    kind: 'event',
    title: input.action === 'approve' ? 'Item aprovado' : input.action === 'reject' ? 'Item rejeitado' : 'Alterações solicitadas',
    detail: existing.title,
    status: 'approval-action',
    channel: existing.channel,
    product: existing.product,
    productId: existing.productId,
    source: 'control-center',
    sourceKey: `approval:${input.kind}:${input.id}:${Date.now()}`,
    evidence,
  });
  return { ...normalized, id: input.id };
}

export async function requireCommercialAdapter(request: Request) {
  const configured = await secrets.readSecret('ZPC_CLUSTER_TOKEN');
  if (!configured) return false;
  const auth = request.headers.get('authorization') || '';
  return auth === `Bearer ${configured}`;
}

export async function commercialAdapterIngest(request: Request, body: unknown) {
  if (!await requireCommercialAdapter(request)) return error('Adapter comercial nao autorizado.', 401);
  const raw = body as { records?: Partial<CommercialRecord>[]; heartbeat?: { source?: string; detail?: string } };
  const records = Array.isArray(raw.records) ? raw.records.slice(0, 100) : [];
  const persisted: CommercialRecord[] = [];
  for (const record of records) persisted.push(await upsertBySourceKey(record));
  if (raw.heartbeat) {
    persisted.push(await upsertBySourceKey({
      kind: 'event',
      title: 'Heartbeat do robô comercial',
      detail: cleanString(raw.heartbeat.detail || 'Orquestrador comercial online.', 1000),
      status: 'heartbeat',
      source: cleanString(raw.heartbeat.source || 'commercial-orchestrator', 180),
      sourceKey: 'commercial-orchestrator-heartbeat',
      evidence: ['adapter-authenticated', new Date().toISOString()],
    }));
  }
  return json({ ok: true, persisted: persisted.length, at: new Date().toISOString() });
}



export type ProspectResult = { title: string; url: string; description: string; query: string };

type M1ProspectingConfig = {
  policy: { locale: string; country: string; primary_region: string; min_score: number; cold_outreach: boolean };
  icp: string[];
  product_intent_terms: string[];
  negative_keywords: string[];
  queries: string[];
};

export function loadM1ProspectingConfig(): M1ProspectingConfig {
  const raw = readFileSync(new URL('../config/m1-queries.json', import.meta.url), 'utf8');
  const parsed = JSON.parse(raw) as M1ProspectingConfig;
  if (!Array.isArray(parsed.queries) || parsed.queries.length === 0) throw new Error('m1_queries_config_empty');
  return parsed;
}

const M1_PROSPECTING = loadM1ProspectingConfig();
const normalizeTerm = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const PROSPECT_HARD_REJECT = M1_PROSPECTING.negative_keywords.map(normalizeTerm);
const PROSPECT_ICP_TERMS = M1_PROSPECTING.icp.map(normalizeTerm);
const PROSPECT_PRODUCT_TERMS = M1_PROSPECTING.product_intent_terms.map(normalizeTerm);
const PROSPECT_BR_TERMS = ['brasil','brazil','ceara','fortaleza','juazeiro do norte','crato','iguatu','barbalha','varzea alegre','.br'];

function prospectText(result: ProspectResult) {
  return [result.title,result.description,result.url]
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function scoreProspect(result: ProspectResult) {
  const text = prospectText(result);
  const reject = PROSPECT_HARD_REJECT.filter(term => text.includes(term));
  const icp = PROSPECT_ICP_TERMS.filter(term => text.includes(term));
  const product = PROSPECT_PRODUCT_TERMS.filter(term => text.includes(term));
  const brazil = PROSPECT_BR_TERMS.filter(term => text.includes(term));
  let score = 0;
  if (icp.length) score += 3;
  if (product.length) score += 3;
  if (brazil.length) score += 2;
  if (/https?:\/\/[^\s/]+\.br(?:[/:]|$)/i.test(result.url)) score += 1;
  if (reject.length) score -= 10;
  const threshold = Math.max(1, Number(M1_PROSPECTING.policy.min_score || 7));
  const signal = assessMarketSignal({ title: result.title, detail: result.description, url: result.url });
  const relevant = signal.useful && reject.length === 0 && icp.length > 0 && product.length > 0 && brazil.length > 0 && score >= threshold;
  const reason = !signal.useful
    ? `DESCARTADO_SINAL=${signal.reason} · SCORE=${score}`
    : relevant
    ? `ICP=${icp.slice(0,3).join(',')} · PRODUTO=${product.slice(0,3).join(',')} · BR=${brazil.slice(0,3).join(',')} · SCORE=${score}`
    : reject.length
      ? `DESCARTADO_CATEGORIA=${reject.slice(0,3).join(',')} · SCORE=${score}`
      : `DESCARTADO_RELEVANCIA · ICP=${icp.length} · PRODUTO=${product.length} · BR=${brazil.length} · SCORE=${score}`;
  return { relevant, score, threshold, reason };
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(xml: string, tag: string) {
  const match = xml.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return match ? decodeXml(match[1]) : '';
}

export async function searchProspects(query: string): Promise<ProspectResult[]> {
  const response = await fetch('https://www.bing.com/search?mkt=pt-BR&cc=br&setlang=pt-BR&format=rss&count=20&q=' + encodeURIComponent(query), {
    headers: {
      accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
      'user-agent': 'ZEVANORY-Commercial-Research/2026.09',
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('prospect_search_http_' + response.status);
  const xml = await response.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  const seen = new Set<string>();
  const results: ProspectResult[] = [];
  for (const item of items) {
    const title = extractTag(item, 'title');
    const url = extractTag(item, 'link');
    const description = extractTag(item, 'description');
    if (!title || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    results.push({ title: title.slice(0, 180), url, description: description.slice(0, 1200), query });
    if (results.length >= 12) break;
  }
  return results;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function generateDailyBriefs() {
  const [products, creatives] = await Promise.all([
    db.list<any>('acs_products_admin', { limit: 100 }),
    listKind('creative', 1000),
  ]);
  let created = 0;
  for (const product of products.items.filter(item => item.status !== 'archived').slice(0, 3)) {
    const sourceKey = 'robot-brief:' + String(product.slug || product.id) + ':' + todayKey();
    if (creatives.some(item => item.source === 'commercial-robot' && item.sourceKey === sourceKey)) continue;
    await upsertBySourceKey({
      kind: 'creative',
      title: 'Brief comercial · ' + cleanString(product.name || product.slug || 'Produto', 120),
      detail: [
        'Objetivo: gerar uma peça orientada à descoberta e educação, sem promessa não comprovada.',
        product.description ? 'Contexto do produto: ' + cleanString(product.description, 600) : '',
        'Regra: nenhum conteúdo será publicado sem passar pela fila de aprovação.',
      ].filter(Boolean).join(' '),
      status: 'brief',
      product: cleanString(product.name || '', 180) || null,
      productId: String(product.id || '') || null,
      source: 'commercial-robot',
      sourceKey,
      evidence: ['generated-by:commercial-robot', 'approval-required', new Date().toISOString()],
    });
    created += 1;
  }
  return created;
}

let robotTickRunning = false;

let lastNoiseSweepAt = 0;

export async function commercialRobotTick() {
  if (robotTickRunning) return { ok: false, skipped: true, reason: 'tick_already_running' };
  robotTickRunning = true;
  const startedAt = new Date().toISOString();
  let discovered = 0;
  let rejected = 0;
  let queryFailures = 0;
  try {
    const queries = M1_PROSPECTING.queries.map(item => String(item).trim()).filter(Boolean).slice(0, 24);
    if (!queries.length) {
      return { ok: false, skipped: true, reason: 'm1_queries_missing', discovered: 0, rejected: 0, queryFailures: 0, briefsCreated: 0, at: new Date().toISOString() };
    }

    for (const query of queries) {
      try {
        const results = await searchProspects(query);
        for (const result of results) {
          const review = scoreProspect(result);
          if (!review.relevant) {
            rejected += 1;
            continue;
          }
          await upsertBySourceKey({
            kind: 'evidence',
            title: result.title,
            detail: result.description || 'Descoberta pública qualificada por relevância.',
            status: 'raw-discovery',
            channel: 'web',
            product: 'ZEVANORY',
            source: 'public-search',
            sourceKey: ('bing:' + result.url).slice(0, 220),
            evidence: [
              result.url,
              'query-source:M1',
              'query:' + query,
              'locale:pt-BR',
              'country:BR',
              'score:' + review.score,
              'relevance:' + review.reason,
              'rule:no-cold-outreach',
              'stage:reviewed-discovery',
              'discovered-at:' + startedAt,
            ],
          });
          discovered += 1;
        }
      } catch {
        queryFailures += 1;
      }
    }

    // Owner authorized (2026-10-06) continuous archival of web noise: archive-only, never delete.
    let noiseArchived = 0;
    if (Date.now() - lastNoiseSweepAt > 6 * 60 * 60 * 1000) {
      lastNoiseSweepAt = Date.now();
      try {
        const sweep = await commercialCleanup({ mode: 'apply', confirm: 'AUTORIZO_ARQUIVAMENTO' });
        noiseArchived = Number(sweep.archived || 0);
      } catch (cause) {
        console.error('commercial_noise_sweep_failed', cause instanceof Error ? cause.message : String(cause));
      }
    }

    const briefsCreated = await generateDailyBriefs();
    const hourKey = new Date().toISOString().slice(0, 13);
    await upsertBySourceKey({
      kind: 'event',
      title: 'Ciclo de prospecção concluído',
      detail: `${discovered} sinal(is) útil(eis) persistido(s); ${rejected} descartado(s) como ruído; ${noiseArchived} ruído(s) antigo(s) arquivado(s); ${queries.length} consulta(s) M1; ${queryFailures} busca(s) com falha; ${briefsCreated} brief(s) criado(s).`,
      status: 'research',
      source: 'commercial-robot',
      sourceKey: 'research-cycle:' + hourKey,
      evidence: ['query-source:M1', 'locale:pt-BR', 'country:BR', 'relevance-filter:enabled', 'no-cold-outreach', 'no-auto-contact', 'no-auto-publish', startedAt],
    });
    await upsertBySourceKey({
      kind: 'event',
      title: 'Heartbeat do robô comercial',
      detail: 'Worker de prospecção e produção de briefs executando. Contato e publicação externos permanecem condicionados aos gates.',
      status: 'heartbeat',
      source: 'commercial-robot',
      sourceKey: 'commercial-orchestrator-heartbeat',
      evidence: ['runtime-worker', 'public-search-only', 'approval-required', new Date().toISOString()],
    });
    return { ok: true, discovered, rejected, noiseArchived, queryFailures, briefsCreated, at: new Date().toISOString() };
  } finally {
    robotTickRunning = false;
  }
}


function envEnabled(name: string) {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function configuredSalesAutonomy(): ZevanorySalesAutonomyLevel {
  const value = String(process.env.ZEVANORY_SALES_AUTONOMY || 'assist').trim().toLowerCase();
  return value === 'autopilot' || value === 'autonomous' ? value : 'assist';
}

export function buildZevanorySalesPolicy(
  operations: CommercialOperationsLike,
  options: { humanApproval?: boolean; paymentConfirmed?: boolean } = {},
): ZevanorySalesPolicy {
  const channels = Array.isArray(operations?.channels) ? operations.channels : [];
  const activeChannelReady = channels.some(channel =>
    isOperationallyActive(channel.commercialExecution) &&
    !isOperationallyBlocked(channel.releaseGate) &&
    Boolean(String(channel.name || '').trim()),
  );
  const infrastructureReady = Boolean(
    operations?.available &&
    operations?.health?.ready &&
    operations?.continuity?.quorumOk,
  );

  return {
    infrastructureReady,
    channelReady: infrastructureReady && activeChannelReady,
    contactPolicyReady: envEnabled('ZEVANORY_SALES_CONTACT_POLICY_READY'),
    publicationPolicyReady: envEnabled('ZEVANORY_SALES_PUBLICATION_POLICY_READY'),
    pricingPolicyReady: envEnabled('ZEVANORY_SALES_PRICING_POLICY_READY'),
    checkoutReady:
      isOperationallyActive(operations?.runtime?.checkout) &&
      envEnabled('ZEVANORY_SALES_CHECKOUT_POLICY_READY'),
    fulfillmentReady: envEnabled('ZEVANORY_SALES_FULFILLMENT_POLICY_READY'),
    paymentConfirmed: Boolean(options.paymentConfirmed),
    humanApproval: Boolean(options.humanApproval),
    autonomousPublicationAllowed: envEnabled('ZEVANORY_SALES_AUTONOMOUS_PUBLICATION_ALLOWED'),
  };
}

export async function commercialSalesPromoteDiscovery(discoveryId: string) {
  const [discovery] = await db.get<Omit<CommercialRecord, 'id'>>(commercialBucketName('evidence'), [discoveryId]);
  if (!discovery) throw new Error('sales_discovery_not_found');
  if (discovery.status !== 'raw-discovery') throw new Error('sales_discovery_not_raw');

  const promotedAt = new Date().toISOString();
  const lead = await upsertBySourceKey({
    kind: 'lead',
    title: discovery.title,
    detail: discovery.detail,
    status: 'new',
    channel: discovery.channel || 'web',
    product: discovery.product || 'ZEVANORY SALES',
    productId: discovery.productId,
    source: 'zevanory-sales',
    sourceKey: ('promoted:' + (discovery.sourceKey || discoveryId)).slice(0, 220),
    evidence: [
      ...(discovery.evidence || []),
      'promotion:human-reviewed',
      'discovery-id:' + discoveryId,
      'promoted-at:' + promotedAt,
    ].slice(-20),
  });

  await upsertBySourceKey({
    kind: 'event',
    title: 'Lead criado a partir de descoberta',
    detail: discovery.title,
    status: 'sales-promoted',
    channel: discovery.channel,
    product: discovery.product || 'ZEVANORY SALES',
    productId: discovery.productId,
    source: 'zevanory-sales',
    sourceKey: 'promoted-event:' + lead.id,
    evidence: ['lead-id:' + lead.id, 'discovery-id:' + discoveryId, promotedAt],
  });

  return lead;
}

export type CommercialSalesQualificationInput = {
  leadId: string;
  score: number;
  signals: string[];
  reason?: string;
};

export async function commercialSalesQualifyLead(input: CommercialSalesQualificationInput) {
  const score = Math.max(0, Math.min(100, Math.round(Number(input.score))));
  if (!Number.isFinite(score)) throw new Error('sales_qualification_score_invalid');

  const thresholdRaw = Number(process.env.ZEVANORY_SALES_QUALIFICATION_THRESHOLD || '60');
  const threshold = Number.isFinite(thresholdRaw)
    ? Math.max(1, Math.min(100, Math.round(thresholdRaw)))
    : 60;
  const signals = Array.isArray(input.signals)
    ? input.signals.map(item => cleanString(item, 240)).filter(Boolean).slice(0, 20)
    : [];
  if (signals.length === 0) throw new Error('sales_qualification_evidence_required');

  const [existing] = await db.get<Omit<CommercialRecord, 'id'>>(commercialBucketName('lead'), [cleanString(input.leadId, 120)]);
  if (!existing) throw new Error('sales_lead_not_found');

  const qualified = score >= threshold;
  const now = new Date().toISOString();
  const evidence = [
    ...(existing.evidence || []),
    'qualification-score:' + score,
    'qualification-threshold:' + threshold,
    ...signals.map(item => 'qualification-signal:' + item),
    ...(input.reason ? ['qualification-reason:' + cleanString(input.reason, 500)] : []),
    'qualification-at:' + now,
  ].slice(-20);

  const normalized = normalizeCommercialRecord(
    {
      kind: 'lead',
      status: qualified ? 'qualified' : 'nurture',
      evidence,
    },
    { ...existing, id: input.leadId, kind: 'lead' } as CommercialRecord,
  );
  if (!normalized) throw new Error('commercial_record_invalid');
  await db.update(commercialBucketName('lead'), [{ id: input.leadId, record: normalized }]);

  await upsertBySourceKey({
    kind: 'event',
    title: qualified ? 'Lead qualificado pelo ZEVANORY SALES' : 'Lead mantido em nutrição',
    detail: 'score=' + score + '; threshold=' + threshold + '; lead=' + existing.title,
    status: 'sales-qualification',
    channel: existing.channel,
    product: existing.product || 'ZEVANORY SALES',
    productId: existing.productId,
    source: 'zevanory-sales',
    sourceKey: 'sales-qualification:' + input.leadId + ':' + now,
    evidence,
  });

  return {
    leadId: input.leadId,
    qualified,
    score,
    threshold,
    status: qualified ? 'qualified' : 'nurture',
    evidenceCount: signals.length,
    at: now,
  };
}

async function paymentConfirmedForLead(leadId: string) {
  const finance = await listKind('finance', 1000);
  return finance.some(item => {
    const status = String(item.status || '').trim().toLowerCase();
    if (!['paid', 'received', 'confirmed'].includes(status)) return false;
    return (item.evidence || []).some(value => value === 'lead-id:' + leadId);
  });
}

export async function commercialSalesDecision(
  operations: CommercialOperationsLike,
  input: {
    leadId: string;
    action: ZevanorySalesAction;
    humanApproval?: boolean;
  },
) {
  const [lead] = await db.get<Omit<CommercialRecord, 'id'>>(commercialBucketName('lead'), [input.leadId]);
  if (!lead) throw new Error('sales_lead_not_found');

  const paymentConfirmed = await paymentConfirmedForLead(input.leadId);
  const autonomy = configuredSalesAutonomy();
  const policy = buildZevanorySalesPolicy(operations, {
    humanApproval: input.humanApproval,
    paymentConfirmed,
  });
  const decision = evaluateZevanorySalesAction(autonomy, input.action, policy);
  const leadStatus = String(lead.status || '').trim().toLowerCase().replaceAll('_', '-');
  const qualifiedStatuses = new Set([
    'qualified',
    'contact-ready',
    'contacted',
    'conversation',
    'offer',
    'follow-up',
    'checkout',
    'payment',
    'customer',
    'fulfillment',
  ]);
  if (input.action !== 'research' && !qualifiedStatuses.has(leadStatus)) {
    decision.allowed = false;
    decision.reason = 'lead_not_qualified';
  }
  const at = new Date().toISOString();

  await upsertBySourceKey({
    kind: 'evidence',
    title: 'Decisao comercial · ' + lead.title,
    detail: decision.allowed
      ? 'Acao autorizada pelos gates atuais; nenhuma execucao externa foi realizada por este endpoint.'
      : 'Acao bloqueada pelos gates atuais: ' + decision.reason,
    status: decision.allowed ? 'sales-decision-allowed' : 'sales-decision-blocked',
    channel: lead.channel,
    product: lead.product || 'ZEVANORY SALES',
    productId: lead.productId,
    source: 'zevanory-sales',
    sourceKey: ('sales-decision:' + input.leadId + ':' + input.action + ':' + at).slice(0, 220),
    evidence: [
      'lead-id:' + input.leadId,
      'action:' + input.action,
      'autonomy:' + autonomy,
      'decision:' + decision.reason,
      'lead-status:' + leadStatus,
      'payment-confirmed:' + paymentConfirmed,
      'external-execution:false',
      at,
    ],
  });

  return {
    leadId: input.leadId,
    autonomy,
    action: input.action,
    decision,
    policy,
    leadStatus,
    paymentConfirmed,
    externalExecution: false,
    evaluatedAt: at,
  };
}

type CommercialSalesExecutableAction = 'contact' | 'offer' | 'follow-up' | 'checkout';

function nextLeadStatusForAction(action: CommercialSalesExecutableAction) {
  if (action === 'contact') return 'contacted';
  if (action === 'offer') return 'offer';
  if (action === 'follow-up') return 'follow-up';
  return 'checkout';
}

export async function commercialSalesExecuteAction(
  operations: CommercialOperationsLike,
  input: {
    leadId: string;
    action: CommercialSalesExecutableAction;
    content: string;
    humanApproval?: boolean;
  },
) {
  const content = cleanString(input.content, 4000);
  if (!content) throw new Error('sales_action_content_required');

  const decision = await commercialSalesDecision(operations, {
    leadId: input.leadId,
    action: input.action,
    humanApproval: input.humanApproval,
  });
  if (!decision.decision.allowed) {
    return { ...decision, executed: false, executionReason: decision.decision.reason };
  }

  const adapterUrl = String(process.env.ZEVANORY_SALES_CHANNEL_ADAPTER_URL || '').trim();
  if (!/^https:\/\//i.test(adapterUrl)) throw new Error('sales_channel_adapter_url_missing');
  const adapterToken = await secrets.readSecret('ZEVANORY_SALES_CHANNEL_ADAPTER_TOKEN');
  if (!adapterToken) throw new Error('sales_channel_adapter_token_missing');

  const [lead] = await db.get<Omit<CommercialRecord, 'id'>>(commercialBucketName('lead'), [input.leadId]);
  if (!lead) throw new Error('sales_lead_not_found');

  const requestId = crypto.randomUUID();
  const sentAt = new Date().toISOString();
  const response = await fetch(adapterUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + adapterToken,
      'x-zevanory-request-id': requestId,
    },
    body: JSON.stringify({
      schema: 'zevanory.sales.action.v1',
      tenantId: zevanorySalesTenantId(),
      requestId,
      action: input.action,
      lead: {
        id: input.leadId,
        title: lead.title,
        channel: lead.channel,
        product: lead.product,
        productId: lead.productId,
      },
      content,
      sentAt,
    }),
    signal: AbortSignal.timeout(12_000),
  });

  const raw = await response.text();
  let adapterResult: Record<string, unknown> = {};
  try { adapterResult = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch {}
  if (!response.ok) throw new Error('sales_channel_adapter_http_' + response.status);

  const externalId = cleanNullable(adapterResult.externalId || adapterResult.id, 220);
  const readback = cleanNullable(adapterResult.readback || adapterResult.status, 500);
  if (!externalId) throw new Error('sales_channel_adapter_external_id_missing');

  const status = nextLeadStatusForAction(input.action);
  const evidence = [
    ...(lead.evidence || []),
    'lead-id:' + input.leadId,
    'sales-action:' + input.action,
    'adapter-request-id:' + requestId,
    'external-id:' + externalId,
    ...(readback ? ['adapter-readback:' + readback] : []),
    'executed-at:' + sentAt,
  ].slice(-20);
  const normalized = normalizeCommercialRecord(
    { kind: 'lead', status, evidence },
    { ...lead, id: input.leadId, kind: 'lead' } as CommercialRecord,
  );
  if (!normalized) throw new Error('commercial_record_invalid');
  await db.update(commercialBucketName('lead'), [{ id: input.leadId, record: normalized }]);

  await upsertBySourceKey({
    kind: 'event',
    title: 'Acao comercial executada · ' + lead.title,
    detail: input.action + ' enviado pelo adapter externo.',
    status: 'sales-action-executed',
    channel: lead.channel,
    product: lead.product || 'ZEVANORY SALES',
    productId: lead.productId,
    source: 'zevanory-sales',
    sourceKey: ('sales-execution:' + requestId).slice(0, 220),
    evidence,
  });

  return {
    ...decision,
    executed: true,
    externalExecution: true,
    requestId,
    externalId,
    readback,
    leadStatus: status,
    executedAt: sentAt,
  };
}

export async function commercialSalesInbound(request: Request, body: unknown) {
  if (!await requireCommercialAdapter(request)) return error('Adapter comercial nao autorizado.', 401);
  const raw = body as {
    leadId?: string;
    externalId?: string;
    channel?: string;
    text?: string;
    receivedAt?: string;
  };
  const leadId = cleanString(raw.leadId, 120);
  const externalId = cleanString(raw.externalId, 220);
  const text = cleanString(raw.text, 4000);
  if (!leadId || !externalId || !text) return error('Evento inbound invalido.', 400);

  const [lead] = await db.get<Omit<CommercialRecord, 'id'>>(commercialBucketName('lead'), [leadId]);
  if (!lead) return error('Lead nao encontrado.', 404);

  const receivedAt = cleanString(raw.receivedAt, 64) || new Date().toISOString();
  const evidence = [
    ...(lead.evidence || []),
    'lead-id:' + leadId,
    'inbound-external-id:' + externalId,
    'conversation-observed:true',
    'received-at:' + receivedAt,
  ].slice(-20);
  const normalized = normalizeCommercialRecord(
    { kind: 'lead', status: 'conversation', evidence },
    { ...lead, id: leadId, kind: 'lead' } as CommercialRecord,
  );
  if (!normalized) return error('Registro comercial invalido.', 400);
  await db.update(commercialBucketName('lead'), [{ id: leadId, record: normalized }]);

  await upsertBySourceKey({
    kind: 'event',
    title: 'Resposta recebida · ' + lead.title,
    detail: text,
    status: 'sales-inbound',
    channel: cleanNullable(raw.channel, 120) || lead.channel,
    product: lead.product || 'ZEVANORY SALES',
    productId: lead.productId,
    source: 'zevanory-sales-adapter',
    sourceKey: ('sales-inbound:' + externalId).slice(0, 220),
    evidence,
  });

  return json({ ok: true, leadId, status: 'conversation', receivedAt });
}


function eventHasMarker(items: CommercialRecord[], leadId: string, marker: string) {
  return items.some(item =>
    (item.evidence || []).includes('lead-id:' + leadId) &&
    (item.evidence || []).includes(marker)
  );
}

export type CommercialSalesLifecycleEvent =
  | 'checkout-completed'
  | 'payment-confirmed'
  | 'customer-created'
  | 'fulfillment-started'
  | 'follow-up-not-required';

export async function commercialSalesLifecycle(request: Request, body: unknown) {
  if (!await requireCommercialAdapter(request)) return error('Adapter comercial nao autorizado.', 401);
  const raw = body as {
    leadId?: string;
    event?: CommercialSalesLifecycleEvent;
    externalId?: string;
    valueCents?: number;
    currency?: string;
    detail?: string;
    occurredAt?: string;
  };
  const leadId = cleanString(raw.leadId, 120);
  const event = cleanString(raw.event, 80) as CommercialSalesLifecycleEvent;
  const allowed = new Set<CommercialSalesLifecycleEvent>([
    'checkout-completed',
    'payment-confirmed',
    'customer-created',
    'fulfillment-started',
    'follow-up-not-required',
  ]);
  if (!leadId || !allowed.has(event)) return error('Evento de ciclo invalido.', 400);

  const [lead] = await db.get<Omit<CommercialRecord, 'id'>>(commercialBucketName('lead'), [leadId]);
  if (!lead) return error('Lead nao encontrado.', 404);

  const occurredAt = cleanString(raw.occurredAt, 64) || new Date().toISOString();
  const externalId = cleanNullable(raw.externalId, 220);
  const marker = event + ':true';
  const evidence = [
    ...(lead.evidence || []),
    'lead-id:' + leadId,
    marker,
    ...(externalId ? ['lifecycle-external-id:' + externalId] : []),
    'lifecycle-at:' + occurredAt,
  ].slice(-20);

  let nextStatus = String(lead.status || 'qualified');
  if (event === 'checkout-completed') nextStatus = 'checkout';
  if (event === 'payment-confirmed') nextStatus = 'payment';
  if (event === 'customer-created') nextStatus = 'customer';
  if (event === 'fulfillment-started') nextStatus = 'fulfillment';

  const normalized = normalizeCommercialRecord(
    { kind: 'lead', status: nextStatus, evidence },
    { ...lead, id: leadId, kind: 'lead' } as CommercialRecord,
  );
  if (!normalized) return error('Registro comercial invalido.', 400);
  await db.update(commercialBucketName('lead'), [{ id: leadId, record: normalized }]);

  if (event === 'payment-confirmed') {
    const valueRaw = Number(raw.valueCents);
    const valueCents = Number.isFinite(valueRaw) && valueRaw >= 0 ? Math.round(valueRaw) : null;
    await upsertBySourceKey({
      kind: 'finance',
      title: 'Pagamento confirmado · ' + lead.title,
      detail: cleanString(raw.detail || 'Pagamento confirmado pelo adapter autenticado.', 1000),
      status: 'confirmed',
      channel: lead.channel,
      product: lead.product || 'ZEVANORY SALES',
      productId: lead.productId,
      valueCents,
      source: 'zevanory-sales-adapter',
      sourceKey: ('payment-confirmed:' + leadId + ':' + (externalId || occurredAt)).slice(0, 220),
      evidence: ['lead-id:' + leadId, marker, ...(externalId ? ['payment-external-id:' + externalId] : []), occurredAt],
    });
  }

  await upsertBySourceKey({
    kind: 'event',
    title: 'Ciclo comercial · ' + event,
    detail: cleanString(raw.detail || lead.title, 1000),
    status: 'sales-lifecycle',
    channel: lead.channel,
    product: lead.product || 'ZEVANORY SALES',
    productId: lead.productId,
    source: 'zevanory-sales-adapter',
    sourceKey: ('sales-lifecycle:' + leadId + ':' + event + ':' + (externalId || occurredAt)).slice(0, 220),
    evidence: ['lead-id:' + leadId, marker, ...(externalId ? ['lifecycle-external-id:' + externalId] : []), occurredAt],
  });

  return json({ ok: true, leadId, event, status: nextStatus, occurredAt });
}

export async function commercialSalesProof(leadId: string) {
  const [lead] = await db.get<Omit<CommercialRecord, 'id'>>(commercialBucketName('lead'), [leadId]);
  if (!lead) throw new Error('sales_lead_not_found');

  const [events, finance] = await Promise.all([
    listKind('event', 1000),
    listKind('finance', 1000),
  ]);
  const evidence = lead.evidence || [];

  const proof = {
    leadDiscovered: evidence.some(value => value.startsWith('discovery-id:') || value.startsWith('discovered-at:')),
    contactSent:
      evidence.includes('sales-action:contact') &&
      evidence.some(value => value.startsWith('external-id:')),
    conversationObserved:
      evidence.includes('conversation-observed:true') ||
      eventHasMarker(events, leadId, 'conversation-observed:true'),
    qualificationRecorded:
      evidence.some(value => value.startsWith('qualification-score:')) &&
      evidence.some(value => value.startsWith('qualification-signal:')),
    offerSent:
      evidence.includes('sales-action:offer') &&
      evidence.some(value => value.startsWith('external-id:')),
    followUpSatisfied:
      evidence.includes('sales-action:follow-up') ||
      evidence.includes('follow-up-not-required:true') ||
      eventHasMarker(events, leadId, 'follow-up-not-required:true'),
    checkoutCompleted:
      evidence.includes('checkout-completed:true') ||
      eventHasMarker(events, leadId, 'checkout-completed:true'),
    paymentConfirmed:
      finance.some(item =>
        ['paid','received','confirmed'].includes(String(item.status || '').toLowerCase()) &&
        (item.evidence || []).includes('lead-id:' + leadId) &&
        (item.evidence || []).includes('payment-confirmed:true')
      ),
    customerCreated:
      evidence.includes('customer-created:true') ||
      eventHasMarker(events, leadId, 'customer-created:true'),
    fulfillmentStarted:
      evidence.includes('fulfillment-started:true') ||
      eventHasMarker(events, leadId, 'fulfillment-started:true'),
  };

  const result = evaluateZevanoryAutonomousSaleProof(proof);
  return {
    leadId,
    proof,
    ...result,
    verdict: result.pass ? 'AUTONOMOUS_SALE_PROVED' : 'AUTONOMOUS_SALE_NOT_PROVED',
    evaluatedAt: new Date().toISOString(),
  };
}
