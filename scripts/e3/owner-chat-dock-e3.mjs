// E3-D: Epaminondas FIXO na coluna esquerda do painel, sem PIN separado (27/11/2026), em ambiente isolado.
// Mesmo arranjo da E3 (owner-chat-e3.mjs): proxy HTTPS local; https://controle.zevanory.api.br = build local do painel com
// APIs de fixture, MAS o passe do chat (/api/owner/chat/ticket) é assinado de verdade com a chave fictícia da ponte;
// https://zevanory.api.br = Worker real em Node (owner-chat-harness.mjs) com PostgreSQL 16 real e descartável.
// Prova: layout (coluna, sem sobreposição, sem rolagem da página, campo Enviar visível com histórico longo; claro e
// escuro; telas grandes, médias, estreitas e celular com teclado), sessão sem PIN, troca de seção, recarga, renovação,
// saída do painel (revogação no servidor na hora), sessão do painel vencida (sem passe = sem acesso em até 5 min),
// acesso direto bloqueado e postMessage de outra origem ignorado. Capturas em e3-dock-evidence/<navegador>/.
import * as pw from 'playwright';
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createHarness } from './owner-chat-harness.mjs';
import { startProxy } from './e3-proxy.mjs';

const browserName = process.env.E3_BROWSER || 'chromium';
const PM = process.env.PUBLIC_MIRROR_DIR || 'public-mirror';
const PANEL = process.env.PANEL_PREVIEW || 'http://127.0.0.1:4173';
const out = `e3-dock-evidence/${browserName}`; fs.mkdirSync(out, { recursive: true });
const BRIDGE_KEY = 'ponte-ficticia-' + crypto.randomBytes(24).toString('hex');
const PANEL_URL = 'https://controle.zevanory.api.br/';
const CHAT = 'https://zevanory.api.br';
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let currentH = null;
let panelBase = PANEL;
const panelState = { sessionValid: true, sessionExp: Date.now() + 8 * 3600e3, tickets: 0, jti: crypto.randomUUID(), issued: [] };
function mint() {
  const ts = String(Date.now()), nonce = b64u(crypto.randomBytes(32)), exp = String(panelState.sessionExp);
  const sid = b64u(crypto.createHash('sha256').update('zpc-owner-chat-sid:' + panelState.jti).digest());
  const sig = b64u(crypto.createHmac('sha256', BRIDGE_KEY).update(['zpc-owner-chat-v1', 'session', ts, nonce, exp, sid].join('\n')).digest());
  const t = { ts, nonce, exp, sid, sig }; panelState.issued.push(t); return t;
}
const fixture = JSON.parse(fs.readFileSync(new URL('./owner-chat-dock-fixture.json', import.meta.url), 'utf8'));
function commandCenterFixture() {
  const at = new Date().toISOString(), day = at.slice(0, 10);
  const m = (value, definition, source = 'Fixture E3-D') => ({ value, source, updatedAt: at, definition, integrity: 'real' });
  return {
    generatedAt: at, day, goals: [], revenue: {},
    funnel: { visitors7: m(0, 'Pessoas reais em 7 dias'), views7: m(0, 'Visualizações em 7 dias'), leads7: m(0, 'Leads em 7 dias'), views30: m(0, 'Visualizações em 30 dias'),
      intents30: m(0, 'Intenção de compra em 30 dias'), sales30: m(0, 'Vendas em 30 dias'), sources: {}, pages: [] },
    acquisition: { reachAt: at, channels: [], youtubeRecent: [], history: [], publications: { expected: 6, published: 0, pct: 0, perChannel: {} }, today: [] },
    autonomy: { runs: null, agenda: [], ownerOnly: [] },
    operations: { probes: [{ url: 'https://zevanory.api.br/', http: 200, ms: 120, ok: true }, { url: 'https://vendas.zevanory.api.br/', http: 200, ms: 140, ok: true }, { url: 'https://controle.zevanory.api.br/', http: 200, ms: 110, ok: true }],
      salesSwitch: { open: false }, checkoutMode: 'hotmart-direct', deploys: [] },
    forecast: { status: 'insufficient', reason: 'Fixture E3-D: sem histórico de vendas' },
    recommendations: [],
  };
}
const panelApi = (pathname, body) => {
  if (/(^|\/)api\/owner\/chat\/ticket$/.test(pathname)) {
    if (!panelState.sessionValid || body?.sessionToken !== 'e3-fixture-session') return [401, { error: 'unauthorized' }];
    panelState.tickets++; return [200, { ticket: mint() }];
  }
  if (/(^|\/)api\/admin\/bootstrap$/.test(pathname)) return [200, fixture];
  // Visão Geral carregada (captura do desktop pedida na contra-auditoria de 27/11): consolidado FICTÍCIO marcado como tal,
  // no estado real de hoje (nenhuma venda). Exige a mesma sessão do painel que o passe do chat.
  if (/(^|\/)api\/owner\/command-center$/.test(pathname)) {
    if (!panelState.sessionValid || body?.sessionToken !== 'e3-fixture-session') return [401, { error: 'unauthorized' }];
    return [200, { ok: true, snapshot: commandCenterFixture(), sales: null, servedAt: new Date().toISOString() }];
  }
  if (/(^|\/)api\/_auth_diagnostic$/.test(pathname)) return [200, { secretValid: true, locked: false, sessionRoundtrip: true, bootstrapOk: true }];
  if (/(^|\/)api\/auth\/turnstile-config$/.test(pathname)) return [200, { enabled: false, sitekey: null, action: 'zpc_owner_login' }];
  if (/(^|\/)api\/pin\/logout$/.test(pathname)) { panelState.sessionValid = false; return [200, { ok: true }]; }
  if (/\/global-trust\.json$/.test(pathname)) return [200, fixture.globalTrust];
  if (/^\/(control\/)?api\//.test(pathname)) return [404, { error: 'e3_not_mocked' }];
  return null;
};
const proxy = await startProxy(async (host, request) => {
  const u = new URL(request.url);
  if (host === 'zevanory.api.br') { const h = new Headers(request.headers); h.set('cf-connecting-ip', currentH.ip); return currentH.fetch(new Request(request.url, { method: request.method, headers: h, body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer() })); }
  if (host === 'controle.zevanory.api.br') {
    let body = null; if (request.method === 'POST') { try { body = JSON.parse(await request.text()); } catch {} }
    const api = panelApi(u.pathname, body); if (api) return new Response(JSON.stringify(api[1]), { status: api[0], headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    const r = await fetch(panelBase + u.pathname + u.search); return new Response(await r.arrayBuffer(), { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream' } });
  }
  if (host === 'evil.example.test') return new Response(`<!doctype html><iframe id="x" src="${PANEL_URL}" style="width:1300px;height:800px"></iframe>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  return new Response('not found', { status: 404 });
});
const browser = await pw[browserName].launch({ proxy: { server: 'http://127.0.0.1:' + proxy.port } });
const mk = () => createHarness(PM, { bridgeKey: BRIDGE_KEY });
const contexts = [];
async function ctxFor(H, { viewport = { width: 1920, height: 1080 }, theme = 'dark', mobile = false, clock = false } = {}) {
  currentH = H; panelState.sessionValid = true; panelState.sessionExp = Date.now() + 8 * 3600e3; panelState.jti = crypto.randomUUID(); panelState.issued = [];
  const opts = { viewport, ignoreHTTPSErrors: true };
  if (mobile && browserName !== 'firefox') Object.assign(opts, { isMobile: true, hasTouch: true });
  const context = await browser.newContext(opts); contexts.push(context); context.setDefaultTimeout(15000);
  await context.addInitScript(({ theme }) => { if (location.hostname === 'controle.zevanory.api.br') { localStorage.setItem('zpc_theme', theme); localStorage.setItem('arbm_admin_session', 'e3-fixture-session'); } }, { theme });
  const page = await context.newPage();
  if (clock) await page.clock.install();
  return { context, page };
}
const frame = (page) => page.frameLocator('.ownerChatFrame');
async function openPanel(page, H) {
  await page.goto(PANEL_URL); await page.locator('.zpcAppShell').waitFor({ timeout: 20000 });
  // Até 900px o chat é a 1ª área do seletor (fora da vista nas outras áreas, mas já conectado).
  if (page.viewportSize().width <= 900) await page.locator('.areaSelectWrap select').selectOption('owner-chat');
  await frame(page).locator('#log').getByText(H.secret, { exact: false }).waitFor({ timeout: 20000 });
}
async function waitUntil(fn, ms = 12000, step = 250) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, step)); } return false; }
const rect = (loc) => loc.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; });
const overlaps = (a, b) => a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;

async function longHistory(H, n = 40) { for (let i = 0; i < n; i++) await H.addPrivate(`Mensagem de teste ${i + 1}: o monitor do GitHub voltou a receber dados; esta frase é longa de propósito para quebrar a linha na coluna estreita sem cortar nada.`); }

async function checkLayout(page, label) {
  const vp = page.viewportSize();
  const pageScroll = await page.evaluate(() => ({ sh: document.scrollingElement.scrollHeight, ih: innerHeight, sw: document.scrollingElement.scrollWidth, iw: innerWidth }));
  assert(pageScroll.sh <= pageScroll.ih + 1 && pageScroll.sw <= pageScroll.iw + 1, `${label}: página sem rolagem (${JSON.stringify(pageScroll)})`);
  const dock = await rect(page.locator('.ownerChatDock'));
  assert(dock.h >= 180 && dock.w >= 150, `${label}: chat com tamanho útil (${dock.w}x${dock.h})`);
  assert(dock.x >= 0 && dock.y >= 0 && dock.r <= vp.width + 0.5 && dock.b <= vp.height + 0.5, `${label}: chat inteiro na tela`);
  const navVisible = await page.locator('.zpcNavGroup').isVisible();
  if (navVisible) {
    const sistema = await rect(page.locator('.zpcNavGroup .tab', { hasText: 'Sistema' }));
    assert(dock.y >= sistema.b, `${label}: chat abaixo de "Sistema"`);
    for (const t of ['Visão Geral', 'Produtos', 'Comercial', 'Conteúdo', 'Atendimento', 'Financeiro', 'Evidências', 'Sistema']) assert(await page.locator('.zpcNavGroup .tab', { hasText: t }).isVisible(), `${label}: menu "${t}" visível`);
    const nav = await rect(page.locator('.zpcNavigation'));
    assert(dock.x >= nav.x - 0.5 && dock.r <= nav.r + 0.5, `${label}: chat dentro da coluna`);
  }
  for (const sel of ['main.shell', '.premiumShellTopbar', '.trustStrip', '.areaSelectWrap']) {
    const loc = page.locator(sel).first();
    if (await loc.count() && await loc.isVisible()) assert(!overlaps(dock, await rect(loc)), `${label}: chat não cobre ${sel}`);
  }
  const f = frame(page);
  const inner = await f.locator('body').evaluate(() => { const q = (s) => document.querySelector(s).getBoundingClientRect(); const f = q('form'), i = q('#q'), b = q('#b'), l = document.getElementById('log');
    return { form: [f.top, f.bottom], ih: innerHeight, iw: innerWidth, input: [i.left, i.right], btn: [b.left, b.right, b.bottom], logScroll: l.scrollHeight > l.clientHeight, bodyScroll: document.scrollingElement.scrollHeight <= innerHeight + 1, hscroll: document.scrollingElement.scrollWidth <= innerWidth + 1 }; });
  assert(inner.form[1] <= inner.ih + 0.5 && inner.btn[2] <= inner.ih + 0.5 && inner.btn[1] <= inner.iw + 0.5, `${label}: campo e Enviar visíveis na base (${JSON.stringify(inner)})`);
  assert(inner.bodyScroll && inner.hscroll, `${label}: só a lista de mensagens rola`);
  return inner;
}

const T = {};
T.layout_reference_and_sizes = async () => {
  const H = await mk(); await longHistory(H);
  for (const theme of ['dark', 'light']) for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720]]) {
    const { context, page } = await ctxFor(H, { viewport: { width: w, height: h }, theme });
    await openPanel(page, H);
    const inner = await checkLayout(page, `${w}x${h} ${theme}`);
    assert(inner.logScroll, `${w}x${h}: histórico longo rola dentro da lista`);
    assert.equal(await frame(page).locator('html').getAttribute('data-theme'), theme, 'chat segue o tema do painel');
    // Visão Geral CARREGADA ao lado do chat (não "Central indisponível").
    await page.getByText('Vendas hoje').first().waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(await page.getByText('Central indisponível').count(), 0, `${w}x${h}: Visão Geral carregada`);
    await page.screenshot({ path: `${out}/layout-${w}x${h}-${theme}.png` });
    await context.close();
  }
};
T.layout_narrow_and_phone = async () => {
  const H = await mk(); await longHistory(H, 20);
  for (const [w, h, mobile] of [[1100, 800, false], [1024, 768, false], [768, 1024, true], [390, 844, true]]) for (const theme of ['dark', 'light']) {
    const { context, page } = await ctxFor(H, { viewport: { width: w, height: h }, theme, mobile });
    await openPanel(page, H);
    await page.screenshot({ path: `${out}/layout-${w}x${h}-${theme}.png` });
    await checkLayout(page, `${w}x${h} ${theme}`);
    if (w <= 900) {
      await frame(page).locator('#q').fill('rascunho no celular');
      await page.screenshot({ path: `${out}/layout-${w}x${h}-${theme}-chat-aberto.png` });
      await page.locator('.areaSelectWrap select').selectOption('overview'); await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/layout-${w}x${h}-${theme}-outra-area.png` });
      assert(await page.locator('main.shell').isVisible(), `${w}: outra área volta a aparecer`);
      await page.locator('.areaSelectWrap select').selectOption('owner-chat'); await page.waitForTimeout(300);
      assert.equal(await frame(page).locator('#q').inputValue(), 'rascunho no celular', `${w}: texto preservado ao trocar de área`);
    }
    if (w === 390) { // teclado aberto: a área visível encolhe ~45%
      await frame(page).locator('#q').focus(); await page.setViewportSize({ width: 390, height: 464 });
      await page.waitForTimeout(300); await checkLayout(page, `390x464 teclado ${theme}`);
      await page.screenshot({ path: `${out}/layout-390-teclado-${theme}.png` });
    }
    await context.close();
  }
};
T.session_without_pin_and_server_validation = async () => {
  const H = await mk(); const { page } = await ctxFor(H);
  await openPanel(page, H);
  assert.equal(await frame(page).locator('input#p, input[inputmode=numeric]').count(), 0, 'nenhum campo de PIN');
  assert.equal(await page.locator('.ownerChatFab, .ownerChatClose').count(), 0, 'sem botão de abrir nem de fechar');
  assert.equal(H.sessionKeys().length, 1, 'uma sessão do chat, criada pelo passe');
  await frame(page).locator('#q').fill('status'); await frame(page).locator('#q').press('Enter');
  assert(await waitUntil(async () => (await frame(page).locator('#log').innerText()).includes('Publicações de hoje')), 'envio e resposta validados no servidor');
  const exp = H.q1(`select extract(epoch from (expires_at - created_at))::int as ttl from zevanory_owner_chat_sessions where revoked_at is null`)[0].ttl;
  assert.equal(exp, '300', 'sessão do chat de 5 min');
};
T.section_switch_keeps_chat_and_draft = async () => {
  const H = await mk(); const { page } = await ctxFor(H);
  await openPanel(page, H);
  await frame(page).locator('body').evaluate(() => { window.__e3Marker = 'mesmo-documento'; });
  await frame(page).locator('#q').fill('rascunho que não pode sumir');
  for (const t of ['Produtos', 'Comercial', 'Sistema', 'Visão Geral']) { await page.locator('.zpcNavGroup .tab', { hasText: t }).click(); await page.waitForTimeout(250); }
  assert.equal(await frame(page).locator('body').evaluate(() => window.__e3Marker), 'mesmo-documento', 'iframe não recarregou');
  assert.equal(await frame(page).locator('#q').inputValue(), 'rascunho que não pode sumir', 'texto digitado preservado');
  assert(await frame(page).locator('#log').getByText(H.secret, { exact: false }).isVisible(), 'conversa continua');
};
T.reload_returns_ready = async () => {
  const H = await mk(); const { page } = await ctxFor(H);
  await openPanel(page, H); await page.reload(); await page.locator('.zpcAppShell').waitFor();
  await frame(page).locator('#log').getByText(H.secret, { exact: false }).waitFor({ timeout: 20000 });
  assert.equal(await frame(page).locator('#st').innerText(), 'ao vivo');
};
T.renewal_rotates_session = async () => {
  const H = await mk(); const { page } = await ctxFor(H, { clock: true });
  await openPanel(page, H);
  const first = H.sessionKeys(); assert.equal(first.length, 1);
  const before = panelState.tickets;
  await page.clock.runFor(121_000);
  const ok = await waitUntil(() => { const k = H.sessionKeys(); return k.length === 1 && k[0] !== first[0]; }, 20000);
  assert(ok, 'renovação: sessão nova e a anterior revogada ' + JSON.stringify({ tickets: panelState.tickets - before, keys: H.sessionKeys().length, renewals: H.log.filter((x) => x.path === '/api/admin/owner-chat/panel-session') }));
};
T.panel_logout_revokes_now = async () => {
  const H = await mk(); const { page } = await ctxFor(H);
  await openPanel(page, H); assert.equal(H.sessionKeys().length, 1);
  const cookie = (await page.context().cookies(CHAT)).find((c) => c.name === 'zv_owner_chat');
  await page.locator('.zpcHeaderActions button', { hasText: 'Sair' }).click();
  assert(await waitUntil(() => H.sessionKeys().length === 0, 6000), 'sessão do chat revogada no servidor ao sair do painel');
  const r = await H.fetch(new Request(CHAT + '/api/admin/owner-chat/feed', { headers: { cookie: 'zv_owner_chat=' + cookie.value } }));
  assert.equal(r.status, 401, 'cookie antigo não lê mais nada');
};
T.ticket_issued_before_logout_cannot_restore = async () => {
  const H = await mk(); const { page } = await ctxFor(H);
  await openPanel(page, H);
  const early = mint(); // passe da MESMA sessão do painel, emitido antes da saída e ainda não usado
  await page.locator('.zpcHeaderActions button', { hasText: 'Sair' }).click();
  assert(await waitUntil(() => H.sessionKeys().length === 0, 6000), 'sessão do chat revogada na saída');
  const r = await H.fetch(new Request(CHAT + '/api/admin/owner-chat/panel-session', { method: 'POST', body: JSON.stringify(early), headers: { origin: CHAT, 'x-owner-chat': '1', 'content-type': 'application/json' } }));
  assert.equal(r.status, 401, 'passe anterior à saída recusado'); assert.deepEqual(await r.json(), { error: 'panel_session_ended' });
  assert.equal(H.sessionKeys().length, 0, 'nenhuma sessão reaberta');
};
T.two_tabs_logout_ends_all_even_during_renewal = async () => {
  const H = await mk(); const { context, page } = await ctxFor(H);
  await openPanel(page, H);
  const page2 = await context.newPage(); await openPanel(page2, H); // 2ª aba, mesmo login do painel
  assert(H.sessionKeys().length >= 1, 'sessões abertas');
  const renew = mint(); // renovação da aba 2 correndo junto com a saída na aba 1
  const [, rs] = await Promise.all([
    page.locator('.zpcHeaderActions button', { hasText: 'Sair' }).click(),
    frame(page2).locator('body').evaluate(async (t) => (await fetch('/api/admin/owner-chat/panel-session', { method: 'POST', headers: { 'content-type': 'application/json', 'x-owner-chat': '1' }, body: JSON.stringify(t) })).status, renew),
  ]);
  assert(await waitUntil(() => H.sessionKeys().length === 0, 8000), 'nenhuma sessão daquele login vale depois da saída (renovação: ' + rs + ')');
  const st = await frame(page2).locator('body').evaluate(async () => (await fetch('/api/admin/owner-chat/feed', { cache: 'no-store' })).status);
  assert.equal(st, 401, 'a 2ª aba perde a leitura na hora');
  const send = await frame(page2).locator('body').evaluate(async () => (await fetch('/api/admin/owner-chat/message', { method: 'POST', headers: { 'content-type': 'application/json', 'x-owner-chat': '1' }, body: JSON.stringify({ text: 'status' }) })).status);
  assert.equal(send, 401, 'a 2ª aba não envia');
};
T.panel_session_expired_loses_access_within_5min = async () => {
  const H = await mk(); const { page } = await ctxFor(H);
  await openPanel(page, H);
  panelState.sessionValid = false; // sessão do painel vencida/revogada: a borda não dá mais passe
  H.advance(301_000);
  assert(await waitUntil(async () => !(await frame(page).locator('body').innerText()).includes(H.secret), 15000), 'conversa some sem passe');
  assert.equal(H.sessionKeys().length, 0, 'nenhuma sessão válida');
  assert(await waitUntil(async () => /sessão do painel acabou|Conectando ao painel/.test(await frame(page).locator('body').innerText()), 15000), 'tela pede o painel, não PIN');
};
T.direct_access_blocked = async () => {
  const H = await mk(); const { page } = await ctxFor(H);
  await page.goto(CHAT + '/admin/proprietario');
  await page.getByText('O Epaminondas abre dentro do painel').waitFor();
  assert(!(await page.content()).includes(H.secret), 'nada privado');
  for (const [p, m] of [['/api/admin/owner-chat/feed', 'GET'], ['/api/admin/owner-chat/message', 'POST'], ['/api/admin/owner-chat/action', 'POST']]) {
    const s = await page.evaluate(async ([p, m]) => (await fetch(p, { method: m, headers: { 'content-type': 'application/json', 'x-owner-chat': '1' }, body: m === 'POST' ? '{}' : undefined })).status, [p, m]);
    assert.equal(s, 401, p + ' sem sessão');
  }
  assert.equal(H.sessionKeys().length, 0);
};
T.foreign_origin_cannot_feed_ticket = async () => {
  const H = await mk(); const { page } = await ctxFor(H);
  await page.goto(CHAT + '/admin/proprietario'); // documento de topo, sem painel
  await page.evaluate(() => window.postMessage({ type: 'zv-owner-chat:ticket', ticket: { ts: '1', nonce: 'x', exp: '1', sig: 'y' } }, '*'));
  await page.waitForTimeout(800);
  assert.equal(H.sessionKeys().length, 0, 'mensagem de outra origem/janela ignorada');
};

const results = { browser: browserName, positives: {} };
for (const [name, fn] of Object.entries(T).filter(([n]) => !process.env.E3_ONLY || process.env.E3_ONLY.split(',').includes(n))) {
  const t = Date.now(); let error = null;
  try { await fn(); } catch (e) { error = String(e?.message || e).slice(0, 600); }
  for (const c of contexts.splice(0)) await c.close().catch(() => {});
  results.positives[name] = { pass: !error, ms: Date.now() - t, error };
  console.log((error ? 'FAIL ' : 'PASS ') + name + (error ? ' :: ' + error : ''));
}
// Contraprova do painel: build mutante em que "Sair" NÃO encerra o chat (PANEL_MUTANT_NO_END). A saída precisa reprovar.
results.negatives = {};
if (process.env.PANEL_MUTANT_NO_END) {
  panelBase = process.env.PANEL_MUTANT_NO_END; let detected = false, error = null;
  try { await T.panel_logout_revokes_now(); } catch (e) { detected = true; error = String(e?.message || e).slice(0, 300); }
  for (const c of contexts.splice(0)) await c.close().catch(() => {});
  panelBase = PANEL; results.negatives['panel:no-end-session->panel_logout_revokes_now'] = { detected, error };
  console.log((detected ? 'DETECTED ' : 'MISSED ') + 'panel:no-end-session -> panel_logout_revokes_now');
}
results.refusedNonFixtureHosts = [...proxy.refused];
results.status = Object.values(results.positives).every((x) => x.pass) && Object.values(results.negatives).every((x) => x.detected) ? 'PASS' : 'FAIL';
fs.writeFileSync(`${out}/report.json`, JSON.stringify(results, null, 2));
console.log(`OWNER_CHAT_DOCK_E3_${browserName.toUpperCase()}=${results.status} positives=${Object.values(results.positives).filter((x) => x.pass).length}/${Object.keys(T).length}`);
await browser.close(); proxy.close();
process.exit(results.status === 'PASS' ? 0 : 1);
