// Regression suite for the incident lifecycle (owner audit 13/10/2026, Mission 2).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeIncidents, planIncidentWrites, TELEMETRY_UNAVAILABLE_TITLE, type LifecycleIncident } from '../backend/incident-lifecycle.ts';

// Minimal in-memory store with the same add/update/list semantics as the panel db.
function store() {
  const rows: Array<LifecycleIncident & { id: string }> = [];
  let seq = 0;
  return {
    rows,
    list: () => rows.map(r => ({ ...r })),
    add: (items: LifecycleIncident[]) => { for (const i of items) rows.push({ ...i, id: 'i' + (++seq) }); },
    update: (items: Array<{ id: string; record: LifecycleIncident }>) => { for (const u of items) { const k = rows.findIndex(r => r.id === u.id); if (k >= 0) rows[k] = { ...u.record, id: u.id }; } },
  };
}
const telemetryDown = (at: string): LifecycleIncident => ({ system: 'ZEVANORY PRODUCT CONTROL', severity: 'warning', title: TELEMETRY_UNAVAILABLE_TITLE, detail: 'falhou', createdAt: at, state: 'watching' });
const refresh = (db: ReturnType<typeof store>, observed: LifecycleIncident[], recovered: boolean, at: string) => {
  const plan = planIncidentWrites(db.list(), observed, recovered, at);
  db.update(plan.update);
  db.add(plan.add);
};
const at = (i: number) => new Date(Date.parse('2026-10-13T00:00:00Z') + i * 60_000).toISOString();

let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name); };

test('1. 25 failing refreshes create ONE incident with 25 occurrences (no 20-row cap)', () => {
  const db = store();
  for (let i = 0; i < 25; i++) refresh(db, [telemetryDown(at(i))], false, at(i));
  assert.equal(db.rows.length, 1);
  const active = activeIncidents(db.list());
  assert.equal(active.length, 1);
  assert.equal(active[0].occurrences, 25);
  assert.equal(active[0].createdAt, at(0), 'first seen preserved');
  assert.equal(active[0].lastSeenAt, at(24));
});

test('2. a proven live telemetry read resolves it; it disappears from the active list', () => {
  const db = store();
  for (let i = 0; i < 3; i++) refresh(db, [telemetryDown(at(i))], false, at(i));
  refresh(db, [], true, at(10));
  assert.equal(activeIncidents(db.list()).length, 0);
  assert.equal(db.rows[0].state, 'resolved');
  assert.equal(db.rows[0].resolvedAt, at(10));
});

test('3. absence of proof never resolves: a failing refresh without recovery keeps it active', () => {
  const db = store();
  refresh(db, [telemetryDown(at(0))], false, at(0));
  refresh(db, [], false, at(1));
  assert.equal(activeIncidents(db.list()).length, 1);
});

test('4. after recovery, a new failure opens a NEW incident counted from 1', () => {
  const db = store();
  refresh(db, [telemetryDown(at(0))], false, at(0));
  refresh(db, [], true, at(1));
  refresh(db, [telemetryDown(at(2))], false, at(2));
  const active = activeIncidents(db.list());
  assert.equal(active.length, 1);
  assert.equal(active[0].occurrences, 1);
  assert.equal(db.rows.length, 2);
});

test('5. legacy "Executor primario interrompido" duplicates are merged, renamed and closed by recovery', () => {
  const db = store();
  db.add(Array.from({ length: 20 }, (_, i) => ({ ...telemetryDown(at(i)), title: 'Executor primario interrompido' })));
  assert.equal(activeIncidents(db.list())[0].title, TELEMETRY_UNAVAILABLE_TITLE);
  assert.equal(activeIncidents(db.list())[0].occurrences, 20);
  refresh(db, [telemetryDown(at(30))], false, at(30));
  const active = activeIncidents(db.list());
  assert.equal(active.length, 1);
  assert.equal(active[0].occurrences, 21);
  assert.equal(db.rows.filter(r => r.state !== 'resolved').length, 1, 'duplicates consolidated');
  refresh(db, [], true, at(31));
  assert.equal(activeIncidents(db.list()).length, 0);
});

test('6. recovery does not close unrelated incidents (e.g. availability failures)', () => {
  const db = store();
  const outage: LifecycleIncident = { system: 'ZEVANORY', severity: 'critical', title: 'Falha de disponibilidade', detail: 'HTTP 503', createdAt: at(0), state: 'open' };
  refresh(db, [outage, telemetryDown(at(0))], false, at(0));
  refresh(db, [], true, at(1));
  const active = activeIncidents(db.list());
  assert.deepEqual(active.map(a => a.title), ['Falha de disponibilidade']);
});

test('8. an incident still observed while telemetry is live is NOT resolved and recreated (review finding)', () => {
  const db = store();
  const partial = (t: string): LifecycleIncident => ({ system: 'ZEVANORY', severity: 'warning', title: 'Telemetria privada incompleta', detail: 'sem SHA', createdAt: t, state: 'watching' });
  for (let i = 0; i < 5; i++) refresh(db, [partial(at(i))], true, at(i));
  assert.equal(db.rows.length, 1, 'no new row per refresh');
  assert.equal(db.rows[0].state, 'watching');
  assert.equal(activeIncidents(db.list())[0].occurrences, 5);
  refresh(db, [], true, at(9));
  assert.equal(activeIncidents(db.list()).length, 0, 'closed once no longer observed with live telemetry');
});

test('9. bounded merge batch never double counts across refreshes; records carry no id field', () => {
  const db = store();
  db.add(Array.from({ length: 400 }, (_, i) => ({ ...telemetryDown(at(i)), title: 'Executor primario interrompido' })));
  for (let r = 0; r < 4; r++) refresh(db, [telemetryDown(at(1000 + r))], false, at(1000 + r));
  const active = activeIncidents(db.list());
  assert.equal(active.length, 1);
  assert.equal(active[0].occurrences, 404);
  assert.equal(db.rows.filter(x => x.state !== 'resolved').length, 1);
  const plan = planIncidentWrites(db.list(), [telemetryDown(at(2000))], false, at(2000));
  assert.equal(plan.update.every(u => !('id' in u.record)), true);
});

test('7. both backends use the lifecycle and no longer claim an interrupted executor', () => {
  for (const file of ['../backend/index.ts', '../cf-worker/backend-index.ts']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /title: 'Executor primario interrompido'/, file);
    assert.match(src, /planIncidentWrites\(storedIncidents\.items, incidents, Boolean\(telemetry\) && !fetchResult\.stale, now\)/, file);
    assert.match(src, /incidents: activeIncidents\(/, file);
    assert.doesNotMatch(src, /db\.list<IncidentRecord>\(INCIDENTS, \{ limit: (20|500) \}\)/, file);
  }
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /if \(item\.state === 'resolved'\) continue;/);
  assert.match(app, /dedupeRecords\(dashboard\?\.incidents \?\? \[\], false\)/);
});

console.log(`incident-lifecycle: ${n} tests passed`);
