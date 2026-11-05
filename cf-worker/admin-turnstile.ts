// DEC-18 / R111. Siteverify is a mandatory, single-use gate before any login limiter
// or passphrase verification. Strict origin/action checks avoid cross-widget reuse.
// Deactivation is an explicit rollout control: require owner authorization to switch on.
export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_ACTION = 'zpc_owner_login';
export const TURNSTILE_HOSTNAME = 'controle.zevanory.api.br';

export type TurnstileResult = { ok: boolean; status: 200 | 403 | 503; code: string };
export const isTurnstileEnforced = (env: Record<string, unknown>) =>
  String(env.TURNSTILE_ENFORCED || '') === 'true';

export async function verifyTurnstileLogin(
  request: Request,
  env: Record<string, unknown>,
  verifier: typeof fetch = fetch,
): Promise<TurnstileResult> {
  if (!isTurnstileEnforced(env)) return { ok: true, status: 200, code: 'not_enabled' };
  const secret = String(env.TURNSTILE_SECRET || '');
  const sitekey = String(env.TURNSTILE_SITE_KEY || '');
  if (!secret || !sitekey) return { ok: false, status: 503, code: 'turnstile_not_configured' };
  if (request.method !== 'POST') return { ok: false, status: 403, code: 'turnstile_method_denied' };
  let token = '';
  try {
    const value: unknown = await request.clone().json();
    if (typeof value === 'object' && value !== null && !Array.isArray(value))
      token = String((value as Record<string, unknown>).turnstileToken || '');
  } catch {
    return { ok: false, status: 403, code: 'turnstile_token_missing' };
  }
  if (!token || token.length > 2048 || !/^[A-Za-z0-9._-]+$/.test(token))
    return { ok: false, status: 403, code: 'turnstile_token_missing_or_invalid' };
  const form = new URLSearchParams({ secret, response: token });
  const ip = request.headers.get('cf-connecting-ip');
  // CF-Connecting-IP is injected by Cloudflare; reject untrusted X-Forwarded-For.
  if (ip && ip.length < 64 && /^[a-fA-F0-9:.]+$/.test(ip)) form.set('remoteip', ip);
  try {
    const response = await verifier(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return { ok: false, status: 503, code: 'turnstile_upstream_unavailable' };
    const proof: unknown = await response.json();
    if (!proof || typeof proof !== 'object' || Array.isArray(proof))
      return { ok: false, status: 503, code: 'turnstile_bad_response' };
    const item = proof as Record<string, unknown>;
    if (item.success !== true || item.hostname !== TURNSTILE_HOSTNAME || item.action !== TURNSTILE_ACTION)
      return { ok: false, status: 403, code: 'turnstile_challenge_rejected' };
    return { ok: true, status: 200, code: 'turnstile_verified' };
  } catch {
    return { ok: false, status: 503, code: 'turnstile_unreachable' };
  }
}
