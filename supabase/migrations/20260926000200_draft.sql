-- Snake draft.
--
-- drafts.draft_order is the round 1 order; even rounds run in reverse. Every
-- pick must fit the roster limits, and there are exactly as many rounds as
-- roster spots, so every team finishes with a full, valid roster.

create function private.draft_team_on_clock(p_order uuid[], p_pick int)
returns uuid
language sql immutable
set search_path = ''
as $$
  select case
    when coalesce(cardinality(p_order), 0) = 0 or p_pick < 1 then null
    when ((p_pick - 1) / cardinality(p_order)) % 2 = 0
      then p_order[((p_pick - 1) % cardinality(p_order)) + 1]
    else p_order[cardinality(p_order) - ((p_pick - 1) % cardinality(p_order))]
  end;
$$;

create function private.draft_total_picks(p_order uuid[])
returns int
language sql stable
set search_path = ''
as $$
  select (private.config() -> 'draft' ->> 'rounds')::int * coalesce(cardinality(p_order), 0);
$$;

create function private.draft_deadline(p_pick_seconds int)
returns timestamptz
language sql stable
set search_path = ''
as $$
  select case when p_pick_seconds is null then null else now() + make_interval(secs => p_pick_seconds) end;
$$;

-- The draft row for this season, locked for the rest of the transaction.
create function private.lock_draft()
returns public.drafts
language plpgsql
set search_path = ''
as $$
declare
  v_draft public.drafts;
begin
  select * into v_draft from public.drafts where season = private.season() for update;
  if not found then
    raise exception 'The draft hasn''t been set up yet. Draw the draft order first.';
  end if;
  return v_draft;
end
$$;

-- ---------------------------------------------------------------------------
-- Setup (commissioner)
-- ---------------------------------------------------------------------------

create function private.draft_set_order(p_order uuid[], p_how text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_names text;
begin
  insert into public.drafts (season, draft_order, pick_seconds)
  values (
    private.season(), p_order, (private.config() -> 'draft' ->> 'defaultPickSeconds')::int
  )
  on conflict (season) do update set draft_order = excluded.draft_order
  where public.drafts.status = 'not_started';

  if not found then
    raise exception 'The draft has already started, so the order is locked.';
  end if;

  select string_agg(t.name, ', ' order by o.position) into v_names
  from unnest(p_order) with ordinality as o(team_id, position)
  join public.teams t on t.id = o.team_id;

  perform private.log_tx(
    'commissioner', null, (select auth.uid()),
    'Draft order ' || p_how || ': ' || v_names,
    jsonb_build_object('action', 'draft_order', 'order', to_jsonb(p_order))
  );
end
$$;

-- Draw a random draft order. Can be redrawn until the draft starts.
create function public.draft_randomize_order()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order uuid[];
  v_expected int := (private.config() ->> 'teamCount')::int;
begin
  perform private.assert_commissioner();
  perform private.lock_league();

  select array_agg(id order by random()) into v_order from public.teams;

  if coalesce(cardinality(v_order), 0) <> v_expected then
    raise exception 'The league needs % teams before the draft. It has %.',
      v_expected, coalesce(cardinality(v_order), 0);
  end if;

  perform private.draft_set_order(v_order, 'drawn at random');
end
$$;

-- Set the draft order by hand, e.g. after drawing names from a hat.
create function public.draft_set_order(p_order uuid[])
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_expected int := (private.config() ->> 'teamCount')::int;
begin
  perform private.assert_commissioner();
  perform private.lock_league();

  if coalesce(cardinality(p_order), 0) <> v_expected
    or (select count(distinct t.id) from public.teams t where t.id = any (p_order)) <> v_expected
  then
    raise exception 'The order must list each of the % teams exactly once.', v_expected;
  end if;

  perform private.draft_set_order(p_order, 'set by the commissioner');
end
$$;

-- Set the pick timer in seconds, or null for no timer. During the draft the
-- current pick's clock restarts with the new length.
create function public.draft_set_timer(p_seconds int)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_draft public.drafts;
begin
  perform private.assert_commissioner();
  perform private.lock_league();
  v_draft := private.lock_draft();

  if p_seconds is not null and (p_seconds < 10 or p_seconds > 86400) then
    raise exception 'The pick timer must be between 10 seconds and 24 hours.';
  end if;
  if v_draft.status = 'complete' then
    raise exception 'The draft is already complete.';
  end if;

  update public.drafts
  set pick_seconds = p_seconds,
      pick_deadline = case when status = 'in_progress' then private.draft_deadline(p_seconds) else null end,
      paused_seconds_remaining = case when status = 'paused' then p_seconds else null end
  where season = v_draft.season;
end
$$;

-- ---------------------------------------------------------------------------
-- Running the draft (commissioner)
-- ---------------------------------------------------------------------------

create function public.draft_start()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_draft public.drafts;
begin
  perform private.assert_commissioner();
  perform private.lock_league();
  v_draft := private.lock_draft();

  if v_draft.status <> 'not_started' then
    raise exception 'The draft has already started.';
  end if;
  if coalesce(cardinality(v_draft.draft_order), 0) = 0 then
    raise exception 'Draw the draft order first.';
  end if;
  if not exists (select 1 from public.players where is_active) then
    raise exception 'Import NHL players before starting the draft.';
  end if;
  if exists (select 1 from public.roster_entries where end_at is null) then
    raise exception 'Rosters must be empty before the draft starts.';
  end if;

  update public.drafts
  set status = 'in_progress',
      current_pick = 1,
      started_at = now(),
      completed_at = null,
      pick_deadline = private.draft_deadline(pick_seconds),
      paused_seconds_remaining = null
  where season = v_draft.season;

  perform private.log_tx(
    'commissioner', null, (select auth.uid()), 'The draft has started.',
    jsonb_build_object('action', 'draft_start')
  );
end
$$;

create function public.draft_pause()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_draft public.drafts;
begin
  perform private.assert_commissioner();
  perform private.lock_league();
  v_draft := private.lock_draft();

  if v_draft.status <> 'in_progress' then
    raise exception 'The draft isn''t running.';
  end if;

  update public.drafts
  set status = 'paused',
      paused_seconds_remaining = case
        when pick_deadline is null then null
        else greatest(1, ceil(extract(epoch from pick_deadline - now())))::int
      end,
      pick_deadline = null
  where season = v_draft.season;

  perform private.log_tx(
    'commissioner', null, (select auth.uid()), 'The draft was paused.',
    jsonb_build_object('action', 'draft_pause')
  );
end
$$;

create function public.draft_resume()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_draft public.drafts;
begin
  perform private.assert_commissioner();
  perform private.lock_league();
  v_draft := private.lock_draft();

  if v_draft.status <> 'paused' then
    raise exception 'The draft isn''t paused.';
  end if;

  update public.drafts
  set status = 'in_progress',
      pick_deadline = private.draft_deadline(
        case when pick_seconds is null then null else coalesce(paused_seconds_remaining, pick_seconds) end
      ),
      paused_seconds_remaining = null
  where season = v_draft.season;

  perform private.log_tx(
    'commissioner', null, (select auth.uid()), 'The draft resumed.',
    jsonb_build_object('action', 'draft_resume')
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Picks
-- ---------------------------------------------------------------------------

create function private.draft_make_pick(
  p_draft public.drafts, p_player bigint, p_actor uuid, p_auto boolean
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_team uuid := private.draft_team_on_clock(p_draft.draft_order, p_draft.current_pick);
  v_teams int := cardinality(p_draft.draft_order);
  v_total int := private.draft_total_picks(p_draft.draft_order);
  v_round int := ((p_draft.current_pick - 1) / v_teams) + 1;
  v_group text;
  v_now timestamptz := now();
begin
  select position_group into v_group from public.players where id = p_player;
  if not found then
    raise exception 'Unknown player.';
  end if;

  if exists (
    select 1 from public.draft_picks where season = p_draft.season and player_id = p_player
  ) or exists (
    select 1 from public.roster_entries where player_id = p_player and end_at is null
  ) then
    raise exception '% has already been drafted.', private.player_label(p_player);
  end if;

  if private.active_count(v_team, v_group) >= private.roster_limit(v_group) then
    raise exception '% already has all % of its % spots filled.',
      private.team_name(v_team), private.roster_limit(v_group), v_group;
  end if;

  insert into public.draft_picks (season, pick_number, round, team_id, player_id, picked_by, is_auto_pick, picked_at)
  values (p_draft.season, p_draft.current_pick, v_round, v_team, p_player, p_actor, p_auto, v_now);

  insert into public.roster_entries (team_id, player_id, slot, reason, start_at)
  values (v_team, p_player, 'active', 'draft', v_now);

  perform private.log_tx(
    'draft_pick', v_team, p_actor,
    'Round ' || v_round || ', pick ' || p_draft.current_pick || ': ' || private.team_name(v_team)
      || ' selected ' || private.player_label(p_player)
      || case when p_auto then ' (auto-pick)' else '' end,
    jsonb_build_object(
      'pick_number', p_draft.current_pick, 'round', v_round,
      'player', private.player_json(p_player), 'auto', p_auto
    )
  );

  if p_draft.current_pick >= v_total then
    update public.drafts
    set status = 'complete', completed_at = v_now, pick_deadline = null, paused_seconds_remaining = null,
        current_pick = v_total
    where season = p_draft.season;

    perform private.log_tx(
      'commissioner', null, null, 'The draft is complete. Free agency is open.',
      jsonb_build_object('action', 'draft_complete')
    );
  else
    update public.drafts
    set current_pick = p_draft.current_pick + 1,
        pick_deadline = private.draft_deadline(pick_seconds)
    where season = p_draft.season;
  end if;
end
$$;

-- Make the current pick. The owner on the clock picks for themselves; the
-- commissioner can pick on behalf of whoever is on the clock.
create function public.draft_pick(p_player_id bigint)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_draft public.drafts;
  v_on_clock uuid;
begin
  perform private.assert_member();
  perform private.lock_league();
  v_draft := private.lock_draft();

  if v_draft.status = 'paused' then
    raise exception 'The draft is paused.';
  elsif v_draft.status <> 'in_progress' then
    raise exception 'The draft isn''t running.';
  end if;

  v_on_clock := private.draft_team_on_clock(v_draft.draft_order, v_draft.current_pick);

  if not public.is_commissioner()
    and v_on_clock is distinct from (select id from public.teams where owner_id = (select auth.uid()))
  then
    raise exception 'It''s not your pick. % is on the clock.', private.team_name(v_on_clock);
  end if;

  perform private.draft_make_pick(v_draft, p_player_id, (select auth.uid()), false);
end
$$;

-- When the pick clock has run out, take the best available player who fits the
-- roster, ranked by last season's fantasy points. A player listed as Out or on
-- Injured Reserve is only taken if nobody healthy is left. Any open draft room
-- calls this when its countdown hits zero; it does nothing unless time is
-- really up.
create function public.draft_auto_pick()
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_draft public.drafts;
  v_team uuid;
  v_groups text[];
  v_player bigint;
begin
  perform private.assert_member();
  perform private.lock_league();

  select * into v_draft from public.drafts where season = private.season() for update;
  if not found or v_draft.status <> 'in_progress'
    or v_draft.pick_deadline is null or v_draft.pick_deadline > now()
  then
    return false;
  end if;

  v_team := private.draft_team_on_clock(v_draft.draft_order, v_draft.current_pick);

  select array_agg(g) into v_groups
  from unnest(array['F', 'D', 'G']) as g
  where private.active_count(v_team, g) < private.roster_limit(g);

  select p.id into v_player
  from public.players p
  left join public.player_season_stats s
    on s.player_id = p.id and s.season = private.previous_season()
  where p.is_active
    and p.position_group = any (v_groups)
    and not exists (select 1 from public.roster_entries r where r.player_id = p.id and r.end_at is null)
    and not exists (
      select 1 from public.draft_picks dp where dp.season = v_draft.season and dp.player_id = p.id
    )
  order by
    exists (
      select 1 from public.player_injuries i where i.player_id = p.id and i.is_ir_eligible
    ),
    coalesce(s.fantasy_points, 0) desc,
    p.id
  limit 1;

  if v_player is null then
    raise exception 'No players are available to auto-pick.';
  end if;

  perform private.draft_make_pick(v_draft, v_player, null, true);
  return true;
end
$$;

-- ---------------------------------------------------------------------------
-- Fixing mistakes (commissioner)
-- ---------------------------------------------------------------------------

-- Undo the most recent pick and put that team back on the clock.
create function public.draft_undo_last_pick()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_draft public.drafts;
  v_pick public.draft_picks;
begin
  perform private.assert_commissioner();
  perform private.lock_league();
  v_draft := private.lock_draft();

  select * into v_pick
  from public.draft_picks
  where season = v_draft.season
  order by pick_number desc
  limit 1;

  if not found then
    raise exception 'There are no picks to undo.';
  end if;

  delete from public.roster_entries
  where team_id = v_pick.team_id and player_id = v_pick.player_id and reason = 'draft' and end_at is null;

  if not found then
    raise exception 'That roster has changed since the draft, so the pick can''t be undone.';
  end if;

  delete from public.draft_picks where season = v_pick.season and pick_number = v_pick.pick_number;

  update public.transactions
  set details = details || jsonb_build_object('undone', true)
  where type = 'draft_pick' and team_id = v_pick.team_id
    and (details ->> 'pick_number')::int = v_pick.pick_number
    and not coalesce((details ->> 'undone')::boolean, false);

  update public.drafts
  set current_pick = v_pick.pick_number,
      completed_at = null,
      status = case when status = 'paused' then 'paused' else 'in_progress' end,
      pick_deadline = case when status = 'paused' then null else private.draft_deadline(pick_seconds) end,
      paused_seconds_remaining = case when status = 'paused' then pick_seconds else null end
  where season = v_draft.season;

  perform private.log_tx(
    'commissioner', v_pick.team_id, (select auth.uid()),
    'Commissioner undid pick ' || v_pick.pick_number || ': ' || private.team_name(v_pick.team_id)
      || ' selecting ' || private.player_label(v_pick.player_id),
    jsonb_build_object(
      'action', 'draft_undo', 'pick_number', v_pick.pick_number,
      'player', private.player_json(v_pick.player_id)
    )
  );
end
$$;

-- Wipe the draft and start over, e.g. after a practice run. Only possible
-- while rosters are exactly what the draft produced.
create function public.draft_reset()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_draft public.drafts;
begin
  perform private.assert_commissioner();
  perform private.lock_league();
  v_draft := private.lock_draft();

  if exists (select 1 from public.roster_entries where reason <> 'draft' or end_at is not null) then
    raise exception 'Rosters have changed since the draft, so it can''t be reset.';
  end if;
  if exists (select 1 from public.player_game_points where team_id is not null) then
    raise exception 'Games have already been scored, so the draft can''t be reset.';
  end if;

  -- "where true": Supabase's API sessions refuse a delete with no where clause.
  delete from public.waiver_claims where true;
  delete from public.waivers where true;
  delete from public.roster_entries where true;
  delete from public.draft_picks where season = v_draft.season;
  delete from public.transactions
  where type = 'draft_pick'
    or (type = 'commissioner' and details ->> 'action' in (
      'draft_start', 'draft_pause', 'draft_resume', 'draft_undo', 'draft_complete', 'draft_reset'
    ));

  update public.drafts
  set status = 'not_started', current_pick = 1, pick_deadline = null, paused_seconds_remaining = null,
      started_at = null, completed_at = null
  where season = v_draft.season;

  perform private.log_tx(
    'commissioner', null, (select auth.uid()), 'Commissioner reset the draft.',
    jsonb_build_object('action', 'draft_reset')
  );
end
$$;
