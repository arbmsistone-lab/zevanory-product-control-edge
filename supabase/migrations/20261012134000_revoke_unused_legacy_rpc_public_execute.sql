-- ZEVANORY security hardening, applied 2026-10-12 (Supabase migration
-- "zpc_revoke_unused_legacy_rpc_public_execute").
-- 17 legacy SECURITY DEFINER RPCs (zpc_peer_*, zpc_replica_*, zpc_rpc_*) were executable by
-- anon/authenticated through PostgREST. Edge logs of the previous 24h showed zero calls to them;
-- the panel and the Render backend only call zpc_worker_* (backend/platform.ts, cf-worker/platform-worker.ts).
-- Tightening only: service_role keeps EXECUTE.
-- Rollback: grant execute on function <sig> to anon, authenticated;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'zpc\_peer\_%' or p.proname like 'zpc\_replica\_%' or p.proname like 'zpc\_rpc\_%')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
