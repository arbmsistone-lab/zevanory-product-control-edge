import { Pool } from 'pg';

type Item<T> = T & { id: string };
type WriteItem<T> = { id: string; record: T };

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

const secondaryUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const secondaryKey = String(process.env.SUPABASE_ANON_KEY || '');
const clusterSecret = String(process.env.ZPC_CLUSTER_SECRET || '');
const instanceId = String(process.env.BACKEND_INSTANCE_ID || 'portable-backend');

async function secondaryRpc(fn: string, body: Record<string, unknown>) {
  if (!secondaryUrl || !secondaryKey || !clusterSecret) throw new Error('secondary_not_configured');
  const response = await fetch(`${secondaryUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: secondaryKey,
      authorization: `Bearer ${secondaryKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_secret: clusterSecret, ...body }),
  });
  if (!response.ok) throw new Error(`secondary_${fn}_${response.status}`);
  return await response.json();
}

async function primaryList<T>(tableName: string, limit: number): Promise<Item<T>[]> {
  const result = await pool.query(
    'select id, record from zpc_portable.records where table_name=$1 order by updated_at desc limit $2',
    [tableName, limit],
  );
  return result.rows.map(row => ({ ...(row.record as T), id: String(row.id) }));
}

async function secondaryList<T>(tableName: string, limit: number): Promise<Item<T>[]> {
  const rows = await secondaryRpc('zpc_replica_list', { p_table_name: tableName, p_limit: limit }) as Array<{id:string;record:T}>;
  return rows.map(row => ({ ...(row.record as T), id: String(row.id) }));
}

async function primaryGet<T>(tableName: string, ids: string[]): Promise<Array<Item<T> | null>> {
  if (!ids.length) return [];
  const result = await pool.query(
    'select id, record from zpc_portable.records where table_name=$1 and id=any($2::text[])',
    [tableName, ids],
  );
  const map = new Map(result.rows.map(row => [String(row.id), row.record as T]));
  return ids.map(id => map.has(id) ? ({ ...(map.get(id) as T), id }) : null);
}

async function secondaryGet<T>(tableName: string, ids: string[]): Promise<Array<Item<T> | null>> {
  if (!ids.length) return [];
  const rows = await secondaryRpc('zpc_replica_get', { p_table_name: tableName, p_ids: ids }) as Array<{id:string;record:T}>;
  const map = new Map(rows.map(row => [String(row.id), row.record]));
  return ids.map(id => map.has(id) ? ({ ...(map.get(id) as T), id }) : null);
}

async function primaryUpsert<T>(tableName: string, id: string, record: T, opId: string) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into zpc_portable.records(table_name,id,record,version,updated_at,origin)
       values($1,$2,$3::jsonb,1,now(),$4)
       on conflict(table_name,id) do update
       set record=excluded.record,version=zpc_portable.records.version+1,updated_at=now(),origin=excluded.origin`,
      [tableName, id, JSON.stringify(record), instanceId],
    );
    await client.query(
      `insert into zpc_portable.replication_log(op_id,source,operation,table_name,record_id,payload)
       values($1,$2,'upsert',$3,$4,$5::jsonb) on conflict(op_id) do nothing`,
      [opId, instanceId, tableName, id, JSON.stringify(record)],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function secondaryUpsert<T>(tableName: string, id: string, record: T, opId: string) {
  await secondaryRpc('zpc_replica_upsert', {
    p_op_id: opId, p_source: instanceId, p_table_name: tableName, p_id: id, p_record: record,
  });
}

async function primaryDelete(tableName: string, id: string, opId: string) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from zpc_portable.records where table_name=$1 and id=$2', [tableName, id]);
    await client.query(
      `insert into zpc_portable.replication_log(op_id,source,operation,table_name,record_id,payload)
       values($1,$2,'delete',$3,$4,null) on conflict(op_id) do nothing`,
      [opId, instanceId, tableName, id],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function secondaryDelete(tableName: string, id: string, opId: string) {
  await secondaryRpc('zpc_replica_delete', {
    p_op_id: opId, p_source: instanceId, p_table_name: tableName, p_id: id,
  });
}

async function atLeastOne<T>(primary: () => Promise<T>, secondary: () => Promise<T>): Promise<T> {
  try {
    const value = await primary();
    secondary().catch(() => undefined);
    return value;
  } catch (primaryError) {
    try {
      return await secondary();
    } catch {
      throw primaryError;
    }
  }
}

export const db = {
  async list<T>(tableName: string, options?: { limit?: number }) {
    const limit = Math.max(1, Math.min(Number(options?.limit || 100), 1000));
    const items = await atLeastOne(() => primaryList<T>(tableName, limit), () => secondaryList<T>(tableName, limit));
    return { items };
  },
  async get<T>(tableName: string, ids: string[]) {
    return await atLeastOne(() => primaryGet<T>(tableName, ids), () => secondaryGet<T>(tableName, ids));
  },
  async add<T>(tableName: string, records: T[]) {
    const ids: string[] = [];
    for (const record of records) {
      const id = crypto.randomUUID();
      const opId = crypto.randomUUID();
      const results = await Promise.allSettled([
        primaryUpsert(tableName, id, record, opId),
        secondaryUpsert(tableName, id, record, opId),
      ]);
      if (results.every(r => r.status === 'rejected')) throw new Error('dual_write_failed');
      ids.push(id);
    }
    return ids;
  },
  async update<T>(tableName: string, records: WriteItem<T>[]) {
    const ids: string[] = [];
    for (const item of records) {
      const opId = crypto.randomUUID();
      const results = await Promise.allSettled([
        primaryUpsert(tableName, item.id, item.record, opId),
        secondaryUpsert(tableName, item.id, item.record, opId),
      ]);
      if (results.every(r => r.status === 'rejected')) throw new Error('dual_update_failed');
      ids.push(item.id);
    }
    return ids;
  },
  async delete(tableName: string, ids: string[]) {
    for (const id of ids) {
      const opId = crypto.randomUUID();
      const results = await Promise.allSettled([
        primaryDelete(tableName, id, opId),
        secondaryDelete(tableName, id, opId),
      ]);
      if (results.every(r => r.status === 'rejected')) throw new Error('dual_delete_failed');
    }
    return true;
  },
  async health() {
    const out: Record<string, boolean> = { neon: false, supabase: false };
    try { await pool.query('select 1'); out.neon = true; } catch {}
    try { await secondaryRpc('zpc_replica_list', { p_table_name: '__health__', p_limit: 1 }); out.supabase = true; } catch {}
    return out;
  },
};

export const secrets = {
  async readSecret(name: string) {
    return process.env[name] || '';
  },
  async listSecretNames() {
    return ['ADMIN_PIN','ARBM_TELEMETRY_TOKEN','DATABASE_URL','SUPABASE_URL','SUPABASE_ANON_KEY','ZPC_CLUSTER_SECRET']
      .filter(name => Boolean(process.env[name]));
  },
};

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function error(message: string, status = 400) {
  return json({ error: message, message }, status);
}

type RouteHandler = (ctx: { body: unknown; request: Request }) => Promise<Response> | Response;

export function router(routes: Record<string, RouteHandler[]>) {
  return async (request: Request) => {
    const url = new URL(request.url);
    const key = `${request.method.toUpperCase()} ${url.pathname}`;
    const handlers = routes[key];
    if (!handlers?.length) return error('Not found', 404);
    let body: unknown = {};
    if (!['GET','HEAD'].includes(request.method.toUpperCase())) {
      body = await request.json().catch(() => ({}));
    }
    let response: Response = error('Not handled', 500);
    for (const handler of handlers) response = await handler({ body, request });
    return response;
  };
}
