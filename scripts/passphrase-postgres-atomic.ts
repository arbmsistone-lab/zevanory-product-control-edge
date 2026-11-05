import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.DEC13_TEST_DATABASE_URL;
if (!connectionString) throw new Error('DEC13_TEST_DATABASE_URL required: real PostgreSQL 17 integration, not a mock');
const pool = new pg.Pool({ connectionString, max: 24 });
const uuid = (n: number) => '00000000-0000-8000-8000-' + n.toString(16).padStart(12,'0');
const fingerprint = 'a'.repeat(64);
const token = 'contract-test-only-secret';
async function attempt(source: string, valid = false, trusted = false, fp = fingerprint) {
  const result = await pool.query(
    'select public.zpc_passphrase_attempt($1,$2::uuid,$3,$4,$5) as outcome',
    [token, source, fp, trusted, valid],
  );
  return result.rows[0].outcome as {status:number,locked:boolean};
}
try {
  // Disposable CI PostgreSQL service, never a connected project database.
  await pool.query('create role anon nologin');
  await pool.query('create role authenticated nologin');
  await pool.query(`create table public.zpc_records (
    bucket text not null, id uuid not null, record jsonb not null,
    updated_at timestamptz not null default now(),
    primary key (bucket,id)
  )`);
  await pool.query(`create or replace function public.zpc_worker_auth_ok(p_token text)
    returns boolean language sql stable as $$ select p_token = 'contract-test-only-secret' $$`);
  // Apply the DEC-13 migrations in order, exactly as production received them (R107 replaces the function).
  await pool.query(await fs.readFile(new URL('../supabase/migrations/20261104180000_dec13_atomic_passphrase_attempt.sql', import.meta.url),'utf8'));
  const migration = await fs.readFile(new URL('../supabase/migrations/20261105150000_dec13_r107_clock_after_lock.sql', import.meta.url),'utf8');
  await pool.query(migration);
  // R107 regression: the clock must be read after each advisory lock, and a future windowStart must not reset the count.
  assert.match(migration, /hashtextextended\('zpc-passphrase-src:'[^;]*;\s*(--[^\n]*\n\s*)*ts := clock_timestamp\(\);/);
  assert.match(migration, /hashtextextended\('zpc-passphrase-aggregate-v1',0\)\);\s*(--[^\n]*\n\s*)*ts := clock_timestamp\(\);/);
  assert.doesNotMatch(migration, /start_ts > ts/);
  // NC01/DEC-13: SQL policy must remain identical to TS policy. Regression for
  // SECURITY DEFINER search_path hijack and function-local timeout settings.
  const policy = await fs.readFile(new URL('../cf-worker/admin-auth-throttle.ts', import.meta.url), 'utf8');
  const constants: Record<string,number> = {};
  for (const [,name,value] of policy.matchAll(/export const (SOURCE_MAX_FAILURES|SOURCE_MAX_FAILURES_UNDER_ATTACK|SOURCE_LOCK_MINUTES|SOURCE_LOCK_CAP_MINUTES|AGGREGATE_WINDOW_MINUTES|AGGREGATE_HOT_FAILURES) = (\d+);/g))
    constants[name]=Number(value);
  assert.equal(Object.keys(constants).length,6,'all six policy constants must be compared with SQL');
  assert.match(migration, new RegExp('total >= ' + constants.AGGREGATE_HOT_FAILURES + ' and not p_trusted then ' + constants.SOURCE_MAX_FAILURES_UNDER_ATTACK + ' else ' + constants.SOURCE_MAX_FAILURES + ' end'));
  assert.match(migration, new RegExp("interval '" + constants.AGGREGATE_WINDOW_MINUTES + " minutes'"));
  assert.match(migration, new RegExp('least\\(' + constants.SOURCE_LOCK_CAP_MINUTES + ',\\s*' + constants.SOURCE_LOCK_MINUTES + ' \\* power'));
  // A malicious public overload cannot intercept the system hashing function.
  await pool.query(`create or replace function public.hashtextextended(text,bigint)
    returns bigint language plpgsql as 'begin raise exception ''shadowed_hash''; end;'`);
  const config = await pool.query(`select p.proconfig from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='zpc_passphrase_attempt'`);
  assert.equal(config.rowCount,1);
  assert.ok(config.rows[0].proconfig.includes('search_path=pg_catalog, public'));
  assert.ok(config.rows[0].proconfig.includes('lock_timeout=2s'));
  assert.ok(config.rows[0].proconfig.includes('statement_timeout=2s'));
  assert.equal((await attempt(uuid(500),true)).status,200,'shadowed public.hashtextextended must not be executed');
  await pool.query('drop function public.hashtextextended(text,bigint)');
  await assert.rejects(pool.query('select public.zpc_passphrase_attempt($1,$2::uuid,$3,$4,$5)',
    ['wrong',uuid(1),fingerprint,false,false]),/unauthorized/);
  const source = uuid(1);
  const parallel = await Promise.all(Array.from({length:24},()=>attempt(source,false,false)));
  assert.equal(parallel.filter(x=>x.status===401).length,5,'exactly five wrong attempts must be counted');
  assert.equal(parallel.filter(x=>x.status===429).length,19,'remaining attempts from locked source rejected');
  const srcRow = await pool.query('select record from public.zpc_records where bucket=$1 and id=$2',
    ['acs_passphrase_source_security',source]);
  assert.equal(srcRow.rowCount,1);
  assert.equal(srcRow.rows[0].record.locks,1);
  assert.ok(Date.parse(srcRow.rows[0].record.lockedUntil)>Date.now());
  assert.equal((await attempt(source,true)).status,429,'correct phrase from locked source stays locked');
  assert.equal((await attempt(uuid(2),true)).status,200,'other source owner never locked by source 1');
  const twelve=await Promise.all(Array.from({length:12},(_,i)=>attempt(uuid(100+i))));
  assert.deepEqual([...new Set(twelve.map(v=>v.status))],[401],'distributed sources never locked globally');
  const aggregate = await pool.query('select record from public.zpc_records where bucket=$1',
    ['acs_passphrase_aggregate_security']);
  assert.equal(aggregate.rows[0].record.failures,17,'atomic aggregate increments without lost updates');
  const second = await Promise.all(Array.from({length:12},(_,i)=>attempt(uuid(200+i))));
  assert.deepEqual([...new Set(second.map(v=>v.status))],[401]);
  assert.equal((await attempt(uuid(999),true)).status,200,'clean owner during hot aggregate');
  assert.equal((await attempt(uuid(999),false)).status,401);
  assert.equal((await attempt(uuid(999),false)).status,401);
  assert.equal((await attempt(uuid(999),false)).status,401);
  assert.equal((await attempt(uuid(999),true)).status,429,'hot aggregate tightens untrusted source only');
  assert.equal((await attempt(source,true,false,'b'.repeat(64))).status,200,'rotated fingerprint resets source lock');
  console.log('DEC13_POSTGRES_ATOMIC_PASS concurrency=24 source_401=5 source_429=19 aggregate_no_lost_updates=true owner_during_attack=200');
} finally { await pool.end(); }
