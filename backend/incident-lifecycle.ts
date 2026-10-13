// Incident lifecycle for the owner panel (owner audit 13/10/2026, Mission 2).
//
// Confirmed defect: every telemetry refresh that could not read the private feed inserted a NEW
// "Executor primario interrompido" row; nothing ever closed it, and the panel read only the 20
// newest rows, so "registrado 20 vezes" was the query cap, not a real total. The title also
// claimed the executor was interrupted when the only proven fact was a telemetry read failure.
//
// Rules here:
//  - One open row per system+title: a repeat increments `occurrences` and `lastSeenAt`.
//  - Recovery is closed only by proof: a successful live telemetry read resolves telemetry
//    incidents (state 'resolved', `resolvedAt`). Resolved rows are not shown as active.
//  - The panel receives the true occurrence total of each active incident.

export type IncidentState = 'open' | 'watching' | 'resolved';

export type LifecycleIncident = {
  id?: string;
  system: string;
  severity: 'warning' | 'critical';
  title: string;
  detail: string;
  createdAt: string;
  state: IncidentState;
  occurrences?: number;
  lastSeenAt?: string;
  resolvedAt?: string | null;
};

/** What the refresh actually proves when the private feed fails: telemetry is unavailable. */
export const TELEMETRY_UNAVAILABLE_TITLE = 'Telemetria privada indisponível';
/** Titles written before this fix; matched so legacy rows are merged and closed too. */
export const LEGACY_TELEMETRY_TITLES = ['Executor primario interrompido'];
export const TELEMETRY_INCIDENT_TITLES = new Set([TELEMETRY_UNAVAILABLE_TITLE, ...LEGACY_TELEMETRY_TITLES, 'Telemetria privada incompleta']);

const keyOf = (item: { system: string; title: string }) => {
  const title = LEGACY_TELEMETRY_TITLES.includes(item.title) ? TELEMETRY_UNAVAILABLE_TITLE : item.title;
  return item.system + '\u0000' + title;
};
const isActive = (item: LifecycleIncident) => item.state !== 'resolved';
const strip = (row: LifecycleIncident): LifecycleIncident => { const { id: _id, ...rest } = row; return rest; };
const occ = (item: LifecycleIncident) => Math.max(1, Math.trunc(Number(item.occurrences) || 1));

/** Bounded write batch per refresh (edge RPC timeout); remaining legacy duplicates merge next run. */
export const MAX_MERGES_PER_REFRESH = 150;

export type IncidentWritePlan = {
  add: LifecycleIncident[];
  update: Array<{ id: string; record: LifecycleIncident }>;
};

/**
 * Plans the writes for one refresh. `existing` are stored rows (with ids), `observed` the
 * incidents seen in this refresh, `telemetryRecovered` true only when live telemetry was read.
 */
export function planIncidentWrites(existing: LifecycleIncident[], observed: LifecycleIncident[], telemetryRecovered: boolean, now: string): IncidentWritePlan {
  const update = new Map<string, LifecycleIncident>();
  const add: LifecycleIncident[] = [];
  const activeByKey = new Map<string, LifecycleIncident[]>();
  for (const row of existing) {
    if (!row.id || !isActive(row)) continue;
    const list = activeByKey.get(keyOf(row)) || [];
    list.push(row);
    activeByKey.set(keyOf(row), list);
  }

  // Recovery closes only telemetry incidents NOT observed in this same refresh: an incident that is
  // still being seen (e.g. "Telemetria privada incompleta" while the feed is live) stays open and
  // keeps counting instead of being resolved and recreated (independent review, 13/10).
  const observedKeys = new Set(observed.map(keyOf));
  if (telemetryRecovered) {
    for (const row of existing) {
      if (row.id && isActive(row) && TELEMETRY_INCIDENT_TITLES.has(row.title) && !observedKeys.has(keyOf(row))) {
        update.set(row.id, { ...strip(row), state: 'resolved', resolvedAt: now });
      }
    }
  }

  const seen = new Set<string>();
  for (const incident of observed) {
    const key = keyOf(incident);
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = activeByKey.get(key) || [];
    if (rows.length === 0) {
      add.push({ ...incident, occurrences: 1, lastSeenAt: now, resolvedAt: null });
      continue;
    }
    // Merge every legacy duplicate into the oldest row; close the rest as merged.
    const sorted = [...rows].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const keeper = sorted[0];
    const merged = sorted.slice(0, 1 + MAX_MERGES_PER_REFRESH);
    const total = merged.reduce((sum, row) => sum + occ(row), 0) + 1;
    update.set(keeper.id!, { ...strip(keeper), title: incident.title, detail: incident.detail, severity: incident.severity, state: incident.state, occurrences: total, lastSeenAt: now, resolvedAt: null });
    for (const dup of sorted.slice(1, 1 + MAX_MERGES_PER_REFRESH)) update.set(dup.id!, { ...strip(dup), state: 'resolved', resolvedAt: now, detail: dup.detail + ' (consolidado)' });
  }
  return { add, update: [...update.entries()].map(([id, record]) => ({ id, record })) };
}

/** Active incidents for the panel: one per system+title, true occurrence totals, newest first. */
export function activeIncidents<T extends LifecycleIncident>(rows: T[]): Array<T & { occurrences: number; lastSeenAt: string }> {
  const groups = new Map<string, T & { occurrences: number; lastSeenAt: string }>();
  for (const row of rows) {
    if (!isActive(row)) continue;
    const key = keyOf(row);
    const last = String(row.lastSeenAt || row.createdAt || '');
    const prev = groups.get(key);
    if (!prev) {
      groups.set(key, { ...row, title: LEGACY_TELEMETRY_TITLES.includes(row.title) ? TELEMETRY_UNAVAILABLE_TITLE : row.title, occurrences: occ(row), lastSeenAt: last });
    } else {
      prev.occurrences += occ(row);
      if (last > prev.lastSeenAt) { prev.lastSeenAt = last; prev.detail = row.detail; }
      if (String(row.createdAt) < String(prev.createdAt)) prev.createdAt = row.createdAt;
    }
  }
  return [...groups.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}
