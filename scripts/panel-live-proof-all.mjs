// Live geometry proof of EVERY panel area on PRODUCTION, with real data (owner order: all screens,
// official matrix 1536x730, 1280x720, 1366x768, 1024x768, 390x844, both themes).
// Fails on page scroll, local scroll surfaces, clipped content, elements outside the workspace or
// overlapping text. Prints only codes and CSS classes: never business data or the session token.
import { chromium } from 'playwright';

const base = process.env.TARGET_URL || 'https://controle.zevanory.api.br';
const pin = process.env.ADMIN_PIN || '';
if (!pin) { console.log('::error title=LIVE_ALL::ADMIN_PIN_MISSING'); process.exit(2); }
const login = await fetch(base + '/api/pin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
const token = login.ok ? String((await login.json())?.sessionToken || '') : '';
if (!token) { console.log('::error title=LIVE_ALL::LOGIN_FAILED_' + login.status); process.exit(1); }

const routes = {
  products: ['Produtos'], commercial: ['Comercial', 'Resumo'], prospecting: ['Comercial', 'Prospecção'], crm: ['Comercial', 'CRM/Vendas'],
  creatives: ['Conteúdo', 'Criativos'], approvals: ['Conteúdo', 'Aprovações'], publications: ['Conteúdo', 'Publicações'],
  support: ['Atendimento'], finance: ['Financeiro', 'Movimentações'], cfo: ['Financeiro', 'ZEVANORY CFO'], evidence: ['Evidências'],
  operations: ['Sistema', 'Saúde do sistema'], governance: ['Sistema', 'Qualidade e certificação'], channels: ['Sistema', 'Conectar canais'],
};
const sizes = [[1536, 730], [1280, 720], [1366, 768], [1024, 768], [390, 844], [1920, 1080]];

async function go(page, width, key) {
  if (width <= 960) {
    const sel = page.getByLabel('Selecionar área do Control Center');
    await sel.waitFor({ state: 'visible', timeout: 15000 });
    await sel.selectOption(key);
    return;
  }
  const nav = page.getByRole('navigation', { name: 'Áreas do ZEVANORY' });
  const [primary, sub] = routes[key];
  await nav.getByRole('button', { name: primary, exact: true }).click();
  if (sub) await nav.getByRole('button', { name: sub, exact: true }).click();
}

const browser = await chromium.launch({ headless: true });
const failures = [];
let checks = 0;
for (const [width, height] of sizes) for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce' });
  await context.addInitScript(({ token, theme }) => { localStorage.setItem('arbm_admin_session', token); localStorage.setItem('zpc_theme', theme); }, { token, theme });
  const page = await context.newPage();
  await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 45000 });
  await page.getByRole('navigation', { name: 'Perguntas da Central de Comando' }).waitFor({ timeout: 30000 });
  for (const key of Object.keys(routes)) {
    try { await go(page, width, key); } catch (e) { failures.push({ size: width + 'x' + height, theme, view: key, issues: ['NAVIGATION'] }); continue; }
    await page.waitForTimeout(700);
    checks++;
    const r = await page.evaluate(() => {
      const de = document.documentElement, out = [];
      if (de.scrollHeight > innerHeight + 1 || de.scrollWidth > innerWidth + 1) out.push('PAGE_SCROLL');
      const root = document.querySelector('main');
      if (!root) return ['NO_WORKSPACE'];
      const all = [...root.querySelectorAll('*')].filter(el => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; });
      const rootBox = root.getBoundingClientRect();
      for (const el of all) {
        const s = getComputedStyle(el), b = el.getBoundingClientRect();
        if ((['auto', 'scroll'].includes(s.overflowY) && el.scrollHeight > el.clientHeight + 1) || (['auto', 'scroll'].includes(s.overflowX) && el.scrollWidth > el.clientWidth + 1)) out.push('LOCAL_SCROLL:' + el.className);
        if (['hidden', 'clip'].includes(s.overflowY) && el.scrollHeight > el.clientHeight + 1 && !el.matches('.ccBar')) out.push('CLIPPED:' + el.className);
        if (b.right > rootBox.right + 1 || b.bottom > rootBox.bottom + 1 || b.left < rootBox.left - 1) out.push('OUTSIDE:' + el.className);
      }
      const texts = all.filter(el => el.children.length === 0 && (el.textContent || '').trim()).map(el => ({ el, b: el.getBoundingClientRect() }));
      for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i].b, c = texts[j].b;
        const ix = Math.min(a.right, c.right) - Math.max(a.left, c.left), iy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
        if (ix > 2 && iy > 2) out.push('OVERLAP:' + texts[i].el.className + '|' + texts[j].el.className);
      }
      return [...new Set(out)].slice(0, 12);
    });
    if (r.length) failures.push({ size: width + 'x' + height, theme, view: key, issues: r });
  }
  await context.close();
}
await browser.close();
console.log('::notice title=LIVE_ALL::' + JSON.stringify({ checks, failures: failures.length, byView: Object.entries(failures.reduce((m, f) => (m[f.view] = (m[f.view] || 0) + 1, m), {})) }));
// One summary line per area (annotation budget is small): sizes that failed and the issue kinds.
const byView = {};
for (const f of failures) { const v = (byView[f.view] = byView[f.view] || { sizes: new Set(), issues: new Set() }); v.sizes.add(f.size + '/' + f.theme[0]); for (const i of f.issues) v.issues.add(i.replace(/\|.*/, '|…')); }
for (const [view, v] of Object.entries(byView).slice(0, 10)) console.log('::warning title=LIVE_ALL_' + view + '::' + JSON.stringify({ sizes: [...v.sizes], issues: [...v.issues].slice(0, 14) }));
for (const f of failures.slice(0, 9)) console.log('::error title=LIVE_ALL_GEOMETRY::' + JSON.stringify(f));
if (failures.length) process.exit(1);
console.log('PANEL_LIVE_PROOF_ALL=PASS checks=' + checks);
