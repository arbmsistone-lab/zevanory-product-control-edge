import { Pool, type Pool as PoolType } from 'pg';

declare const Netlify: any;

type Row<T> = T & { id: string };
type ListResult<T> = { items: Row<T>[] };

function env(name: string) {
  try {
    if (typeof Netlify !== 'undefined' && Netlify?.env?.get) {
      const value = Netlify.env.get(name);
      if (value) return String(value);
    }
  } catch {}
  return process.env[name] || '';
}

let pool: PoolType | null = null;
function primaryPool() {
  const url = env('DATABASE_URL_PRIMARY');
  if (!url) throw new Error('primary_database_unconfigured');
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 4,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 5_000,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function secondaryCall(payload: Record<string, unknown>) {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_PUBLISHABLE_KEY');
  const secret = env('ZPC_REPLICATION_SECRET');
  if (!url || !key || !secret) throw new Error('secondary_database_unconfigured');

  const response = await fetch(`${url}/rest/v1/rpc/zpc_store`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'apikey': key,
      'authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({ payload: Object.assign({}, payload, { secret }) }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) { const detail = (await response.text()).slice(0, 160); throw new Error(`secondary_database_http_${response.status}_${detail}`); }
  return await response.json() as any;
}

async function primaryList<T>(bucket: string, limit: number): Promise<ListResult<T>> {
  const result = await primaryPool().query(
    'select id::text, record from public.zpc_records where bucket=$1 order by updated_at desc limit $2',
    [bucket, limit],
  );
  return { items: result.rows.map(row => ({ id: row.id, ...(row.record as T) })) as Row<T>[] };
}

async function primaryGet<T>(bucket: string, ids: string[]): Promise<(Row<T> | null)[]> {
  if (!ids.length) return [];
  const result = await primaryPool().query(
    'select id::text, record from public.zpc_records where bucket=$1 and id = any($2::uuid[])',
    [bucket, ids],
  );
  const map = new Map(result.rows.map(row => [row.id, { id: row.id, ...(row.record as T) }]));
  return ids.map(id => (map.get(id) as Row<T> | undefined) || null);
}

async function primaryUpsert(bucket: string, items: Array<{ id: string; record: unknown }>) {
  const client = await primaryPool().connect();
  try {
    await client.query('begin');
    for (const item of items) {
      await client.query(
        'insert into public.zpc_records(bucket,id,record,updated_at) values($1,$2,$3::jsonb,now()) on conflict(bucket,id) do update set record=excluded.record,updated_at=excluded.updated_at',
        [bucket, item.id, JSON.stringify(item.record)],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function primaryDelete(bucket: string, ids: string[]) {
  if (!ids.length) return;
  await primaryPool().query('delete from public.zpc_records where bucket=$1 and id = any($2::uuid[])', [bucket, ids]);
}

async function logPendingSecondary(operation: 'add'|'update'|'delete', bucket: string, payload: unknown) {
  try {
    await primaryPool().query(
      'insert into public.zpc_replication_log(operation,bucket,payload,source) values($1,$2,$3::jsonb,$4)',
      [operation, bucket, JSON.stringify(payload), 'pending-secondary'],
    );
  } catch {}
}

async function applyPendingToPrimary(item: any) {
  const operation = String(item?.operation || '');
  const bucket = String(item?.bucket || '');
  const id = String(item?.recordId || '');
  if (!bucket || !id) return;
  if (operation === 'delete') return primaryDelete(bucket, [id]);
  return primaryUpsert(bucket, [{ id, record: item?.payload || {} }]);
}

let reconciling = false;
export async function reconcileReplication() {
  if (reconciling) return;
  reconciling = true;
  try {
    try {
      const pending = await primaryPool().query(
        "select id::text, operation, bucket, payload from public.zpc_replication_log where source='pending-secondary' order by created_at limit 20"
      );
      for (const row of pending.rows) {
        try {
          const payload = row.operation === 'delete'
            ? { op: 'delete', bucket: row.bucket, ids: row.payload?.ids || [] }
            : { op: row.operation, bucket: row.bucket, items: row.payload?.items || [] };
          await secondaryCall(payload);
          await primaryPool().query("delete from public.zpc_replication_log where id=$1 and source='pending-secondary'", [row.id]);
        } catch {}
      }
    } catch {}

    try {
      const pending = await secondaryCall({ op: 'pending', limit: 20 });
      const ack: string[] = [];
      for (const item of pending?.items || []) {
        try {
          await applyPendingToPrimary(item);
          ack.push(String(item.queueId));
        } catch {}
      }
      if (ack.length) await secondaryCall({ op: 'ack', ids: ack });
    } catch {}
  } finally {
    reconciling = false;
  }
}

export const db = {
  async list<T>(bucket: string, options: { limit?: number } = {}): Promise<ListResult<T>> {
    const limit = Math.max(1, Math.min(options.limit || 100, 1000));
    try {
      const result = await primaryList<T>(bucket, limit);
      void reconcileReplication();
      return result;
    } catch {
      const result = await secondaryCall({ op: 'list', bucket, limit });
      return { items: (result?.items || []) as Row<T>[] };
    }
  },

  async get<T>(bucket: string, ids: string[]): Promise<(Row<T> | null)[]> {
    try {
      const result = await primaryGet<T>(bucket, ids);
      void reconcileReplication();
      return result;
    } catch {
      const result = await secondaryCall({ op: 'get', bucket, ids });
      const map = new Map((result?.items || []).filter(Boolean).map((item: any) => [String(item.id), item]));
      return ids.map(id => (map.get(id) as Row<T> | undefined) || null);
    }
  },

  async add<T>(bucket: string, records: T[]): Promise<string[]> {
    const items = records.map(record => ({ id: crypto.randomUUID(), record }));
    let primaryOk = false;
    try {
      await primaryUpsert(bucket, items);
      primaryOk = true;
    } catch {}

    if (primaryOk) {
      try {
        await secondaryCall({ op: 'add', bucket, items });
      } catch {
        await logPendingSecondary('add', bucket, { items });
      }
      void reconcileReplication();
      return items.map(item => item.id);
    }

    await secondaryCall({ op: 'add', bucket, items, queuePrimary: true });
    return items.map(item => item.id);
  },

  async update<T>(bucket: string, changes: Array<{ id: string; record: T }>): Promise<string[]> {
    let primaryOk = false;
    try {
      await primaryUpsert(bucket, changes);
      primaryOk = true;
    } catch {}

    if (primaryOk) {
      try {
        await secondaryCall({ op: 'update', bucket, items: changes });
      } catch {
        await logPendingSecondary('update', bucket, { items: changes });
      }
      void reconcileReplication();
      return changes.map(item => item.id);
    }

    await secondaryCall({ op: 'update', bucket, items: changes, queuePrimary: true });
    return changes.map(item => item.id);
  },

  async delete(bucket: string, ids: string[]): Promise<string[]> {
    let primaryOk = false;
    try {
      await primaryDelete(bucket, ids);
      primaryOk = true;
    } catch {}

    if (primaryOk) {
      try {
        await secondaryCall({ op: 'delete', bucket, ids });
      } catch {
        await logPendingSecondary('delete', bucket, { ids });
      }
      void reconcileReplication();
      return ids;
    }

    await secondaryCall({ op: 'delete', bucket, ids, queuePrimary: true });
    return ids;
  },
};

export const secrets = {
  async listSecretNames() {
    return ['ADMIN_PIN','ARBM_TELEMETRY_TOKEN'].filter(name => Boolean(env(name)));
  },
  async readSecret(name: string) {
    return env(name);
  },
};

export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function error(message: string, status = 500) {
  return json({ error: message, message }, status);
}

type RouteContext = { body: unknown; request: Request };
type RouteHandler = (ctx: RouteContext) => Promise<Response> | Response;

export function router(routes: Record<string, RouteHandler[]>) {
  return async (request: Request) => {
    void reconcileReplication();
    const url = new URL(request.url);
    const key = `${request.method.toUpperCase()} ${url.pathname}`;
    const handlers = routes[key];
    if (!handlers?.length) return error('Rota nao encontrada.', 404);
    let body: unknown = {};
    if (!['GET','HEAD'].includes(request.method.toUpperCase())) {
      try { body = await request.json(); } catch { body = {}; }
    }
    try {
      return await handlers[0]({ body, request });
    } catch (cause) {
      console.error('portable_router_error', cause);
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

export async function adminPinState() {
  const configured = env('ADMIN_PIN').trim();
  if (/^\d{4}$/.test(configured)) {
    return { configured: true, fingerprint: await sha256(configured), source: 'environment' };
  }
  const saved = await configRecord('admin_pin_hash');
  const hash = String(saved?.value || '');
  if (/^[a-f0-9]{64}$/.test(hash)) return { configured: true, fingerprint: hash, source: 'portable-store' };
  if (env('LEGACY_APP_URL')) return { configured: true, fingerprint: 'legacy-bootstrap', source: 'legacy-bootstrap' };
  return { configured: false, fingerprint: 'unconfigured', source: 'none' };
}

export async function verifyAdminPin(candidate: string) {
  const configured = env('ADMIN_PIN').trim();
  if (/^\d{4}$/.test(configured)) {
    const fingerprint = await sha256(configured);
    return { valid: candidate === configured, fingerprint };
  }

  const saved = await configRecord('admin_pin_hash');
  const savedHash = String(saved?.value || '');
  if (/^[a-f0-9]{64}$/.test(savedHash)) {
    return { valid: (await sha256(candidate)) === savedHash, fingerprint: savedHash };
  }

  const legacy = env('LEGACY_APP_URL').replace(/\/$/, '');
  if (!legacy) return { valid: false, fingerprint: 'unconfigured' };

  const login = await fetch(`${legacy}/api/pin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: candidate }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!login.ok) return { valid: false, fingerprint: 'legacy-bootstrap' };

  const auth = await login.json() as any;
  const token = String(auth?.sessionToken || '');
  if (!token) return { valid: false, fingerprint: 'legacy-bootstrap' };

  try {
    const bootstrapResponse = await fetch(`${legacy}/api/admin/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionToken: token }),
      signal: AbortSignal.timeout(15_000),
    });
    if (bootstrapResponse.ok) {
      const bootstrap = await bootstrapResponse.json();
      await migrateLegacyBootstrap(bootstrap);
    }
  } finally {
    try {
      await fetch(`${legacy}/api/pin/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionToken: token }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {}
  }

  const fingerprint = await sha256(candidate);
  await setConfig('admin_pin_hash', fingerprint);
  return { valid: true, fingerprint };
}

function safeError(cause: unknown) {
  const message = String((cause as any)?.code || (cause as any)?.message || (cause as any)?.name || 'unknown_error');
  return message.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 120);
}

export async function portableHealth() {
  let primary = { ok: false, error: '' };
  let secondary = { ok: false, error: '' };
  try {
    await primaryPool().query('select 1 as ok');
    primary = { ok: true, error: '' };
  } catch (cause) {
    primary = { ok: false, error: safeError(cause) };
  }
  try {
    await secondaryCall({ op: 'list', bucket: 'zpc_config', limit: 1 });
    secondary = { ok: true, error: '' };
  } catch (cause) {
    secondary = { ok: false, error: safeError(cause) };
  }
  return {
    ok: primary.ok || secondary.ok,
    primary,
    secondary,
    mode: 'portable-dual-store-v1',
  };
}
