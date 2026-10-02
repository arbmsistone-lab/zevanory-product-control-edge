import { ownerPreviewBootstrap } from './owner-preview-fixture';

type ApiResponse<T = any> = { data: T; status: number };

const CANONICAL_CONTROL_HOST = 'controle.zevanory.api.br';

function resolveApiPath(path: string) {
  if (typeof window === 'undefined') return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (window.location.hostname === CANONICAL_CONTROL_HOST) {
    return normalized;
  }
  const base = window.location.pathname === '/control' || window.location.pathname.startsWith('/control/') ? '/control' : '';
  return `${base}${normalized}`;
}

async function request<T>(method: string, path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<ApiResponse<T>> {
  const ownerPreview = typeof window !== 'undefined' && window.location.hostname === 'zpc-commercial-final-audit-20260926.onrender.com';
  if (ownerPreview) {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    if (normalized.endsWith('/api/_session_verify')) return { data: { valid: true } as T, status: 200 };
    if (normalized.endsWith('/api/admin/bootstrap')) return { data: ownerPreviewBootstrap as T, status: 200 };
    if (normalized.endsWith('/api/pin/login')) return { data: { ok: true, sessionToken: 'owner-preview-session', expiresAt: '2099-01-01T00:00:00.000Z' } as T, status: 200 };
    if (normalized.endsWith('/global-trust.json')) return { data: ownerPreviewBootstrap.globalTrust as T, status: 200 };
    return { data: { ok: true, preview: true, persisted: false } as T, status: 200 };
  }
  const resolved = resolveApiPath(path);
  const crossOrigin = typeof window !== 'undefined' && resolved.startsWith('http');
  const response = await fetch(resolved, {
    method,
    signal: options?.signal,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: crossOrigin ? 'omit' : 'same-origin',
  });

  let data: any = null;
  try { data = await response.json(); } catch { data = null; }

  if (!response.ok) {
    const err: any = new Error(data?.error || data?.message || `HTTP ${response.status}`);
    err.response = { data, status: response.status };
    throw err;
  }

  return { data: data as T, status: response.status };
}

export const api = {
  get<T = any>(path: string) {
    return request<T>('GET', path);
  },
  post<T = any>(path: string, body?: unknown, options?: { signal?: AbortSignal }) {
    return request<T>('POST', path, body ?? {}, options);
  },
};
