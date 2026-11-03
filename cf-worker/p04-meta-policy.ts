// NC-005 / D7: independent, fail-closed P04 Meta gate. Candidate ONLY, not deployed.
// No boolean flag or status inside a creative may certify its own safety.
export const P04_CERTIFIER_URL = 'https://zevanory.api.br/api/p04/certification/status';
export const P04_RECEIPT_URL = 'https://zevanory.api.br/api/p04/certification/receipts/';
const SHA = /^[0-9a-f]{64}$/i;
const CATEGORY_NAMES = ['legibilidade', 'contraste', 'corte', 'preco_cta_pixels', 'alegacoes', 'ortografia', 'marca'];

function validIso(s: unknown): number | null {
  if (typeof s !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

export function validateP04Certificate(c: any, now = Date.now()): boolean {
  if (!c || c.protocol !== 'p04-certifier-v1' || c.status !== 'certified' || c.revoked !== false) return false;
  if (typeof c.id !== 'string' || !/^p04-[A-Za-z0-9_-]{8,}$/.test(c.id)) return false;
  if (typeof c.evaluatorVersion !== 'string' || !/^p04-[A-Za-z0-9._-]+$/.test(c.evaluatorVersion)) return false;
  if (!SHA.test(String(c.evaluatorSha256 || '')) || !SHA.test(String(c.rubricSha256 || '')) || !SHA.test(String(c.holdoutSha256 || ''))) return false;
  const issued = validIso(c.issuedAt), expires = validIso(c.expiresAt);
  if (issued === null || expires === null || issued > now || expires <= now || expires - issued > 30 * 86400_000) return false;
  if (c.holdoutIndependent !== true || c.pixelInspected !== true || c.criticalRecall !== 1 || c.criticalFalseNegatives !== 0) return false;
  if (!Number.isFinite(c.kappaOverall) || c.kappaOverall < .80) return false;
  if (!Array.isArray(c.categories)) return false;
  for (const category of CATEGORY_NAMES) {
    const metrics = c.categories.find((x: any) => x?.category === category);
    if (!metrics || !Number.isInteger(metrics.n) || metrics.n < 20 || !Number.isFinite(metrics.kappa) || metrics.kappa < .70) return false;
  }
  // The certifier is an independent service binding; absent or unconfigured means NO-GO.
  return true;
}

export async function readP04Certificate(env: Record<string, any>, now = Date.now()): Promise<any | null> {
  try {
    const service = env?.P04_CERTIFIER_SERVICE;
    if (!service || typeof service.fetch !== 'function') return null;
    const r = await service.fetch(P04_CERTIFIER_URL, { method: 'GET', headers: { accept: 'application/json', 'cache-control': 'no-store' }, signal: AbortSignal.timeout(4000) });
    if (!r?.ok) return null;
    const cert = await r.json();
    return validateP04Certificate(cert, now) ? cert : null;
  } catch { return null; }
}

async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const h = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(h)].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Receipt is resolved from independent certifier, never trusted from DB item.evidence alone.
export async function verifyP04RenderedReceipt(env: Record<string, any>, item: any, cert: any): Promise<{ ok: boolean; mediaSha256?: string; reason: string }> {
  try {
    if (!cert || !validateP04Certificate(cert)) return { ok: false, reason: 'p04_certificate_invalid' };
    const receiptId = String(item?.p04ReceiptId || '');
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(receiptId)) return { ok: false, reason: 'p04_receipt_missing' };
    const service = env?.P04_CERTIFIER_SERVICE;
    const r = await service.fetch(P04_RECEIPT_URL + encodeURIComponent(receiptId), { method: 'GET', headers: { accept: 'application/json', 'cache-control': 'no-store' }, signal: AbortSignal.timeout(4000) });
    if (!r?.ok) return { ok: false, reason: 'p04_receipt_unavailable' };
    const receipt = await r.json() as any;
    if (receipt?.status !== 'approved' || receipt?.certificateId !== cert.id || receipt?.evaluatorVersion !== cert.evaluatorVersion || receipt?.pixelInspected !== true || receipt?.criticalPassed !== true || receipt?.revoked !== false) return { ok: false, reason: 'p04_receipt_invalid' };
    if (!SHA.test(String(receipt.mediaSha256 || '')) || !SHA.test(String(receipt.captionSha256 || ''))) return { ok: false, reason: 'p04_receipt_hash_invalid' };
    const caption = String(item?.detail || '').slice(0, 2100);
    if (await sha256Hex(new TextEncoder().encode(caption)) !== receipt.captionSha256) return { ok: false, reason: 'p04_caption_changed' };
    const u = new URL(String(item?.imageUrl || ''));
    const match = u.hostname === 'controle.zevanory.api.br' && u.pathname.match(/^\/api\/commercial\/creative\/assets\/([0-9a-f-]{36})\.(jpg|png)$/i);
    if (!match) return { ok: false, reason: 'p04_media_origin_invalid' };
    const bytes = await env?.T2_CREATIVE_ASSETS?.get?.('t2-creative/v1/' + match[1], 'arrayBuffer');
    if (!(bytes instanceof ArrayBuffer) || !bytes.byteLength) return { ok: false, reason: 'p04_media_unavailable' };
    const digest = await sha256Hex(bytes);
    if (digest !== receipt.mediaSha256) return { ok: false, reason: 'p04_media_changed' };
    return { ok: true, mediaSha256: digest, reason: 'p04_receipt_verified' };
  } catch { return { ok: false, reason: 'p04_receipt_check_failed' }; }
}
