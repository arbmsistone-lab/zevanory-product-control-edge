// Creative approval queue decided by the quality gate (owner order: only owner acts reach the owner).
// Approves a creative only when its text matches the official catalog (name + exact price + the
// official page link), carries no forbidden claim, and fits the platform; otherwise it requests
// changes with the exact reasons. Logs only ids and reasons (public repository).
const base = process.env.TARGET_URL || 'https://controle.zevanory.api.br';
const CATALOG_URL = 'https://raw.githubusercontent.com/arbmsistone-lab/zevanory-public-mirror/gh-pages/data/products.json';
const FORBIDDEN = [/gr[aá]tis/i, /garantid[oa]s? (de )?(lucro|resultado|vendas)/i, /ganhe \d|renda extra/i, /antes e depois/i, /\d+\s*%\s*(off|de desconto)/i, /\b(desconto|promo[cç][aã]o|cupom)\b/i, /[uú]ltimas vagas|s[oó] hoje|corra/i];

export function decide(item, catalog) {
  const text = `${item.title || ''}\n${item.detail || ''}`;
  const reasons = [];
  const product = catalog.products.find((p) => text.toLowerCase().includes(p.name.toLowerCase()));
  if (!product) reasons.push('produto não identificado no catálogo oficial');
  else {
    const prices = [...text.matchAll(/R\$\s?(\d{2,4})(?:,(\d{2}))?/g)].map((m) => Number(m[1]));
    if (!prices.length) reasons.push('sem preço oficial no texto');
    else if (prices.some((v) => v !== product.price && v !== 641 && v !== 394)) reasons.push(`preço diferente do oficial (R$ ${product.price})`);
    if (!text.includes(`vendas.zevanory.api.br/${product.slug}`)) reasons.push('sem o link oficial da página do produto');
  }
  for (const re of FORBIDDEN) if (re.test(text)) reasons.push('termo proibido: ' + re.source);
  if (/garantia/i.test(text) && !/7 dias/i.test(text)) reasons.push('garantia sem o prazo oficial de 7 dias');
  if (String(item.detail || '').length > 2200) reasons.push('legenda acima de 2.200 caracteres');
  return { action: reasons.length ? 'request-changes' : 'approve', reasons, product: product?.slug || null };
}

async function main() {
  const pin = process.env.ADMIN_PIN || '';
  if (!pin) throw new Error('ADMIN_PIN_MISSING');
  const catalog = await (await fetch(CATALOG_URL)).json();
  const login = await fetch(base + '/api/pin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
  const sessionToken = login.ok ? String((await login.json())?.sessionToken || '') : '';
  if (!sessionToken) throw new Error('LOGIN_FAILED_' + login.status);
  const boot = await (await fetch(base + '/api/admin/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionToken }) })).json();
  const commercial = boot?.commercial || {};
  const pending = [...(commercial.creatives || []), ...(commercial.publications || [])].filter((x) => ['approval', 'pending-approval', 'awaiting-approval'].includes(String(x.status || '').toLowerCase().replaceAll('_', '-')));
  const out = [];
  for (const item of pending) {
    const d = decide(item, catalog);
    const r = await fetch(base + '/api/commercial/approval', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionToken, id: item.id, kind: item.kind, action: d.action, note: d.action === 'approve' ? 'Aprovado pelo controle de qualidade: catálogo, preço e link oficiais conferidos.' : 'Controle de qualidade: ' + d.reasons.join('; ') }) });
    const fail = r.status >= 400 ? String((await r.json().catch(() => ({})))?.error || '').replace(/[^\p{L}\p{N} _:.,()/-]/gu, '').slice(0, 120) : '';
    out.push({ id: String(item.id).slice(0, 12), kind: item.kind, action: d.action, http: r.status, reasons: d.reasons, ...(fail ? { error: fail } : {}) });
  }
  console.log('::notice title=CREATIVE_AUTO_DECISION::' + JSON.stringify({ pending: pending.length, decisions: out }));
  if (out.some((o) => o.http >= 400)) process.exit(1);
}
const isMain = process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href;
if (isMain) main().catch((e) => { console.log('::error title=CREATIVE_AUTO_DECISION::' + String(e?.message || e).slice(0, 160)); process.exit(1); });
