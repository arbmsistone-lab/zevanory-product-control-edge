// E3: o Worker REAL do chat do proprietário (zevanory-public-mirror, PR #1098) rodando em Node, isolado.
// Só código do Worker: handleOwnerChat + owner-pin + owner-session + injectInstitutionalChat, na mesma ordem do Worker
// central (cloudflare-worker.compat.mjs: rota do chat antes de tudo; injeção do chat público por fora de toda resposta).
// Banco: PostgreSQL 16 REAL e descartável (serviço do job), um banco novo por harness; cada consulta é um processo psql
// próprio = conexão própria e autocommit, como o driver HTTP do Neon no Worker. Sessões e tentativas de PIN vivem SÓ
// no banco (R1/O1). KV em memória com TTL (o chat só grava nele o marcador de versão).
// Tudo é fictício: PIN aleatório por execução (nunca registrado), dados de teste, nenhum acesso à produção.
// `mutation` liga UM defeito deliberado, usado só nas contraprovas negativas: cópia mutante do módulo do Worker
// (diretório temporário, nunca publicada) ou alteração da resposta HTML da página.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const PG_HOST = process.env.E3_PG_HOST || '127.0.0.1', PG_PORT = process.env.E3_PG_PORT || '5432';
const psqlArgs = (q, db) => ['-h', PG_HOST, '-p', PG_PORT, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '--csv', '-c', q];
const lit = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'boolean' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') q = false; else field += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const toObjects = (out) => { const rows = parseCsv(out.trim() ? out : ''); if (!rows.length) return []; const [h, ...d] = rows; return d.map((r) => Object.fromEntries(h.map((k, i) => [k, k === 'live' ? r[i] === 't' : r[i] === '' ? null : r[i]]))); };

// Contraprovas em módulo: [arquivo, [[trecho exato, substituto, ocorrências esperadas]...]].
const MODULE_MUTANTS = {
  'origin-off': ['owner-chat.mjs', [['&& !sameOriginApi(request, url)) return', '&& false) return', 1]]],
  'revoke-unchecked': ['owner-pin.mjs', [['catch { console.warn(JSON.stringify({ event: "owner_chat_logout_unconfirmed" })); return json({ ok: false, error: "revoke_unconfirmed" }, 503); }', 'catch { out = { pendingActions: 0 }; }', 1]]],
  'no-revoke': ['owner-session.mjs', [['set revoked_at = now() where token_sha256 = $1 and revoked_at is null`', 'set revoked_at = now() where false`', 1]]],
  'no-expiry': ['owner-session.mjs', [['and revoked_at is null and expires_at > now() for share', 'and revoked_at is null for share', 2]]],
  'no-lockout': ['owner-pin.mjs', [['if (res.ipN > PIN_IP_MAX || res.globalN > PIN_GLOBAL_MAX) {', 'if (false) {', 1]]],
  'fail-open-check': ['owner-chat.mjs', [['try { valid = await checkSession(sql, hash); } catch { valid = false; }', 'try { valid = await checkSession(sql, hash); } catch { valid = true; }', 1]]],
  'ignore-end-cookie': ['owner-chat.mjs', [['if (session && logoutPending(request) &&', 'if (false &&', 1]]],
  'logout-ignores-pending': ['owner-session.mjs', [['pendingActions = Number(p[0]?.n || 0);', 'pendingActions = 0;', 1]]],
};
// Contraprovas na página (texto exato da resposta; âncora ausente = erro, nunca um mutante sem efeito).
const PAGE_MUTANTS = {
  'no-clear': [['if(r.status===401)return fim();', '', 3]],
  'no-render-guard': [['function add(m){if(ended||!m||', 'function add(m){if(!m||', 1], ['if(ended)return;', '', -1], ['ctl.abort();', '', 1]],
  'logout-unchecked': [['confirmed=r.ok&&j.ok===true;', 'confirmed=true;', 1], ['let confirmed=false;', 'let confirmed=true;', 1]],
  'no-esc-bridge': [['window.parent.postMessage(', 'void(', 1]],
  'no-pending-lock': [['if(endOn()){sair();}else{', 'if(false){sair();}else{', 1]],
  'inject-admin': [['</body>', '<script src="/site-chat.js" defer></script></body>', 1]],
  'no-inflight-guard': [['if(inflight){again=true;return;}', '', 1]],
  'reveal-without-validation': [['openGen++;poll();', 'openGen++;log.hidden=false;poll();', 1]],
  // Consulta NÃO suspensa com o chat fechado (as duas camadas da pausa: o intervalo e a guarda da consulta).
  'poll-while-closed': [['async function poll(){if(document.hidden||ended||!shown)return;', 'async function poll(){if(document.hidden||ended)return;', 1], ['if(!open){clearInterval(iv);iv=0;log.hidden=true;', 'if(!open){log.hidden=true;', 1]],
};
const RESPONSE_MUTANTS = new Set(['frame-star', 'weak-cookie', 'csrf-off']);
export const MUTATIONS = Object.freeze([...Object.keys(MODULE_MUTANTS), ...Object.keys(PAGE_MUTANTS), ...RESPONSE_MUTANTS]);

function replaceExact(src, from, to, expected, label) {
  const n = src.split(from).length - 1;
  if (expected === -1 ? n < 1 : n !== expected) throw new Error(`âncora da contraprova ${label}: "${from}" ${n}x (esperado ${expected === -1 ? '≥1' : expected})`);
  return src.split(from).join(to);
}
async function loadChat(pmDir, mutation) {
  if (!MODULE_MUTANTS[mutation]) return import(pathToFileURL(path.resolve(pmDir, 'worker/owner-chat.mjs')).href);
  const [file, reps] = MODULE_MUTANTS[mutation];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-mutant-' + mutation + '-'));
  fs.cpSync(path.resolve(pmDir, 'worker'), path.join(dir, 'worker'), { recursive: true });
  fs.symlinkSync(path.resolve(pmDir, 'data'), path.join(dir, 'data'));
  const p = path.join(dir, 'worker', file); let s = fs.readFileSync(p, 'utf8');
  for (const [from, to, n] of reps) s = replaceExact(s, from, to, n, mutation);
  fs.writeFileSync(p, s);
  return import(pathToFileURL(path.join(dir, 'worker/owner-chat.mjs')).href);
}

export async function createHarness(pmDir, { mutation = null, withPin = true } = {}) {
  if (mutation && !MUTATIONS.includes(mutation)) throw new Error('mutação desconhecida: ' + mutation);
  const chat = await loadChat(pmDir, mutation);
  const { injectInstitutionalChat } = await import(pathToFileURL(path.resolve(pmDir, 'worker/r120-chat-institutional.mjs')).href);

  // Banco novo e vazio para este harness.
  const db = 'e3_' + crypto.randomBytes(5).toString('hex');
  execFileSync('psql', psqlArgs(`create database ${db}`, 'postgres'), { encoding: 'utf8' });
  const q1 = (q) => toObjects(execFileSync('psql', psqlArgs(q, db), { encoding: 'utf8' }));
  const n1 = (q) => Number(Object.values(q1(q)[0] || { n: 0 })[0]);

  // eslint-disable-next-line prefer-const
  let H = { dbFault: null, actionGate: null }; // preenchido abaixo; o adaptador e o KV leem as falhas dele
  let offset = 0; const now = () => Date.now() + offset;
  const data = new Map(); const kvWrites = []; let kvReads = 0;
  const live = (k) => { const e = data.get(k); if (!e) return null; if (e.exp && now() >= e.exp) { data.delete(k); return null; } return e; };
  const PAUSE_KEY = 'zpc:creative-autonomy:paused:v1';
  const kv = {
    get: async (k) => { kvReads++; return live(k)?.v ?? null; },
    put: async (k, v, o = {}) => { if (k === PAUSE_KEY && H.actionGate) await H.actionGate; kvWrites.push(k); data.set(k, { v: String(v), exp: o.expirationTtl ? now() + o.expirationTtl * 1000 : null }); },
    delete: async (k) => { data.delete(k); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...data.keys()].filter((x) => x.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
  // Falha INTERNA do banco (o adaptador lança erro na instrução, como uma queda de conexão): 'check' | 'create' |
  // 'revoke' | 'reserve' | 'pending' | 'all'.
  const FAULT_TAG = { check: 'session-check', create: 'session-create', revoke: 'session-revoke', reserve: 'pin-reserve', pending: 'session-pending' };
  const sqlLog = [];
  const sql = {
    async query(q, params = []) {
      const tag = (q.match(/\/\*owner-chat:([a-z-]+)\*\//) || [])[1] || 'ddl';
      sqlLog.push(tag);
      if (H.dbFault === 'all' || (H.dbFault && FAULT_TAG[H.dbFault] === tag)) throw new Error('e3: falha interna do banco (' + tag + ')');
      const inl = q.replace(/\$(\d+)/g, (_, n) => lit(params[Number(n) - 1]));
      const { stdout } = await run('psql', psqlArgs(inl, db), { encoding: 'utf8', maxBuffer: 1 << 24 });
      return toObjects(stdout);
    },
  };
  const pin = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  const secret = 'SEGREDO-FICTICIO-' + crypto.randomBytes(6).toString('hex');
  await chat.insertOwnerMessage(sql, { from: 'zevanory', kind: 'chat', text: 'Mensagem privada de teste: ' + secret });
  await (await import(pathToFileURL(path.resolve(pmDir, 'worker/owner-session.mjs')).href)).ensureSessionSchema(sql);
  const env = { ZEVANORY_PRIVATE_ARTIFACTS: kv, DATABASE_URL: 'e3-postgres-isolado', SITE_CHAT_ENABLED: 'true', ...(withPin ? { OWNER_CHAT_PIN: pin } : {}) };
  // Sem credencial Basic no teste: o único caminho de entrada é o PIN.
  const deps = { isAdminAuthorized: () => false, sqlFactory: () => sql, snapshot: async () => ({ day: '2026-11-26', today: [] }) };
  const log = [];
  H = { pin, secret, sql, kv, data, kvWrites, log, ip: '203.0.113.10', mutation, db,
    // Relógio: avança o KV e desloca os carimbos de tempo no banco (sessões, tentativas, ações), o equivalente a
    // passar o tempo para o relógio do PostgreSQL. Uma hora inteira também vira a janela global de tentativas.
    advance: (ms) => {
      offset += ms; const iv = `interval '${Math.round(ms)} milliseconds'`;
      q1(`update zevanory_owner_chat_sessions set created_at = created_at - ${iv}, expires_at = expires_at - ${iv}`);
      q1(`update zevanory_owner_chat_pin_attempts set last_at = last_at - ${iv}`);
      q1(`update zevanory_owner_chat_messages set action_expires_at = action_expires_at - ${iv} where action_expires_at is not null`);
      if (ms >= 3600e3) q1(`update zevanory_owner_chat_pin_attempts set k = k || '~hora-anterior' where scope = 'global'`);
    },
    sessionKeys: () => q1(`select token_sha256 from zevanory_owner_chat_sessions where revoked_at is null and expires_at > now()`).map((r) => r.token_sha256),
    sessionRows: () => n1(`select count(*) as n from zevanory_owner_chat_sessions`),
    revokeSessions: () => q1(`update zevanory_owner_chat_sessions set revoked_at = now() where revoked_at is null`),
    kvSessionKeys: () => [...data.keys()].filter((k) => k.startsWith('zpc:owner-chat:pin-session:') || k.startsWith('zpc:owner-chat:pin-fail:')),
    rowCount: () => n1(`select count(*) as n from zevanory_owner_chat_messages`),
    actionState: (id) => q1(`select action_state from zevanory_owner_chat_messages where id = ${Number(id)}`)[0]?.action_state,
    q1,
    kvReads: () => kvReads, sqlCalls: () => sqlLog.length,
    // Segura a PRÓXIMA resposta de um caminho (já calculada) até release(): simula resposta atrasada.
    holds: { feed: 0, page: 0 }, waiting: { feed: 0, page: 0 }, waiters: { feed: [], page: [] },
    holdNext: (k) => { H.holds[k]++; },
    release: (k) => { const w = H.waiters[k].splice(0); w.forEach((r) => r()); },
    // Consultas ao feed simultâneas (M1: nunca em dobro).
    feedInflight: 0, feedMaxInflight: 0,
    // Falha simulada do servidor no logout (resposta HTTP): '500' | '503' | 'hang' | null.
    logoutMode: null,
    dbFault: null,
    actionGate: null,
    addPrivate: async (text) => { await chat.insertOwnerMessage(sql, { from: 'zevanory', kind: 'chat', text }); await kv.put('zpc:owner-chat:versao:v1', crypto.randomBytes(4).toString('hex')); },
  };
  const page = (title, body) => new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });

  H.fetch = async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/admin/owner-chat/logout' && H.logoutMode) {
      log.push({ method: request.method, path: url.pathname, status: 'simulado:' + H.logoutMode, cookie: /zv_owner_chat=/.test(request.headers.get('cookie') || ''), origin: request.headers.get('origin') });
      if (H.logoutMode === 'hang') { await new Promise((r) => setTimeout(r, 20000)); return new Response('', { status: 504 }); }
      return new Response(JSON.stringify({ error: 'e3_simulado' }), { status: Number(H.logoutMode), headers: { 'content-type': 'application/json' } });
    }
    if (mutation === 'csrf-off' && request.method === 'POST' && chat.isOwnerChatPath(url.pathname)) {
      const h = new Headers(request.headers); h.set('origin', url.origin); h.set('x-owner-chat', '1');
      request = new Request(request.url, { method: 'POST', headers: h, body: await request.arrayBuffer() });
    }
    const isFeed = url.pathname === '/api/admin/owner-chat/feed';
    if (isFeed) { H.feedInflight++; H.feedMaxInflight = Math.max(H.feedMaxInflight, H.feedInflight); }
    try {
      let res;
      if (chat.isOwnerChatPath(url.pathname)) res = await chat.handleOwnerChat(request, env, deps);
      else if (url.pathname === '/solucoes' || url.pathname === '/') res = page('Página pública fictícia', '<h1>Página pública fictícia</h1>');
      else if (url.pathname === '/site-chat.js') res = new Response('window.__siteChatLoaded=true;', { headers: { 'content-type': 'text/javascript' } });
      else if (url.pathname === '/site-chat.css') res = new Response('', { headers: { 'content-type': 'text/css' } });
      else res = new Response('not found', { status: 404 });
      res = await injectInstitutionalChat(request, env, res);
      if (mutation && (PAGE_MUTANTS[mutation] || RESPONSE_MUTANTS.has(mutation))) res = await mutate(res, url);
      log.push({ method: request.method, path: url.pathname, status: res.status, cookie: /zv_owner_chat=/.test(request.headers.get('cookie') || ''), end: /zv_owner_chat_end=1/.test(request.headers.get('cookie') || ''), origin: request.headers.get('origin'), site: request.headers.get('sec-fetch-site'), at: Date.now() });
      const hk = isFeed ? 'feed' : url.pathname === '/admin/proprietario' ? 'page' : null;
      if (hk && H.holds[hk] > 0) { H.holds[hk]--; H.waiting[hk]++; await new Promise((r) => H.waiters[hk].push(r)); H.waiting[hk]--; }
      return res;
    } finally { if (isFeed) H.feedInflight--; }
  };
  async function mutate(res, url) {
    const headers = new Headers(res.headers);
    const html = /text\/html/.test(headers.get('content-type') || '');
    let body = await res.arrayBuffer();
    if (mutation === 'frame-star' && headers.has('content-security-policy')) headers.set('content-security-policy', headers.get('content-security-policy').replace(/frame-ancestors [^;]+/, 'frame-ancestors *'));
    if (mutation === 'weak-cookie') { const all = headers.getSetCookie(); headers.delete('set-cookie'); for (const c of all) headers.append('set-cookie', c.replace('; HttpOnly', '').replace('SameSite=Strict', 'SameSite=Lax')); }
    if (html && PAGE_MUTANTS[mutation] && (url.pathname === '/api/admin/owner-chat/app' || (mutation === 'inject-admin' && url.pathname.startsWith('/admin/')))) {
      let t = new TextDecoder().decode(body);
      for (const [from, to, n] of PAGE_MUTANTS[mutation]) t = replaceExact(t, from, to, n, mutation);
      body = new TextEncoder().encode(t);
      headers.delete('content-length');
    }
    return new Response(body, { status: res.status, headers });
  }
  return H;
}
