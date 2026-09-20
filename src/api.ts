type ApiResponse<T = any> = { data: T; status: number };

function resolveApiPath(path: string) {
  if (typeof window === 'undefined') return path;
  const base = window.location.pathname === '/control' || window.location.pathname.startsWith('/control/') ? '/control' : '';
  return path.startsWith('/') ? `${base}${path}` : path;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
  const response = await fetch(resolveApiPath(path), {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
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
  post<T = any>(path: string, body?: unknown) {
    return request<T>('POST', path, body ?? {});
  },
};
