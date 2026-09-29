-- Views for the season history, the Tonight screen, and the fuller player
-- sheet. security_invoker makes each one respect the caller's row-level
-- security, exactly as if they had queried the tables.

-- Each team's points by day (the NHL game date, the same day the standings
-- use for "today"), for the season chart and the daily and weekly winners.
-- Points from games and commissioner adjustments are kept apart: the chart
-- adds both, so it ends at the standings total, while the winners count only
-- games. An adjustment falls on the day it was made.
create view public.team_daily_points with (security_invoker = true) as
with settings as (
  select season, config from public.league_settings
),
scored as (
  select pt.team_id, g.game_date as day, sum(pt.points) as points, sum(pt.goals) as goals
  from public.player_game_points pt
  join public.games g on g.id = pt.game_id
  join settings st on g.season = st.season
  where pt.team_id is not null
    and g.game_type in (select value::int from settings, jsonb_array_elements_text(settings.config -> 'scoringGameTypes'))
  group by pt.team_id, g.game_date
),
adjusted as (
  select a.team_id, ((a.created_at at time zone 'America/New_York') - interval '6 hours')::date as day,
    sum(a.points) as points
  from public.point_adjustments a
  group by 1, 2
)
select
  coalesce(s.team_id, a.team_id) as team_id,
  coalesce(s.day, a.day) as day,
  coalesce(s.points, 0)::numeric(10, 2) as game_points,
  coalesce(s.goals, 0)::int as goals,
  coalesce(a.points, 0)::numeric(10, 2) as adjustment_points
from scored s
full join adjusted a on a.team_id = s.team_id and a.day = s.day;

-- Tonight, team by team: everyone in an active roster spot, with today's game
-- if his NHL team plays, his stats so far, and his points. Also anyone whose
-- points today went to a team he has since left, so each team's lines add up
-- to its points for the day.
create view public.tonight_lines with (security_invoker = true) as
with settings as (
  select season, config from public.league_settings
),
today_games as (
  select g.id, g.home_team, g.away_team
  from public.games g
  join settings st on g.season = st.season
  where g.game_date = public.fantasy_today()
    and g.game_type in (select value::int from settings, jsonb_array_elements_text(settings.config -> 'scoringGameTypes'))
),
lines as (
  select r.team_id, r.player_id, tg.id as game_id
  from public.roster_entries r
  join public.players p on p.id = r.player_id
  left join today_games tg on p.nhl_team in (tg.home_team, tg.away_team)
  where r.end_at is null and r.slot = 'active'
  union
  select pt.team_id, pt.player_id, pt.game_id
  from public.player_game_points pt
  join today_games tg on tg.id = pt.game_id
  where pt.team_id is not null
)
select
  l.team_id,
  l.player_id,
  p.full_name,
  p.position,
  p.position_group,
  p.nhl_team,
  p.sweater_number,
  p.headshot_url,
  exists (
    select 1 from public.roster_entries r
    where r.team_id = l.team_id and r.player_id = l.player_id and r.end_at is null and r.slot = 'active'
  ) as on_roster,
  g.id as game_id,
  g.start_time_utc,
  g.game_state,
  g.schedule_state,
  g.period,
  g.home_team,
  g.away_team,
  g.home_score,
  g.away_score,
  s.player_id is not null as has_stats,
  coalesce(s.goals, 0) as goals,
  coalesce(s.assists, 0) as assists,
  coalesce(s.power_play_points, 0) as power_play_points,
  coalesce(s.shorthanded_points, 0) as shorthanded_points,
  coalesce(s.shots, 0) as shots,
  coalesce(s.hits, 0) as hits,
  coalesce(s.blocked_shots, 0) as blocked_shots,
  s.decision,
  coalesce(s.saves, 0) as saves,
  coalesce(s.goals_against, 0) as goals_against,
  coalesce(s.shutout, false) as shutout,
  coalesce(pt.points, 0)::numeric(8, 2) as points,
  pt.team_id as credited_team_id,
  inj.status as injury_status,
  inj.description as injury_description
from lines l
join public.players p on p.id = l.player_id
left join public.games g on g.id = l.game_id
left join public.player_game_stats s on s.game_id = l.game_id and s.player_id = l.player_id
left join public.player_game_points pt on pt.game_id = l.game_id and pt.player_id = l.player_id
left join lateral (
  select i.status, i.description
  from public.player_injuries i
  where i.player_id = l.player_id
  order by i.is_ir_eligible desc, i.synced_at desc
  limit 1
) inj on true;

-- A player's totals for each season from the games imported so far. The
-- columns match player_season_stats, which holds last season's.
create view public.player_season_totals with (security_invoker = true) as
select
  s.player_id,
  g.season,
  count(*)::int as games_played,
  sum(s.goals)::int as goals,
  sum(s.assists)::int as assists,
  sum(s.power_play_points)::int as power_play_points,
  sum(s.shorthanded_points)::int as shorthanded_points,
  sum(s.shots)::int as shots,
  sum(s.hits)::int as hits,
  sum(s.blocked_shots)::int as blocked_shots,
  (count(*) filter (where s.decision = 'W'))::int as wins,
  sum(s.saves)::int as saves,
  sum(s.goals_against)::int as goals_against,
  (count(*) filter (where s.shutout))::int as shutouts,
  coalesce(sum(pt.points), 0)::numeric(10, 2) as fantasy_points
from public.player_game_stats s
join public.games g on g.id = s.game_id
left join public.player_game_points pt on pt.game_id = s.game_id and pt.player_id = s.player_id
where g.game_type in (
  select value::int
  from public.league_settings ls, jsonb_array_elements_text(ls.config -> 'scoringGameTypes')
)
group by s.player_id, g.season;

-- This season's games that haven't finished, with how many days away each
-- one is, for a player's schedule and each team's games in the week ahead.
create view public.upcoming_games with (security_invoker = true) as
select
  g.id,
  g.game_date,
  g.start_time_utc,
  g.home_team,
  g.away_team,
  g.home_score,
  g.away_score,
  g.game_state,
  g.period,
  g.game_date - public.fantasy_today() as days_away
from public.games g
where g.season = (select season from public.league_settings)
  and g.game_type in (
    select value::int
    from public.league_settings ls, jsonb_array_elements_text(ls.config -> 'scoringGameTypes')
  )
  and g.schedule_state = 'OK'
  and g.game_state not in ('FINAL', 'OFF')
  and g.start_time_utc > now() - interval '8 hours';

do $$
declare
  v text;
begin
  foreach v in array array['team_daily_points', 'tonight_lines', 'player_season_totals', 'upcoming_games'] loop
    execute format('revoke all on public.%I from anon, authenticated', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end
$$;
