// E3: certificação funcional integrada do chat do proprietário (painel #224 + Worker #1098), em ambiente isolado.
// Navegador: E3_BROWSER = chromium | firefox | webkit. Painel: build do candidato servido em 127.0.0.1:4173.
// Worker: PUBLIC_MIRROR_DIR aponta para o checkout do #1098. Os navegadores saem por um proxy HTTPS local
// (e3-proxy.mjs, certificado autoassinado), então cookies, SameSite, CORS, CSP e redirecionamentos são do navegador:
//   https://controle.zevanory.api.br -> build local do painel (APIs do painel com fixtures);
//   https://zevanory.api.br          -> Worker real em Node (owner-chat-harness.mjs), dados e PIN fictícios;
//   https://outro.zevanory.api.br e https://evil.example.test -> páginas atacantes do próprio teste;
//   qualquer outro host -> recusado e registrado (prova de que não há dependência de produção).
// Cada teste usa harness e contexto novos. Depois, cada contraprova liga UM defeito no Worker e exige a reprovação.
import * as pw from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHarness } from './owner-chat-harness.mjs';
import { startProxy } from './e3-proxy.mjs';

const browserName = process.env.E3_BROWSER || 'chromium';
const PM = process.env.PUBLIC_MIRROR_DIR || 'public-mirror';
const PANEL = process.env.PANEL_PREVIEW || 'http://127.0.0.1:4173';
const out = `e3-evidence/${browserName}`; fs.mkdirSync(out, { recursive: true });
let currentH = null;
let panelActive = PANEL; // contraprova do painel: build mutante (PANEL_MUTANT), sem a checagem de origem/janela
const panelApi = (pathname) => {
  if (/(^|\/)api\/admin\/bootstrap$/.test(pathname)) return [200, fixture];
  if (/(^|\/)api\/_auth_diagnostic$/.test(pathname)) return [200, { secretValid: true, locked: false, sessionRoundtrip: true, bootstrapOk: true }];
  if (/(^|\/)api\/auth\/turnstile-config$/.test(pathname)) return [200, { enabled: false, sitekey: null, action: 'zpc_owner_login' }];
  if (/\/global-trust\.json$/.test(pathname)) return [200, fixture.globalTrust];
  if (/^\/(control\/)?api\//.test(pathname)) return [404, { error: 'e3_not_mocked' }];
  return null;
};
const proxy = await startProxy(async (host, request) => {
  const u = new URL(request.url);
  if (host === 'zevanory.api.br' && u.pathname === '/__e3/form') return new Response('<!doctype html><script>fetch("/api/admin/owner-chat/message",{method:"POST",credentials:"include",headers:{"content-type":"text/plain"},body:JSON.stringify({text:"ordem forjada da mesma origem"})}).finally(()=>{window.__done=true})</script>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (host === 'zevanory.api.br' && u.pathname === '/__e3/esc-poster') return new Response('<!doctype html><script>parent.postMessage({type:"zv-owner-chat:escape"},"*")</script>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (host === 'zevanory.api.br') { const h = new Headers(request.headers); h.set('cf-connecting-ip', currentH.ip); return currentH.fetch(new Request(request.url, { method: request.method, headers: h, body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer() })); }
  if (host === 'controle.zevanory.api.br') {
    const api = panelApi(u.pathname); if (api) return new Response(JSON.stringify(api[1]), { status: api[0], headers: { 'content-type': 'application/json' } });
    const r = await fetch(panelActive + u.pathname + u.search); return new Response(await r.arrayBuffer(), { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream' } });
  }
  if (u.pathname === '/attack') return new Response(ATTACK(CHAT + '/admin/proprietario'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (u.pathname === '/esc' || u.pathname === '/__e3/esc-poster') return new Response('<!doctype html><script>parent.postMessage({type:"zv-owner-chat:escape"},"*")</script>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  return new Response('not found', { status: 404 });
});
const browser = await pw[browserName].launch({ proxy: { server: 'http://127.0.0.1:' + proxy.port } });
const fixture = { dashboard: { systems: [], audits: [], improvements: [], incidents: [], policy: { zeroSpend: true, failClosed: true, destructiveActions: false, greenRule: 'FALSE_GREEN=0' }, lastEngineRun: '2026-09-30T00:00:00Z', certificationRuns: [] }, globalTrust: { state: 'BLOCKED', sha: null, evidenceRoot: null, policyVersion: 'ZEA-10', quorum: { passed: 0, total: 3, required: 3, conflicts: 0, independentKeys: 0 }, zea10: { proven: 0, partial: 0, blocked: 10 }, engines: [], checkedAt: '2026-09-30T00:00:00Z' }, operations: null, commercial: null, cfo: null, products: [], certificationTargets: [], summary: { total: 0, salesEnabled: 0, commercialReady: 0, blocked: 0, certified: 0, inCertification: 0, zeesBlocked: 0 } };
const PANEL_URL = 'https://controle.zevanory.api.br/';
const CHAT = 'https://zevanory.api.br';
let forced = null; const mk = () => createHarness(PM, { mutation: forced });
const openContexts = [];
const ATTACK = (src) => `<!doctype html><html><head><meta charset="utf-8"><title>atacante</title></head><body><iframe id="x" src="${src}" style="width:400px;height:400px"></iframe>
<script>window.__r={};
fetch('${CHAT}/api/admin/owner-chat/feed',{credentials:'include'}).then(r=>r.text()).then(t=>{window.__r.feed='LIDO:'+t.slice(0,200)}).catch(e=>{window.__r.feed='bloqueado'});
fetch('${CHAT}/api/admin/owner-chat/message',{method:'POST',credentials:'include',mode:'no-cors',headers:{'content-type':'text/plain'},body:JSON.stringify({text:'ordem forjada'})}).then(()=>{window.__r.simplePost='enviado-sem-leitura'}).catch(()=>{window.__r.simplePost='erro'});
fetch('${CHAT}/api/admin/owner-chat/message',{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-owner-chat':'1'},body:JSON.stringify({text:'ordem forjada 2'})}).then(r=>r.text()).then(t=>{window.__r.post='LIDO:'+t.slice(0,200)}).catch(()=>{window.__r.post='bloqueado'});
</script></body></html>`;

async function ctxFor(H, { viewport = { width: 1365, height: 900 }, theme = 'dark', mobile = false } = {}) {
  currentH = H;
  const opts = { viewport, ignoreHTTPSErrors: true };
  if (mobile && browserName !== 'firefox') Object.assign(opts, { isMobile: true, hasTouch: true });
  const context = await browser.newContext(opts); openContexts.push(context); context.setDefaultTimeout(15000);
  await context.addInitScript(({ theme }) => { if (location.hostname === 'controle.zevanory.api.br') { localStorage.setItem('zpc_theme', theme); localStorage.setItem('arbm_admin_session', 'e3-fixture-session'); } }, { theme });
  const page = await context.newPage();
  return { context, page };
}
const chatFrame = (page) => page.frameLocator('.ownerChatFrame');
async function openPanel(page) {
  await page.goto(PANEL_URL); await page.locator('.zpcAppShell').waitFor({ timeout: 20000 });
  await page.locator('.ownerChatFab').click(); await page.locator('.ownerChatPanel.isOpen').waitFor();
}
async function loginInPanel(page, H) {
  await openPanel(page);
  const f = chatFrame(page); await f.locator('#p').waitFor({ timeout: 15000 });
  await f.locator('#p').fill(H.pin);
  await f.locator('#log').getByText(H.secret, { exact: false }).waitFor({ timeout: 15000 });
}
async function secretVisibleAnywhere(page, H) {
  for (const fr of page.frames()) { try { if ((await fr.evaluate(() => document.documentElement.innerText || '')).includes(H.secret)) return true; } catch {} }
  return false;
}
async function waitUntil(fn, ms = 12000, step = 250) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, step)); } return false; }

async function lateResponse(kind) {
  const H = await mk(); const { context, page } = await ctxFor(H);
  await loginInPanel(page, H);
  const late = 'SEGREDO-ATRASADO-' + Math.random().toString(16).slice(2, 10);
  H.holdNext('feed'); await H.addPrivate('Mensagem que chega atrasada: ' + late);
  assert(await waitUntil(() => H.waiting.feed > 0, 9000), 'uma consulta ficou pendente');
  H.holdNext('page');
  if (kind === 'logout') await chatFrame(page).locator('#sair').click();
  // Expiração/revogação percebidas por uma ação do dono (POST de mensagem -> 401). A consulta periódica idêntica à
  // segurada ficaria presa na trava de cache do navegador para a mesma URL; o caminho passivo já é coberto em
  // expiry_12h_boundaries e revocation_server_side.
  if (kind === 'expiry') H.advance(12 * 3600e3 + 1000);
  if (kind === 'revocation') H.revokeSessions();
  if (kind !== 'logout') { await chatFrame(page).locator('#q').fill('status'); await chatFrame(page).locator('#q').press('Enter'); }
  assert(await waitUntil(() => H.waiting.page > 0, 12000), 'navegação para o PIN pendente (documento antigo vivo)');
  assert(!(await secretVisibleAnywhere(page, H)), 'conversa apagada no encerramento');
  H.release('feed'); await page.waitForTimeout(1500);
  const leaked = [];
  for (const fr of page.frames()) { try { const t = await fr.evaluate(() => document.documentElement.innerText || ''); if (t.includes(late) || t.includes(H.secret)) leaked.push(fr.url()); } catch {} }
  assert.deepEqual(leaked, [], 'resposta atrasada voltou a desenhar conteúdo privado (' + kind + ')');
  H.release('page'); await chatFrame(page).locator('#p').waitFor({ timeout: 15000 });
  await context.close();
}
const TESTS = {
  async framing_only_panel() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    await openPanel(page); await chatFrame(page).locator('#p').waitFor({ timeout: 15000 });
    for (const attacker of ['https://evil.example.test/attack', 'https://outro.zevanory.api.br/attack']) {
      await page.goto(attacker); await page.waitForTimeout(2500);
      let rendered = 0;
      for (const fr of page.frames()) if (fr !== page.mainFrame()) { try { rendered += await fr.locator('#p, #log').count(); } catch {} }
      assert.equal(rendered, 0, 'navegador renderizou o chat dentro de origem não autorizada: ' + attacker);
    }
    const res = await H.fetch(new Request(CHAT + '/admin/proprietario'));
    assert.match(res.headers.get('content-security-policy') || '', /(^|; )frame-ancestors https:\/\/controle\.zevanory\.api\.br(;|$)/, 'CSP frame-ancestors só do painel');
    assert.equal(res.headers.get('x-frame-options'), null, 'sem x-frame-options');
    await context.close();
  },
  async pin_absent_incorrect_correct() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    // PIN não configurado no Worker: nenhuma tela de PIN, só o Basic de antes; login por PIN desligado.
    const W = await createHarness(PM, { withPin: false, mutation: forced });
    const noPin = await W.fetch(new Request(CHAT + '/admin/proprietario'));
    assert.equal(noPin.status, 401); assert.match(noPin.headers.get('www-authenticate') || '', /^Basic /); assert.doesNotMatch(await noPin.text(), /id="p"/);
    const noPinLogin = await W.fetch(new Request(CHAT + '/api/admin/owner-chat/pin', { method: 'POST', body: '{"pin":"123456"}', headers: { 'content-type': 'application/json', origin: CHAT, 'x-owner-chat': '1' } }));
    assert.equal(noPinLogin.status, 404, 'login por PIN desligado sem segredo');
    await openPanel(page); const f = chatFrame(page); await f.locator('#p').waitFor({ timeout: 15000 });
    await f.locator('#b').click(); await f.locator('#m').getByText('O PIN tem 6 números.').waitFor();
    assert.equal(H.log.filter((x) => x.path === '/api/admin/owner-chat/pin').length, 0, 'PIN ausente não chama o servidor');
    const wrong = String((Number(H.pin) + 1) % 1e6).padStart(6, '0');
    await f.locator('#p').fill(wrong); await f.locator('#m').getByText('PIN incorreto.', { exact: false }).waitFor();
    assert.equal(await f.locator('#log').count(), 0, 'PIN incorreto não entra');
    assert(!(await secretVisibleAnywhere(page, H)));
    await f.locator('#p').fill(H.pin); await f.locator('#log').getByText(H.secret, { exact: false }).waitFor({ timeout: 15000 });
    await page.screenshot({ path: `${out}/pin-correto-chat-aberto.png` });
    // Conversa funciona dentro do painel (CSRF: Origin + x-owner-chat).
    const before = H.rowCount(); await f.locator('#q').fill('status'); await f.locator('#q').press('Enter');
    assert(await waitUntil(async () => H.rowCount() >= before + 2), 'mensagem e resposta gravadas');
    await context.close();
  },
  async cookie_attributes() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    await loginInPanel(page, H);
    const c = (await context.cookies(CHAT)).find((x) => x.name === 'zv_owner_chat');
    assert(c, 'cookie de sessão presente'); assert.equal(c.httpOnly, true, 'HttpOnly'); assert.equal(c.secure, true, 'Secure'); assert.equal(c.sameSite, 'Strict', 'SameSite=Strict');
    const ttl = c.expires - Date.now() / 1000; assert(ttl > 43200 - 300 && ttl <= 43200 + 5, 'Max-Age 12 h: ' + ttl);
    assert.equal(await page.evaluate(() => document.cookie.includes('zv_owner_chat')), false, 'painel não lê o cookie');
    assert.equal(await chatFrame(page).locator('body').evaluate(() => document.cookie.includes('zv_owner_chat')), false, 'nem o JS do chat');
    assert.equal(H.sessionKeys().length, 1, 'uma sessão no KV (só o hash)');
    await context.close();
  },
  async close_reopen_and_reload_keep_session() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    await loginInPanel(page, H);
    await page.evaluate(() => { window.__frameRef = document.querySelector('.ownerChatFrame'); });
    const loads = H.log.filter((x) => x.path === '/api/admin/owner-chat/app').length;
    await page.locator('.ownerChatClose').click(); assert.equal(await page.locator('.ownerChatPanel.isOpen').count(), 0);
    await page.locator('.ownerChatFab').click(); await page.locator('.ownerChatPanel.isOpen').waitFor();
    assert(await page.evaluate(() => window.__frameRef === document.querySelector('.ownerChatFrame')), 'mesmo iframe');
    assert.equal(H.log.filter((x) => x.path === '/api/admin/owner-chat/app').length, loads, 'sem recarregar o chat');
    assert(await chatFrame(page).locator('#log').getByText(H.secret, { exact: false }).isVisible(), 'conversa preservada');
    await page.reload(); await page.locator('.zpcAppShell').waitFor(); await page.locator('.ownerChatFab').click();
    await chatFrame(page).locator('#log').getByText(H.secret, { exact: false }).waitFor({ timeout: 15000 });
    assert.equal(await chatFrame(page).locator('#p').count(), 0, 'sessão de 12 h vale depois de recarregar (cookie enviado no iframe)');
    await context.close();
  },
  async logout_clears_and_revokes() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    await loginInPanel(page, H);
    const token = (await context.cookies(CHAT)).find((x) => x.name === 'zv_owner_chat').value;
    await chatFrame(page).locator('#sair').click();
    await chatFrame(page).locator('#p').waitFor({ timeout: 15000 });
    assert(!(await secretVisibleAnywhere(page, H)), 'nada privado no DOM depois de sair');
    assert.equal((await context.cookies(CHAT)).filter((x) => x.name === 'zv_owner_chat').length, 0, 'cookie apagado');
    assert.equal(H.sessionKeys().length, 0, 'sessão apagada no KV');
    const replay = await H.fetch(new Request(CHAT + '/api/admin/owner-chat/feed', { headers: { cookie: 'zv_owner_chat=' + token } }));
    assert.equal(replay.status, 401, 'token antigo não vale mais');
    await page.screenshot({ path: `${out}/depois-de-sair.png` });
    await context.close();
  },
  async expiry_12h_boundaries() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    await loginInPanel(page, H);
    const token = (await context.cookies(CHAT)).find((x) => x.name === 'zv_owner_chat').value;
    const feed = () => H.fetch(new Request(CHAT + '/api/admin/owner-chat/feed', { headers: { cookie: 'zv_owner_chat=' + token } }));
    H.advance(12 * 3600e3 - 60e3); assert.equal((await feed()).status, 200, 'válida a 1 min do limite');
    await page.waitForTimeout(6000); assert(await secretVisibleAnywhere(page, H), 'continua aberta antes do limite');
    H.advance(61e3); assert.equal((await feed()).status, 401, 'expirada 1 s depois das 12 h');
    assert(await waitUntil(async () => !(await secretVisibleAnywhere(page, H)) && (await chatFrame(page).locator('#p').count()) === 1), 'expiração apaga a conversa e volta ao PIN (iframe montado)');
    await context.close();
  },
  async revocation_server_side() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    await loginInPanel(page, H); H.revokeSessions();
    assert(await waitUntil(async () => !(await secretVisibleAnywhere(page, H)) && (await chatFrame(page).locator('#p').count()) === 1), 'revogação apaga a conversa e volta ao PIN');
    await context.close();
  },
  async excessive_attempts() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    await openPanel(page); const f = chatFrame(page); await f.locator('#p').waitFor({ timeout: 15000 });
    const wrong = String((Number(H.pin) + 7) % 1e6).padStart(6, '0');
    for (let i = 0; i < 5; i++) { await f.locator('#p').fill(wrong); await f.locator('#m').getByText('PIN incorreto.', { exact: false }).waitFor(); await f.locator('#m').evaluate((m) => { m.textContent = ''; }); }
    await f.locator('#p').fill(H.pin); await f.locator('#m').getByText('Muitas tentativas', { exact: false }).waitFor();
    assert.equal(await f.locator('#log').count(), 0, 'PIN certo bloqueado depois de 5 erros no mesmo IP');
    H.ip = '203.0.113.11'; await f.locator('#m').evaluate((m) => { m.textContent = ''; });
    await f.locator('#p').fill(H.pin); await f.locator('#log').getByText(H.secret, { exact: false }).waitFor({ timeout: 15000 });
    // Limite global: 20 erros por hora em IPs diferentes bloqueiam qualquer login até a janela vencer.
    const H2 = await mk();
    const login = (pinv, ip) => H2.fetch(new Request(CHAT + '/api/admin/owner-chat/pin', { method: 'POST', body: JSON.stringify({ pin: pinv }), headers: { 'content-type': 'application/json', origin: CHAT, 'x-owner-chat': '1', 'cf-connecting-ip': ip } }));
    const wrong2 = String((Number(H2.pin) + 3) % 1e6).padStart(6, '0');
    for (let i = 0; i < 20; i++) assert.equal((await login(wrong2, '198.51.100.' + i)).status, 401);
    assert.equal((await login(H2.pin, '198.51.100.200')).status, 429, 'bloqueio global');
    H2.advance(3601e3); assert.equal((await login(H2.pin, '198.51.100.201')).status, 200, 'libera depois da janela');
    // Janela por IP: 15 min.
    const H3 = await mk(); const login3 = (pinv) => H3.fetch(new Request(CHAT + '/api/admin/owner-chat/pin', { method: 'POST', body: JSON.stringify({ pin: pinv }), headers: { 'content-type': 'application/json', origin: CHAT, 'x-owner-chat': '1', 'cf-connecting-ip': '192.0.2.9' } }));
    const wrong3 = String((Number(H3.pin) + 5) % 1e6).padStart(6, '0');
    for (let i = 0; i < 5; i++) await login3(wrong3);
    assert.equal((await login3(H3.pin)).status, 429); H3.advance(901e3); assert.equal((await login3(H3.pin)).status, 200, 'IP liberado depois de 15 min');
    await context.close();
  },
  async public_private_isolation() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    await page.goto(CHAT + '/solucoes'); assert.equal(await page.locator('script[src="/site-chat.js"]').count(), 1, 'página pública com o chat público');
    await page.goto(CHAT + '/admin/proprietario'); await page.locator('#p').waitFor();
    assert.equal(await page.locator('script[src="/site-chat.js"]').count(), 0, 'tela de PIN sem o chat público');
    await page.locator('#p').fill(H.pin); await page.locator('#log').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('script[src="/site-chat.js"]').count(), 0, 'chat do proprietário sem o chat público');
    assert.equal(await page.evaluate(() => window.__siteChatLoaded === true), false, 'script público não executou');
    assert.equal(H.log.filter((x) => x.path === '/site-chat.js').length, 1, 'site-chat.js só pedido pela página pública');
    await context.close();
  },
  async admin_api_protection() {
    // Navegador real (proxy, sem interceptação): (1) nenhuma resposta do chat traz Access-Control-Allow-*; (2) de outro
    // site o cookie SameSite=Strict não vai e a resposta é 401; (3) o JS atacante não lê nada (CORS do navegador);
    // (4) nenhuma ordem forjada é gravada, nem do vizinho do mesmo site (que envia o cookie).
    const H = await mk(); const { context, page } = await ctxFor(H);
    await loginInPanel(page, H); const before = H.rowCount();
    const token = (await context.cookies(CHAT)).find((x) => x.name === 'zv_owner_chat').value;
    const raw = [
      await H.fetch(new Request(CHAT + '/api/admin/owner-chat/feed', { headers: { cookie: 'zv_owner_chat=' + token, origin: 'https://evil.example.test' } })),
      await H.fetch(new Request(CHAT + '/api/admin/owner-chat/message', { method: 'OPTIONS', headers: { origin: 'https://evil.example.test', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-owner-chat' } })),
      await H.fetch(new Request(CHAT + '/api/admin/owner-chat/app', { headers: { cookie: 'zv_owner_chat=' + token, origin: 'https://evil.example.test' } })),
    ];
    for (const r of raw) for (const k of r.headers.keys()) assert(!k.startsWith('access-control-allow'), 'Worker emitiu ' + k);
    const mark = H.log.length; const seen = {};
    for (const attacker of ['https://evil.example.test/attack', 'https://outro.zevanory.api.br/attack']) {
      const p2 = await context.newPage(); await p2.goto(attacker);
      await waitUntil(() => p2.evaluate(() => window.__r && window.__r.feed && window.__r.post && window.__r.simplePost), 8000);
      seen[attacker] = await p2.evaluate(() => window.__r); await p2.close();
    }
    await page.waitForTimeout(800);
    const cross = H.log.slice(mark).filter((x) => x.path.startsWith('/api/admin/owner-chat/'));
    const evil = cross.filter((x) => x.origin === 'https://evil.example.test');
    assert(evil.length >= 1 && evil.every((x) => !x.cookie && (x.status === 403 || x.status === 401)), 'outro site: sem cookie e recusado ' + JSON.stringify(evil));
    const sibling = cross.filter((x) => x.origin === 'https://outro.zevanory.api.br');
    assert(sibling.length >= 1 && sibling.every((x) => x.status === 403), 'vizinho do mesmo site: tudo recusado no servidor (CA-11) ' + JSON.stringify(sibling));
    for (const [attacker, r] of Object.entries(seen)) { assert.equal(r.feed, 'bloqueado', 'JS de ' + attacker + ' leu o feed'); assert.equal(r.post, 'bloqueado', 'JS de ' + attacker + ' leu a resposta do POST'); }
    assert.equal(H.rowCount(), before, 'nenhuma mensagem forjada gravada');
    fs.writeFileSync(`${out}/api-protection.json`, JSON.stringify({ jsSaw: seen, serverLog: cross }, null, 2));
    await context.close();
  },
  async keyboard_focus() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    await page.goto(PANEL_URL); await page.locator('.zpcAppShell').waitFor({ timeout: 20000 });
    await page.keyboard.press('Tab'); await page.locator('.ownerChatFab').focus();
    assert(await page.locator('.ownerChatFab').evaluate((e) => e === document.activeElement && getComputedStyle(e).outlineStyle !== 'none'), 'foco visível no botão');
    await page.keyboard.press('Enter'); await page.locator('.ownerChatPanel.isOpen').waitFor();
    assert(await page.locator('.ownerChatClose').evaluate((e) => e === document.activeElement), 'foco vai para Fechar ao abrir');
    assert.equal(await page.locator('.ownerChatFab').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.ownerChatPanel.isOpen').count(), 0, 'Esc fecha');
    assert(await page.locator('.ownerChatFab').evaluate((e) => e === document.activeElement), 'foco volta ao botão');
    await page.keyboard.press('Enter'); await page.locator('.ownerChatPanel.isOpen').waitFor(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.ownerChatPanel.isOpen').count(), 0, 'Enter em Fechar fecha');
    await page.keyboard.press(' '); await page.locator('.ownerChatPanel.isOpen').waitFor();
    // Do Fechar para dentro do iframe: até 3 toques de Tab (o Firefox para primeiro no próprio documento do iframe).
    let pinFocused = false;
    for (let i = 0; i < 3 && !pinFocused; i++) { await page.keyboard.press('Tab'); pinFocused = await waitUntil(() => chatFrame(page).locator('#p').evaluate((e) => e === document.activeElement && document.hasFocus()).catch(() => false), 1000); }
    assert(pinFocused, 'Tab leva ao campo de PIN dentro do chat');
    await context.close();
  },
  async viewport_and_mobile() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    await openPanel(page); await chatFrame(page).locator('#p').waitFor({ timeout: 15000 });
    const box = () => page.locator('.ownerChatPanel').boundingBox();
    const sc = () => page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: innerWidth, sh: document.scrollingElement.scrollHeight, ih: innerHeight }));
    let b = await box(); assert(Math.abs(b.width - 420) < 1, 'desktop: painel flutuante 420px');
    for (const vp of [{ width: 375, height: 812 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(vp); await page.waitForTimeout(200); b = await box();
      assert(Math.abs(b.x) < 1 && Math.abs(b.y) < 1 && Math.abs(b.width - vp.width) < 1 && Math.abs(b.height - vp.height) < 1, 'celular: tela cheia ' + JSON.stringify(b));
      const s = await sc(); assert(s.sw <= s.iw, 'sem rolagem horizontal ' + JSON.stringify(s));
      assert.equal(await page.locator('.ownerChatFab').isVisible(), false, 'botão some com o chat aberto no celular');
      await page.screenshot({ path: `${out}/viewport-${vp.width}-aberto.png` });
    }
    await page.setViewportSize({ width: 1365, height: 900 }); await page.waitForTimeout(200); b = await box();
    assert(Math.abs(b.width - 420) < 1, 'volta a flutuante'); assert(await page.locator('.ownerChatFab').isVisible());
    // Sobreposição no estado aberto: Fechar, iframe e botão por cima de tudo nos seus centros.
    for (const sel of ['.ownerChatClose', '.ownerChatFrame', '.ownerChatFab']) assert(await page.locator(sel).evaluate((e) => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!t && (e === t || e.contains(t)); }), 'nada cobre ' + sel);
    await context.close();
    // Dispositivo móvel emulado (toque) — Firefox não emula isMobile; usa só a largura.
    const H2 = await mk(); const m = await ctxFor(H2, { viewport: { width: 390, height: 844 }, mobile: true, theme: 'light' });
    await m.page.goto(PANEL_URL); await m.page.locator('.zpcAppShell').waitFor({ timeout: 20000 });
    if (browserName !== 'firefox') await m.page.locator('.ownerChatFab').tap(); else await m.page.locator('.ownerChatFab').click();
    await m.page.locator('.ownerChatPanel.isOpen').waitFor(); await chatFrame(m.page).locator('#p').fill(H2.pin);
    await chatFrame(m.page).locator('#log').getByText(H2.secret, { exact: false }).waitFor({ timeout: 15000 });
    await m.page.screenshot({ path: `${out}/movel-390-chat.png` });
    await m.context.close();
  },
  // CA-08: resposta iniciada ANTES do fim da sessão e devolvida DEPOIS dele não pode voltar a desenhar nada privado.
  // A resposta do feed é segurada (já calculada, com uma mensagem nova) e a navegação para o PIN também é segurada,
  // para o documento antigo continuar vivo quando a resposta atrasada chega.
  async late_response_after_logout() { await lateResponse('logout'); },
  async late_response_after_expiry() { await lateResponse('expiry'); },
  async late_response_after_revocation() { await lateResponse('revocation'); },
  // CA-09: sem confirmação do servidor, a interface apaga tudo mas NÃO diz que encerrou, não volta a consultar e
  // permite tentar de novo; com confirmação, volta ao PIN e a sessão some do servidor.
  async logout_failure_modes() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    await loginInPanel(page, H); const f = chatFrame(page); const modes = [];
    for (const mode of ['500', '503', 'hang', 'offline']) {
      if (mode === 'offline') await context.setOffline(true); else H.logoutMode = mode;
      const first = modes.length === 0; modes.push(mode);
      await f.locator(first ? '#sair' : '#retry').click();
      await f.locator('#fimmsg').getByText('Não foi possível confirmar', { exact: false }).waitFor({ timeout: mode === 'hang' ? 14000 : 8000 });
      assert(!(await secretVisibleAnywhere(page, H)), 'nada privado depois de pedir para sair (' + mode + ')');
      assert.equal(await f.locator('#log > *').count(), 0, 'conversa apagada (' + mode + ')');
      assert.equal(await f.locator('#fimmsg').getByText('Sessão encerrada.', { exact: true }).count(), 0, 'não afirma encerramento sem confirmação (' + mode + ')');
      assert.equal(H.sessionKeys().length, 1, 'a sessão de fato continua no servidor (' + mode + ')');
      assert(await f.locator('#retry').isVisible(), 'oferece tentar de novo (' + mode + ')');
      const feeds = H.log.filter((x) => x.path === '/api/admin/owner-chat/feed').length;
      await page.waitForTimeout(6000);
      assert.equal(H.log.filter((x) => x.path === '/api/admin/owner-chat/feed').length, feeds, 'consulta parada, a conversa não volta sozinha (' + mode + ')');
      if (mode === 'offline') await context.setOffline(false); else H.logoutMode = null;
    }
    await page.screenshot({ path: `${out}/logout-sem-confirmacao.png` });
    await f.locator('#retry').click(); await f.locator('#p').waitFor({ timeout: 15000 });
    assert.equal(H.sessionKeys().length, 0, 'recuperação: com o servidor de volta, a sessão é encerrada');
    assert.equal((await context.cookies(CHAT)).filter((x) => x.name === 'zv_owner_chat').length, 0, 'cookie apagado');
    await context.close();
  },
  // CA-10: Esc com o foco DENTRO do chat (PIN, campo de mensagem, Enviar, Sair) fecha e devolve o foco ao botão.
  async escape_inside_chat() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    const escFrom = async (sel) => {
      if (!(await page.locator('.ownerChatPanel.isOpen').count())) { await page.locator('.ownerChatFab').click(); await page.locator('.ownerChatPanel.isOpen').waitFor(); }
      await chatFrame(page).locator(sel).focus(); await page.keyboard.press('Escape');
      assert(await waitUntil(async () => (await page.locator('.ownerChatPanel.isOpen').count()) === 0, 3000), 'Esc dentro do chat fecha (' + sel + ')');
      assert(await waitUntil(() => page.locator('.ownerChatFab').evaluate((e) => e === document.activeElement), 2000), 'foco volta ao botão (' + sel + ')');
    };
    await openPanel(page); await chatFrame(page).locator('#p').waitFor({ timeout: 15000 });
    await escFrom('#p');
    await page.locator('.ownerChatFab').click(); await chatFrame(page).locator('#p').fill(H.pin);
    await chatFrame(page).locator('#log').getByText(H.secret, { exact: false }).waitFor({ timeout: 15000 });
    for (const sel of ['#q', '#b', '#sair']) await escFrom(sel);
    await context.close();
  },
  // CA-10: o painel só aceita o aviso de Esc vindo da origem do chat E da janela do seu iframe.
  async escape_spoofing_rejected() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    await openPanel(page); await chatFrame(page).locator('#p').waitFor({ timeout: 15000 });
    const stillOpen = async (label) => { await page.waitForTimeout(1500); assert.equal(await page.locator('.ownerChatPanel.isOpen').count(), 1, 'aviso forjado fechou o chat: ' + label); };
    await page.evaluate(() => window.postMessage({ type: 'zv-owner-chat:escape' }, '*')); await stillOpen('o próprio painel');
    for (const src of ['https://outro.zevanory.api.br/esc', 'https://evil.example.test/esc', CHAT + '/__e3/esc-poster']) {
      await page.evaluate((u) => { const i = document.createElement('iframe'); i.src = u; i.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;border:0'; document.body.appendChild(i); }, src);
      await stillOpen(src);
    }
    await chatFrame(page).locator('#p').focus(); await page.keyboard.press('Escape');
    assert(await waitUntil(async () => (await page.locator('.ownerChatPanel.isOpen').count()) === 0, 3000), 'controle positivo: Esc legítimo fecha');
    await context.close();
  },
  // CA-11: origem recusada no servidor, antes de KV e banco; pedidos legítimos seguem.
  async origin_rejection() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    await loginInPanel(page, H);
    const token = (await context.cookies(CHAT)).find((x) => x.name === 'zv_owner_chat').value;
    const get = (headers) => H.fetch(new Request(CHAT + '/api/admin/owner-chat/feed', { headers: { cookie: 'zv_owner_chat=' + token, ...headers } }));
    const k0 = H.kvReads(), s0 = H.sqlCalls();
    for (const h of [{ origin: 'https://outro.zevanory.api.br' }, { 'sec-fetch-site': 'same-site' }, { origin: 'https://evil.example.test', 'sec-fetch-site': 'cross-site' }]) {
      const r = await get(h); assert.equal(r.status, 403, 'recusado: ' + JSON.stringify(h)); assert.doesNotMatch(await r.text(), new RegExp(H.secret));
    }
    assert.equal(H.kvReads(), k0, 'recusa sem ler o KV'); assert.equal(H.sqlCalls(), s0, 'recusa sem tocar no banco');
    for (const h of [{}, { 'sec-fetch-site': 'same-origin' }, { origin: CHAT, 'sec-fetch-site': 'same-origin' }]) assert.equal((await get(h)).status, 200, 'legítimo: ' + JSON.stringify(h));
    // No navegador: o vizinho do mesmo site recebe 403 já no GET do feed (antes chegava 200, barrado só pelo CORS).
    const p2 = await context.newPage(); const mark = H.log.length; await p2.goto('https://outro.zevanory.api.br/attack');
    await waitUntil(() => p2.evaluate(() => window.__r && window.__r.feed && window.__r.post && window.__r.simplePost), 8000); await p2.close();
    const sib = H.log.slice(mark).filter((x) => x.origin === 'https://outro.zevanory.api.br' && x.path.startsWith('/api/admin/owner-chat/'));
    assert(sib.length >= 1 && sib.every((x) => x.status === 403), 'vizinho do mesmo site: 403 em tudo ' + JSON.stringify(sib));
    // A conversa legítima no painel continua funcionando.
    const before = H.rowCount(); await chatFrame(page).locator('#q').fill('status'); await chatFrame(page).locator('#q').press('Enter');
    assert(await waitUntil(async () => H.rowCount() >= before + 2), 'chat legítimo segue funcionando');
    await context.close();
  },
  // CSRF (independente do CA-11): mesmo vindo da própria origem (p. ex. uma página pública comprometida em
  // zevanory.api.br), POST sem o cabeçalho x-owner-chat é recusado e nada é gravado.
  async csrf_header_required() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    await loginInPanel(page, H); const before = H.rowCount(); const mark = H.log.length;
    const p2 = await context.newPage(); await p2.goto(CHAT + '/__e3/form');
    await waitUntil(() => p2.evaluate(() => window.__done === true), 8000); await p2.close();
    const posts = H.log.slice(mark).filter((x) => x.path === '/api/admin/owner-chat/message');
    assert(posts.length >= 1 && posts.every((x) => x.cookie && x.status === 403), 'POST da mesma origem sem x-owner-chat recusado ' + JSON.stringify(posts));
    assert.equal(H.rowCount(), before, 'nada gravado');
    await context.close();
  },
  async kv_and_commercial_untouched() {
    const H = await mk(); const { context, page } = await ctxFor(H);
    await loginInPanel(page, H); await chatFrame(page).locator('#q').fill('vendas'); await chatFrame(page).locator('#q').press('Enter'); await page.waitForTimeout(1500);
    await chatFrame(page).locator('#sair').click(); await chatFrame(page).locator('#p').waitFor();
    const bad = H.kvWrites.filter((k) => !/^zpc:owner-chat:(pin-session|pin-fail|versao)/.test(k));
    assert.deepEqual(bad, [], 'chat só grava chaves próprias no KV (nada de vendas, interruptores ou publicadores)');
    await context.close();
  },
};
// Contraprova -> teste que deve reprovar com o defeito ligado.
const NEGATIVES = [['frame-star', 'framing_only_panel'], ['no-revoke', 'logout_clears_and_revokes'], ['no-clear', 'expiry_12h_boundaries'], ['no-clear', 'revocation_server_side'], ['weak-cookie', 'cookie_attributes'], ['no-lockout', 'excessive_attempts'], ['inject-admin', 'public_private_isolation'], ['no-ttl', 'expiry_12h_boundaries'], ['csrf-off', 'csrf_header_required'], ['no-render-guard', 'late_response_after_logout'], ['no-render-guard', 'late_response_after_expiry'], ['no-render-guard', 'late_response_after_revocation'], ['logout-unchecked', 'logout_failure_modes'], ['no-esc-bridge', 'escape_inside_chat'], ['origin-off', 'origin_rejection'], ['origin-off', 'admin_api_protection'], ['panel:no-origin-check', 'escape_spoofing_rejected']];

const results = { browser: browserName, version: browser.version(), positives: {}, negatives: {} };
// Diagnóstico de falha: captura de cada página aberta, URLs dos frames e cookies (sem valores).
async function diagnose(name) {
  const d = [];
  for (const [ci, c] of openContexts.entries()) for (const [pi, pg] of c.pages().entries()) {
    try { await pg.screenshot({ path: `${out}/FALHA-${name}-${ci}-${pi}.png` }); } catch {}
    d.push({ url: pg.url(), frames: pg.frames().map((f) => f.url()), cookies: (await c.cookies().catch(() => [])).map((k) => ({ name: k.name, domain: k.domain, sameSite: k.sameSite, httpOnly: k.httpOnly, secure: k.secure })) });
  }
  return d;
}
const closeAll = async () => { while (openContexts.length) await openContexts.pop().close().catch(() => {}); };
const ONLY = (process.env.E3_ONLY || '').split(',').filter(Boolean);
for (const [name, fn] of Object.entries(TESTS)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const t = Date.now();
  try { await fn(); results.positives[name] = { pass: true, ms: Date.now() - t }; }
  catch (e) {
    results.positives[name] = { pass: false, ms: Date.now() - t, error: String(e && e.message || e).slice(0, 500), diag: await diagnose(name) };
  }
  await closeAll();
  console.log((results.positives[name].pass ? 'PASS ' : 'FAIL ') + name + (results.positives[name].error ? ' :: ' + results.positives[name].error : ''));
  if (results.positives[name].diag) console.log('DIAG ' + name + ' ' + JSON.stringify(results.positives[name].diag));
}
for (const [mutation, name] of NEGATIVES) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const panelMut = mutation.startsWith('panel:');
  if (panelMut && !process.env.PANEL_MUTANT) { results.negatives[mutation + '->' + name] = { detected: false, error: 'PANEL_MUTANT ausente' }; console.log('MISSED ' + mutation + ' -> ' + name + ' :: PANEL_MUTANT ausente'); continue; }
  forced = panelMut ? null : mutation; if (panelMut) panelActive = process.env.PANEL_MUTANT; const t = Date.now();
  let failed = false, error = null;
  try { await TESTS[name](); } catch (e) { failed = true; error = String(e && e.message || e).slice(0, 300); }
  forced = null; panelActive = PANEL; await closeAll();
  results.negatives[mutation + '->' + name] = { detected: failed, ms: Date.now() - t, error };
  console.log((failed ? 'DETECTED ' : 'MISSED ') + mutation + ' -> ' + name + (error ? ' :: ' + error : ''));
}
results.refusedNonFixtureHosts = [...proxy.refused];
console.log('REFUSED_HOSTS ' + JSON.stringify(results.refusedNonFixtureHosts));
const okP = Object.values(results.positives).every((x) => x.pass);
const okN = Object.values(results.negatives).every((x) => x.detected);
results.status = okP && okN ? 'PASS' : 'FAIL';
fs.writeFileSync(`${out}/report.json`, JSON.stringify(results, null, 2));
console.log(`OWNER_CHAT_E3_${browserName.toUpperCase()}=${results.status} positives=${Object.values(results.positives).filter((x) => x.pass).length}/${Object.keys(TESTS).length} negatives=${Object.values(results.negatives).filter((x) => x.detected).length}/${NEGATIVES.length} refused=${proxy.refused.size}`);
await browser.close(); proxy.close();
process.exit(results.status === 'PASS' ? 0 : 1);
