import { db } from './platform.ts';
import {
  computeCfoMetrics,
  daysLate,
  openCents,
  receivableRisk,
  type CfoAction,
  type CfoAdapter,
  type CfoReceivable,
  type CfoTransaction,
  type CfoWorkspaceData,
} from '../src/cfo-model.ts';

const RECEIVABLES = 'cfo_receivables_v1';
const TRANSACTIONS = 'cfo_transactions_v1';
const ACTIONS = 'cfo_actions_v1';
const ADAPTERS = 'cfo_adapters_v1';

const FAIL_CLOSED = true as const;
const READY_FOR_APPROVAL = 'READY_FOR_APPROVAL' as const;

type CfoIngestBody = {
  kind?: 'receivable' | 'transaction' | 'adapter';
  source?: string;
  sourceKey?: string;
  payload?: Record<string, unknown>;
  evidence?: string[];
};

function text(value: unknown, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function cents(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('cfo_invalid_amount');
  return Math.round(n);
}

function iso(value: unknown, fallback = new Date().toISOString()) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error('cfo_invalid_date');
  return d.toISOString();
}

function evidence(value: unknown) {
  return Array.isArray(value)
    ? value.map(item => text(item, 500)).filter(Boolean).slice(0, 20)
    : [];
}

function normalizeReceivable(input: CfoIngestBody): Omit<CfoReceivable, 'id'> {
  const p = input.payload || {};
  const amountCents = cents(p.amountCents);
  const paidCents = Math.min(amountCents, cents(p.paidCents ?? 0));
  const status = String(p.status || 'OPEN').toUpperCase();
  if (!['OPEN','OVERDUE','PAID','CANCELLED'].includes(status)) throw new Error('cfo_invalid_receivable_status');
  const now = new Date().toISOString();
  return {
    customer: text(p.customer, 160) || 'Cliente não identificado',
    document: text(p.document, 64) || null,
    dueAt: iso(p.dueAt),
    amountCents,
    paidCents,
    status: status as CfoReceivable['status'],
    source: text(input.source, 80) || 'admin',
    sourceKey: text(input.sourceKey, 160) || null,
    evidence: evidence(input.evidence),
    createdAt: iso(p.createdAt, now),
    updatedAt: now,
  };
}

function normalizeTransaction(input: CfoIngestBody): Omit<CfoTransaction, 'id'> {
  const p = input.payload || {};
  const kind = String(p.kind || '').toUpperCase();
  if (!['INFLOW','OUTFLOW'].includes(kind)) throw new Error('cfo_invalid_transaction_kind');
  return {
    kind: kind as CfoTransaction['kind'],
    amountCents: cents(p.amountCents),
    occurredAt: iso(p.occurredAt),
    category: text(p.category, 120) || 'Sem categoria',
    counterparty: text(p.counterparty, 160) || null,
    source: text(input.source, 80) || 'admin',
    sourceKey: text(input.sourceKey, 160) || null,
    reconciled: Boolean(p.reconciled),
    evidence: evidence(input.evidence),
    createdAt: new Date().toISOString(),
  };
}

function normalizeAdapter(input: CfoIngestBody): Omit<CfoAdapter, 'id'> {
  const p = input.payload || {};
  const state = String(p.state || 'UNCONFIGURED').toUpperCase();
  if (!['UNCONFIGURED','DEGRADED','READY'].includes(state)) throw new Error('cfo_invalid_adapter_state');
  const mode = String(p.mode || 'READ').toUpperCase();
  if (!['READ','READ_WRITE'].includes(mode)) throw new Error('cfo_invalid_adapter_mode');
  if (state === 'READY' && evidence(input.evidence).length === 0) throw new Error('cfo_ready_requires_evidence');
  return {
    label: text(p.label, 120) || text(input.source, 80) || 'Adaptador',
    state: state as CfoAdapter['state'],
    mode: mode as CfoAdapter['mode'],
    lastSyncAt: p.lastSyncAt ? iso(p.lastSyncAt) : null,
    evidence: evidence(input.evidence),
    blocker: state === 'READY' ? null : text(p.blocker, 240) || 'Integração ainda não comprovada.',
  };
}

function adapterDefaults(existing: CfoAdapter[]) {
  const defaults: CfoAdapter[] = [
    { id:'arbm-one', label:'ARBM ONE · financeiro/contábil', state:'UNCONFIGURED', mode:'READ', lastSyncAt:null, evidence:[], blocker:'Adapter autenticado ainda não configurado no CFO.' },
    { id:'pix', label:'Pix / cobrança', state:'UNCONFIGURED', mode:'READ', lastSyncAt:null, evidence:[], blocker:'Provider e readback ainda não comprovados no CFO.' },
    { id:'banking', label:'Open Finance / banco', state:'UNCONFIGURED', mode:'READ', lastSyncAt:null, evidence:[], blocker:'Conexão bancária ainda não configurada.' },
    { id:'erp', label:'ERP externo', state:'UNCONFIGURED', mode:'READ', lastSyncAt:null, evidence:[], blocker:'ERP ainda não conectado.' },
    { id:'fiscal', label:'Fiscal / documentos', state:'UNCONFIGURED', mode:'READ', lastSyncAt:null, evidence:[], blocker:'Fonte fiscal ainda não conectada.' },
  ];
  const byLabel = new Map(existing.map(item => [item.label.toLowerCase(), item]));
  return defaults.map(item => byLabel.get(item.label.toLowerCase()) || item)
    .concat(existing.filter(item => !defaults.some(d => d.label.toLowerCase() === item.label.toLowerCase())));
}

function deriveActions(receivables: CfoReceivable[], transactions: CfoTransaction[], metrics: ReturnType<typeof computeCfoMetrics>): CfoAction[] {
  const now = new Date();
  const actions: CfoAction[] = [];
  for (const item of receivables) {
    const risk = receivableRisk(item, now);
    const open = openCents(item);
    if (open <= 0 || risk === 'LOW') continue;
    actions.push({
      id: `collect:${item.id}`,
      kind: 'COLLECT',
      title: risk === 'HIGH' ? 'Cobrança prioritária' : 'Revisar recebível',
      detail: `${item.customer} · ${daysLate(item.dueAt, now)} dias de atraso · ação externa exige aprovação.`,
      valueCents: open,
      state: READY_FOR_APPROVAL,
      requiresApproval: true,
      sourceIds: [item.id],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }
  for (const tx of transactions.filter(item => !item.reconciled).slice(0, 10)) {
    actions.push({
      id: `reconcile:${tx.id}`,
      kind: 'RECONCILE',
      title: 'Conciliação pendente',
      detail: `${tx.category} · origem ${tx.source} · confirmar correspondência antes de contabilizar.`,
      valueCents: tx.amountCents,
      state: READY_FOR_APPROVAL,
      requiresApproval: true,
      sourceIds: [tx.id],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }
  if (metrics.projected30dCents < 0) {
    actions.unshift({
      id: 'cash-alert:30d',
      kind: 'CASH_ALERT',
      title: 'Projeção de caixa negativa em 30 dias',
      detail: 'Revisar recebimentos previstos, despesas e compromissos. O CFO não movimenta valores automaticamente.',
      valueCents: Math.abs(metrics.projected30dCents),
      state: 'SUGGESTED',
      requiresApproval: false,
      sourceIds: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }
  if (metrics.taxReserveSuggestedCents > 0) {
    actions.push({
      id: 'tax-reserve:suggested',
      kind: 'RESERVE_TAX',
      title: 'Reserva tributária indicativa',
      detail: 'Estimativa operacional, não cálculo fiscal definitivo. Validar regime e regras aplicáveis antes de reservar recursos.',
      valueCents: metrics.taxReserveSuggestedCents,
      state: 'SUGGESTED',
      requiresApproval: false,
      sourceIds: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }
  return actions.slice(0, 30);
}

export async function cfoWorkspace(): Promise<CfoWorkspaceData> {
  const [receivableRows, transactionRows, adapterRows, actionRows] = await Promise.all([
    db.list<CfoReceivable>(RECEIVABLES, { limit: 500 }),
    db.list<CfoTransaction>(TRANSACTIONS, { limit: 500 }),
    db.list<CfoAdapter>(ADAPTERS, { limit: 50 }),
    db.list<CfoAction>(ACTIONS, { limit: 100 }),
  ]);
  const receivables = receivableRows.items;
  const transactions = transactionRows.items;
  const adapters = adapterDefaults(adapterRows.items);
  const metrics = computeCfoMetrics(transactions, receivables);
  const derived = deriveActions(receivables, transactions, metrics);
  const persisted = actionRows.items.filter(item => ['APPROVED','EXECUTED','BLOCKED'].includes(item.state));
  const readyAdapters = adapters.filter(item => item.state === 'READY' && item.evidence.length > 0);
  const hasData = receivables.length > 0 || transactions.length > 0;
  const state = readyAdapters.length > 0 && hasData ? 'ACTIVE' : hasData ? 'STANDBY' : 'BLOCKED';

  return {
    schema: 'zevanory-cfo-workspace/v1',
    generatedAt: new Date().toISOString(),
    engine: {
      state,
      failClosed: FAIL_CLOSED,
      autonomousMutations: false,
      reason: state === 'ACTIVE'
        ? 'Leitura ativa com pelo menos um adaptador comprovado; mutações financeiras externas continuam sob aprovação.'
        : state === 'STANDBY'
          ? 'Há dados, mas nenhum adaptador foi comprovado como READY.'
          : 'Nenhuma fonte financeira comprovada foi conectada ao CFO.',
    },
    metrics,
    adapters,
    receivables: receivables.map(item => ({
      ...item,
      openCents: openCents(item),
      daysLate: daysLate(item.dueAt),
      risk: receivableRisk(item),
    })).sort((a,b) => b.daysLate - a.daysLate || b.openCents - a.openCents).slice(0, 100),
    recentTransactions: transactions.sort((a,b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 100),
    actions: [...persisted, ...derived].slice(0, 30),
  };
}

export async function cfoAdminIngest(input: CfoIngestBody) {
  if (!input || !input.kind) throw new Error('cfo_missing_kind');
  if (input.kind === 'receivable') {
    const record = normalizeReceivable(input);
    const [id] = await db.add(RECEIVABLES, [record]);
    return { ok: true, id, kind: input.kind };
  }
  if (input.kind === 'transaction') {
    const record = normalizeTransaction(input);
    const [id] = await db.add(TRANSACTIONS, [record]);
    return { ok: true, id, kind: input.kind };
  }
  const record = normalizeAdapter(input);
  const [id] = await db.add(ADAPTERS, [record]);
  return { ok: true, id, kind: input.kind, state: record.state };
}
