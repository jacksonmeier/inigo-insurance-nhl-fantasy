-- Scheduled jobs (Supabase Cron).
--
-- Jobs that only touch the database run as plain SQL. Jobs that need the NHL
-- or ESPN call the "sync" Edge Function over HTTP. Where to find that
-- function, and the secret that proves the call came from here, live in
-- private.cron_config. Until that row is filled in, the HTTP jobs do nothing.
--
-- `npm run setup` fills it in for local development. For a hosted project see
-- docs/SETUP.md.

create table private.cron_config (
  id boolean primary key default true check (id),
  functions_url text not null,
  cron_secret text not null
);

alter table private.cron_config enable row level security;
revoke all on private.cron_config from public, anon, authenticated;

-- Lets a setup script (holding the service role key) fill in the config
-- without needing a direct database connection.
create function public.set_cron_config(p_functions_url text, p_cron_secret text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(p_functions_url, '') !~ '^https?://' or length(coalesce(p_cron_secret, '')) < 16 then
    raise exception 'Give the functions URL and a secret of at least 16 characters.';
  end if;

  insert into private.cron_config (functions_url, cron_secret)
  values (p_functions_url, p_cron_secret)
  on conflict (id) do update
    set functions_url = excluded.functions_url, cron_secret = excluded.cron_secret;
end
$$;

revoke execute on function public.set_cron_config(text, text) from public, anon, authenticated;
grant execute on function public.set_cron_config(text, text) to service_role;

-- Calls the sync function for one job. Returns whether a request was sent.
create function private.invoke_sync(p_job text)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_config private.cron_config;
begin
  select * into v_config from private.cron_config;
  if not found then
    return false;
  end if;

  perform net.http_post(
    url := rtrim(v_config.functions_url, '/') || '/sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_config.cron_secret),
    body := jsonb_build_object('job', p_job),
    timeout_milliseconds := 55000
  );
  return true;
end
$$;

-- Live scoring, every 30 seconds. Costs one cheap query when nothing is on.
create function private.cron_live_scoring()
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.games_to_poll()) then
    return false;
  end if;
  return private.invoke_sync('live');
end
$$;

-- Injuries: hourly on game days, every 6 hours otherwise, and once more in the
-- hour before the first puck drop. Runs every 15 minutes to decide.
create function private.cron_injuries()
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_last timestamptz;
  v_first_game timestamptz;
  v_due boolean;
begin
  select last_run_at into v_last from public.sync_status where job = 'injuries';

  select min(start_time_utc) into v_first_game
  from public.games
  where game_date = public.fantasy_today()
    and game_type = any (private.scoring_game_types())
    and schedule_state = 'OK';

  v_due := v_last is null
    or v_last < now() - interval '6 hours'
    or (v_first_game is not null and v_last < now() - interval '55 minutes')
    or (
      v_first_game is not null
      and now() between v_first_game - interval '45 minutes' and v_first_game
      and v_last < v_first_game - interval '45 minutes'
    );

  if not v_due then
    return false;
  end if;
  return private.invoke_sync('injuries');
end
$$;

revoke execute on function private.invoke_sync(text), private.cron_live_scoring(), private.cron_injuries()
  from public, anon, authenticated;

-- pg_cron and pg_net exist on Supabase (hosted and local) but not in the
-- in-memory database the tests use.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
    or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice 'pg_cron or pg_net is not available. Skipping scheduled jobs.';
    return;
  end if;

  create extension if not exists pg_cron with schema pg_catalog;
  create extension if not exists pg_net with schema extensions;

  perform cron.schedule('league-live-scoring', '30 seconds', 'select private.cron_live_scoring()');
  perform cron.schedule('league-windows', '*/15 * * * *', 'select public.process_windows()');
  perform cron.schedule('league-injuries', '*/15 * * * *', 'select private.cron_injuries()');
  -- 10:00 UTC is 5 or 6 AM Eastern: after the last West Coast game, before anyone's awake.
  perform cron.schedule('league-finals', '0 10 * * *', $job$select private.invoke_sync('finals')$job$);
  perform cron.schedule('league-players', '20 10 * * *', $job$select private.invoke_sync('players')$job$);
  perform cron.schedule('league-schedule', '40 10 * * *', $job$select private.invoke_sync('schedule')$job$);
  -- Keep cron's own log from growing forever.
  perform cron.schedule(
    'league-cron-cleanup', '0 9 * * *',
    $job$delete from cron.job_run_details where end_time < now() - interval '2 days'$job$
  );
end
$$;
