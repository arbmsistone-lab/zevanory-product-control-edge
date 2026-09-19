type AnyRecord = Record<string, any>;
type Row<T> = T & { id: string };
type ListResult<T> = { items: Row<T>[] };

let WORKER_ENV: Record<string, string> = {};

export function setWorkerEnv(env: Record<string, unknown>) {
  WORKER_ENV = Object.fromEntries(
    Object.entries(env || {}).map(([k, v]) => [k, typeof v === 'string' ? v : String(v ?? '')]),
  );
}

function env(name: string) {
  return WORKER_ENV[name] || '';
}

async function storeCall(payload: Record<string, unknown>) {
  const url = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_PUBLISHABLE_KEY');
  const token = env('ZPC_REPLICATION_SECRET');
  if (!url || !key || !token) throw new Error('portable_store_unconfigured');

  const op = String(payload.op || '');
  const bucket = String(payload.bucket || '');
  let rpc = '';
  let body: Record<string, unknown> = { p_token: token, p_bucket: bucket };

  if (op === 'list') {
    rpc = 'zpc_worker_list';
    body.p_limit = Number(payload.limit || 100);
  } else if (op === 'get') {
    rpc = 'zpc_worker_get';
    body.p_ids = Array.isArray(payload.ids) ? payload.ids : [];
  } else if (op === 'add' || op === 'update') {
    rpc = 'zpc_worker_upsert';
    body.p_items = Array.isArray(payload.items) ? payload.items : [];
    body.p_operation = op;
    body.p_queue_primary = true;
  } else if (op === 'delete') {
    rpc = 'zpc_worker_delete';
    body.p_ids = Array.isArray(payload.ids) ? payload.ids : [];
    body.p_queue_primary = true;
  } else {
    throw new Error('unsupported_store_operation');
  }

  const response = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: key,
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 180);
    throw new Error(`portable_store_http_${response.status}_${detail}`);
  }
  return await response.json() as any;
}

export const db = {
  async list<T>(bucket: string, options: { limit?: number } = {}): Promise<ListResult<T>> {
    const result = await storeCall({
      op: 'list',
      bucket,
      limit: Math.max(1, Math.min(options.limit || 100, 1000)),
    });
    return { items: (result?.items || []) as Row<T>[] };
  },

  async get<T>(bucket: string, ids: string[]): Promise<(Row<T> | null)[]> {
    if (!ids.length) return [];
    const result = await storeCall({ op: 'get', bucket, ids });
    const map = new Map(
      (result?.items || [])
        .filter(Boolean)
        .map((item: any) => [String(item.id), item]),
    );
    return ids.map(id => (map.get(id) as Row<T> | undefined) || null);
  },

  async add<T>(bucket: string, records: T[]): Promise<string[]> {
    const items = records.map(record => ({ id: crypto.randomUUID(), record }));
    await storeCall({ op: 'add', bucket, items, queuePrimary: true });
    return items.map(item => item.id);
  },

  async update<T>(bucket: string, changes: Array<{ id: string; record: T }>): Promise<string[]> {
    await storeCall({ op: 'update', bucket, items: changes, queuePrimary: true });
    return changes.map(item => item.id);
  },

  async delete(bucket: string, ids: string[]): Promise<string[]> {
    await storeCall({ op: 'delete', bucket, ids, queuePrimary: true });
    return ids;
  },
};

export const secrets = {
  async listSecretNames() {
    return ['ADMIN_PIN', 'ARBM_TELEMETRY_TOKEN'].filter(name => Boolean(env(name)));
  },
  async readSecret(name: string) {
    return env(name);
  },
};

export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function error(message: string, status = 500) {
  return json({ error: message, message }, status);
}

type RouteContext = { body: unknown; request: Request };
type RouteHandler = (ctx: RouteContext) => Promise<Response> | Response;

export function router(routes: Record<string, RouteHandler[]>) {
  return async (request: Request) => {
    const url = new URL(request.url);
    const key = `${request.method.toUpperCase()} ${url.pathname}`;
    const handlers = routes[key];
    if (!handlers?.length) return error('Rota nao encontrada.', 404);

    let body: unknown = {};
    if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
      try { body = await request.json(); } catch { body = {}; }
    }

    try {
      return await handlers[0]({ body, request });
    } catch (cause) {
      console.error('cloudflare_portable_router_error', cause);
      return error('Falha interna fail-closed.', 500);
    }
  };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}

const CONFIG_BUCKET = 'zpc_config';

async function configRecord(key: string) {
  const current = await db.list<any>(CONFIG_BUCKET, { limit: 100 });
  return current.items.find(item => item.key === key) || null;
}

async function setConfig(key: string, value: unknown) {
  const current = await configRecord(key);
  const record = { key, value, updatedAt: new Date().toISOString() };
  if (current) await db.update(CONFIG_BUCKET, [{ id: current.id, record }]);
  else await db.add(CONFIG_BUCKET, [record]);
}

async function replaceBucket(bucket: string, records: any[]) {
  const current = await db.list<any>(bucket, { limit: 1000 });
  if (current.items.length) await db.delete(bucket, current.items.map(item => item.id));
  if (records.length) await db.add(bucket, records);
}

function stripId<T extends Record<string, any>>(item: T) {
  const { id, ...record } = item;
  return record;
}

async function migrateLegacyBootstrap(bootstrap: any) {
  if (!bootstrap || await configRecord('legacy_bootstrap_migrated')) return;
  const dashboard = bootstrap.dashboard || {};

  if (Array.isArray(dashboard.systems)) await replaceBucket('acs_systems', dashboard.systems.map(stripId));
  if (Array.isArray(dashboard.audits)) await replaceBucket('acs_audits', dashboard.audits.map(stripId));
  if (Array.isArray(dashboard.improvements)) await replaceBucket('acs_improvements', dashboard.improvements.map(stripId));
  if (Array.isArray(dashboard.incidents)) await replaceBucket('acs_incidents', dashboard.incidents.map(stripId));
  await replaceBucket('acs_engine', [{ lastRun: dashboard.lastEngineRun || new Date().toISOString() }]);

  if (Array.isArray(bootstrap.products)) {
    const products = bootstrap.products.map((item: any) => {
      const {
        id, certification, commercialReady, blockers, auditOverall, auditStatus,
        ...record
      } = item;
      return record;
    });
    await replaceBucket('acs_products_admin', products);
  }

  await setConfig('legacy_bootstrap_migrated', true);
}

export async function completePortableAccessMigration(candidate: string, migrationToken: string) {
  const expected = env('ZPC_MIGRATION_TOKEN');
  if (!expected || migrationToken !== expected) {
    return { ok: false, status: 403, message: 'Link de migracao invalido.' };
  }

  const value = String(candidate || '').trim();
  if (!/^\d{4}$/.test(value)) {
    return { ok: false, status: 400, message: 'Informe um PIN de 4 numeros.' };
  }

  const existing = await configRecord('admin_pin_hash');
  if (existing?.value && /^[a-f0-9]{64}$/.test(String(existing.value))) {
    return { ok: false, status: 409, message: 'PIN portatil ja configurado.' };
  }

  const fingerprint = await sha256(value);
  await setConfig('admin_pin_hash', fingerprint);
  await setConfig('pin_migration_completed_at', new Date().toISOString());
  return { ok: true, status: 200 };
}

export async function adminPinState() {
  const saved = await configRecord('admin_pin_hash');
  const hash = String(saved?.value || '');
  if (/^[a-f0-9]{64}$/.test(hash)) {
    return { configured: true, fingerprint: hash, source: 'portable-store' };
  }
  return { configured: false, fingerprint: 'unconfigured', source: 'none' };
}

export async function verifyAdminPin(candidate: string) {
  const saved = await configRecord('admin_pin_hash');
  const savedHash = String(saved?.value || '');
  if (!/^[a-f0-9]{64}$/.test(savedHash)) {
    return { valid: false, fingerprint: 'unconfigured' };
  }
  return { valid: (await sha256(candidate)) === savedHash, fingerprint: savedHash };
}

export async function portableHealth() {
  let store = { ok: false, error: '' };
  let peer = { ok: false, error: '' };

  try {
    await storeCall({ op: 'list', bucket: CONFIG_BUCKET, limit: 1 });
    store = { ok: true, error: '' };
  } catch (cause) {
    store = { ok: false, error: String((cause as any)?.message || cause).slice(0, 120) };
  }

  const peerUrl = env('RENDER_BACKEND_URL').replace(/\/$/, '');
  if (peerUrl) {
    try {
      const response = await fetch(`${peerUrl}/portable-health`, {
        headers: { 'cache-control': 'no-cache' },
      });
      peer = { ok: response.ok, error: response.ok ? '' : `http_${response.status}` };
    } catch (cause) {
      peer = { ok: false, error: String((cause as any)?.message || cause).slice(0, 120) };
    }
  }

  return {
    ok: store.ok,
    primary: store,
    secondaryCompute: peer,
    mode: 'portable-cloudflare-supabase-v1',
    instance: 'cloudflare',
  };
}
