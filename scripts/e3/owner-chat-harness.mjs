// E3: o Worker REAL do chat do proprietário (zevanory-public-mirror, PR #1098) rodando em Node, isolado.
// Só código do Worker: handleOwnerChat + owner-pin + injectInstitutionalChat, na mesma ordem do Worker central
// (cloudflare-worker.compat.mjs: rota do chat antes de tudo; injeção do chat público por fora de toda resposta).
// Tudo é fictício: PIN aleatório por execução (nunca registrado), KV em memória com TTL e relógio controlável,
// banco falso dos testes do próprio Worker (tests/helpers/owner-chat-fakes.mjs), nenhum acesso à produção.
// `mutation` liga UM defeito deliberado, usado só nas contraprovas negativas.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

export const MUTATIONS = Object.freeze(['frame-star', 'no-clear', 'weak-cookie', 'no-lockout', 'inject-admin', 'no-ttl', 'csrf-off', 'no-revoke', 'no-render-guard', 'logout-unchecked', 'no-esc-bridge', 'origin-off', 'revoke-unchecked', 'no-pending-lock']);
const PAGE_MUTATIONS = new Set(['no-clear', 'inject-admin', 'no-render-guard', 'logout-unchecked', 'no-esc-bridge', 'no-pending-lock']);

export async function createHarness(pmDir, { mutation = null, withPin = true } = {}) {
  if (mutation && !MUTATIONS.includes(mutation)) throw new Error('mutação desconhecida: ' + mutation);
  const mod = (p) => import(pathToFileURL(path.resolve(pmDir, p)).href);
  // 'origin-off': cópia do Worker com a checagem de origem do CA-11 desligada (mesmo diretório, para os imports relativos).
  let chat;
  if (mutation === 'origin-off') {
    const fsx = await import('node:fs'); const src = fsx.readFileSync(path.resolve(pmDir, 'worker/owner-chat.mjs'), 'utf8');
    const anchor = '&& !sameOriginApi(request, url)) return'; if (!src.includes(anchor)) throw new Error('âncora CA-11 ausente');
    const mp = path.resolve(pmDir, 'worker/owner-chat.e3-mutant-origin-off.mjs'); fsx.writeFileSync(mp, src.replace(anchor, '&& false) return'));
    chat = await import(pathToFileURL(mp).href + '?' + Date.now()); fsx.rmSync(mp, { force: true });
  } else if (mutation === 'revoke-unchecked') {
    // CA-09.1: cópia do owner-pin que volta a confirmar o logout sem olhar o resultado da revogação.
    const fsx = await import('node:fs'); const dir = path.resolve(pmDir, 'worker'); const tag = 'e3-mutant-' + crypto.randomBytes(3).toString('hex');
    const pinSrc = fsx.readFileSync(path.join(dir, 'owner-pin.mjs'), 'utf8');
    const anchor = 'const revoked = await revokeSession(env.ZEVANORY_PRIVATE_ARTIFACTS, SESSION_PREFIX + (await sha256Hex(token)));';
    if (!pinSrc.includes(anchor)) throw new Error('âncora CA-09.1 ausente');
    fsx.writeFileSync(path.join(dir, `owner-pin.${tag}.mjs`), pinSrc.replace(anchor, anchor.replace('const revoked = ', '') + ' const revoked = true;'));
    const chatSrc = fsx.readFileSync(path.join(dir, 'owner-chat.mjs'), 'utf8');
    if (!chatSrc.includes('from "./owner-pin.mjs"')) throw new Error('import do owner-pin ausente');
    fsx.writeFileSync(path.join(dir, `owner-chat.${tag}.mjs`), chatSrc.replace('from "./owner-pin.mjs"', `from "./owner-pin.${tag}.mjs"`));
    try { chat = await import(pathToFileURL(path.join(dir, `owner-chat.${tag}.mjs`)).href); }
    finally { fsx.rmSync(path.join(dir, `owner-chat.${tag}.mjs`), { force: true }); fsx.rmSync(path.join(dir, `owner-pin.${tag}.mjs`), { force: true }); }
  } else chat = await mod('worker/owner-chat.mjs');
  const { injectInstitutionalChat } = await mod('worker/r120-chat-institutional.mjs');
  const { fakeSql } = await mod('tests/helpers/owner-chat-fakes.mjs');

  let offset = 0; const now = () => Date.now() + offset;
  const data = new Map(); const kvWrites = []; let kvReads = 0;
  const live = (k) => { const e = data.get(k); if (!e) return null; if (mutation !== 'no-ttl' && e.exp && now() >= e.exp) { data.delete(k); return null; } return e; };
  const kv = {
    get: async (k) => { kvReads++; if (mutation === 'no-lockout' && k.startsWith('zpc:owner-chat:pin-fail:')) return null; return live(k)?.v ?? null; },
    put: async (k, v, o = {}) => { kvWrites.push(k); data.set(k, { v: String(v), exp: o.expirationTtl ? now() + o.expirationTtl * 1000 : null }); },
    // kvFault (falha INTERNA do KV, não HTTP simulado): 'delete-throws' = exclusão lança erro; 'stale' = exclusão
    // aceita mas o valor continua visível (o que a consistência eventual do Workers KV faria em outro ponto de presença).
    delete: async (k) => {
      const sess = k.startsWith('zpc:owner-chat:pin-session:v1:');
      if (sess && H.kvFault === 'delete-throws') throw new Error('e3: KV indisponível na exclusão');
      if (sess && H.kvFault === 'stale') return;
      if (mutation === 'no-revoke' && sess) return; data.delete(k);
    },
  };
  const pin = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  const secret = 'SEGREDO-FICTICIO-' + crypto.randomBytes(6).toString('hex');
  const sql = fakeSql();
  await chat.insertOwnerMessage(sql, { from: 'zevanory', kind: 'chat', text: 'Mensagem privada de teste: ' + secret });
  const env = { ZEVANORY_PRIVATE_ARTIFACTS: kv, DATABASE_URL: 'e3-fake', SITE_CHAT_ENABLED: 'true', ...(withPin ? { OWNER_CHAT_PIN: pin } : {}) };
  // Sem credencial Basic no teste: o único caminho de entrada é o PIN.
  const deps = { isAdminAuthorized: () => false, sqlFactory: () => sql, snapshot: async () => ({ day: '2026-11-26', today: [] }) };
  const log = [];
  const H = { pin, secret, sql, kv, data, kvWrites, log, ip: '203.0.113.10', mutation,
    advance: (ms) => { offset += ms; },
    sessionKeys: () => [...data.keys()].filter((k) => k.startsWith('zpc:owner-chat:pin-session:v1:') && live(k)),
    revokeSessions: () => { for (const k of [...data.keys()]) if (k.startsWith('zpc:owner-chat:pin-session:v1:')) data.delete(k); },
    rowCount: () => sql.rows.length,
    kvReads: () => kvReads, sqlCalls: () => sql.log.length,
    // Segura a PRÓXIMA resposta de um caminho (já calculada) até release(): simula resposta atrasada.
    holds: { feed: 0, page: 0 }, waiting: { feed: 0, page: 0 }, waiters: { feed: [], page: [] },
    holdNext: (k) => { H.holds[k]++; },
    release: (k) => { const w = H.waiters[k].splice(0); w.forEach((r) => r()); },
    // Falha simulada do servidor no logout: '500' | '503' | 'hang' | null.
    logoutMode: null,
    kvFault: null,
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
    let res;
    if (chat.isOwnerChatPath(url.pathname)) res = await chat.handleOwnerChat(request, env, deps);
    else if (url.pathname === '/solucoes' || url.pathname === '/') res = page('Página pública fictícia', '<h1>Página pública fictícia</h1>');
    else if (url.pathname === '/site-chat.js') res = new Response('window.__siteChatLoaded=true;', { headers: { 'content-type': 'text/javascript' } });
    else if (url.pathname === '/site-chat.css') res = new Response('', { headers: { 'content-type': 'text/css' } });
    else res = new Response('not found', { status: 404 });
    res = await injectInstitutionalChat(request, env, res);
    if (mutation) res = await mutate(res, url);
    log.push({ method: request.method, path: url.pathname, status: res.status, cookie: /zv_owner_chat=/.test(request.headers.get('cookie') || ''), origin: request.headers.get('origin'), site: request.headers.get('sec-fetch-site') });
    const hk = url.pathname === '/api/admin/owner-chat/feed' ? 'feed' : url.pathname === '/admin/proprietario' ? 'page' : null;
    if (hk && H.holds[hk] > 0) { H.holds[hk]--; H.waiting[hk]++; await new Promise((r) => H.waiters[hk].push(r)); H.waiting[hk]--; }
    return res;
  };
  async function mutate(res, url) {
    const headers = new Headers(res.headers);
    const html = /text\/html/.test(headers.get('content-type') || '');
    let body = await res.arrayBuffer();
    if (mutation === 'frame-star' && headers.has('content-security-policy')) headers.set('content-security-policy', headers.get('content-security-policy').replace(/frame-ancestors [^;]+/, 'frame-ancestors *'));
    if (mutation === 'weak-cookie' && headers.has('set-cookie')) headers.set('set-cookie', headers.get('set-cookie').replace('; HttpOnly', '').replace('SameSite=Strict', 'SameSite=Lax'));
    if (html && PAGE_MUTATIONS.has(mutation) && (url.pathname.startsWith('/admin/') || url.pathname.startsWith('/api/admin/owner-chat/app'))) {
      let t = new TextDecoder().decode(body);
      if (mutation === 'no-clear') t = t.split('if(r.status===401)return fim();').join('');
      if (mutation === 'no-render-guard') t = t.replace('function add(m){if(ended||!m||', 'function add(m){if(!m||').split('if(ended)return;').join('').replace('ctl.abort();', '');
      if (mutation === 'logout-unchecked') t = t.replace('confirmed=r.ok&&j.ok===true;', 'confirmed=true;').replace('let confirmed=false;', 'let confirmed=true;');
      if (mutation === 'no-esc-bridge') t = t.split('window.parent.postMessage(').join('void(');
      if (mutation === 'no-pending-lock') t = t.replace('if(pend.on()){sair();}else{', 'if(false){sair();}else{');
      if (mutation === 'inject-admin') t = t.replace('</body>', '<script src="/site-chat.js" defer></script></body>');
      body = new TextEncoder().encode(t);
      headers.delete('content-length');
    }
    return new Response(body, { status: res.status, headers });
  }
  return H;
}
