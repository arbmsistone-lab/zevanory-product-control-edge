import { db, error, json, secrets } from './platform.ts';
import {
  computeCommercialMetrics,
  deriveCommercialRobotState,
  type CommercialOperationsLike,
  type CommercialRecord,
  type CommercialRecordKind,
  type CommercialWorkspaceData,
} from '../src/commercial-model.ts';

const BUCKETS: Record<CommercialRecordKind, string> = {
  lead: 'zpc_commercial_leads',
  creative: 'zpc_commercial_creatives',
  publication: 'zpc_commercial_publications',
  event: 'zpc_commercial_events',
  support: 'zpc_commercial_support',
  finance: 'zpc_commercial_finance',
  evidence: 'zpc_commercial_evidence',
};

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
  const result = await db.list<Omit<CommercialRecord, 'id'>>(BUCKETS[kind], { limit });
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
      await db.update(BUCKETS[kind], [{ id: found.id, record: normalized }]);
      return { ...normalized, id: found.id };
    }
  }
  const [id] = await db.add(BUCKETS[kind], [normalized]);
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
  const [existing] = await db.get<Omit<CommercialRecord, 'id'>>(BUCKETS[kind], [id]);
  if (!existing) throw new Error('commercial_record_not_found');
  const normalized = normalizeCommercialRecord({ ...raw, kind }, { ...existing, id, kind } as CommercialRecord);
  if (!normalized) throw new Error('commercial_record_invalid');
  await db.update(BUCKETS[kind], [{ id, record: normalized }]);
  return { ...normalized, id };
}

export async function commercialApprovalAction(input: {
  id: string;
  kind: 'creative' | 'publication';
  action: 'approve' | 'reject' | 'request-changes';
  note?: string;
}) {
  const [existing] = await db.get<Omit<CommercialRecord, 'id'>>(BUCKETS[input.kind], [input.id]);
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
  await db.update(BUCKETS[input.kind], [{ id: input.id, record: normalized }]);
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

