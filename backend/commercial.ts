import { db, error, json, secrets } from './platform.ts';
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
  };
}

async function listKind(kind: CommercialRecordKind, limit = 200): Promise<CommercialRecord[]> {
  const result = await db.list<Omit<CommercialRecord, 'id'>>(commercialBucketName(kind), { limit });
  return result.items.map(item => ({ ...item, kind, id: item.id })) as CommercialRecord[];
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



type ProspectResult = { title: string; url: string; description: string; query: string };

const DEFAULT_PROSPECT_QUERIES = [
  'empresa varejo Ceara automacao WhatsApp',
  'clinica Ceara atendimento WhatsApp Instagram',
  'salao Ceara agendamento WhatsApp Instagram',
  'loja Ceara vendas Instagram WhatsApp',
];

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

async function searchProspects(query: string): Promise<ProspectResult[]> {
  const response = await fetch('https://www.bing.com/search?format=rss&q=' + encodeURIComponent(query), {
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
    if (results.length >= 4) break;
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

export async function commercialRobotTick() {
  if (robotTickRunning) return { ok: false, skipped: true, reason: 'tick_already_running' };
  robotTickRunning = true;
  const startedAt = new Date().toISOString();
  let discovered = 0;
  let queryFailures = 0;
  try {
    const configuredQueries = String(process.env.COMMERCIAL_PROSPECT_QUERIES || '')
      .split('|')
      .map(item => item.trim())
      .filter(Boolean);
    const queries = (configuredQueries.length ? configuredQueries : DEFAULT_PROSPECT_QUERIES).slice(0, 6);

    for (const query of queries) {
      try {
        const results = await searchProspects(query);
        for (const result of results) {
          await upsertBySourceKey({
            kind: 'evidence',
            title: result.title,
            detail: result.description || 'Descoberta pública ainda não qualificada.',
            status: 'raw-discovery',
            channel: 'web',
            product: 'ZEVANORY',
            source: 'public-search',
            sourceKey: ('bing:' + result.url).slice(0, 220),
            evidence: [result.url, 'query:' + query, 'stage:raw-discovery', 'discovered-at:' + startedAt],
          });
          discovered += 1;
        }
      } catch {
        queryFailures += 1;
      }
    }

    const briefsCreated = await generateDailyBriefs();
    const hourKey = new Date().toISOString().slice(0, 13);
    await upsertBySourceKey({
      kind: 'event',
      title: 'Ciclo de prospecção concluído',
      detail: `${discovered} resultado(s) processado(s) em ${queries.length} busca(s); ${queryFailures} busca(s) com falha; ${briefsCreated} brief(s) criado(s).`,
      status: 'research',
      source: 'commercial-robot',
      sourceKey: 'research-cycle:' + hourKey,
      evidence: ['public-search-only', 'no-auto-contact', 'no-auto-publish', startedAt],
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
    return { ok: true, discovered, queryFailures, briefsCreated, at: new Date().toISOString() };
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
  const [discovery] = await db.get<Omit<CommercialRecord, 'id'>>(BUCKETS.evidence, [discoveryId]);
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

  const [existing] = await db.get<Omit<CommercialRecord, 'id'>>(BUCKETS.lead, [cleanString(input.leadId, 120)]);
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
  await db.update(BUCKETS.lead, [{ id: input.leadId, record: normalized }]);

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

export async function commercialSalesDecision(
  operations: CommercialOperationsLike,
  input: {
    leadId: string;
    action: ZevanorySalesAction;
    humanApproval?: boolean;
    paymentConfirmed?: boolean;
  },
) {
  const [lead] = await db.get<Omit<CommercialRecord, 'id'>>(BUCKETS.lead, [input.leadId]);
  if (!lead) throw new Error('sales_lead_not_found');
  const autonomy = configuredSalesAutonomy();
  const policy = buildZevanorySalesPolicy(operations, {
    humanApproval: input.humanApproval,
    paymentConfirmed: input.paymentConfirmed,
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
    externalExecution: false,
    evaluatedAt: at,
  };
}
