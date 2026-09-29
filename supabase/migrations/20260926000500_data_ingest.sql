-- Entry points for the sync function (service role only). The function fetches
-- from the NHL and ESPN and calculates fantasy points; these write the results
-- in one transaction each and decide which fantasy team gets the points.
--
-- Rows are only rewritten when something changed, so Realtime only pushes
-- real updates to open screens.

create function public.push_config(p_config jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_config is null or p_config -> 'roster' is null or p_config -> 'windows' is null then
    raise exception 'That doesn''t look like the league config.';
  end if;

  update public.league_settings
  set config = p_config
  where config is distinct from p_config;
end
$$;

create function public.record_sync(
  p_job text, p_status text, p_message text default null, p_details jsonb default '{}'::jsonb
)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.sync_status as s (job, status, message, details, last_run_at, last_ok_at)
  values (
    p_job, p_status, p_message, coalesce(p_details, '{}'::jsonb), now(),
    case when p_status = 'ok' then now() end
  )
  on conflict (job) do update
    set status = excluded.status,
        message = excluded.message,
        details = excluded.details,
        last_run_at = excluded.last_run_at,
        last_ok_at = coalesce(excluded.last_ok_at, s.last_ok_at);
$$;

-- ---------------------------------------------------------------------------
-- Players
-- ---------------------------------------------------------------------------

-- p_full = true means the list covers every NHL roster, so anyone missing from
-- it is no longer on an NHL team.
create function public.ingest_players(p_players jsonb, p_full boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_changed int;
  v_deactivated int := 0;
begin
  with incoming as (
    select distinct on (x.id) x.*
    from jsonb_to_recordset(p_players) as x(
      id bigint, first_name text, last_name text, "position" text, nhl_team text,
      sweater_number int, headshot_url text
    )
    where x.id is not null
    order by x.id
  ),
  upserted as (
    insert into public.players as p (
      id, first_name, last_name, position, nhl_team, sweater_number, headshot_url, is_active, updated_at
    )
    select id, first_name, last_name, "position", nhl_team, sweater_number, headshot_url, nhl_team is not null, now()
    from incoming
    on conflict (id) do update
      set first_name = excluded.first_name,
          last_name = excluded.last_name,
          position = excluded.position,
          nhl_team = excluded.nhl_team,
          sweater_number = excluded.sweater_number,
          headshot_url = excluded.headshot_url,
          is_active = excluded.is_active,
          updated_at = now()
      where (p.first_name, p.last_name, p.position, p.nhl_team, p.sweater_number, p.headshot_url, p.is_active)
        is distinct from
        (excluded.first_name, excluded.last_name, excluded.position, excluded.nhl_team,
         excluded.sweater_number, excluded.headshot_url, excluded.is_active)
    returning 1
  )
  select count(*) into v_changed from upserted;

  if p_full then
    update public.players
    set is_active = false, nhl_team = null, updated_at = now()
    where (is_active or nhl_team is not null)
      and id not in (select (x ->> 'id')::bigint from jsonb_array_elements(p_players) as x);
    get diagnostics v_deactivated = row_count;
  end if;

  return jsonb_build_object('changed', v_changed, 'deactivated', v_deactivated);
end
$$;

create function public.ingest_season_stats(p_rows jsonb)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_changed int;
begin
  with incoming as (
    select distinct on (x.player_id, x.season) x.*
    from jsonb_to_recordset(p_rows) as x(
      player_id bigint, season int, games_played int, goals int, assists int,
      power_play_points int, shorthanded_points int, shots int, hits int, blocked_shots int,
      wins int, saves int, goals_against int, shutouts int, fantasy_points numeric
    )
    join public.players p on p.id = x.player_id
    order by x.player_id, x.season
  ),
  upserted as (
    insert into public.player_season_stats as s (
      player_id, season, games_played, goals, assists, power_play_points, shorthanded_points,
      shots, hits, blocked_shots, wins, saves, goals_against, shutouts, fantasy_points, updated_at
    )
    select
      player_id, season, coalesce(games_played, 0), coalesce(goals, 0), coalesce(assists, 0),
      coalesce(power_play_points, 0), coalesce(shorthanded_points, 0), coalesce(shots, 0),
      coalesce(hits, 0), coalesce(blocked_shots, 0), coalesce(wins, 0), coalesce(saves, 0),
      coalesce(goals_against, 0), coalesce(shutouts, 0), coalesce(fantasy_points, 0), now()
    from incoming
    on conflict (player_id, season) do update
      set games_played = excluded.games_played,
          goals = excluded.goals,
          assists = excluded.assists,
          power_play_points = excluded.power_play_points,
          shorthanded_points = excluded.shorthanded_points,
          shots = excluded.shots,
          hits = excluded.hits,
          blocked_shots = excluded.blocked_shots,
          wins = excluded.wins,
          saves = excluded.saves,
          goals_against = excluded.goals_against,
          shutouts = excluded.shutouts,
          fantasy_points = excluded.fantasy_points,
          updated_at = now()
      where (s.games_played, s.goals, s.assists, s.power_play_points, s.shorthanded_points, s.shots,
             s.hits, s.blocked_shots, s.wins, s.saves, s.goals_against, s.shutouts, s.fantasy_points)
        is distinct from
        (excluded.games_played, excluded.goals, excluded.assists, excluded.power_play_points,
         excluded.shorthanded_points, excluded.shots, excluded.hits, excluded.blocked_shots,
         excluded.wins, excluded.saves, excluded.goals_against, excluded.shutouts, excluded.fantasy_points)
    returning 1
  )
  select count(*) into v_changed from upserted;

  return v_changed;
end
$$;

-- ---------------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------------

create function public.ingest_schedule(p_games jsonb)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_changed int;
begin
  with incoming as (
    select distinct on (x.id) x.*
    from jsonb_to_recordset(p_games) as x(
      id bigint, season int, game_type int, game_date date, start_time_utc timestamptz,
      home_team text, away_team text, home_score int, away_score int,
      game_state text, schedule_state text, period int
    )
    where x.id is not null
    order by x.id
  ),
  upserted as (
    insert into public.games as g (
      id, season, game_type, game_date, start_time_utc, home_team, away_team,
      home_score, away_score, game_state, schedule_state, period
    )
    select
      id, season, game_type, game_date, start_time_utc, home_team, away_team,
      home_score, away_score, coalesce(game_state, 'FUT'), coalesce(schedule_state, 'OK'), period
    from incoming
    on conflict (id) do update
      set season = excluded.season,
          game_type = excluded.game_type,
          game_date = excluded.game_date,
          start_time_utc = excluded.start_time_utc,
          home_team = excluded.home_team,
          away_team = excluded.away_team,
          schedule_state = excluded.schedule_state,
          -- The boxscore is fresher than the schedule once a game is over.
          game_state = case when g.game_state in ('FINAL', 'OFF') then g.game_state else excluded.game_state end,
          home_score = coalesce(excluded.home_score, g.home_score),
          away_score = coalesce(excluded.away_score, g.away_score),
          period = coalesce(excluded.period, g.period)
      where (g.season, g.game_type, g.game_date, g.start_time_utc, g.home_team, g.away_team, g.schedule_state)
          is distinct from
          (excluded.season, excluded.game_type, excluded.game_date, excluded.start_time_utc,
           excluded.home_team, excluded.away_team, excluded.schedule_state)
        or (g.game_state not in ('FINAL', 'OFF') and g.game_state is distinct from excluded.game_state)
        or coalesce(excluded.home_score, g.home_score) is distinct from g.home_score
        or coalesce(excluded.away_score, g.away_score) is distinct from g.away_score
    returning 1
  )
  select count(*) into v_changed from upserted;

  return v_changed;
end
$$;

-- ---------------------------------------------------------------------------
-- Game stats and fantasy points
-- ---------------------------------------------------------------------------

-- One game's boxscore. p_stats has one object per player who dressed, with his
-- raw stats plus the fantasy points and per-stat breakdown the scoring engine
-- calculated. Each player's points are credited to the fantasy team that had
-- him in an active slot at puck drop.
create function public.ingest_game(p_game jsonb, p_stats jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_game_id bigint := (p_game ->> 'id')::bigint;
  v_start timestamptz := (p_game ->> 'start_time_utc')::timestamptz;
  v_stats_changed int := 0;
  v_points_changed int := 0;
  v_removed int := 0;
  v_unknown bigint[];
begin
  if v_game_id is null or v_start is null then
    raise exception 'A game needs an id and a start time.';
  end if;

  insert into public.games as g (
    id, season, game_type, game_date, start_time_utc, home_team, away_team,
    home_score, away_score, game_state, schedule_state, period, last_synced_at
  )
  values (
    v_game_id,
    (p_game ->> 'season')::int,
    (p_game ->> 'game_type')::int,
    (p_game ->> 'game_date')::date,
    v_start,
    p_game ->> 'home_team',
    p_game ->> 'away_team',
    (p_game ->> 'home_score')::int,
    (p_game ->> 'away_score')::int,
    coalesce(p_game ->> 'game_state', 'FUT'),
    coalesce(p_game ->> 'schedule_state', 'OK'),
    (p_game ->> 'period')::int,
    now()
  )
  on conflict (id) do update
    set game_date = excluded.game_date,
        start_time_utc = excluded.start_time_utc,
        home_score = excluded.home_score,
        away_score = excluded.away_score,
        game_state = excluded.game_state,
        schedule_state = excluded.schedule_state,
        period = excluded.period,
        last_synced_at = excluded.last_synced_at
    where (g.game_date, g.start_time_utc, g.home_score, g.away_score, g.game_state, g.schedule_state, g.period)
      is distinct from
      (excluded.game_date, excluded.start_time_utc, excluded.home_score, excluded.away_score,
       excluded.game_state, excluded.schedule_state, excluded.period)
      -- Still note that the game was checked, but at most once a minute.
      or g.last_synced_at is null
      or g.last_synced_at < now() - interval '1 minute';

  if p_stats is null or jsonb_typeof(p_stats) <> 'array' or jsonb_array_length(p_stats) = 0 then
    return jsonb_build_object(
      'game_id', v_game_id, 'stats_changed', 0, 'points_changed', 0, 'removed', 0,
      'unknown_players', '[]'::jsonb
    );
  end if;

  perform private.lock_league();

  -- Someone called up since the last roster import. His line is skipped for
  -- now; the caller imports him and sends the game again.
  select coalesce(array_agg(distinct (x ->> 'player_id')::bigint), '{}') into v_unknown
  from jsonb_array_elements(p_stats) as x
  where not exists (select 1 from public.players p where p.id = (x ->> 'player_id')::bigint);

  with incoming as (
    select distinct on (x.player_id) x.*
    from jsonb_to_recordset(p_stats) as x(
      player_id bigint, nhl_team text, goals int, assists int, power_play_points int,
      shorthanded_points int, shots int, hits int, blocked_shots int, decision text,
      saves int, goals_against int, shutout boolean, toi text
    )
    join public.players p on p.id = x.player_id
    order by x.player_id
  ),
  upserted as (
    insert into public.player_game_stats as s (
      game_id, player_id, nhl_team, goals, assists, power_play_points, shorthanded_points,
      shots, hits, blocked_shots, decision, saves, goals_against, shutout, toi, updated_at
    )
    select
      v_game_id, player_id, nhl_team, coalesce(goals, 0), coalesce(assists, 0),
      coalesce(power_play_points, 0), coalesce(shorthanded_points, 0), coalesce(shots, 0),
      coalesce(hits, 0), coalesce(blocked_shots, 0), decision, coalesce(saves, 0),
      coalesce(goals_against, 0), coalesce(shutout, false), toi, now()
    from incoming
    on conflict (game_id, player_id) do update
      set nhl_team = excluded.nhl_team,
          goals = excluded.goals,
          assists = excluded.assists,
          power_play_points = excluded.power_play_points,
          shorthanded_points = excluded.shorthanded_points,
          shots = excluded.shots,
          hits = excluded.hits,
          blocked_shots = excluded.blocked_shots,
          decision = excluded.decision,
          saves = excluded.saves,
          goals_against = excluded.goals_against,
          shutout = excluded.shutout,
          toi = excluded.toi,
          updated_at = now()
      where (s.nhl_team, s.goals, s.assists, s.power_play_points, s.shorthanded_points, s.shots, s.hits,
             s.blocked_shots, s.decision, s.saves, s.goals_against, s.shutout, s.toi)
        is distinct from
        (excluded.nhl_team, excluded.goals, excluded.assists, excluded.power_play_points,
         excluded.shorthanded_points, excluded.shots, excluded.hits, excluded.blocked_shots,
         excluded.decision, excluded.saves, excluded.goals_against, excluded.shutout, excluded.toi)
    returning 1
  )
  select count(*) into v_stats_changed from upserted;

  with incoming as (
    select distinct on (x.player_id) x.*
    from jsonb_to_recordset(p_stats) as x(player_id bigint, goals int, points numeric, breakdown jsonb)
    join public.players p on p.id = x.player_id
    order by x.player_id
  ),
  upserted as (
    insert into public.player_game_points as pt (
      game_id, player_id, team_id, points, goals, breakdown, calculated_at
    )
    select
      v_game_id, player_id, private.team_at(player_id, v_start),
      coalesce(points, 0), coalesce(goals, 0), coalesce(breakdown, '{}'::jsonb), now()
    from incoming
    on conflict (game_id, player_id) do update
      set team_id = excluded.team_id,
          points = excluded.points,
          goals = excluded.goals,
          breakdown = excluded.breakdown,
          calculated_at = now()
      where (pt.team_id, pt.points, pt.goals, pt.breakdown)
        is distinct from (excluded.team_id, excluded.points, excluded.goals, excluded.breakdown)
    returning 1
  )
  select count(*) into v_points_changed from upserted;

  -- A stat correction can take a player out of the boxscore altogether.
  delete from public.player_game_stats
  where game_id = v_game_id
    and player_id not in (select (x ->> 'player_id')::bigint from jsonb_array_elements(p_stats) as x);
  get diagnostics v_removed = row_count;

  return jsonb_build_object(
    'game_id', v_game_id,
    'stats_changed', v_stats_changed,
    'points_changed', v_points_changed,
    'removed', v_removed,
    'unknown_players', to_jsonb(v_unknown)
  );
end
$$;

-- Re-decides which team gets each game's points from the roster history. Used
-- after a commissioner roster correction and by the nightly job.
create function private.reattribute(p_player_ids bigint[] default null, p_since timestamptz default null)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_changed int;
begin
  update public.player_game_points pt
  set team_id = private.team_at(pt.player_id, g.start_time_utc), calculated_at = now()
  from public.games g
  where g.id = pt.game_id
    and (p_player_ids is null or pt.player_id = any (p_player_ids))
    and (p_since is null or g.start_time_utc >= p_since)
    and pt.team_id is distinct from private.team_at(pt.player_id, g.start_time_utc);
  get diagnostics v_changed = row_count;
  return v_changed;
end
$$;

create function public.reattribute_points(p_since timestamptz default null)
returns int
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.lock_league();
  return private.reattribute(null, p_since);
end
$$;

-- Games the live scoring job should be polling right now: started (or about
-- to), not yet official, and not postponed.
create function public.games_to_poll()
returns setof public.games
language sql stable security definer
set search_path = ''
as $$
  select g.*
  from public.games g
  where g.game_type = any (private.scoring_game_types())
    and g.season = private.season()
    and g.schedule_state = 'OK'
    and g.game_state <> 'OFF'
    and g.start_time_utc <= now() + interval '5 minutes'
    and g.start_time_utc > now() - interval '12 hours'
  order by g.start_time_utc;
$$;

-- Games from the last few days that have started, for the nightly job that
-- re-imports final boxscores to pick up the NHL's stat corrections.
create function public.games_to_finalize(p_days int default 2)
returns setof public.games
language sql stable security definer
set search_path = ''
as $$
  select g.*
  from public.games g
  where g.game_type = any (private.scoring_game_types())
    and g.season = private.season()
    and g.schedule_state = 'OK'
    and g.game_date >= public.fantasy_today() - p_days
    and g.start_time_utc <= now()
  order by g.start_time_utc;
$$;

-- What the sync function needs to know before it starts. Returned as one JSON
-- value because the API caps the number of rows a request can return.
create function public.sync_context()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'season', private.season(),
    'previous_season', private.previous_season(),
    'scoring_game_types', to_jsonb(private.scoring_game_types()),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'first_name', p.first_name, 'last_name', p.last_name,
        'position', p.position, 'nhl_team', p.nhl_team
      ))
      from public.players p
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Injuries
-- ---------------------------------------------------------------------------

create function private.injury_rows(p_rows jsonb)
returns table (
  espn_athlete_id text, espn_name text, espn_team text, espn_position text,
  player_id bigint, match_confidence text, status text, description text,
  espn_updated_at timestamptz
)
language sql immutable
set search_path = ''
as $$
  select distinct on (x.espn_athlete_id)
    x.espn_athlete_id, x.espn_name, x.espn_team, x.espn_position,
    x.player_id, x.match_confidence, x.status, x.description, x.espn_updated_at
  from jsonb_to_recordset(p_rows) as x(
    espn_athlete_id text, espn_name text, espn_team text, espn_position text,
    player_id bigint, match_confidence text, status text, description text,
    espn_updated_at timestamptz
  )
  where x.espn_athlete_id is not null and x.status is not null
  order by x.espn_athlete_id, x.espn_updated_at desc nulls last;
$$;

-- Replaces the injury list with ESPN's current one, then raises alerts for
-- what changed: rostered players who became IR-eligible, and players on IR who
-- are healthy again (which starts the owner's decision window).
create function public.ingest_injuries(p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_statuses text[];
  v_before bigint[];
  v_after bigint[];
  v_deadline timestamptz := now() + private.window_length('irReturnDecisionHours');
  v_row record;
  v_newly_eligible int := 0;
  v_healthy int := 0;
  v_relapsed int := 0;
begin
  -- An empty list almost certainly means the fetch failed. Treating it as
  -- "everyone is healthy" would start every IR player's return window.
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No injuries supplied. Refusing to clear the injury list.';
  end if;

  perform private.lock_league();

  select coalesce(array_agg(lower(value)), '{}') into v_statuses
  from jsonb_array_elements_text(private.config() -> 'irEligibleStatuses');

  select coalesce(array_agg(distinct player_id), '{}') into v_before
  from public.player_injuries
  where is_ir_eligible and player_id is not null;

  -- A mapping the commissioner set by hand always wins, and a confident match
  -- is never replaced by a weaker one.
  insert into public.espn_player_map as m (
    espn_athlete_id, player_id, espn_name, espn_team, espn_position, match_confidence, updated_at
  )
  select
    i.espn_athlete_id,
    (select p.id from public.players p where p.id = i.player_id),
    i.espn_name, i.espn_team, i.espn_position,
    case when i.player_id is null then 'unmatched' else coalesce(i.match_confidence, 'low') end,
    v_now
  from private.injury_rows(p_rows) i
  on conflict (espn_athlete_id) do update
    set espn_name = excluded.espn_name,
        espn_team = excluded.espn_team,
        espn_position = excluded.espn_position,
        player_id = case
          when m.match_confidence = 'manual' then m.player_id
          when m.player_id is not null and excluded.player_id is null then m.player_id
          when m.match_confidence = 'high' and excluded.match_confidence <> 'high' then m.player_id
          else excluded.player_id
        end,
        match_confidence = case
          when m.match_confidence = 'manual' then m.match_confidence
          when m.player_id is not null and excluded.player_id is null then m.match_confidence
          when m.match_confidence = 'high' and excluded.match_confidence <> 'high' then m.match_confidence
          else excluded.match_confidence
        end,
        updated_at = v_now
    where (m.espn_name, m.espn_team, m.espn_position) is distinct from
          (excluded.espn_name, excluded.espn_team, excluded.espn_position)
      or (
        m.match_confidence <> 'manual'
        and (m.player_id, m.match_confidence) is distinct from (excluded.player_id, excluded.match_confidence)
      );

  delete from public.player_injuries
  where espn_athlete_id not in (select i.espn_athlete_id from private.injury_rows(p_rows) i);

  insert into public.player_injuries as pi (
    espn_athlete_id, player_id, status, is_ir_eligible, description, espn_updated_at, synced_at
  )
  select
    i.espn_athlete_id, m.player_id, i.status, lower(i.status) = any (v_statuses),
    i.description, i.espn_updated_at, v_now
  from private.injury_rows(p_rows) i
  join public.espn_player_map m on m.espn_athlete_id = i.espn_athlete_id
  on conflict (espn_athlete_id) do update
    set player_id = excluded.player_id,
        status = excluded.status,
        is_ir_eligible = excluded.is_ir_eligible,
        description = excluded.description,
        espn_updated_at = excluded.espn_updated_at,
        synced_at = excluded.synced_at
    where (pi.player_id, pi.status, pi.is_ir_eligible, pi.description, pi.espn_updated_at)
      is distinct from
      (excluded.player_id, excluded.status, excluded.is_ir_eligible, excluded.description, excluded.espn_updated_at);

  select coalesce(array_agg(distinct player_id), '{}') into v_after
  from public.player_injuries
  where is_ir_eligible and player_id is not null;

  -- Rostered players who just became IR-eligible.
  for v_row in
    select r.team_id, r.player_id, i.status
    from public.roster_entries r
    join public.player_injuries i on i.player_id = r.player_id and i.is_ir_eligible
    where r.end_at is null and r.slot = 'active'
      and r.player_id = any (v_after) and not r.player_id = any (v_before)
  loop
    perform private.alert(
      v_row.team_id, 'ir_eligible',
      private.player_label(v_row.player_id) || ' is listed as ' || v_row.status || '. You can move him to IR.',
      jsonb_build_object('player_id', v_row.player_id, 'status', v_row.status)
    );
    v_newly_eligible := v_newly_eligible + 1;
  end loop;

  -- Players on IR who are healthy again: the decision window starts now.
  for v_row in
    select s.id, s.team_id, s.ir_player_id, s.replacement_player_id
    from public.ir_stints s
    where s.resolved_at is null and s.healthy_at is null
      and not s.ir_player_id = any (v_after)
    for update
  loop
    update public.ir_stints
    set healthy_at = v_now, decision_deadline = v_deadline
    where id = v_row.id;

    perform private.alert(
      v_row.team_id, 'ir_player_healthy',
      private.player_label(v_row.ir_player_id) || ' is no longer listed as out. '
        || case
          when v_row.replacement_player_id is null then 'Activate him from IR.'
          else 'Activate him, or keep ' || private.player_label(v_row.replacement_player_id) || ' and drop him.'
        end
        || ' If you do nothing he''ll be activated automatically when the window closes.',
      jsonb_build_object('player_id', v_row.ir_player_id, 'decision_deadline', v_deadline)
    );
    v_healthy := v_healthy + 1;
  end loop;

  -- Players on IR who were healthy but are listed as out again: call it off.
  for v_row in
    select s.id, s.team_id, s.ir_player_id
    from public.ir_stints s
    where s.resolved_at is null and s.healthy_at is not null
      and s.ir_player_id = any (v_after)
    for update
  loop
    update public.ir_stints set healthy_at = null, decision_deadline = null where id = v_row.id;

    perform private.alert(
      v_row.team_id, 'general',
      private.player_label(v_row.ir_player_id) || ' is listed as out again, so he stays on IR.',
      jsonb_build_object('player_id', v_row.ir_player_id)
    );
    v_relapsed := v_relapsed + 1;
  end loop;

  return jsonb_build_object(
    'injuries', (select count(*) from public.player_injuries),
    'unmatched', (select count(*) from public.espn_player_map m
                  join public.player_injuries i on i.espn_athlete_id = m.espn_athlete_id
                  where m.player_id is null),
    'low_confidence', (select count(*) from public.espn_player_map m
                       join public.player_injuries i on i.espn_athlete_id = m.espn_athlete_id
                       where m.match_confidence = 'low'),
    'newly_eligible', v_newly_eligible,
    'healthy', v_healthy,
    'relapsed', v_relapsed
  );
end
$$;
