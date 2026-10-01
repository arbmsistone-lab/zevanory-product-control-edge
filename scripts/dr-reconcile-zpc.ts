import { Pool } from 'pg';

type Summary = {
  cutoff: string;
  totalCurrentRecords: number;
  totalChangedSinceCutoff: number;
  buckets: Array<{ bucket: string; currentRecords: number; changedSinceCutoff: number; firstChange: string | null; lastChange: string | null; exactMirrorSupported: boolean }>;
  exactMirrorSupported: boolean;
};

function hardenedDatabaseUrl(raw: string) {
  const url = new URL(raw);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (!local) url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

export async function runDrReconcileDryRun(cutoff = '2026-09-29T15:06:35Z', end = '2026-10-01T22:30:21Z'): Promise<Summary> {
  const databaseUrl = String(process.env.DATABASE_URL_PRIMARY || '').trim();
  if (!databaseUrl) throw new Error('DR_RECONCILE_PRIMARY_UNCONFIGURED');

  const pool = new Pool({
    connectionString: hardenedDatabaseUrl(databaseUrl),
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    ssl: { rejectUnauthorized: true },
  });

  try {
    const result = await pool.query(
      `
      select
        bucket,
        count(*)::int as current_records,
        count(*) filter (where updated_at >= $1::timestamptz and updated_at <= $2::timestamptz)::int as changed_since_cutoff,
        min(updated_at) filter (where updated_at >= $1::timestamptz and updated_at <= $2::timestamptz) as first_change,
        max(updated_at) filter (where updated_at >= $1::timestamptz and updated_at <= $2::timestamptz) as last_change
      from public.zpc_records
      group by bucket
      order by bucket
      `,
      [cutoff, end],
    );

    const buckets = result.rows.map((row: any) => ({
      bucket: String(row.bucket),
      currentRecords: Number(row.current_records || 0),
      changedSinceCutoff: Number(row.changed_since_cutoff || 0),
      firstChange: row.first_change ? new Date(row.first_change).toISOString() : null,
      lastChange: row.last_change ? new Date(row.last_change).toISOString() : null,
      exactMirrorSupported: Number(row.current_records || 0) < 1000,
    }));

    return {
      cutoff,
      totalCurrentRecords: buckets.reduce((sum, item) => sum + item.currentRecords, 0),
      totalChangedSinceCutoff: buckets.reduce((sum, item) => sum + item.changedSinceCutoff, 0),
      buckets,
      exactMirrorSupported: buckets.every(item => item.exactMirrorSupported),
    };
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDrReconcileDryRun(process.argv[2] || undefined, process.argv[3] || undefined)
    .then(summary => {
      console.log(JSON.stringify(summary, null, 2));
      console.error(`DR_RECONCILE_DRY_RUN=${summary.exactMirrorSupported ? 'PASS' : 'FAIL'} changed=${summary.totalChangedSinceCutoff} current=${summary.totalCurrentRecords}`);
      process.exitCode = summary.exactMirrorSupported ? 0 : 2;
    })
    .catch(error => {
      console.error('DR_RECONCILE_DRY_RUN=FAIL', error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}


type PrimaryRecord = { bucket: string; id: string; record: unknown };

async function fetchPrimaryRecords(pool: Pool, bucket: string) {
  const result = await pool.query(
    'select bucket, id::text, record from public.zpc_records where bucket=$1 order by id',
    [bucket],
  );
  return result.rows as PrimaryRecord[];
}

async function secondaryRpc(name: string, body: Record<string, unknown>) {
  const base = String(process.env.DR_SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(process.env.DR_SUPABASE_PUBLISHABLE_KEY || '');
  const token = String(process.env.ZPC_CLUSTER_TOKEN || '');
  if (!base || !key || !token) throw new Error('DR_RECONCILE_TARGET_UNCONFIGURED');
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: key,
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ p_token: token, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`DR_RECONCILE_RPC_${name}_HTTP_${response.status}`);
  return response.status === 204 ? null : await response.json();
}

export async function executeDrReconcile() {
  if (process.env.DR_RECONCILE_APPROVED !== 'YES') throw new Error('DR_RECONCILE_APPROVAL_REQUIRED');
  const databaseUrl = String(process.env.DATABASE_URL_PRIMARY || '').trim();
  if (!databaseUrl) throw new Error('DR_RECONCILE_PRIMARY_UNCONFIGURED');
  const summary = await runDrReconcileDryRun();
  if (!summary.exactMirrorSupported) throw new Error('DR_RECONCILE_EXACT_MIRROR_UNSUPPORTED');

  const pool = new Pool({
    connectionString: hardenedDatabaseUrl(databaseUrl),
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    ssl: { rejectUnauthorized: true },
  });

  try {
    const result: Record<string, { upserted: number; deleted: number }> = {};
    for (const bucket of summary.buckets.map(item => item.bucket)) {
      const primary = await fetchPrimaryRecords(pool, bucket);
      const remote = await secondaryRpc('zpc_worker_list', { p_bucket: bucket, p_limit: 1000 }) as any;
      const remoteIds = new Set((remote?.items || []).map((item: any) => String(item.id)));
      const primaryIds = new Set(primary.map(item => item.id));

      for (let i = 0; i < primary.length; i += 100) {
        const chunk = primary.slice(i, i + 100).map(item => ({ id: item.id, record: item.record }));
        if (chunk.length) {
          await secondaryRpc('zpc_worker_upsert', {
            p_bucket: bucket,
            p_items: chunk,
            p_operation: 'update',
            p_queue_primary: false,
          });
        }
      }

      const stale = [...remoteIds].filter(id => !primaryIds.has(id));
      for (let i = 0; i < stale.length; i += 100) {
        const ids = stale.slice(i, i + 100);
        if (ids.length) {
          await secondaryRpc('zpc_worker_delete', {
            p_bucket: bucket,
            p_ids: ids,
            p_queue_primary: false,
          });
        }
      }
      result[bucket] = { upserted: primary.length, deleted: stale.length };
    }
    return { ok: true, source: 'render-primary', target: 'dr-supabase-secondary', buckets: result };
  } finally {
    await pool.end();
  }
}

if (process.argv.includes('--execute')) {
  executeDrReconcile()
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error('DR_RECONCILE_EXECUTE=FAIL', error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
