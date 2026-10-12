// Live geometry proof of the Revenue Command Center on PRODUCTION, with real data.
// Logs in with the owner PIN (secret), opens every tab in 5 viewports x 2 themes and
// fails on: page scroll, local scroll surfaces, clipped content, clipped text, or
// overlapping text boxes. Prints only codes and CSS classes: never business data,
// never the session token (this repository is public).
import { chromium } from 'playwright';

const base = process.env.TARGET_URL || 'https://controle.zevanory.api.br';
const pin = process.env.ADMIN_PIN || '';
if (!pin) { console.log('::error title=LIVE_PROOF::ADMIN_PIN_MISSING'); process.exit(2); }
const login = await fetch(base + '/api/pin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
const token = login.ok ? String((await login.json())?.sessionToken || '') : '';
if (!token) { console.log('::error title=LIVE_PROOF::LOGIN_FAILED_' + login.status); process.exit(1); }

const cc = await fetch(base + '/api/owner/command-center', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionToken: token }) });
const ccBody = cc.ok ? await cc.json() : null;
console.log('::notice title=LIVE_DATA::' + JSON.stringify({ endpoint: cc.status, snapshot: Boolean(ccBody?.snapshot), snapshotAt: ccBody?.snapshot?.generatedAt || null, salesLedger: Boolean(ccBody?.sales) }));

const tabs = ['Agora', 'IA', 'Desempenho', 'Funciona?', 'Operação', 'Financeiro', 'Rumo'];
const sizes = [[1920, 1080], [1440, 900], [1536, 730], [768, 1024], [375, 812], [1280, 720], [1366, 768], [1024, 768], [390, 844]];
const browser = await chromium.launch({ headless: true });
const failures = [];
let checks = 0;
for (const [width, height] of sizes) for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce' });
  await context.addInitScript(({ token, theme }) => { localStorage.setItem('arbm_admin_session', token); localStorage.setItem('zpc_theme', theme); }, { token, theme });
  const page = await context.newPage();
  await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 45000 });
  await page.getByRole('navigation', { name: 'Perguntas da Central de Comando' }).waitFor({ timeout: 30000 });
  for (const tab of tabs) {
    await page.getByRole('navigation', { name: 'Perguntas da Central de Comando' }).getByRole('button', { name: tab, exact: true }).click();
    await page.waitForTimeout(400);
    const narrowPages = Number((await page.locator('.ccTabs .ccPager span').textContent({ timeout: 800 }).catch(() => '1/1'))?.split('/')[1] || 1);
    for (let p = 0; p < narrowPages; p++) {
      if (p > 0) { await page.locator('.ccTabs .ccPager button[aria-label="Próxima página"]').click(); await page.waitForTimeout(300); }
      checks++;
      const r = await page.evaluate(() => {
        const de = document.documentElement, out = [];
        if (de.scrollHeight > innerHeight + 1 || de.scrollWidth > innerWidth + 1) out.push('PAGE_SCROLL');
        const root = document.querySelector('.ccRoot');
        if (!root) return ['NO_COMMAND_CENTER'];
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
      if (r.length) failures.push({ size: width + 'x' + height, theme, tab, page: p + 1, issues: r });
    }
  }
  await context.close();
}
await browser.close();
console.log('::notice title=LIVE_PROOF::' + JSON.stringify({ checks, failures: failures.length }));
for (const f of failures.slice(0, 9)) console.log('::error title=LIVE_GEOMETRY::' + JSON.stringify(f));
if (failures.length) process.exit(1);
console.log('COMMAND_CENTER_LIVE_PROOF=PASS checks=' + checks);
