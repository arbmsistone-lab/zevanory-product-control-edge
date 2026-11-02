// Trava de vendas para os publicadores de conteúdo (T2 fábrica de criativos, T3 publicador Meta).
//
// Fonte canônica: o Worker núcleo (zevanory) responde GET /api/sales/status com { open } calculado de
// KV sales:open:v1 + "LIBERAR VENDAS" + preflight verde (worker/sales-control.mjs readSalesSwitch no
// repositório zevanory-public-mirror). Este painel lê pelo service binding CORE_WORKER, igual ao Worker de
// vendas (sales-public-worker.mjs salesOpen): só uma resposta OK com open === true abre; binding ausente,
// erro de rede, timeout, status != 2xx, JSON inválido ou open diferente de true = FECHADO (fail-closed).
export const SALES_STATUS_URL = 'https://zevanory.api.br/api/sales/status';
const STATUS_TIMEOUT_MS = 5_000;

export async function readCoreSalesOpen(env: Record<string, any> | null | undefined): Promise<boolean> {
  try {
    const core = env?.CORE_WORKER;
    if (!core || typeof core.fetch !== 'function') return false;
    const response = await core.fetch(SALES_STATUS_URL, {
      method: 'GET',
      headers: { accept: 'application/json', 'cache-control': 'no-store' },
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    if (!response || !response.ok) return false;
    const body = await response.json();
    return body?.open === true;
  } catch {
    return false;
  }
}

// Conteúdo proibido enquanto as vendas estão fechadas: preço, link de checkout/assinatura (próprio,
// Hotmart, Mercado Pago) e chamada de compra. Mesmos caminhos/hosts de data/politica-unica.json
// (checkout_href_paths, checkout_hosts) + /comprar sem barra final.
const PRICE_RE = /R\$\s*\d/i;
const CHECKOUT_LINK_RE = /\/comprar(?:\b|\/)|\/assinar\/|\/hotmart\/|\/checkout\b|\bhotmart\b|mpago\.l[ai]\b|mercadopago\.com(?:\.br)?\/checkout/i;
// Fronteiras Unicode (\b do JS não trata "á" como letra).
const PURCHASE_CTA_RE = /(?<![\p{L}\p{N}])(?:(?:compre|comprar|compra)\s+(?:já|ja|agora|aqui|hoje)|garanta\s+(?:já|ja|o\s+seu|a\s+sua|seu|sua)|finalize\s+(?:a\s+|sua\s+)?compra|botão\s+de\s+compra|botao\s+de\s+compra)(?![\p{L}\p{N}])/iu;

export function salesLockViolations(text: unknown): string[] {
  const s = String(text ?? '');
  const out: string[] = [];
  if (PRICE_RE.test(s)) out.push('price');
  if (CHECKOUT_LINK_RE.test(s)) out.push('checkout_link');
  if (PURCHASE_CTA_RE.test(s)) out.push('purchase_cta');
  return out;
}

// Tudo o que vai para a rede (legenda) ou que aponta para onde o post leva (links e evidências).
export function creativePublicText(item: any): string {
  const evidence = Array.isArray(item?.evidence) ? item.evidence.map(String) : [];
  return [item?.detail, item?.title, item?.imageUrl, item?.link, item?.url, item?.productUrl, ...evidence]
    .map(v => String(v ?? '')).join('\n');
}

export const SALES_LOCK_HOLD_PREFIX = 't3-sales-lock-hold:';
const alertedDays = new Set<string>();
export function resetSalesLockHoldMemo() { alertedDays.clear(); }

// Um aviso por dia (UTC) enquanto houver item retido: um console.warn sempre, e o alerta (callback) só
// na primeira retenção do dia, marcada em KV com TTL de 2 dias (1 escrita/dia no máximo).
export async function noteSalesLockHold(
  env: Record<string, any>,
  held: { id: unknown; reasons: string[] }[],
  alert: (summary: string) => Promise<unknown>,
  now = new Date(),
): Promise<{ alerted: boolean; day: string }> {
  const day = now.toISOString().slice(0, 10);
  const summary = held.length + ' criativo(s) aprovado(s) retido(s) na fila: vendas fechadas e a legenda/link tem ' +
    [...new Set(held.flatMap(h => h.reasons))].join(', ') + '.';
  try { console.warn('t3_sales_lock_hold', JSON.stringify({ day, held: held.map(h => ({ id: String(h.id ?? ''), reasons: h.reasons })) })); } catch {}
  // Isolado: evita repetir o alerta a cada tick mesmo se o KV falhar.
  if (alertedDays.has(day)) return { alerted: false, day };
  const kv = env?.T2_CREATIVE_ASSETS;
  const key = SALES_LOCK_HOLD_PREFIX + day;
  try {
    if (kv?.get && await kv.get(key)) { alertedDays.add(day); return { alerted: false, day }; }
    if (kv?.put) await kv.put(key, JSON.stringify({ at: now.toISOString(), held: held.length }), { expirationTtl: 2 * 86400 });
  } catch {}
  alertedDays.add(day);
  try { await alert(summary); } catch {}
  return { alerted: true, day };
}
