// Passe do chat do proprietário (Epaminondas): HMAC-SHA256 com a chave da ponte do proprietário, rótulo próprio
// (zpc-owner-chat-v1, domínio separado do OAuth), 60 s de validade no Worker do chat, nonce aleatório de 256 bits
// (uso único conferido lá, no PostgreSQL) e o vencimento da sessão do painel (a sessão do chat nunca passa dele).
export type OwnerChatTicket = { ts: string; nonce: string; exp: string; sig: string };

const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function mintOwnerChatTicket(key: string, panelSessionExpMs: number, now = Date.now()): Promise<OwnerChatTicket | null> {
  if (key.length < 32 || !Number.isFinite(panelSessionExpMs) || panelSessionExpMs <= now) return null;
  const ts = String(now);
  const exp = String(Math.floor(panelSessionExpMs));
  if (!/^\d{13}$/.test(ts) || !/^\d{13}$/.test(exp)) return null;
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64u(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(['zpc-owner-chat-v1', 'session', ts, nonce, exp].join('\n')))));
  return { ts, nonce, exp, sig };
}
