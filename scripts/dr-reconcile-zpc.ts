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

export async function runDrReconcileDryRun(cutoff = '2026-09-29T15:06:35Z'): Promise<Summary> {
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
        count(*) filter (where updated_at >= $1::timestamptz)::int as changed_since_cutoff,
        min(updated_at) filter (where updated_at >= $1::timestamptz) as first_change,
        max(updated_at) filter (where updated_at >= $1::timestamptz) as last_change
      from public.zpc_records
      group by bucket
      order by bucket
      `,
      [cutoff],
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
  runDrReconcileDryRun(process.argv[2] || undefined)
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
