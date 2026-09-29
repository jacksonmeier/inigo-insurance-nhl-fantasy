-- League config mirror, extra NHL data tables, and the helpers every rule
-- function builds on.
--
-- The rules (draft, roster moves, waivers, trades, IR) are enforced by
-- security-definer SQL functions so each action is one transaction. They read
-- league settings from league_settings.config, which mirrors
-- supabase/functions/_shared/league.config.ts. The sync function pushes the
-- file's values here on every run, so the file stays the single place to edit.

-- ---------------------------------------------------------------------------
-- Config mirror
-- ---------------------------------------------------------------------------

alter table public.league_settings add column config jsonb not null default '{}'::jsonb;

-- Must match LEAGUE in league.config.ts (a test checks this).
update public.league_settings set config = '{
  "name": "Inigo Insurance",
  "teamCount": 4,
  "roster": { "F": 3, "D": 2, "G": 1 },
  "irSlots": 1,
  "draft": { "rounds": 6, "defaultPickSeconds": 120 },
  "windows": { "waiverHours": 24, "tradeVetoHours": 24, "irReturnDecisionHours": 24 },
  "irEligibleStatuses": ["Out", "Injured Reserve"],
  "scoringGameTypes": [2]
}'::jsonb;

-- ---------------------------------------------------------------------------
-- Extra NHL data
-- ---------------------------------------------------------------------------

-- NHL's schedule state: OK, PPD (postponed), CNCL (cancelled), SUSP, TBD.
alter table public.games add column schedule_state text not null default 'OK';

create index games_start_time_idx on public.games (start_time_utc);

-- Full-season totals from the NHL stats API, used to rank players before the
-- current season has any games (the draft) and shown as "last season".
create table public.player_season_stats (
  player_id bigint not null references public.players (id) on delete cascade,
  season int not null,
  games_played int not null default 0,
  goals int not null default 0,
  assists int not null default 0,
  power_play_points int not null default 0,
  shorthanded_points int not null default 0,
  shots int not null default 0,
  hits int not null default 0,
  blocked_shots int not null default 0,
  wins int not null default 0,
  saves int not null default 0,
  goals_against int not null default 0,
  shutouts int not null default 0,
  fantasy_points numeric(8, 2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (player_id, season)
);

create index player_season_stats_points_idx on public.player_season_stats (season, fantasy_points desc);

-- Last run of each sync job, so the commissioner can see that data is fresh.
create table public.sync_status (
  job text primary key,
  status text not null check (status in ('ok', 'error')),
  message text,
  details jsonb not null default '{}',
  last_run_at timestamptz not null default now(),
  last_ok_at timestamptz
);

do $$
declare
  t text;
begin
  foreach t in array array['player_season_stats', 'sync_status'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy "League members can read" on public.%I for select to authenticated using ((select public.is_league_member()))',
      t
    );
  end loop;
end
$$;

-- Waiver claims stay private to the claiming team until they're processed.
drop policy "League members can read" on public.waiver_claims;
create policy "Owners can read their claims" on public.waiver_claims
  for select to authenticated
  using (team_id = (select public.my_team_id()) or (select public.is_commissioner()));

-- ---------------------------------------------------------------------------
-- Helpers. The private schema is not exposed through the API.
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public;

create function private.config()
returns jsonb
language sql stable
set search_path = ''
as $$
  select config from public.league_settings;
$$;

create function private.season()
returns int
language sql stable
set search_path = ''
as $$
  select season from public.league_settings;
$$;

-- The season before the current one, e.g. 20262027 -> 20252026.
create function private.previous_season()
returns int
language sql stable
set search_path = ''
as $$
  select season - 10001 from public.league_settings;
$$;

create function private.roster_limit(p_group text)
returns int
language sql stable
set search_path = ''
as $$
  select coalesce((private.config() -> 'roster' ->> p_group)::int, 0);
$$;

-- One of the 24-hour windows, by its key in LEAGUE.windows.
create function private.window_length(p_key text)
returns interval
language sql stable
set search_path = ''
as $$
  select (private.config() -> 'windows' ->> p_key)::numeric * interval '1 hour';
$$;

create function private.scoring_game_types()
returns int[]
language sql stable
set search_path = ''
as $$
  select coalesce(array_agg(value::int), '{}')
  from jsonb_array_elements_text(private.config() -> 'scoringGameTypes');
$$;

-- Every roster-changing action takes this lock first, so two actions can never
-- interleave. With 4 owners there's no contention to worry about.
create function private.lock_league()
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(7726001);
$$;

create function private.caller_team()
returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  v_team uuid;
begin
  select id into v_team from public.teams where owner_id = (select auth.uid());
  if v_team is null then
    raise exception 'You don''t have a team in this league.';
  end if;
  return v_team;
end
$$;

create function private.assert_member()
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if not public.is_league_member() then
    raise exception 'Only league members can do that.';
  end if;
end
$$;

create function private.assert_commissioner()
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if not public.is_commissioner() then
    raise exception 'Only the commissioner can do that.';
  end if;
end
$$;

-- Roster moves open once the draft is complete.
create function private.assert_season_open()
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.drafts where season = private.season() and status = 'complete'
  ) then
    raise exception 'Roster moves open once the draft is complete.';
  end if;
end
$$;

create function private.team_name(p_team uuid)
returns text
language sql stable
set search_path = ''
as $$
  select name from public.teams where id = p_team;
$$;

-- "Connor McDavid (C, EDM)"
create function private.player_label(p_player bigint)
returns text
language sql stable
set search_path = ''
as $$
  select full_name || ' (' || position || coalesce(', ' || nhl_team, '') || ')'
  from public.players
  where id = p_player;
$$;

create function private.player_json(p_player bigint)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', id, 'name', full_name, 'position', position, 'group', position_group, 'nhl_team', nhl_team
  )
  from public.players
  where id = p_player;
$$;

create function private.log_tx(
  p_type text, p_team uuid, p_actor uuid, p_summary text, p_details jsonb default '{}'::jsonb
)
returns bigint
language sql
set search_path = ''
as $$
  insert into public.transactions (type, team_id, actor_id, summary, details)
  values (p_type, p_team, p_actor, p_summary, coalesce(p_details, '{}'::jsonb))
  returning id;
$$;

create function private.alert(p_team uuid, p_type text, p_message text, p_data jsonb default '{}'::jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.alerts (team_id, type, message, data)
  values (p_team, p_type, p_message, coalesce(p_data, '{}'::jsonb));
$$;

-- Players in a team's active slots for one position group.
create function private.active_count(p_team uuid, p_group text)
returns int
language sql stable
set search_path = ''
as $$
  select count(*)::int
  from public.roster_entries r
  join public.players p on p.id = r.player_id
  where r.team_id = p_team and r.end_at is null and r.slot = 'active' and p.position_group = p_group;
$$;

-- Injured players of one position group whose spot hasn't been filled by a
-- temporary replacement yet.
create function private.unreplaced_ir_count(p_team uuid, p_group text)
returns int
language sql stable
set search_path = ''
as $$
  select count(*)::int
  from public.ir_stints s
  join public.players p on p.id = s.ir_player_id
  where s.team_id = p_team and s.resolved_at is null and s.replacement_player_id is null
    and p.position_group = p_group;
$$;

-- The fantasy team that had this player in an active slot at a moment in time.
-- Points for a game go to whoever rostered the player at puck drop.
create function private.team_at(p_player bigint, p_at timestamptz)
returns uuid
language sql stable
set search_path = ''
as $$
  select r.team_id
  from public.roster_entries r
  where r.player_id = p_player and r.slot = 'active'
    and r.start_at <= p_at and (r.end_at is null or r.end_at > p_at)
  limit 1;
$$;

-- The league's "today": the NHL game date, rolling over at 6 AM Eastern so
-- late West Coast games still count as tonight.
create function public.fantasy_today()
returns date
language sql stable
set search_path = ''
as $$
  select ((now() at time zone 'America/New_York') - interval '6 hours')::date;
$$;

create function public.server_time()
returns timestamptz
language sql stable
set search_path = ''
as $$
  select clock_timestamp();
$$;

-- ---------------------------------------------------------------------------
-- Views. security_invoker makes them respect the caller's row-level security.
-- ---------------------------------------------------------------------------

-- Points and goals by fantasy team, counting only this season's scoring games.
create view public.team_standings with (security_invoker = true) as
with settings as (
  select season, config from public.league_settings
),
scored as (
  select pt.team_id, pt.points, pt.goals, g.game_date
  from public.player_game_points pt
  join public.games g on g.id = pt.game_id
  join settings s on g.season = s.season
  where pt.team_id is not null
    and g.game_type in (select value::int from settings, jsonb_array_elements_text(settings.config -> 'scoringGameTypes'))
),
totals as (
  select
    team_id,
    sum(points) as points,
    sum(goals) as goals,
    sum(points) filter (where game_date = public.fantasy_today()) as today_points
  from scored
  group by team_id
),
adjustments as (
  select team_id, sum(points) as points, sum(goals) as goals
  from public.point_adjustments
  group by team_id
),
combined as (
  select
    t.id as team_id,
    t.name,
    t.owner_id,
    (coalesce(tot.points, 0) + coalesce(adj.points, 0))::numeric(10, 2) as total_points,
    (coalesce(tot.goals, 0) + coalesce(adj.goals, 0))::int as total_goals,
    coalesce(tot.today_points, 0)::numeric(10, 2) as today_points,
    coalesce(adj.points, 0)::numeric(10, 2) as adjustment_points
  from public.teams t
  left join totals tot on tot.team_id = t.id
  left join adjustments adj on adj.team_id = t.id
)
select
  c.*,
  -- Tiebreaker: most goals by the team's players while rostered.
  rank() over (order by c.total_points desc, c.total_goals desc)::int as rank
from combined c;

-- Every player with his fantasy status, injury status and points.
create view public.player_pool with (security_invoker = true) as
select
  p.id,
  p.first_name,
  p.last_name,
  p.full_name,
  p.position,
  p.position_group,
  p.nhl_team,
  p.sweater_number,
  p.headshot_url,
  p.is_active,
  coalesce(cur.points, 0)::numeric(10, 2) as season_points,
  coalesce(cur.games, 0)::int as season_games,
  coalesce(prev.fantasy_points, 0)::numeric(10, 2) as last_season_points,
  coalesce(prev.games_played, 0)::int as last_season_games,
  r.team_id as fantasy_team_id,
  r.slot as roster_slot,
  coalesce(r.is_ir_replacement, false) as is_ir_replacement,
  w.id as waiver_id,
  w.expires_at as waiver_expires_at,
  w.dropped_by_team_id as waiver_dropped_by_team_id,
  case
    when r.team_id is not null then 'rostered'
    when w.id is not null then 'waivers'
    else 'free_agent'
  end as availability,
  inj.status as injury_status,
  coalesce(inj.is_ir_eligible, false) as is_ir_eligible,
  inj.description as injury_description
from public.players p
left join lateral (
  select sum(pt.points) as points, count(*) as games
  from public.player_game_points pt
  join public.games g on g.id = pt.game_id
  where pt.player_id = p.id
    and g.season = (select season from public.league_settings)
    and g.game_type in (
      select value::int
      from public.league_settings ls, jsonb_array_elements_text(ls.config -> 'scoringGameTypes')
    )
) cur on true
left join public.player_season_stats prev
  on prev.player_id = p.id and prev.season = (select season - 10001 from public.league_settings)
left join public.roster_entries r on r.player_id = p.id and r.end_at is null
left join public.waivers w on w.player_id = p.id and w.status = 'open'
left join lateral (
  select i.status, i.is_ir_eligible, i.description
  from public.player_injuries i
  where i.player_id = p.id
  order by i.is_ir_eligible desc, i.synced_at desc
  limit 1
) inj on true;

-- Current rosters with what the team page shows for each player.
create view public.team_rosters with (security_invoker = true) as
select
  r.id as roster_entry_id,
  r.team_id,
  r.slot,
  r.is_ir_replacement,
  r.reason,
  r.start_at,
  pp.id as player_id,
  pp.full_name,
  pp.first_name,
  pp.last_name,
  pp.position,
  pp.position_group,
  pp.nhl_team,
  pp.sweater_number,
  pp.headshot_url,
  pp.is_active,
  pp.season_points,
  pp.season_games,
  pp.last_season_points,
  pp.injury_status,
  pp.is_ir_eligible,
  pp.injury_description,
  coalesce(mine.points, 0)::numeric(10, 2) as team_points,
  -- Today's points that count for this team. A player added after puck drop
  -- is playing tonight but not for this team yet.
  coalesce(today.points, 0)::numeric(10, 2) as today_points,
  today.game_id as today_game_id,
  coalesce(today.not_counting, false) as today_not_counting,
  ng.id as next_game_id,
  ng.start_time_utc as next_game_start,
  ng.game_state as next_game_state,
  ng.period as next_game_period,
  ng.home_team as next_game_home,
  ng.away_team as next_game_away
from public.roster_entries r
join public.player_pool pp on pp.id = r.player_id
left join lateral (
  select sum(pt.points) as points
  from public.player_game_points pt
  join public.games g on g.id = pt.game_id
  where pt.player_id = r.player_id and pt.team_id = r.team_id
    and g.season = (select season from public.league_settings)
    and g.game_type in (
      select value::int
      from public.league_settings ls, jsonb_array_elements_text(ls.config -> 'scoringGameTypes')
    )
) mine on true
left join lateral (
  select
    sum(pt.points) filter (where pt.team_id = r.team_id) as points,
    max(pt.game_id) as game_id,
    bool_or(pt.team_id is distinct from r.team_id) as not_counting
  from public.player_game_points pt
  join public.games g on g.id = pt.game_id
  where pt.player_id = r.player_id and g.game_date = public.fantasy_today()
    and g.season = (select season from public.league_settings)
    and g.game_type in (
      select value::int
      from public.league_settings ls, jsonb_array_elements_text(ls.config -> 'scoringGameTypes')
    )
) today on true
left join lateral (
  select g.id, g.start_time_utc, g.game_state, g.period, g.home_team, g.away_team
  from public.games g
  where pp.nhl_team is not null
    and (g.home_team = pp.nhl_team or g.away_team = pp.nhl_team)
    and g.game_state not in ('FINAL', 'OFF')
    and g.schedule_state = 'OK'
    and g.start_time_utc > now() - interval '8 hours'
    and g.game_type in (
      select value::int
      from public.league_settings ls, jsonb_array_elements_text(ls.config -> 'scoringGameTypes')
    )
  order by g.start_time_utc
  limit 1
) ng on true
where r.end_at is null;

-- Points each rostered player has earned for his fantasy team this week
-- (Monday to Sunday), for the "top scorer of the week" callout.
create view public.week_scorers with (security_invoker = true) as
select
  pt.player_id,
  p.full_name,
  p.position,
  p.nhl_team,
  p.headshot_url,
  pt.team_id,
  t.name as team_name,
  sum(pt.points)::numeric(10, 2) as points,
  sum(pt.goals)::int as goals,
  count(*)::int as games
from public.player_game_points pt
join public.games g on g.id = pt.game_id
join public.players p on p.id = pt.player_id
join public.teams t on t.id = pt.team_id
where pt.team_id is not null
  and g.season = (select season from public.league_settings)
  and g.game_type in (
    select value::int
    from public.league_settings ls, jsonb_array_elements_text(ls.config -> 'scoringGameTypes')
  )
  and g.game_date >= date_trunc('week', public.fantasy_today()::timestamp)::date
  and g.game_date < date_trunc('week', public.fantasy_today()::timestamp)::date + 7
group by pt.player_id, p.full_name, p.position, p.nhl_team, p.headshot_url, pt.team_id, t.name;

revoke all on public.team_standings, public.player_pool, public.team_rosters, public.week_scorers
  from anon, authenticated;
grant select on public.team_standings, public.player_pool, public.team_rosters, public.week_scorers
  to authenticated;
