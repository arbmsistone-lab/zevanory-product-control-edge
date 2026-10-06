-- Prevent stale replication replays from overwriting newer commercial/control records.
create or replace function public.zpc_worker_upsert(
  p_token text,
  p_bucket text,
  p_items jsonb,
  p_operation text default 'update'::text,
  p_queue_primary boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  item jsonb;
  rid uuid;
  rec jsonb;
  ids_json jsonb := '[]'::jsonb;
  log_source text := case when p_queue_primary then 'pending-primary' else 'cloudflare-worker' end;
begin
  if not public.zpc_worker_auth_ok(p_token) then
    raise exception 'unauthorized' using errcode='28000';
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
  loop
    rid := coalesce(nullif(item->>'id','')::uuid,gen_random_uuid());
    rec := coalesce(item->'record','{}'::jsonb);

    insert into public.zpc_records(bucket,id,record,updated_at)
    values(p_bucket,rid,rec,now())
    on conflict(bucket,id) do update
      set record=excluded.record,updated_at=now()
      where coalesce(excluded.record->>'updatedAt','')
            >= coalesce(public.zpc_records.record->>'updatedAt','');

    insert into public.zpc_replication_log(operation,bucket,record_id,payload,source)
    values(
      case when p_operation='add' then 'add' else 'update' end,
      p_bucket,
      rid,
      rec,
      log_source
    );

    ids_json := ids_json || jsonb_build_array(rid::text);
  end loop;

  return jsonb_build_object('ids',ids_json);
end;
$function$;
