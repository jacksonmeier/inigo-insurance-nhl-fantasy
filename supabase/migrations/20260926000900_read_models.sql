-- Views shaped for the screens that read them, so the app can load each
-- screen with one simple query. security_invoker makes every view respect the
-- caller's row-level security, exactly as if they had queried the tables.

-- A player's games, newest first in the app: stats, fantasy points, and which
-- fantasy team (if any) the points went to.
create view public.player_game_log with (security_invoker = true) as
select
  s.game_id,
  s.player_id,
  g.season,
  g.game_type,
  g.game_date,
  g.start_time_utc,
  g.game_state,
  g.home_team,
  g.away_team,
  g.home_score,
  g.away_score,
  s.nhl_team,
  case when s.nhl_team = g.home_team then g.away_team else g.home_team end as opponent,
  s.nhl_team = g.home_team as is_home,
  s.goals,
  s.assists,
  s.power_play_points,
  s.shorthanded_points,
  s.shots,
  s.hits,
  s.blocked_shots,
  s.decision,
  s.saves,
  s.goals_against,
  s.shutout,
  s.toi,
  coalesce(pt.points, 0)::numeric(8, 2) as points,
  coalesce(pt.breakdown, '{}'::jsonb) as breakdown,
  pt.team_id as credited_team_id
from public.player_game_stats s
join public.games g on g.id = s.game_id
left join public.player_game_points pt on pt.game_id = s.game_id and pt.player_id = s.player_id;

-- Every pick of this season's draft with the player and team it names.
create view public.draft_board with (security_invoker = true) as
select
  dp.season,
  dp.pick_number,
  dp.round,
  dp.team_id,
  t.name as team_name,
  dp.player_id,
  p.full_name,
  p.position,
  p.position_group,
  p.nhl_team,
  p.headshot_url,
  dp.is_auto_pick,
  dp.picked_at
from public.draft_picks dp
join public.teams t on t.id = dp.team_id
join public.players p on p.id = dp.player_id
where dp.season = (select season from public.league_settings);

-- Trades with both team names and the players going each way.
create view public.trade_details with (security_invoker = true) as
select
  tr.id,
  tr.status,
  tr.message,
  tr.created_at,
  tr.responded_at,
  tr.veto_deadline,
  tr.processed_at,
  tr.proposing_team_id,
  pt.name as proposing_team_name,
  tr.receiving_team_id,
  rt.name as receiving_team_name,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'player_id', p.id, 'full_name', p.full_name, 'position', p.position,
        'position_group', p.position_group, 'nhl_team', p.nhl_team,
        'headshot_url', p.headshot_url, 'from_team_id', tp.from_team_id
      )
      order by p.position_group, p.last_name
    )
    from public.trade_players tp
    join public.players p on p.id = tp.player_id
    where tp.trade_id = tr.id
  ), '[]'::jsonb) as players,
  (select v.team_id from public.trade_vetoes v where v.trade_id = tr.id order by v.created_at limit 1)
    as vetoed_by_team_id
from public.trades tr
join public.teams pt on pt.id = tr.proposing_team_id
join public.teams rt on rt.id = tr.receiving_team_id;

-- Players on IR right now, with their replacement and any decision deadline.
create view public.ir_status with (security_invoker = true) as
select
  s.id as stint_id,
  s.team_id,
  t.name as team_name,
  s.ir_player_id,
  ip.full_name as ir_player_name,
  ip.position_group,
  s.replacement_player_id,
  rp.full_name as replacement_player_name,
  s.placed_at,
  s.healthy_at,
  s.decision_deadline,
  inj.status as injury_status,
  coalesce(inj.is_ir_eligible, false) as still_out
from public.ir_stints s
join public.teams t on t.id = s.team_id
join public.players ip on ip.id = s.ir_player_id
left join public.players rp on rp.id = s.replacement_player_id
left join lateral (
  select i.status, i.is_ir_eligible
  from public.player_injuries i
  where i.player_id = s.ir_player_id
  order by i.is_ir_eligible desc
  limit 1
) inj on true
where s.resolved_at is null;

-- Tonight's NHL games.
create view public.todays_games with (security_invoker = true) as
select
  g.id, g.game_date, g.start_time_utc, g.home_team, g.away_team, g.home_score, g.away_score,
  g.game_state, g.schedule_state, g.period
from public.games g
where g.game_date = public.fantasy_today()
  and g.season = (select season from public.league_settings)
  and g.game_type in (
    select value::int
    from public.league_settings ls, jsonb_array_elements_text(ls.config -> 'scoringGameTypes')
  );

-- Injured players ESPN lists that couldn't be matched to an NHL player with
-- confidence, for the commissioner to sort out.
create view public.espn_issues with (security_invoker = true) as
select
  m.espn_athlete_id,
  m.espn_name,
  m.espn_team,
  m.espn_position,
  m.match_confidence,
  m.player_id,
  p.full_name as matched_name,
  p.nhl_team as matched_team,
  p.position as matched_position,
  i.status
from public.espn_player_map m
join public.player_injuries i on i.espn_athlete_id = m.espn_athlete_id
left join public.players p on p.id = m.player_id
where m.match_confidence in ('low', 'unmatched');

-- The activity feed with team names filled in.
create view public.activity_feed with (security_invoker = true) as
select
  x.id, x.type, x.team_id, t.name as team_name, x.actor_id, x.summary, x.details, x.created_at
from public.transactions x
left join public.teams t on t.id = x.team_id;

-- Open waivers with the player on them.
create view public.waiver_wire with (security_invoker = true) as
select
  w.id as waiver_id,
  w.player_id,
  p.full_name,
  p.position,
  p.position_group,
  p.nhl_team,
  w.dropped_by_team_id,
  t.name as dropped_by_team_name,
  w.created_at,
  w.expires_at
from public.waivers w
join public.players p on p.id = w.player_id
join public.teams t on t.id = w.dropped_by_team_id
where w.status = 'open';

do $$
declare
  v text;
begin
  foreach v in array array[
    'player_game_log', 'draft_board', 'trade_details', 'ir_status', 'todays_games',
    'espn_issues', 'activity_feed', 'waiver_wire'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end
$$;
