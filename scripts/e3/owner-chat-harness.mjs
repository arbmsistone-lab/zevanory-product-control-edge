// E3: o Worker REAL do chat do proprietário (zevanory-public-mirror, PR #1098) rodando em Node, isolado.
// Só código do Worker: handleOwnerChat + owner-pin + injectInstitutionalChat, na mesma ordem do Worker central
// (cloudflare-worker.compat.mjs: rota do chat antes de tudo; injeção do chat público por fora de toda resposta).
// Tudo é fictício: PIN aleatório por execução (nunca registrado), KV em memória com TTL e relógio controlável,
// banco falso dos testes do próprio Worker (tests/helpers/owner-chat-fakes.mjs), nenhum acesso à produção.
// `mutation` liga UM defeito deliberado, usado só nas contraprovas negativas.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

export const MUTATIONS = Object.freeze(['frame-star', 'no-clear', 'weak-cookie', 'no-lockout', 'inject-admin', 'no-ttl', 'csrf-off', 'no-revoke']);

export async function createHarness(pmDir, { mutation = null, withPin = true } = {}) {
  if (mutation && !MUTATIONS.includes(mutation)) throw new Error('mutação desconhecida: ' + mutation);
  const mod = (p) => import(pathToFileURL(path.resolve(pmDir, p)).href);
  const chat = await mod('worker/owner-chat.mjs');
  const { injectInstitutionalChat } = await mod('worker/r120-chat-institutional.mjs');
  const { fakeSql } = await mod('tests/helpers/owner-chat-fakes.mjs');

  let offset = 0; const now = () => Date.now() + offset;
  const data = new Map(); const kvWrites = [];
  const live = (k) => { const e = data.get(k); if (!e) return null; if (mutation !== 'no-ttl' && e.exp && now() >= e.exp) { data.delete(k); return null; } return e; };
  const kv = {
    get: async (k) => { if (mutation === 'no-lockout' && k.startsWith('zpc:owner-chat:pin-fail:')) return null; return live(k)?.v ?? null; },
    put: async (k, v, o = {}) => { kvWrites.push(k); data.set(k, { v: String(v), exp: o.expirationTtl ? now() + o.expirationTtl * 1000 : null }); },
    delete: async (k) => { if (mutation === 'no-revoke' && k.startsWith('zpc:owner-chat:pin-session:v1:')) return; data.delete(k); },
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
  };
  const page = (title, body) => new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });

  H.fetch = async (request) => {
    const url = new URL(request.url);
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
    log.push({ method: request.method, path: url.pathname, status: res.status, cookie: /zv_owner_chat=/.test(request.headers.get('cookie') || ''), origin: request.headers.get('origin') });
    return res;
  };
  async function mutate(res, url) {
    const headers = new Headers(res.headers);
    const html = /text\/html/.test(headers.get('content-type') || '');
    let body = await res.arrayBuffer();
    if (mutation === 'frame-star' && headers.has('content-security-policy')) headers.set('content-security-policy', headers.get('content-security-policy').replace(/frame-ancestors [^;]+/, 'frame-ancestors *'));
    if (mutation === 'weak-cookie' && headers.has('set-cookie')) headers.set('set-cookie', headers.get('set-cookie').replace('; HttpOnly', '').replace('SameSite=Strict', 'SameSite=Lax'));
    if (html && (mutation === 'no-clear' || (mutation === 'inject-admin' && url.pathname.startsWith('/admin/') || mutation === 'inject-admin' && url.pathname.startsWith('/api/admin/owner-chat/app')))) {
      let t = new TextDecoder().decode(body);
      if (mutation === 'no-clear') t = t.split('if(r.status===401)return fim();').join('');
      if (mutation === 'inject-admin') t = t.replace('</body>', '<script src="/site-chat.js" defer></script></body>');
      body = new TextEncoder().encode(t);
      headers.delete('content-length');
    }
    return new Response(body, { status: res.status, headers });
  }
  return H;
}
