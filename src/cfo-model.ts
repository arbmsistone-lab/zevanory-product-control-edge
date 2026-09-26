export type CfoAdapterState = 'UNCONFIGURED' | 'DEGRADED' | 'READY';
export type CfoActionState = 'SUGGESTED' | 'READY_FOR_APPROVAL' | 'APPROVED' | 'EXECUTED' | 'BLOCKED';
export type CfoReceivableRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export type CfoReceivable = {
  id: string;
  customer: string;
  document?: string | null;
  dueAt: string;
  amountCents: number;
  paidCents: number;
  status: 'OPEN' | 'OVERDUE' | 'PAID' | 'CANCELLED';
  source: string;
  sourceKey?: string | null;
  evidence: string[];
  createdAt: string;
  updatedAt: string;
};

export type CfoTransaction = {
  id: string;
  kind: 'INFLOW' | 'OUTFLOW';
  amountCents: number;
  occurredAt: string;
  category: string;
  counterparty?: string | null;
  source: string;
  sourceKey?: string | null;
  reconciled: boolean;
  evidence: string[];
  createdAt: string;
};

export type CfoAction = {
  id: string;
  kind: 'COLLECT' | 'RESERVE_TAX' | 'REVIEW_COST' | 'RECONCILE' | 'CASH_ALERT';
  title: string;
  detail: string;
  valueCents?: number | null;
  state: CfoActionState;
  requiresApproval: boolean;
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type CfoAdapter = {
  id: string;
  label: string;
  state: CfoAdapterState;
  mode: 'READ' | 'READ_WRITE';
  lastSyncAt: string | null;
  evidence: string[];
  blocker: string | null;
};

export type CfoMetrics = {
  balanceCents: number;
  receivableOpenCents: number;
  overdueCents: number;
  dueTodayCents: number;
  inflow30dCents: number;
  outflow30dCents: number;
  projected30dCents: number;
  taxReserveSuggestedCents: number;
  highRiskReceivables: number;
};

export type CfoWorkspaceData = {
  schema: 'zevanory-cfo-workspace/v1';
  generatedAt: string;
  engine: {
    state: 'BLOCKED' | 'STANDBY' | 'ACTIVE';
    failClosed: true;
    autonomousMutations: false;
    reason: string;
  };
  metrics: CfoMetrics;
  adapters: CfoAdapter[];
  receivables: Array<CfoReceivable & { openCents: number; daysLate: number; risk: CfoReceivableRisk }>;
  recentTransactions: CfoTransaction[];
  actions: CfoAction[];
};

export function openCents(item: Pick<CfoReceivable, 'amountCents' | 'paidCents'>) {
  return Math.max(0, Math.round(item.amountCents) - Math.round(item.paidCents));
}

export function daysLate(dueAt: string, now = new Date()) {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return 0;
  const day = 86_400_000;
  return Math.max(0, Math.floor((new Date(now.toDateString()).getTime() - new Date(due.toDateString()).getTime()) / day));
}

export function receivableRisk(item: CfoReceivable, now = new Date()): CfoReceivableRisk {
  const late = daysLate(item.dueAt, now);
  const open = openCents(item);
  if (open <= 0 || item.status === 'PAID' || item.status === 'CANCELLED') return 'LOW';
  if (late >= 30 || open >= 500_000) return 'HIGH';
  if (late >= 7 || open >= 150_000) return 'MEDIUM';
  return 'LOW';
}

export function computeCfoMetrics(
  transactions: CfoTransaction[],
  receivables: CfoReceivable[],
  now = new Date(),
): CfoMetrics {
  const start30 = now.getTime() - 30 * 86_400_000;
  const today = now.toISOString().slice(0, 10);
  let inflow30dCents = 0;
  let outflow30dCents = 0;
  let balanceCents = 0;

  for (const tx of transactions) {
    const signed = tx.kind === 'INFLOW' ? tx.amountCents : -tx.amountCents;
    balanceCents += signed;
    const t = new Date(tx.occurredAt).getTime();
    if (Number.isFinite(t) && t >= start30 && t <= now.getTime()) {
      if (tx.kind === 'INFLOW') inflow30dCents += tx.amountCents;
      else outflow30dCents += tx.amountCents;
    }
  }

  let receivableOpenCents = 0;
  let overdueCents = 0;
  let dueTodayCents = 0;
  let highRiskReceivables = 0;
  for (const item of receivables) {
    const open = openCents(item);
    if (!open || item.status === 'CANCELLED') continue;
    receivableOpenCents += open;
    const late = daysLate(item.dueAt, now);
    if (late > 0 || item.status === 'OVERDUE') overdueCents += open;
    if (item.dueAt.slice(0, 10) === today) dueTodayCents += open;
    if (receivableRisk(item, now) === 'HIGH') highRiskReceivables += 1;
  }

  const expected30d = receivables
    .filter(item => {
      const due = new Date(item.dueAt).getTime();
      return due >= now.getTime() && due <= now.getTime() + 30 * 86_400_000 && item.status !== 'CANCELLED';
    })
    .reduce((sum, item) => sum + openCents(item), 0);

  const expenseRunRate = outflow30dCents;
  const projected30dCents = balanceCents + expected30d - expenseRunRate;
  const taxableBase = Math.max(0, inflow30dCents - outflow30dCents);
  const taxReserveSuggestedCents = Math.round(taxableBase * 0.10);

  return {
    balanceCents,
    receivableOpenCents,
    overdueCents,
    dueTodayCents,
    inflow30dCents,
    outflow30dCents,
    projected30dCents,
    taxReserveSuggestedCents,
    highRiskReceivables,
  };
}
