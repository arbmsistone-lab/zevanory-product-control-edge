-- DEC-13(a) NC01: atomic passphrase source lock and aggregate pressure signal.
-- Applied only during a separately authorized database migration; missing RPC fails closed (503).
-- A single transaction owns the source decision and its durable counter.
create or replace function public.zpc_passphrase_attempt(
  p_token text, p_source_id uuid, p_fingerprint text, p_trusted boolean, p_valid boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  src_bucket constant text := 'acs_passphrase_source_security';
  agg_bucket constant text := 'acs_passphrase_aggregate_security';
  agg_id constant uuid := '00000000-0000-8000-8000-00000000da13';
  src jsonb;
  agg jsonb;
  ts timestamptz := clock_timestamp();
  until_ts timestamptz;
  failures integer;
  locks integer;
  total integer;
  threshold integer;
  start_ts timestamptz;
  minutes integer;
  next_record jsonb;
begin
  if not public.zpc_worker_auth_ok(p_token) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_source_id is null or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' or p_valid is null or p_trusted is null then
    raise exception 'invalid_passphrase_attempt' using errcode = '22023';
  end if;
  -- Serializes identical sources across Cloudflare colo/regions. Correct logins NEVER wait
  -- for the global aggregate lock, and a different source cannot lock this one.
  perform pg_advisory_xact_lock(hashtextextended('zpc-passphrase-src:' || p_source_id::text, 0));
  select r.record into src from public.zpc_records r where bucket = src_bucket and id = p_source_id for update;
  if src is null or src->>'fingerprint' is distinct from p_fingerprint then
    src := jsonb_build_object('failedAttempts',0,'locks',0,'lockedUntil',null,'fingerprint',p_fingerprint);
  end if;
  begin
    until_ts := nullif(src->>'lockedUntil','')::timestamptz;
  exception when others then
    raise exception 'corrupt_passphrase_lock' using errcode = '22023';
  end;
  if until_ts is not null and until_ts > ts then
    return jsonb_build_object('status',429,'locked',true);
  end if;
  locks := greatest(0, least(1000, coalesce((src->>'locks')::integer,0)));
  if p_valid then
    next_record := jsonb_build_object('failedAttempts',0,'locks',0,'lockedUntil',null,'fingerprint',p_fingerprint,'updatedAt',ts);
    insert into public.zpc_records(bucket,id,record,updated_at) values(src_bucket,p_source_id,next_record,ts)
      on conflict(bucket,id) do update set record=excluded.record, updated_at=excluded.updated_at;
    return jsonb_build_object('status',200,'locked',false);
  end if;
  -- Aggregate is a pressure signal, NEVER a shared lockout. Serialize increments to
  -- avoid a lossy read/modify/write even during a distributed spray.
  perform pg_advisory_xact_lock(hashtextextended('zpc-passphrase-aggregate-v1',0));
  select r.record into agg from public.zpc_records r where bucket=agg_bucket and id=agg_id for update;
  begin
    start_ts := nullif(agg->>'windowStart','')::timestamptz;
  exception when others then
    start_ts := null;
  end;
  if start_ts is null or start_ts > ts or ts-start_ts >= interval '15 minutes' then
    start_ts := ts;
    total := 1;
  else
    total := least(2147483647, greatest(0,coalesce((agg->>'failures')::integer,0)) + 1);
  end if;
  next_record := jsonb_build_object('windowStart',start_ts,'failures',total,'updatedAt',ts);
  insert into public.zpc_records(bucket,id,record,updated_at) values(agg_bucket,agg_id,next_record,ts)
    on conflict(bucket,id) do update set record=excluded.record, updated_at=excluded.updated_at;
  threshold := case when total >= 25 and not p_trusted then 3 else 5 end;
  failures := greatest(0,coalesce((src->>'failedAttempts')::integer,0)) + 1;
  if failures >= threshold then
    locks := least(1000,locks+1);
    minutes := least(120,15 * power(2,least(3,locks-1))::integer);
    until_ts := ts + make_interval(mins=>minutes);
    failures := 0;
  else
    until_ts := null;
  end if;
  next_record := jsonb_build_object('failedAttempts',failures,'locks',locks,
    'lockedUntil',until_ts,'fingerprint',p_fingerprint,'updatedAt',ts);
  insert into public.zpc_records(bucket,id,record,updated_at) values(src_bucket,p_source_id,next_record,ts)
    on conflict(bucket,id) do update set record=excluded.record, updated_at=excluded.updated_at;
  return jsonb_build_object('status',401,'locked',until_ts is not null,'aggregateHot',total >= 25);
end;
$$;
revoke all on function public.zpc_passphrase_attempt(text,uuid,text,boolean,boolean) from public;
grant execute on function public.zpc_passphrase_attempt(text,uuid,text,boolean,boolean) to anon, authenticated;
