-- Row-level security.
--
-- Model: league members (the 4 team owners, plus the commissioner) can READ
-- everything. The browser can WRITE almost nothing directly: only its own team
-- name and marking its own alerts read. Every game action (draft pick, add,
-- drop, trade, IR move) goes through a server-side function that checks the
-- league rules, and all stats/points are written by Edge Functions using the
-- service role, which bypasses RLS.
--
-- The anon key is public (the repo is public), so anyone can call the API.
-- Signed-out users and signed-in strangers get nothing.

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies on teams don't recurse)
-- ---------------------------------------------------------------------------

create function public.is_commissioner()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.league_settings where commissioner_id = (select auth.uid())
  );
$$;

create function public.my_team_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select id from public.teams where owner_id = (select auth.uid());
$$;

create function public.is_league_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.my_team_id() is not null or public.is_commissioner();
$$;

revoke execute on function public.is_commissioner(), public.my_team_id(), public.is_league_member() from public, anon;
grant execute on function public.is_commissioner(), public.my_team_id(), public.is_league_member() to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges: start from nothing, grant back only what's needed
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  tables text[] := array[
    'league_settings', 'teams', 'players', 'games', 'player_game_stats',
    'roster_entries', 'player_game_points', 'point_adjustments', 'transactions',
    'alerts', 'waivers', 'waiver_claims', 'trades', 'trade_players', 'trade_vetoes',
    'espn_player_map', 'player_injuries', 'ir_stints', 'drafts', 'draft_picks'
  ];
begin
  foreach t in array tables loop
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

-- Owners can rename their own team (and nothing else about it).
grant update (name) on public.teams to authenticated;
create policy "Owners can rename their team" on public.teams
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Owners can mark their own alerts read.
grant update (read_at) on public.alerts to authenticated;
create policy "Owners can mark their alerts read" on public.alerts
  for update to authenticated
  using (team_id = (select public.my_team_id()))
  with check (team_id = (select public.my_team_id()));

-- Alerts are private to the team they're for (the commissioner can see all).
drop policy "League members can read" on public.alerts;
create policy "Owners can read their alerts" on public.alerts
  for select to authenticated
  using (team_id = (select public.my_team_id()) or (select public.is_commissioner()));

-- ---------------------------------------------------------------------------
-- Realtime: tables whose changes are pushed to open screens.
-- Realtime respects the select policies above.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.games,
  public.player_game_points,
  public.point_adjustments,
  public.roster_entries,
  public.transactions,
  public.alerts,
  public.trades,
  public.waivers,
  public.player_injuries,
  public.drafts,
  public.draft_picks;
