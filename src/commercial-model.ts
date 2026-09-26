export const COMMERCIAL_SECTIONS = [
  'commercial',
  'creatives',
  'approvals',
  'publications',
  'prospecting',
  'crm',
  'support',
  'finance',
  'evidence',
] as const;

export type CommercialSection = (typeof COMMERCIAL_SECTIONS)[number];

export type CommercialRecordKind =
  | 'lead'
  | 'creative'
  | 'publication'
  | 'event'
  | 'support'
  | 'finance'
  | 'evidence';

export type CommercialRecord = {
  id: string;
  kind: CommercialRecordKind;
  title: string;
  detail: string;
  status: string;
  channel: string | null;
  product: string | null;
  productId: string | null;
  valueCents: number | null;
  source: string;
  sourceKey: string | null;
  evidence: string[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type CommercialRobotState = {
  state: 'ACTIVE' | 'STANDBY' | 'BLOCKED';
  label: string;
  reason: string;
  lastHeartbeatAt: string | null;
  externalProspecting: boolean;
  publishAdapterReady: boolean;
  activeChannels: string[];
};

export type CommercialMetrics = {
  leadsToday: number;
  contactsToday: number;
  creativesInProduction: number;
  pendingApproval: number;
  publishedToday: number;
  salesCentsToday: number;
};

export type CommercialWorkspaceData = {
  generatedAt: string;
  metrics: CommercialMetrics;
  robot: CommercialRobotState;
  leads: CommercialRecord[];
  creatives: CommercialRecord[];
  publications: CommercialRecord[];
  events: CommercialRecord[];
  support: CommercialRecord[];
  finance: CommercialRecord[];
  evidence: CommercialRecord[];
  counts: {
    leads: number;
    creatives: number;
    publications: number;
    events: number;
    support: number;
    finance: number;
    evidence: number;
  };
};

export type CommercialOperationsLike = {
  available?: boolean;
  health?: { ready?: boolean };
  runtime?: { sales?: string; checkout?: string; financial?: string; whatsapp?: string };
  continuity?: { quorumOk?: boolean; channels?: string[] };
  channels?: Array<{ name?: string; releaseGate?: string; commercialExecution?: string }>;
};

const ACTIVE_WORDS = new Set(['active', 'ativo', 'enabled', 'ready', 'running', 'pass', 'green', 'allow']);
const BLOCKED_WORDS = new Set(['blocked', 'disabled', 'fail', 'off', 'globally-blocked', 'unavailable']);

export function normalizeCommercialState(value: unknown) {
  return String(value || '').trim().toLowerCase().replaceAll('_', '-');
}

export function isOperationallyActive(value: unknown) {
  return ACTIVE_WORDS.has(normalizeCommercialState(value));
}

export function isOperationallyBlocked(value: unknown) {
  return BLOCKED_WORDS.has(normalizeCommercialState(value));
}

export function deriveCommercialRobotState(
  operations: CommercialOperationsLike | null | undefined,
  lastHeartbeatAt: string | null,
): CommercialRobotState {
  const channels = Array.isArray(operations?.channels) ? operations!.channels! : [];
  const activeChannels = channels
    .filter(item => isOperationallyActive(item.commercialExecution) && !isOperationallyBlocked(item.releaseGate))
    .map(item => String(item.name || '').trim())
    .filter(Boolean);
  const salesActive = isOperationallyActive(operations?.runtime?.sales);
  const infraReady = Boolean(operations?.available && operations?.health?.ready && operations?.continuity?.quorumOk);
  const externalProspecting = activeChannels.length > 0 && salesActive && infraReady;
  const publishAdapterReady = channels.some(item =>
    isOperationallyActive(item.commercialExecution) &&
    !isOperationallyBlocked(item.releaseGate) &&
    Boolean(String(item.name || '').trim()),
  );

  const heartbeatFresh = lastHeartbeatAt
    ? Date.now() - Date.parse(lastHeartbeatAt) <= 20 * 60 * 1000
    : false;

  if (!operations?.available || !infraReady) {
    return {
      state: 'BLOCKED',
      label: 'ROBÔ COMERCIAL: BLOQUEADO',
      reason: 'Control Core, infraestrutura ou quorum não estão comprovadamente prontos.',
      lastHeartbeatAt,
      externalProspecting: false,
      publishAdapterReady: false,
      activeChannels: [],
    };
  }

  if (externalProspecting && heartbeatFresh) {
    return {
      state: 'ACTIVE',
      label: 'ROBÔ COMERCIAL: ATIVO',
      reason: 'Orquestrador com heartbeat recente e canal comercial liberado pelo Control Core.',
      lastHeartbeatAt,
      externalProspecting: true,
      publishAdapterReady,
      activeChannels,
    };
  }

  return {
    state: 'STANDBY',
    label: 'ROBÔ COMERCIAL: STANDBY',
    reason: externalProspecting
      ? 'Canais aptos encontrados, mas ainda não há heartbeat comercial recente.'
      : 'Painel operacional pronto, porém nenhum canal está comprovado para execução comercial externa.',
    lastHeartbeatAt,
    externalProspecting,
    publishAdapterReady,
    activeChannels,
  };
}

function isToday(value: string | null | undefined, now = new Date()) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

export function computeCommercialMetrics(input: {
  leads: CommercialRecord[];
  creatives: CommercialRecord[];
  publications: CommercialRecord[];
  events: CommercialRecord[];
  finance: CommercialRecord[];
}, now = new Date()): CommercialMetrics {
  const contactStates = new Set(['contacted', 'qualified', 'opportunity', 'proposal', 'won']);
  const creativeProductionStates = new Set(['draft', 'brief', 'generating', 'testing', 'approval']);
  const approvalStates = new Set(['approval', 'pending-approval', 'awaiting-approval']);
  const confirmedFinanceStates = new Set(['confirmed', 'paid', 'received', 'settled', 'done']);

  const contactEventsToday = input.events.filter(item =>
    isToday(item.createdAt, now) && normalizeCommercialState(item.status) === 'contact'
  );
  const contactLeadsToday = input.leads.filter(item =>
    isToday(item.updatedAt, now) && contactStates.has(normalizeCommercialState(item.status))
  );
  const saleSources = new Set(['sale', 'payment', 'checkout', 'order', 'asaas']);

  return {
    leadsToday: input.leads.filter(item => isToday(item.createdAt, now)).length,
    contactsToday: contactEventsToday.length > 0 ? contactEventsToday.length : contactLeadsToday.length,
    creativesInProduction: input.creatives.filter(item => creativeProductionStates.has(normalizeCommercialState(item.status))).length,
    pendingApproval: [
      ...input.creatives,
      ...input.publications,
    ].filter(item => approvalStates.has(normalizeCommercialState(item.status))).length,
    publishedToday: input.publications.filter(item =>
      normalizeCommercialState(item.status) === 'published' && isToday(item.publishedAt || item.updatedAt, now)
    ).length,
    salesCentsToday: input.finance
      .filter(item => isToday(item.updatedAt || item.createdAt, now)
        && confirmedFinanceStates.has(normalizeCommercialState(item.status))
        && saleSources.has(normalizeCommercialState(item.source))
        && Number(item.valueCents || 0) > 0)
      .reduce((sum, item) => sum + Number(item.valueCents || 0), 0),
  };
}

export function commercialStatusLabel(value: string) {
  const key = normalizeCommercialState(value);
  const labels: Record<string, string> = {
    draft: 'RASCUNHO',
    brief: 'BRIEF',
    generating: 'GERANDO',
    testing: 'EM TESTE',
    approval: 'AGUARDANDO APROVAÇÃO',
    'pending-approval': 'AGUARDANDO APROVAÇÃO',
    approved: 'APROVADO',
    rejected: 'REJEITADO',
    scheduled: 'AGENDADO',
    published: 'PUBLICADO',
    failed: 'FALHOU',
    new: 'NOVO',
    qualified: 'QUALIFICADO',
    contacted: 'CONTATADO',
    opportunity: 'OPORTUNIDADE',
    proposal: 'PROPOSTA',
    won: 'GANHO',
    lost: 'PERDIDO',
    open: 'ABERTO',
    resolved: 'RESOLVIDO',
    confirmed: 'CONFIRMADO',
    paid: 'PAGO',
    received: 'RECEBIDO',
    active: 'ATIVO',
    standby: 'STANDBY',
    blocked: 'BLOQUEADO',
  };
  return labels[key] || String(value || 'SEM ESTADO').replaceAll('_', ' ').toUpperCase();
}

export function isCommercialSection(value: string): value is CommercialSection {
  return (COMMERCIAL_SECTIONS as readonly string[]).includes(value);
}
