// P18 external trigger (AVAL Sol 253/254). The GitHub scheduler is heavily throttled in
// arbmsistone-lab/zevanory-public-mirror: the P18 external monitor (cron */5 there) has not run once since
// activation. This module runs from the EXISTING Cron Trigger of this control Worker (no new trigger: the
// expression goes from */15 to */5 and the legacy duties keep their 15-minute cadence) and, on every invocation:
//
//  1. requests workflow_dispatch of p18-external-monitor.yml with a 5-minute window id (idempotency key,
//     p18w-YYYYMMDDTHHMMZ from controller.scheduledTime) and records the GitHub HTTP result and the run id
//     (return_run_details: true -> 200 + workflow_run_id; GitHub changelog 2026-02-19). HTTP 200/204 means
//     "accepted", NEVER "monitoring done": the runner's real start is recorded on the GitHub side
//     (p18/runs-*.jsonl, p18/heartbeat.json, p18/cf-dispatch.json on evidence/b0-baseline);
//  2. executable contingency independent of GitHub runners: one direct GET of the public raw heartbeat on the
//     evidence branch; stale > 15 min (or missing/malformed/unreadable) raises an alert even when the dispatch
//     returned 200/204 (runner never started, monitor failing, evidence push failing);
//  3. fail-safe: 401/403/404/422/429/5xx/timeout/network and heartbeat failures are recorded in the shared KV
//     state and raise an owner alert through the EXISTING channel, independent of GitHub Actions: a
//     `zpc-alert:v1:*` entry in the shared KV namespace (same id as the central Worker's
//     ZEVANORY_PRIVATE_ARTIFACTS), category "channel_down", which the central Worker's hourly cron emails as a
//     digest through the existing Resend account (worker/owner-alerts.mjs in the mirror). No new provider.
//
// A FULL Cloudflare outage stops this path too; it is detected from the GitHub side (watchdog reading
// p18/cf-dispatch.json, when GitHub runs it). The two paths cover each other; neither alone proves sections 9/11.
//
// Budget per invocation (Workers Free: 10 ms CPU, 50 subrequests, 6 simultaneous connections, 1000 KV ops,
// 1000 KV writes/day per account): normally 2 fetch subrequests (dispatch + heartbeat, in parallel); at minute 00
// the hourly watchdog wake-up adds 1 fetch, 1 KV read and 1 KV marker write. The primary path uses at most 1 KV
// read + 2 KV writes, hard wall budget 10 s, no retries (the next window is the retry). KV writes are bounded:
// state only on alert, on a status change (>= 15 min after the last write) or an hourly checkpoint, and never more
// than WRITE_CAP_PER_HOUR per hour (nominal 24/day, hard ceiling 144/day).
//
// The token (Worker secret P18_DISPATCH_TOKEN, fine-grained, Actions: write on this single repository) is only
// ever sent to api.github.com and never logged, stored or put in an alert.

export const P18_REPO = 'arbmsistone-lab/zevanory-public-mirror';
export const P18_WORKFLOW = 'p18-external-monitor.yml';
export const P18_WATCHDOG_WORKFLOW = 'p18-monitor-watchdog.yml';
export const P18_REF = 'gh-pages';
export const P18_DISPATCH_URL = `https://api.github.com/repos/${P18_REPO}/actions/workflows/${P18_WORKFLOW}/dispatches`;
export const P18_WATCHDOG_DISPATCH_URL = `https://api.github.com/repos/${P18_REPO}/actions/workflows/${P18_WATCHDOG_WORKFLOW}/dispatches`;
export const P18_HEARTBEAT_URL = `https://raw.githubusercontent.com/${P18_REPO}/evidence/b0-baseline/p18/heartbeat.json`;
export const HEARTBEAT_SCHEMA = 'zevanory.p18.heartbeat.v1';
export const WINDOW_MIN = 5;
export const LEGACY_DUTY_EVERY_MIN = 15;
export const DISPATCH_TIMEOUT_MS = 8_000;
export const HEARTBEAT_TIMEOUT_MS = 5_000;
export const TOTAL_BUDGET_MS = 10_000;
export const HEARTBEAT_STALE_S = 900;           // Sol: stale > 15 min
export const HEARTBEAT_FUTURE_S = 120;
export const HEARTBEAT_MAX_BYTES = 8_192;
export const MIN_ALERT_GAP_MS = 30 * 60_000;     // per check: never two alerts of the same check < 30 min apart
export const REALERT_MS = 60 * 60_000;           // same failure repeated at most hourly (digest is hourly)
export const UNCONFIGURED_REALERT_MS = 24 * 3_600_000;
export const STATE_WRITE_ON_CHANGE_MIN_MS = 15 * 60_000;
export const CHECKPOINT_MS = 60 * 60_000;
export const WRITE_CAP_PER_HOUR = 6;
export const MAX_FETCH_SUBREQUESTS = 2;
export const MAX_CRON_FETCH_SUBREQUESTS = 3;
export const STATE_KEY = 'p18-ext:v1:state';
export const WATCHDOG_STATE_KEY = 'p18-watchdog-dispatch:v1:last-hour';
export const WATCHDOG_STATE_TTL_S = 48 * 3600;
export const ALERT_PREFIX = 'zpc-alert:v1:';
export const ALERT_CATEGORY = 'channel_down';      // allow-listed by the central digest (ALLOWED_OWNER_ALERTS)
export const ALERT_CHANNEL = 'p18-monitor-externo';
export const ALERT_TTL_S = 7 * 24 * 3600;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type KvLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};

export type DispatchOutcome = 'accepted' | 'unconfigured' | 'auth' | 'forbidden' | 'not_found' | 'invalid'
  | 'rate_limited' | 'unavailable' | 'timeout' | 'network' | 'unexpected';
export type DispatchResult = {
  outcome: DispatchOutcome; http_status: number | null; run_id: number | null; run_url: string | null;
  elapsed_ms: number; retry_after_s: number | null;
};
export type HeartbeatState = 'FRESH' | 'STALE' | 'MISSING' | 'MALFORMED' | 'FUTURE' | 'UNREADABLE' | 'TIMEOUT';
export type HeartbeatResult = {
  state: HeartbeatState; http_status: number | null; age_s: number | null; last_success_at: string | null;
  window_id: string | null; run_id: string | null; dispatch_to_start_s: number | null; cache_age_s: number | null; elapsed_ms: number;
};
type CheckName = 'dispatch' | 'heartbeat';
export type CheckState = {
  status: 'ok' | 'failing'; detail: string; since: string;
  last_alert_at: string | null; last_alert_kind: 'failure' | 'recovery' | null; alert_detail: string | null;
};
export type P18State = {
  schema: 'zevanory.p18.cf-trigger-state.v1'; written_at: string; writes_hour_start: string; writes_in_hour: number;
  last_window_id: string; last_dispatch: { window_id: string; http_status: number | null; outcome: DispatchOutcome; run_id: number | null; at: string };
  last_accepted_at: string | null; last_run_id: number | null;
  checks: Record<CheckName, CheckState>;
};

const isIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) && !Number.isNaN(Date.parse(v));
const iso = (ms: number) => new Date(ms).toISOString();

export function windowStartMs(ms: number) { const p = WINDOW_MIN * 60_000; return Math.floor(ms / p) * p; }
export function windowIdOf(ms: number) {
  const s = iso(windowStartMs(ms));
  return 'p18w-' + s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 10) + 'T' + s.slice(11, 13) + s.slice(14, 16) + 'Z';
}
export function watchdogWindowIdOf(ms: number) {
  const s = iso(Math.floor(ms / 3_600_000) * 3_600_000);
  return 'p18wd-' + s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 10) + 'T' + s.slice(11, 13) + 'Z';
}
export function isWatchdogDispatchMinute(scheduledTime: number) {
  return Number.isFinite(scheduledTime) && new Date(scheduledTime).getUTCMinutes() === 0;
}
// The legacy cron duties (commercial robot tick, Meta publisher, shared activity) keep the former */15 cadence.
export function isLegacyDutyMinute(scheduledTime: number) {
  const t = Number.isFinite(scheduledTime) ? scheduledTime : Date.now();
  return new Date(t).getUTCMinutes() % LEGACY_DUTY_EVERY_MIN === 0;
}

// GitHub REST "Create a workflow dispatch event": 200 (with return_run_details) or 204 = accepted. A 403 with an
// exhausted primary/secondary rate limit (x-ratelimit-remaining: 0 or retry-after) is a rate limit, not a scope error.
export function classifyDispatch(status: number, headers?: Headers): DispatchOutcome {
  if (status === 200 || status === 204) return 'accepted';
  if (status === 401) return 'auth';
  if (status === 403) return headers?.get('x-ratelimit-remaining') === '0' || headers?.has('retry-after') ? 'rate_limited' : 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 422) return 'invalid';
  if (status === 429) return 'rate_limited';
  if (status >= 500 && status <= 599) return 'unavailable';
  return 'unexpected';
}

// Own timer + AbortController (not AbortSignal.timeout alone): the call settles at `ms` even if the dependency
// ignores the abort, so the KV record and the alert always fit inside the wall budget.
function fetchWithTimeout(fetchImpl: FetchLike, url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = Object.assign(new Error('timeout after ' + ms + ' ms'), { name: 'TimeoutError' });
      try { ctrl.abort(err); } catch { /* ignore */ }
      reject(err);
    }, ms);
  });
  return Promise.race([fetchImpl(url, { ...init, signal: ctrl.signal }), timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

function abortKind(error: unknown): 'timeout' | 'network' {
  const name = (error as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
}

export async function dispatchMonitor(opts: { token: string; windowId: string; dispatchedAt: string; fetchImpl: FetchLike; timeoutMs?: number; clock?: () => number }): Promise<DispatchResult> {
  const clock = opts.clock || Date.now;
  const t0 = clock();
  const done = (outcome: DispatchOutcome, http_status: number | null, extra: Partial<DispatchResult> = {}): DispatchResult =>
    ({ outcome, http_status, run_id: null, run_url: null, retry_after_s: null, ...extra, elapsed_ms: Math.max(0, clock() - t0) });
  if (!opts.token || !opts.windowId) return done('unconfigured', null);
  let response: Response;
  try {
    response = await fetchWithTimeout(opts.fetchImpl, P18_DISPATCH_URL, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + opts.token,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
        'user-agent': 'zevanory-control-p18-dispatch',
      },
      body: JSON.stringify({ ref: P18_REF, inputs: { window_id: opts.windowId, dispatched_at: opts.dispatchedAt, dispatch_source: 'cloudflare-cron' }, return_run_details: true }),
    }, opts.timeoutMs ?? DISPATCH_TIMEOUT_MS);
  } catch (error) {
    return done(abortKind(error), null);
  }
  const outcome = classifyDispatch(response.status, response.headers);
  const ra = Number(response.headers.get('retry-after'));
  const retry_after_s = Number.isFinite(ra) && ra >= 0 && response.headers.has('retry-after') ? Math.min(ra, 86_400) : null;
  let run_id: number | null = null, run_url: string | null = null;
  if (response.status === 200) {
    try {
      const text = (await response.text()).slice(0, 4096);
      const body = JSON.parse(text) as { workflow_run_id?: unknown; html_url?: unknown };
      if (Number.isSafeInteger(body.workflow_run_id) && Number(body.workflow_run_id) > 0) run_id = Number(body.workflow_run_id);
      if (typeof body.html_url === 'string' && body.html_url.startsWith(`https://github.com/${P18_REPO}/actions/runs/`)) run_url = body.html_url.slice(0, 200);
    } catch { /* accepted without parseable details: run id unknown, the runner start is checked on the GitHub side */ }
  } else {
    try { await response.body?.cancel(); } catch { /* ignore */ }
  }
  return done(outcome, response.status, { run_id, run_url, retry_after_s });
}

// Hourly independent wake-up for the watchdog. The workflow has no inputs; the deterministic hour window is
// therefore enforced at the caller with a KV marker before another invocation may request the same hour.
export async function dispatchWatchdog(opts: { token: string; fetchImpl: FetchLike; timeoutMs?: number; clock?: () => number }): Promise<DispatchResult> {
  const clock = opts.clock || Date.now;
  const t0 = clock();
  const done = (outcome: DispatchOutcome, http_status: number | null, extra: Partial<DispatchResult> = {}): DispatchResult =>
    ({ outcome, http_status, run_id: null, run_url: null, retry_after_s: null, ...extra, elapsed_ms: Math.max(0, clock() - t0) });
  if (!opts.token) return done('unconfigured', null);
  let response: Response;
  try {
    response = await fetchWithTimeout(opts.fetchImpl, P18_WATCHDOG_DISPATCH_URL, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + opts.token,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
        'user-agent': 'zevanory-control-p18-watchdog-dispatch',
      },
      body: JSON.stringify({ ref: P18_REF, return_run_details: true }),
    }, opts.timeoutMs ?? DISPATCH_TIMEOUT_MS);
  } catch (error) {
    return done(abortKind(error), null);
  }
  const outcome = classifyDispatch(response.status, response.headers);
  const ra = Number(response.headers.get('retry-after'));
  const retry_after_s = Number.isFinite(ra) && ra >= 0 && response.headers.has('retry-after') ? Math.min(ra, 86_400) : null;
  let run_id: number | null = null, run_url: string | null = null;
  if (response.status === 200) {
    try {
      const body = JSON.parse((await response.text()).slice(0, 4096)) as { workflow_run_id?: unknown; html_url?: unknown };
      if (Number.isSafeInteger(body.workflow_run_id) && Number(body.workflow_run_id) > 0) run_id = Number(body.workflow_run_id);
      if (typeof body.html_url === 'string' && body.html_url.startsWith(`https://github.com/${P18_REPO}/actions/runs/`)) run_url = body.html_url.slice(0, 200);
    } catch { /* accepted without parseable run details */ }
  } else {
    try { await response.body?.cancel(); } catch { /* ignore */ }
  }
  return done(outcome, response.status, { run_id, run_url, retry_after_s });
}

export type WatchdogDispatchRunResult = {
  window_id: string; due: boolean; duplicate: boolean; dispatch: DispatchResult | null;
  kv: 'ok' | 'unavailable' | 'read_failed' | 'write_failed'; fetch_subrequests: number; elapsed_ms: number;
};

export async function runHourlyWatchdogDispatch(opts: {
  env: Record<string, unknown>; scheduledTime: number; fetchImpl?: FetchLike; now?: () => number;
  log?: (line: string) => void; dispatchTimeoutMs?: number;
}): Promise<WatchdogDispatchRunResult> {
  const now = opts.now || Date.now;
  const log = opts.log || ((line: string) => console.info(line));
  const t0 = now();
  const scheduled = Number.isFinite(opts.scheduledTime) ? opts.scheduledTime : t0;
  const windowId = watchdogWindowIdOf(scheduled);
  const due = isWatchdogDispatchMinute(scheduled);
  const empty: WatchdogDispatchRunResult = { window_id: windowId, due, duplicate: false, dispatch: null, kv: 'ok', fetch_subrequests: 0, elapsed_ms: 0 };
  if (!due) return empty;
  const kv = opts.env.T2_CREATIVE_ASSETS as KvLike | undefined;
  if (!kv?.get || !kv?.put) {
    const r = { ...empty, kv: 'unavailable' as const, elapsed_ms: Math.max(0, now() - t0) };
    log('p18_watchdog_dispatch ' + JSON.stringify({ window_id: windowId, outcome: 'not_dispatched', kv: r.kv, http: null, run_id: null, ms: r.elapsed_ms }));
    return r;
  }
  let previous: string | null;
  try { previous = await kv.get(WATCHDOG_STATE_KEY); }
  catch {
    const r = { ...empty, kv: 'read_failed' as const, elapsed_ms: Math.max(0, now() - t0) };
    log('p18_watchdog_dispatch ' + JSON.stringify({ window_id: windowId, outcome: 'not_dispatched', kv: r.kv, http: null, run_id: null, ms: r.elapsed_ms }));
    return r;
  }
  if (previous === windowId) {
    const r = { ...empty, duplicate: true, elapsed_ms: Math.max(0, now() - t0) };
    log('p18_watchdog_dispatch ' + JSON.stringify({ window_id: windowId, outcome: 'duplicate', kv: r.kv, http: null, run_id: null, ms: r.elapsed_ms }));
    return r;
  }
  const token = typeof opts.env.P18_DISPATCH_TOKEN === 'string' ? opts.env.P18_DISPATCH_TOKEN.trim() : '';
  let fetches = 0;
  const dispatch = await dispatchWatchdog({
    token,
    fetchImpl: (input, init) => { fetches += 1; return (opts.fetchImpl || ((i: string, n?: RequestInit) => fetch(i, n)))(input, init); },
    timeoutMs: opts.dispatchTimeoutMs,
    clock: now,
  });
  let kvState: WatchdogDispatchRunResult['kv'] = 'ok';
  try { await kv.put(WATCHDOG_STATE_KEY, windowId, { expirationTtl: WATCHDOG_STATE_TTL_S }); }
  catch { kvState = 'write_failed'; }
  const result: WatchdogDispatchRunResult = { window_id: windowId, due, duplicate: false, dispatch, kv: kvState, fetch_subrequests: fetches, elapsed_ms: Math.max(0, now() - t0) };
  log('p18_watchdog_dispatch ' + JSON.stringify({ window_id: windowId, outcome: dispatch.outcome, kv: kvState, http: dispatch.http_status, run_id: dispatch.run_id, ms: dispatch.elapsed_ms, fetches }));
  return result;
}

export async function readHeartbeat(opts: { fetchImpl: FetchLike; nowMs: number; timeoutMs?: number; clock?: () => number }): Promise<HeartbeatResult> {
  const clock = opts.clock || Date.now;
  const t0 = clock();
  const out = (state: HeartbeatState, extra: Partial<HeartbeatResult> = {}): HeartbeatResult => ({
    state, http_status: null, age_s: null, last_success_at: null, window_id: null, run_id: null, dispatch_to_start_s: null, cache_age_s: null,
    ...extra, elapsed_ms: Math.max(0, clock() - t0),
  });
  let response: Response;
  try {
    response = await fetchWithTimeout(opts.fetchImpl, P18_HEARTBEAT_URL, {
      method: 'GET',
      headers: { accept: 'application/json, text/plain', 'cache-control': 'no-cache', 'user-agent': 'zevanory-control-p18-heartbeat' },
    }, opts.timeoutMs ?? HEARTBEAT_TIMEOUT_MS);
  } catch (error) {
    return out(abortKind(error) === 'timeout' ? 'TIMEOUT' : 'UNREADABLE');
  }
  // raw.githubusercontent.com serves Cache-Control: max-age=300 and ignores query strings, so the content can be
  // up to ~5 min older than the branch; age is computed from the content, and the CDN age is recorded beside it.
  const cacheAge = Number(response.headers.get('age') ?? response.headers.get('source-age'));
  const cache_age_s = Number.isFinite(cacheAge) && (response.headers.has('age') || response.headers.has('source-age')) ? cacheAge : null;
  if (response.status === 404) { try { await response.body?.cancel(); } catch { /* ignore */ } return out('MISSING', { http_status: 404, cache_age_s }); }
  if (response.status !== 200) { try { await response.body?.cancel(); } catch { /* ignore */ } return out('UNREADABLE', { http_status: response.status, cache_age_s }); }
  let doc: Record<string, unknown> | null = null;
  try {
    const text = await response.text();
    if (text.length > HEARTBEAT_MAX_BYTES) return out('MALFORMED', { http_status: 200, cache_age_s });
    const parsed = JSON.parse(text);
    doc = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { doc = null; }
  if (!doc || doc.schema !== HEARTBEAT_SCHEMA || !isIso(doc.last_success_at)) return out('MALFORMED', { http_status: 200, cache_age_s });
  const age_s = Math.round((opts.nowMs - Date.parse(doc.last_success_at)) / 1000);
  const extra: Partial<HeartbeatResult> = {
    http_status: 200, age_s, last_success_at: doc.last_success_at, cache_age_s,
    window_id: typeof doc.window_id === 'string' && /^p18w-\d{8}T\d{4}Z$/.test(doc.window_id) ? doc.window_id : null,
    run_id: typeof doc.run_id === 'string' && /^\d{1,20}$/.test(doc.run_id) ? doc.run_id : null,
    dispatch_to_start_s: Number.isFinite(doc.dispatch_to_start_s) ? Number(doc.dispatch_to_start_s) : null,
  };
  if (age_s < -HEARTBEAT_FUTURE_S) return out('FUTURE', extra);
  if (age_s > HEARTBEAT_STALE_S) return out('STALE', extra);
  return out('FRESH', extra);
}

// Alert text: the central digest masks e-mails and long digit runs (maskExcerpt), so no ISO timestamps or run ids
// here; ages are in minutes and the window id keeps the moment.
function failureText(check: CheckName, detail: string, d: DispatchResult, h: HeartbeatResult, windowId: string) {
  if (check === 'dispatch') {
    const what: Record<string, string> = {
      unconfigured: 'segredo P18_DISPATCH_TOKEN ausente no Worker (passo do proprietário)',
      auth: 'token recusado (401: expirado, revogado ou inválido)',
      forbidden: 'token sem permissão Actions: write neste repositório (403)',
      not_found: 'workflow ou repositório não encontrado para o token (404)',
      invalid: 'pedido recusado pelo GitHub (422: input ou ref)',
      rate_limited: 'limite da API do GitHub (429/403 com limite esgotado)',
      unavailable: 'GitHub indisponível (5xx)',
      timeout: 'GitHub não respondeu dentro de 8 s',
      network: 'falha de rede até a API do GitHub',
      unexpected: 'resposta inesperada do GitHub',
    };
    return `P18 gatilho Cloudflare: pedido de execução do monitor FALHOU (${what[detail] || detail}; HTTP ${d.http_status ?? 'sem resposta'}). Janela ${windowId}. Sem esse pedido o monitor externo depende só do agendador do GitHub, que está estrangulado.`;
  }
  const age = h.age_s === null ? 'desconhecida' : `${Math.round(h.age_s / 60)} min`;
  const what: Record<string, string> = {
    STALE: `último batimento bem-sucedido do monitor há ${age} (limite 15 min)`,
    MISSING: 'batimento do monitor inexistente no ramo de evidência (o monitor ainda não concluiu nenhuma execução)',
    MALFORMED: 'batimento do monitor malformado',
    FUTURE: 'batimento do monitor com horário no futuro',
    UNREADABLE: `batimento ilegível (HTTP ${h.http_status ?? 'sem resposta'})`,
    TIMEOUT: 'GitHub (raw) não respondeu dentro de 5 s',
  };
  return `P18 gatilho Cloudflare: monitor externo SEM batimento fresco: ${what[detail] || detail}. Pedido desta janela: ${d.outcome} (HTTP ${d.http_status ?? 'sem resposta'}). HTTP 204/200 não prova monitoramento. Janela ${windowId}.`;
}
function recoveryText(check: CheckName, windowId: string) {
  return check === 'dispatch'
    ? `P18 gatilho Cloudflare: pedido de execução do monitor voltou a ser aceito pelo GitHub. Janela ${windowId}.`
    : `P18 gatilho Cloudflare: batimento do monitor externo fresco de novo. Janela ${windowId}.`;
}

export type Decision = { state: P18State; alerts: { check: CheckName; kind: 'failure' | 'recovery'; text: string }[]; writeState: boolean; capped: boolean };

export function decide(prev: P18State | null, d: DispatchResult, h: HeartbeatResult, nowMs: number, windowId: string): Decision {
  const now = iso(nowMs);
  const observed: Record<CheckName, { failing: boolean; detail: string }> = {
    dispatch: { failing: d.outcome !== 'accepted', detail: d.outcome },
    heartbeat: { failing: h.state !== 'FRESH', detail: h.state },
  };
  const alerts: Decision['alerts'] = [];
  const checks = {} as Record<CheckName, CheckState>;
  let changed = false;
  for (const name of ['dispatch', 'heartbeat'] as CheckName[]) {
    const p = prev?.checks?.[name];
    const o = observed[name];
    const status = o.failing ? 'failing' : 'ok';
    if (!p || p.status !== status || p.detail !== o.detail) changed = true;
    const c: CheckState = {
      status, detail: o.detail, since: p && p.status === status ? p.since : now,
      last_alert_at: p?.last_alert_at ?? null, last_alert_kind: p?.last_alert_kind ?? null, alert_detail: p?.alert_detail ?? null,
    };
    const sinceAlert = c.last_alert_at ? nowMs - Date.parse(c.last_alert_at) : Infinity;
    let kind: 'failure' | 'recovery' | null = null;
    if (o.failing) {
      // Same failure already announced: repeat hourly (daily for a missing secret). New or different failure:
      // announce now, unless this check alerted < 30 min ago (flapping guard).
      const repeat = c.last_alert_kind === 'failure' && c.alert_detail === o.detail;
      const need = repeat ? (o.detail === 'unconfigured' ? UNCONFIGURED_REALERT_MS : REALERT_MS) : MIN_ALERT_GAP_MS;
      if (sinceAlert >= need) kind = 'failure';
    } else if (c.last_alert_kind === 'failure' && sinceAlert >= MIN_ALERT_GAP_MS) {
      kind = 'recovery';  // an announced failure always gets its recovery line (deferred while < 30 min)
    }
    if (kind) {
      alerts.push({ check: name, kind, text: kind === 'failure' ? failureText(name, o.detail, d, h, windowId) : recoveryText(name, windowId) });
      c.last_alert_at = now; c.last_alert_kind = kind; c.alert_detail = o.detail;
    }
    checks[name] = c;
  }
  // Write budget: one state write per alerting invocation, per status change (>= 15 min after the last write) or
  // hourly checkpoint; never more than WRITE_CAP_PER_HOUR writes (state + alert entries) per hour.
  const lastWrite = prev ? Date.parse(prev.written_at) : -Infinity;
  const hourStart = Math.floor(nowMs / 3_600_000) * 3_600_000;  // cap per UTC clock hour
  const sameHour = prev && Date.parse(prev.writes_hour_start) === hourStart;
  const used = sameHour ? prev!.writes_in_hour : 0;
  const wantWrite = alerts.length > 0 || (changed && nowMs - lastWrite >= STATE_WRITE_ON_CHANGE_MIN_MS) || nowMs - lastWrite >= CHECKPOINT_MS;
  const needed = (wantWrite ? 1 : 0) + (alerts.length ? 1 : 0);
  const capped = wantWrite && used + needed > WRITE_CAP_PER_HOUR;
  const state: P18State = {
    schema: 'zevanory.p18.cf-trigger-state.v1', written_at: now,
    writes_hour_start: iso(hourStart), writes_in_hour: used + needed,
    last_window_id: windowId,
    last_dispatch: { window_id: windowId, http_status: d.http_status, outcome: d.outcome, run_id: d.run_id, at: now },
    last_accepted_at: d.outcome === 'accepted' ? now : prev?.last_accepted_at ?? null,
    last_run_id: d.run_id ?? prev?.last_run_id ?? null,
    checks,
  };
  return { state, alerts: capped ? [] : alerts, writeState: wantWrite && !capped, capped };
}

function parseState(raw: string | null): P18State | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as P18State;
    if (s?.schema !== 'zevanory.p18.cf-trigger-state.v1' || !isIso(s.written_at) || !isIso(s.writes_hour_start) || !s.checks?.dispatch || !s.checks?.heartbeat) return null;
    return s;
  } catch { return null; }
}

export type P18RunResult = {
  window_id: string; dispatch: DispatchResult; heartbeat: HeartbeatResult; alerts: number; state_written: boolean;
  kv: 'ok' | 'unavailable' | 'read_failed' | 'write_failed' | 'capped'; fetch_subrequests: number; elapsed_ms: number; budget_exceeded: boolean;
};

// One invocation. Never throws for expected failures; the caller decides whether to surface `ok: false`.
export async function runP18ExternalTrigger(opts: {
  env: Record<string, unknown>; scheduledTime: number; fetchImpl?: FetchLike; now?: () => number; log?: (line: string) => void; budgetMs?: number;
  dispatchTimeoutMs?: number; heartbeatTimeoutMs?: number;
}): Promise<P18RunResult> {
  const now = opts.now || Date.now;
  const log = opts.log || ((line: string) => console.info(line));
  const t0 = now();
  const scheduled = Number.isFinite(opts.scheduledTime) ? opts.scheduledTime : t0;
  const windowId = windowIdOf(scheduled);
  const token = typeof opts.env.P18_DISPATCH_TOKEN === 'string' ? opts.env.P18_DISPATCH_TOKEN.trim() : '';
  const kv = opts.env.T2_CREATIVE_ASSETS as KvLike | undefined;
  let fetches = 0;
  const counted: FetchLike = (input, init) => {
    fetches += 1;
    if (fetches > MAX_FETCH_SUBREQUESTS) return Promise.reject(new Error('p18_subrequest_cap'));
    return (opts.fetchImpl || ((i: string, n?: RequestInit) => fetch(i, n)))(input, init);
  };
  let budgetExceeded = false;
  const work = (async (): Promise<P18RunResult> => {
    // Dispatch and heartbeat in parallel: 2 connections (of 6), no retries.
    const [d, h] = await Promise.all([
      dispatchMonitor({ token, windowId, dispatchedAt: iso(now()), fetchImpl: counted, clock: now, timeoutMs: opts.dispatchTimeoutMs }),
      readHeartbeat({ fetchImpl: counted, nowMs: now(), clock: now, timeoutMs: opts.heartbeatTimeoutMs }),
    ]);
    let kvState: P18RunResult['kv'] = 'ok', written = false, alertCount = 0;
    if (!kv?.get || !kv?.put) kvState = 'unavailable';
    else {
      let prevRaw: string | null = null, readOk = true;
      try { prevRaw = await kv.get(STATE_KEY); } catch { readOk = false; }
      if (!readOk) kvState = 'read_failed';  // cannot de-duplicate: write nothing (no alert storm), log only
      else {
        const dec = decide(parseState(prevRaw), d, h, now(), windowId);
        if (dec.capped) kvState = 'capped';
        try {
          if (dec.alerts.length) {
            const at = iso(now());
            await kv.put(ALERT_PREFIX + now() + ':p18-ext:' + windowId, JSON.stringify({
              channel: ALERT_CHANNEL, category: ALERT_CATEGORY, reason: dec.alerts.map(a => a.check + ':' + a.kind).join(','),
              excerpt: dec.alerts.map(a => a.text).join(' | ').slice(0, 280), at,
            }), { expirationTtl: ALERT_TTL_S });
            alertCount = dec.alerts.length;
          }
          if (dec.writeState) { await kv.put(STATE_KEY, JSON.stringify(dec.state), { expirationTtl: 30 * 24 * 3600 }); written = true; }
        } catch { kvState = 'write_failed'; }
      }
    }
    return { window_id: windowId, dispatch: d, heartbeat: h, alerts: alertCount, state_written: written, kv: kvState, fetch_subrequests: fetches, elapsed_ms: Math.max(0, now() - t0), budget_exceeded: false };
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<null>(resolve => { timer = setTimeout(() => { budgetExceeded = true; resolve(null); }, opts.budgetMs ?? TOTAL_BUDGET_MS); });
  const raced = await Promise.race([work, budget]);
  if (timer) clearTimeout(timer);
  const result: P18RunResult = raced || {
    window_id: windowId,
    dispatch: { outcome: 'timeout', http_status: null, run_id: null, run_url: null, elapsed_ms: Math.max(0, now() - t0), retry_after_s: null },
    heartbeat: { state: 'TIMEOUT', http_status: null, age_s: null, last_success_at: null, window_id: null, run_id: null, dispatch_to_start_s: null, cache_age_s: null, elapsed_ms: Math.max(0, now() - t0) },
    alerts: 0, state_written: false, kv: 'ok', fetch_subrequests: fetches, elapsed_ms: Math.max(0, now() - t0), budget_exceeded: budgetExceeded,
  };
  // One structured line per window (Workers logs / tail). Never the token.
  log('p18_ext_trigger ' + JSON.stringify({
    window_id: result.window_id, dispatch: { outcome: result.dispatch.outcome, http: result.dispatch.http_status, run_id: result.dispatch.run_id, ms: result.dispatch.elapsed_ms, retry_after_s: result.dispatch.retry_after_s },
    heartbeat: { state: result.heartbeat.state, http: result.heartbeat.http_status, age_s: result.heartbeat.age_s, window_id: result.heartbeat.window_id, run_id: result.heartbeat.run_id, dispatch_to_start_s: result.heartbeat.dispatch_to_start_s, cache_age_s: result.heartbeat.cache_age_s },
    alerts: result.alerts, state_written: result.state_written, kv: result.kv, fetches: result.fetch_subrequests, ms: result.elapsed_ms, budget_exceeded: result.budget_exceeded,
  }));
  return result;
}
