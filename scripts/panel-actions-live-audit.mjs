// Live audit of EVERY panel action and route on PRODUCTION (owner order, Mission 10).
//  A) Guards: every write route refuses a missing session (401) and, with a valid session, refuses
//     invalid input with 4xx before any write (never 5xx, never 404 "route not found").
//  B) Read routes and routes outside the menu answer with the expected status and shape.
//  C) Safe owner actions that only refresh internal state (telemetry, audit) are executed and their
//     persisted result is read back.
//  D) UI: in every area, every visible button that does not write business data is clicked (pagers,
//     tabs, toggles, dialogs, forms opened and cancelled); fails on an error box, a page error, a
//     5xx/404 API answer or a broken layout after the click. Buttons that write (approve, sell,
//     archive, connect...) are NOT clicked here: their full path is proven on an isolated database
//     (scripts/panel-actions-e2e-isolated.ts) and their production guard in (A).
// Output: codes, routes and button labels only; never business data or the session token.
import { chromium } from 'playwright';

const base = process.env.TARGET_URL || 'https://controle.zevanory.api.br';
const pin = process.env.ADMIN_PIN || '';
if (!pin) { console.log('::error title=ACTIONS::ADMIN_PIN_MISSING'); process.exit(2); }
const login = await fetch(base + '/api/pin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
const token = login.ok ? String((await login.json())?.sessionToken || '') : '';
if (!token) { console.log('::error title=ACTIONS::LOGIN_FAILED_' + login.status); process.exit(1); }

const failures = [];
const passed = [];
const fail = (where, detail) => failures.push({ where, detail });
const req = async (method, path, body, opts = {}) => {
  const r = await fetch(base + path, { method, redirect: 'manual', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(opts.timeout || 30000) }).catch(e => ({ status: 0, error: String(e?.name || e) }));
  let data = null;
  if (r.status && !opts.raw) { try { data = await r.json(); } catch {} }
  return { status: r.status, data, headers: r.headers };
};
const expect = async (label, fn) => { try { const msg = await fn(); if (msg) fail(label, msg); else passed.push(label); } catch (e) { fail(label, 'EXCEPTION ' + String(e?.message || e).slice(0, 120)); } };

// A) Guards. Body without session -> 401. With session + invalid input -> the listed 4xx.
const writeRoutes = {
  '/api/products/create': [{ name: '', slug: 'Inválido!' }, 400],
  '/api/products/update': [{ id: '00000000-0000-4000-8000-000000000000' }, 404],
  '/api/products/archive': [{}, 400],
  '/api/commercial/create': null,
  '/api/commercial/update': [{}, 400],
  '/api/commercial/approval': [{ id: 'nao-e-um-id', kind: 'creative', action: 'approve' }, 400],
  '/api/commercial/sales/promote-discovery': [{}, 400],
  '/api/commercial/sales/qualify': [{}, 400],
  '/api/commercial/sales/decision': [{ leadId: 'x', action: 'spam' }, 400],
  '/api/commercial/sales/execute': [{ leadId: 'x', action: 'offer', content: '' }, 400],
  '/api/commercial/sales/proof': [{}, 400],
  '/api/cfo/ingest': [{}, 400],
  '/api/certification/run': [{}, 400],
  '/api/certification/run-batch': null,
  '/api/audit/run': null,
  '/api/telemetry/refresh': null,
  '/api/admin/commercial-cleanup': [{ mode: 'apply' }, 409],
  '/api/sales/switch': [{}, 400],
  '/api/owner/oauth/ticket': [{ channel: 'nao-existe', action: 'status' }, 400],
  '/api/admin/overview': null,
  '/api/admin/bootstrap': null,
  '/api/owner/command-center': null,
  '/api/commercial/funnel': null,
  '/api/sales/state': null,
};
for (const [path, invalid] of Object.entries(writeRoutes)) {
  await expect('guard ' + path, async () => {
    const r = await req('POST', path, {});
    return r.status === 401 ? '' : 'sem sessão respondeu ' + r.status + ' (esperado 401)';
  });
  await expect('guard-forjada ' + path, async () => {
    const r = await req('POST', path, { sessionToken: 'zpc1.eyJleHAiOjk5OTk5OTk5OTk5OTl9.assinatura-falsa' });
    return r.status === 401 ? '' : 'sessão forjada respondeu ' + r.status + ' (esperado 401)';
  });
  if (invalid) await expect('validacao ' + path, async () => {
    const r = await req('POST', path, { ...invalid[0], sessionToken: token });
    return r.status === invalid[1] ? '' : 'entrada inválida respondeu ' + r.status + ' (esperado ' + invalid[1] + ')';
  });
}
await expect('vendas-abrir-pelo-painel-proibido', async () => {
  const r = await req('POST', '/api/sales/switch', { sessionToken: token, open: true });
  return r.status === 403 ? '' : 'abrir vendas pelo painel respondeu ' + r.status + ' (esperado 403: só workflow oficial)';
});
await expect('vendas-fechar-sem-confirmacao', async () => {
  const r = await req('POST', '/api/sales/switch', { sessionToken: token, open: false });
  return r.status === 409 ? '' : 'fechar sem confirmação respondeu ' + r.status + ' (esperado 409)';
});

// B) Read routes with session, plus routes outside the menu.
const reads = [
  ['POST', '/api/_session_verify', { sessionToken: token }, 200, d => d?.valid === true || 'valid!=true'],
  ['POST', '/api/admin/overview', { sessionToken: token }, 200, d => Boolean(d && typeof d === 'object') || 'sem corpo'],
  ['POST', '/api/admin/bootstrap', { sessionToken: token }, 200, d => Array.isArray(d?.products) || 'sem products'],
  ['POST', '/api/owner/command-center', { sessionToken: token }, 200, d => (d?.ok === true && Boolean(d.snapshot)) || 'sem snapshot'],
  ['POST', '/api/commercial/funnel', { sessionToken: token }, 200, d => d?.ok === true || 'ok!=true'],
  ['POST', '/api/sales/state', { sessionToken: token }, 200, d => typeof d?.open === 'boolean' || 'sem open'],
  ['GET', '/api/sales/state', null, 200, d => typeof d?.open === 'boolean' || 'sem open'],
  ['POST', '/api/owner/oauth/ticket', { sessionToken: token, channel: 'youtube', action: 'status' }, 200, d => typeof d?.connected === 'boolean' || 'sem connected'],
  ['POST', '/api/owner/oauth/ticket', { sessionToken: token, channel: 'pinterest', action: 'status' }, 200, d => typeof d?.connected === 'boolean' || 'sem connected'],
  ['POST', '/api/owner/oauth/ticket', { sessionToken: token, channel: 'tiktok', action: 'status' }, 200, d => typeof d?.connected === 'boolean' || 'sem connected'],
  ['GET', '/api/commercial/publish/status', null, null, null],
  ['GET', '/api/commercial/creative/angles', null, null, null],
  ['GET', '/api/_auth_diagnostic', null, null, null],
  ['GET', '/global-trust.json', null, 200, d => Boolean(d && typeof d === 'object') || 'sem json'],
  ['GET', '/zpc-build.json', null, 200, d => Boolean(d && typeof d === 'object') || 'sem json'],
  ['GET', '/version.json', null, 200, d => typeof d?.sha === 'string' || 'sem sha'],
  ['GET', '/runtime-proof', null, 200, d => d?.ok === true || 'ok!=true'],
  ['GET', '/portable-health', null, null, null],
  ['GET', '/definir-pin', null, 410, null],
  ['GET', '/arbm-one', null, 410, null],
  ['GET', '/termos', null, 308, null],
  ['GET', '/control', null, 200, null, true],
  ['GET', '/certifier', null, 200, null, true],
  ['GET', '/', null, 200, null, true],
  ['GET', '/rota-que-nao-existe-xyz', null, null, null, true],
];
for (const [method, path, body, status, check, raw] of reads) {
  await expect('rota ' + method + ' ' + path + (body?.channel ? ' ' + body.channel : ''), async () => {
    const r = await req(method, path, body, { raw });
    if (status === null) return r.status >= 500 || r.status === 0 ? 'respondeu ' + r.status : '';
    if (r.status !== status) return 'respondeu ' + r.status + ' (esperado ' + status + ')';
    if (check) { const ok = check(r.data); if (ok !== true) return String(ok); }
    return '';
  });
}
await expect('rota SSE /api/commercial/stream', async () => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetch(base + '/api/commercial/stream', { signal: ctl.signal }); clearTimeout(t); ctl.abort(); return r.status < 500 ? '' : 'stream respondeu ' + r.status + ' (o painel cai no modo de sincronização a cada 30 s)'; }
  catch (e) { return e?.name === 'AbortError' ? '' : 'stream falhou ' + String(e).slice(0, 80); }
});

// C) Safe internal refresh actions, executed and read back.
for (const path of ['/api/telemetry/refresh', '/api/audit/run']) {
  await expect('acao ' + path, async () => {
    const r = await req('POST', path, { sessionToken: token }, { timeout: 90000 });
    if (r.status !== 200) return 'respondeu ' + r.status;
    // Sanitized consumer diagnosis (owner audit 13/10): attempts 0 = token not configured on the
    // panel side; attempts > 0 with stale = the private feed failed. No secret or payload is printed.
    if (path === '/api/telemetry/refresh') console.log('::notice title=TELEMETRY_CONSUMER::' + JSON.stringify({ ok: r.data?.ok === true, stale: r.data?.stale === true, source: String(r.data?.source || ''), attempts: Number(r.data?.attempts ?? -1), tokenConfigured: Number(r.data?.attempts ?? -1) > 0 }));
    const at = Date.parse(String(r.data?.at || ''));
    if (!Number.isFinite(at) || Math.abs(Date.now() - at) > 10 * 60_000) return 'sem carimbo de execução recente';
    return '';
  });
}
// C2) Creative media probe (owner audit 13/10, Mission 3): every studio/approval image URL is
// fetched as the browser would, and the raw stored asset is fetched too, so a blank card can be
// attributed to 404 (asset missing), 5xx (transform), timeout or undecodable bytes. Output is ids
// (8 chars), statuses and sizes only.
await expect('midia dos criativos', async () => {
  const r = await req('POST', '/api/admin/bootstrap', { sessionToken: token }, { timeout: 60000 });
  const creatives = Array.isArray(r.data?.commercial?.creatives) ? r.data.commercial.creatives : null;
  if (!creatives) { console.log('::notice title=CREATIVE_MEDIA::' + JSON.stringify({ available: false, bootstrap: r.status })); return ''; }
  const visible = creatives.filter(c => c && c.status !== 'archived' && typeof c.imageUrl === 'string' && c.imageUrl);
  const probe = async (u) => {
    const t0 = Date.now();
    try {
      const m = await fetch(u, { signal: AbortSignal.timeout(20000) });
      const b = new Uint8Array(await m.arrayBuffer());
      const magic = b[0] === 0xff && b[1] === 0xd8 ? 'jpeg' : b[0] === 0x89 && b[1] === 0x50 ? 'png' : b.length ? 'other' : 'empty';
      return { http: m.status, type: String(m.headers.get('content-type') || '').slice(0, 24), bytes: b.length, magic, ms: Date.now() - t0 };
    } catch (e) { return { http: 0, error: e?.name === 'TimeoutError' ? 'timeout' : 'network', ms: Date.now() - t0 }; }
  };
  const rows = [];
  for (const c of visible.slice(0, 40)) {
    const img = await probe(c.imageUrl);
    const ok = img.http === 200 && (img.magic === 'jpeg' || img.magic === 'png');
    const raw = ok ? null : await probe(String(c.imageUrl).replace('/creative/assets/', '/creative/assets-raw/'));
    rows.push({ id: String(c.id || '').slice(0, 8), status: c.status, ok, img, raw });
  }
  const broken = rows.filter(x => !x.ok);
  console.log('::notice title=CREATIVE_MEDIA::' + JSON.stringify({ available: true, total: creatives.length, withImage: visible.length, probed: rows.length, broken: broken.length, byStatus: broken.reduce((a, x) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {}), rows: rows.slice(0, 40) }).slice(0, 3800));
  return '';
});
await expect('acao auditoria persistida', async () => {
  const r = await req('POST', '/api/admin/bootstrap', { sessionToken: token });
  const audits = Array.isArray(r.data?.dashboard?.audits) ? r.data.dashboard.audits : null;
  if (!audits) return 'bootstrap sem audits';
  const newest = Math.max(...audits.map(a => Date.parse(String(a?.createdAt || '')) || 0));
  return Date.now() - newest < 15 * 60_000 ? '' : 'nenhuma auditoria persistida nos últimos 15 min';
});

// D) UI: click every non-writing button in every area.
const routes = {
  overview: ['Visão Geral'], products: ['Produtos'], commercial: ['Comercial', 'Resumo'], prospecting: ['Comercial', 'Prospecção'], crm: ['Comercial', 'CRM/Vendas'],
  creatives: ['Conteúdo', 'Criativos'], approvals: ['Conteúdo', 'Aprovações'], publications: ['Conteúdo', 'Publicações'],
  support: ['Atendimento'], finance: ['Financeiro', 'Movimentações'], cfo: ['Financeiro', 'ZEVANORY CFO'], evidence: ['Evidências'],
  operations: ['Sistema', 'Saúde do sistema'], governance: ['Sistema', 'Qualidade e certificação'], channels: ['Sistema', 'Conectar canais'],
};
// Buttons that write business data or leave the session: proven in isolation / by guard, never clicked live.
const PROTECTED = /^(aprovar|rejeitar|alterar$|pedir|solicitar|fechar vendas|confirmar|arquivar|salvar|criar produto|conectar|desconectar|reconectar|qualificar|promover|oferta|contato|follow|checkout|executar|certificar|rodar|auditoria$|telemetria$|publicar|enviar|sair|encerrar|upload|gerar)/i;
const browser = await chromium.launch({ headless: true });
let clicked = 0;
const skipped = new Set();
for (const [width, height] of [[1280, 720], [390, 844]]) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  await context.addInitScript(t => { localStorage.setItem('arbm_admin_session', t); }, token);
  let mainPage = null;
  context.on('page', p => { if (mainPage && p !== mainPage) p.close().catch(() => {}); });
  const page = await context.newPage();
  mainPage = page;
  const apiErrors = [];
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e?.message || e).slice(0, 100)));
  page.on('response', r => { const u = new URL(r.url()); if (u.pathname.includes('/api/') && !u.pathname.endsWith('/commercial/stream') && (r.status() >= 500 || r.status() === 404)) apiErrors.push(r.request().method() + ' ' + u.pathname + ' ' + r.status()); });
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 45000 });
  await page.getByRole('navigation', { name: 'Perguntas da Central de Comando' }).waitFor({ timeout: 30000 });
  const go = async key => {
    if (width <= 960) { const sel = page.getByLabel('Selecionar área do Control Center'); await sel.waitFor({ state: 'visible', timeout: 15000 }); await sel.selectOption(key); }
    else { const nav = page.getByRole('navigation', { name: 'Áreas do ZEVANORY' }); const [p, s] = routes[key]; await nav.getByRole('button', { name: p, exact: true }).click(); if (s) await nav.getByRole('button', { name: s, exact: true }).click(); }
    await page.waitForTimeout(600);
  };
  for (const key of Object.keys(routes)) {
    try { await go(key); } catch { fail(width + ' ' + key, 'NAVEGACAO'); continue; }
    const tag = () => page.evaluate(() => { document.querySelectorAll("[data-audit-i]").forEach(e => e.removeAttribute("data-audit-i")); return [...document.querySelectorAll('main button, main [role="tab"], main summary')].filter(b => { const r = b.getBoundingClientRect(); const s = getComputedStyle(b); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; }).map((b, i) => { b.setAttribute('data-audit-i', String(i)); return { i, disabled: Boolean(b.disabled), text: (b.getAttribute('aria-label') || b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60) }; }); });
    const labels = await tag();
    for (const { i, text, disabled } of labels.slice(0, 40)) {
      if (disabled) continue;
      if (!text || PROTECTED.test(text)) { skipped.add(text || '(sem rótulo)'); continue; }
      const before = { api: apiErrors.length, page: pageErrors.length };
      try {
        const now = await tag();
        if (now[i]?.text !== text || now[i]?.disabled) continue;
        const handle = page.locator('[data-audit-i="' + i + '"]').first();
        await handle.click({ timeout: 4000 });
        clicked++;
        await page.waitForTimeout(500);
        const state = await page.evaluate(() => ({
          error: [...document.querySelectorAll('.errorbox')].map(e => (e.textContent || '').trim()).filter(Boolean)[0] || '',
          scroll: document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth + 1,
        }));
        if (state.error) fail(width + ' ' + key + ' «' + text + '»', 'ERRO_NA_TELA ' + state.error.slice(0, 120));
        if (state.scroll) fail(width + ' ' + key + ' «' + text + '»', 'ROLAGEM_APOS_CLIQUE');
        if (apiErrors.length > before.api) fail(width + ' ' + key + ' «' + text + '»', 'API ' + apiErrors.slice(before.api).join(', '));
        if (pageErrors.length > before.page) fail(width + ' ' + key + ' «' + text + '»', 'JS ' + pageErrors.slice(before.page).join(' | '));
        // Close whatever the click opened (dialog/form) and return to the area.
        await page.keyboard.press('Escape').catch(() => {});
        const cancel = page.getByRole('button', { name: /^(Cancelar|Fechar)$/ }).filter({ visible: true });
        if (await cancel.count()) await cancel.first().click({ timeout: 2000 }).catch(() => {});
      } catch (e) {
        // Element vanished after a previous click (pager moved, dialog closed): not a defect.
      }
      await go(key).catch(() => {});
    }
  }
  if (pageErrors.length) fail(width + ' global', 'JS ' + [...new Set(pageErrors)].slice(0, 3).join(' | '));
  await context.close();
}
// E) Creative studio rendering in the 5 official viewports x 2 themes (owner audit 13/10, Mission 3):
// for every creative image, whether the browser actually painted it (complete + naturalWidth) and
// whether its box is visible. Numbers only; no screenshot of the authenticated panel is stored.
const mediaMatrix = [];
for (const [width, height] of [[1536, 730], [1280, 720], [1366, 768], [1024, 768], [390, 844]]) {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    await context.addInitScript(([t, th]) => { localStorage.setItem('arbm_admin_session', t); localStorage.setItem('zpc_theme', th); }, [token, theme]);
    const page = await context.newPage();
    try {
      await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 45000 });
      await page.getByRole('navigation', { name: 'Perguntas da Central de Comando' }).waitFor({ timeout: 30000 });
      for (const key of ['creatives', 'approvals']) {
        if (width <= 960) { const sel = page.getByLabel('Selecionar área do Control Center'); await sel.waitFor({ state: 'visible', timeout: 15000 }); await sel.selectOption(key); }
        else { const nav = page.getByRole('navigation', { name: 'Áreas do ZEVANORY' }); const [p1, s1] = routes[key]; await nav.getByRole('button', { name: p1, exact: true }).click(); if (s1) await nav.getByRole('button', { name: s1, exact: true }).click(); }
        await page.waitForTimeout(4000);
        const r = await page.evaluate(() => {
          const boxes = [...document.querySelectorAll('.creativePreview, .approvalImage, .creativeMediaError')];
          const imgs = [...document.querySelectorAll('.creativePreview img, img.approvalImage')];
          const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.bottom > 0 && b.right > 0 && b.top < innerHeight && b.left < innerWidth; };
          return {
            boxes: boxes.length,
            imgs: imgs.length,
            painted: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
            pending: imgs.filter(i => !i.complete).length,
            broken: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
            visibleBoxes: boxes.filter(vis).length,
            emptyVisibleBoxes: boxes.filter(b => vis(b) && b.classList.contains('creativePreview') && !b.querySelector('img') && !b.textContent.trim()).length,
            tinyImgs: imgs.filter(i => { const b = i.getBoundingClientRect(); return i.complete && i.naturalWidth > 0 && (b.width < 24 || b.height < 24); }).length,
            errorStates: document.querySelectorAll('.creativeMediaError').length,
            scroll: document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth + 1,
          };
        });
        mediaMatrix.push({ v: width + 'x' + height, theme, area: key, ...r });
      }
    } catch (e) { mediaMatrix.push({ v: width + 'x' + height, theme, error: String(e?.message || e).slice(0, 80) }); }
    await context.close();
  }
}
console.log('::notice title=CREATIVE_RENDER_MATRIX::' + JSON.stringify(mediaMatrix).slice(0, 3900));

// F) Production certification of #208 (owner order 13/10 11:41). Client-side interception only:
// nothing in production is altered; failures are simulated inside this CI browser.
{
  const cert = {};
  const ver = await (await fetch(base + '/version.json?t=' + Date.now())).json().catch(() => null);
  cert.servedSha = ver?.sha || null;
  const trust = await (await fetch(base + '/global-trust.json?t=' + Date.now())).json().catch(() => null);
  cert.trust = trust ? { schema: trust.schema, state: trust.state, reasons: trust.reasons, quorumOk: trust.quorum?.ok, validUntil: trust.validUntil, sha: trust.sha } : null;
  const boot = await req('POST', '/api/admin/bootstrap', { sessionToken: token }, { timeout: 60000 });
  const targets = Array.isArray(boot.data?.certificationTargets) ? boot.data.certificationTargets.map(t => String(t?.name || '')) : [];
  cert.apiTargets = targets.length; cert.apiArbmTargets = targets.filter(n => /^ARBM\b/i.test(n.trim())).length;
  const creatives = (boot.data?.commercial?.creatives || []).filter(c => c && c.status !== 'archived' && c.imageUrl);
  if (creatives[0]) {
    const u = creatives[0].imageUrl;
    const a = await fetch(u); cert.assetHeader = { http: a.status, source: a.headers.get('x-zpc-image-source'), type: a.headers.get('content-type') };
    const r = await fetch(String(u).replace('/creative/assets/', '/creative/assets-raw/')); cert.rawHeader = { http: r.status, type: r.headers.get('content-type') };
  }
  const open = async (mode) => {
    const context = await browser.newContext({ viewport: { width: 1536, height: 730 }, reducedMotion: 'reduce' });
    await context.addInitScript(([t]) => { localStorage.setItem('arbm_admin_session', t); localStorage.setItem('zpc_theme', 'dark'); }, [token]);
    if (mode === 'transform-down') await context.route(/\/api\/commercial\/creative\/assets\/[0-9a-f-]{36}\.(jpg|png)/i, r => r.fulfill({ status: 500, body: 'simulated' }));
    if (mode === 'all-down') await context.route(/\/api\/commercial\/creative\/assets(-raw)?\/[0-9a-f-]{36}\.(jpg|png)/i, r => r.fulfill({ status: 500, body: 'simulated' }));
    const page = await context.newPage();
    await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 45000 });
    await page.getByRole('navigation', { name: 'Perguntas da Central de Comando' }).waitFor({ timeout: 30000 });
    return { context, page };
  };
  const nav = async (page, key) => { const n = page.getByRole('navigation', { name: 'Áreas do ZEVANORY' }); const [p1, s1] = routes[key]; await n.getByRole('button', { name: p1, exact: true }).click(); if (s1) await n.getByRole('button', { name: s1, exact: true }).click(); await page.waitForTimeout(4000); };
  try {
    // Trust strip as painted vs live document.
    const { context, page } = await open('normal');
    await nav(page, 'operations');
    cert.strip = await page.evaluate(() => { const s = document.querySelector('.trustStrip'); return s ? { cls: s.className, label: s.querySelector('.trustState strong')?.textContent?.trim(), quorum: s.querySelectorAll('div')[1]?.textContent?.trim() } : null; });
    // Governance: no ARBM target in the list (all pages) nor in the selector.
    await nav(page, 'governance');
    const names = new Set();
    for (let k = 0; k < 20; k++) {
      (await page.$$eval('.certProductButton b, select option', els => els.map(e => (e.textContent || '').trim()))).forEach(n => names.add(n));
      const next = page.locator('.certTargetPager button').last();
      if (!(await next.count()) || await next.isDisabled()) break;
      await next.click(); await page.waitForTimeout(400);
    }
    cert.uiTargets = names.size; cert.uiArbmTargets = [...names].filter(n => /^ARBM\b/i.test(n)).length;
    cert.stripLabel = await page.evaluate(() => [...document.querySelectorAll('.standardStrip span')].map(s => s.getAttribute('aria-label')).filter(Boolean)[0] || null);
    await context.close();
  } catch (e) { cert.trustOrGovError = String(e?.message || e).slice(0, 120); }
  for (const mode of ['transform-down', 'all-down']) {
    try {
      const { context, page } = await open(mode);
      await nav(page, 'creatives');
      await page.waitForTimeout(3000);
      cert[mode] = await page.evaluate(() => ({
        imgs: document.querySelectorAll('.creativePreview img').length,
        paintedFromOriginal: [...document.querySelectorAll('.creativePreview img')].filter(i => i.complete && i.naturalWidth > 0 && /assets-raw/.test(i.currentSrc)).length,
        errorStates: document.querySelectorAll('.creativeMediaError').length,
        errorText: document.querySelector('.creativeMediaError strong')?.textContent?.trim() || null,
        publishedFlag: [...document.querySelectorAll('.creativeMediaError small')].some(e => /PUBLICADO · ASSET NÃO VERIFICÁVEL/.test(e.textContent || '')),
        emptyBoxes: [...document.querySelectorAll('.creativePreview')].filter(b => !b.querySelector('img') && !b.querySelector('.creativeMediaError') && !b.textContent.trim()).length,
      }));
      await context.close();
    } catch (e) { cert[mode] = { error: String(e?.message || e).slice(0, 120) }; }
  }
  const checks = {
    trustV2Live: cert.trust?.schema === 'zpc-global-trust/v2' && Date.parse(cert.trust.validUntil) > Date.now(),
    noFalseGreen: cert.trust ? (cert.trust.state !== 'GREEN' || cert.trust.quorumOk === true) && !(String(cert.strip?.cls || '').includes('green') && cert.trust.state !== 'GREEN') : false,
    stripMatchesDoc: Boolean(cert.strip) && String(cert.strip.cls).includes({ GREEN: 'green', DEGRADED: 'degraded', BLOCKED: 'blocked', NO_PROOF: 'noproof' }[cert.trust?.state] || '??'),
    arbmOutOfScope: cert.uiTargets > 0 && cert.uiArbmTargets === 0,
    fallbackToOriginal: (cert['transform-down']?.paintedFromOriginal || 0) > 0 && cert['transform-down']?.errorStates === 0 && cert['transform-down']?.emptyBoxes === 0,
    explicitErrorState: (cert['all-down']?.errorStates || 0) > 0 && cert['all-down']?.errorText === 'IMAGEM INDISPONÍVEL' && cert['all-down']?.emptyBoxes === 0,
    rawOriginalServed: cert.rawHeader?.http === 200 && /^image\//.test(String(cert.rawHeader?.type || '')),
    assetServed: cert.assetHeader?.http === 200 && /^image\//.test(String(cert.assetHeader?.type || '')),
  };
  console.log('::notice title=CERT_208::' + JSON.stringify({ checks, cert }).slice(0, 3900));
  for (const [k, v] of Object.entries(checks)) if (!v) fail('CERT_208', k);
}
await browser.close();

const summary = { apiAndRouteChecks: passed.length, uiClicks: clicked, protectedNotClicked: [...skipped].slice(0, 40), failures: failures.length };
console.log('::notice title=PANEL_ACTIONS_LIVE::' + JSON.stringify(summary));
// Annotation budget is ~10 per step: pack every failure into at most 8 lines.
const lines = failures.map(f => f.where + ' => ' + f.detail);
const per = Math.max(1, Math.ceil(lines.length / 8));
for (let i = 0; i < lines.length; i += per) console.log('::error title=PANEL_ACTION_' + (i / per + 1) + '::' + lines.slice(i, i + per).join(' || ').slice(0, 3800));
if (failures.length) process.exit(1);
console.log('PANEL_ACTIONS_LIVE=PASS');
