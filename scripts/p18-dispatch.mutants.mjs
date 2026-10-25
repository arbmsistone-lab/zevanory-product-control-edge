// Mutants for the P18 external trigger (AVAL Sol 253/254). Each mutant changes ONE anchor (exactly one occurrence)
// in a throw-away copy of the tree, runs scripts/p18-dispatch.test.ts against the copy and is KILLED only when the
// suite fails on the assertion label declared below (the label written BEFORE running, from the rule it breaks).
// Anything else (suite passes, other label, anchor missing) is SURVIVED/INCONCLUSIVE and the runner exits 1.
// Usage: node scripts/p18-dispatch.mutants.mjs   (needs node_modules installed; no network)
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const MOD = 'cf-worker/p18-dispatch.ts', WRK = 'cf-worker/worker.ts';
const COPY = ['cf-worker', 'src', 'backend', 'scripts/p18-dispatch.test.ts', 'package.json', 'tsconfig.json'];
const M = [
  ['M01_403_rate_limit_as_scope_error', MOD, "return headers?.get('x-ratelimit-remaining') === '0' || headers?.has('retry-after') ? 'rate_limited' : 'forbidden';", "return 'forbidden';", 'C1-403-limited'],
  ['M02_http_204_counts_as_monitoring', MOD, "heartbeat: { failing: h.state !== 'FRESH', detail: h.state },", "heartbeat: { failing: h.state !== 'FRESH' && d.outcome !== 'accepted', detail: h.state },", 'A2-204-stale-alerts'],
  ['M03_no_run_details', MOD, ", return_run_details: true }),", " }),", 'D1-body'],
  ['M04_window_not_5min', MOD, 'export function windowStartMs(ms: number) { const p = WINDOW_MIN * 60_000;', 'export function windowStartMs(ms: number) { const p = 60_000;', 'W1-floor'],
  ['M05_alert_every_window', MOD, "if (sinceAlert >= need) kind = 'failure';", "kind = 'failure';", 'A1-no-repeat-within-60min'],
  ['M06_no_recovery_line', MOD, "kind = 'recovery';  // an announced failure", "kind = null;  // an announced failure", 'A1-recovery-announced'],
  ['M07_no_write_cap', MOD, 'const capped = wantWrite && used + needed > WRITE_CAP_PER_HOUR;', 'const capped = false;', 'B1-cap-per-hour'],
  ['M08_legacy_duties_every_5min', WRK, 'if (!isLegacyDutyMinute(Number(controller?.scheduledTime))) return;', '', 'S1-no-legacy-at-05'],
  ['M09_p18_blocks_duties', WRK, 'if (ctx?.waitUntil) ctx.waitUntil(p18); else p18.catch(() => undefined);', 'await p18.catch(() => undefined);', 'S1-own-waituntil'],
  ['M10_writes_without_dedupe_state', MOD, "if (!readOk) kvState = 'read_failed';", "if (false) kvState = 'read_failed';", 'E3-read-failed'],
  ['M11_heartbeat_edge_900', MOD, "if (age_s > HEARTBEAT_STALE_S) return out('STALE', extra);", "if (age_s >= HEARTBEAT_STALE_S) return out('STALE', extra);", 'H1-900'],
  ['M12_dispatch_without_token', MOD, "if (!opts.token) return done('unconfigured', null);", '', 'D1-unconfigured'],
  ['M13_category_not_in_digest', MOD, "export const ALERT_CATEGORY = 'channel_down';", "export const ALERT_CATEGORY = 'p18';", 'E1-digest-accepts-category'],
  ['M14_timeout_trusts_dependency', MOD, '      reject(err);', '      void reject;', 'E5-within-budget'],
  ['M15_heartbeat_ignored', MOD, "if (age_s > HEARTBEAT_STALE_S) return out('STALE', extra);", '', 'H1-901'],
];

function stage() {
  const d = mkdtempSync(join(tmpdir(), 'zpc-p18-mut-'));
  for (const rel of COPY) cpSync(join(ROOT, rel), join(d, rel), { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(d, 'node_modules'));
  return d;
}
function run(d) {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsx'), ['scripts/p18-dispatch.test.ts'], { cwd: d, encoding: 'utf8', timeout: 180_000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const base = stage();
const b = run(base);
rmSync(base, { recursive: true, force: true });
const baseOk = b.code === 0 && /p18-dispatch: 16 tests passed/.test(b.out);
console.log(JSON.stringify({ mutant_id: 'BASELINE', ok: baseOk }));
if (!baseOk) { console.log(b.out.slice(-2000)); process.exit(2); }
const results = [];
for (const [id, file, oldS, newS, label] of M) {
  const d = stage();
  const f = join(d, file);
  const text = readFileSync(f, 'utf8');
  const count = text.split(oldS).length - 1;
  let verdict, reason;
  if (count !== 1) { verdict = 'INCONCLUSIVE'; reason = 'anchor_count=' + count; }
  else {
    writeFileSync(f, text.replace(oldS, newS));
    const r = run(d);
    if (r.code === 0) { verdict = 'SURVIVED'; reason = 'suite_passed'; }
    else if (r.out.includes(label)) { verdict = 'KILLED'; reason = 'label:' + label; }
    else { verdict = 'INCONCLUSIVE'; reason = 'failed_without_label ' + (r.out.match(/AssertionError[^\n]*/)?.[0] || r.out.slice(-200)).slice(0, 200); }
  }
  rmSync(d, { recursive: true, force: true });
  results.push({ id, verdict });
  console.log(JSON.stringify({ mutant_id: id, verdict, reason }));
}
const killed = results.filter(r => r.verdict === 'KILLED').length;
console.log(JSON.stringify({ mutants: results.length, KILLED: killed, other: results.filter(r => r.verdict !== 'KILLED').map(r => r.id) }));
process.exit(killed === results.length ? 0 : 1);
