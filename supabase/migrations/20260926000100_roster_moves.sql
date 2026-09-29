-- Free agency and waivers.
--
-- A roster is valid when no position group has more active players than
-- LEAGUE.roster allows. A roster may be short (an open slot simply scores
-- nothing), which is what lets an owner drop first and add later.

-- ---------------------------------------------------------------------------
-- Building blocks shared by every kind of roster move
-- ---------------------------------------------------------------------------

-- Takes a player off a roster. Handles the IR side effects:
--   * dropping a player who is on IR ends his IR stint and makes his temporary
--     replacement a permanent roster player;
--   * dropping a temporary replacement leaves the IR vacancy open again.
create function private.do_drop(p_team uuid, p_player bigint, p_now timestamptz, p_to_waivers boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_entry public.roster_entries;
  v_stint public.ir_stints;
begin
  select * into v_entry
  from public.roster_entries
  where team_id = p_team and player_id = p_player and end_at is null
  for update;

  if not found then
    raise exception '% is not on that roster.', coalesce(private.player_label(p_player), 'That player');
  end if;

  if v_entry.start_at >= p_now then
    -- Added and removed at the same instant: he was never really there.
    delete from public.roster_entries where id = v_entry.id;
  else
    update public.roster_entries set end_at = p_now where id = v_entry.id;
  end if;

  if v_entry.slot = 'ir' then
    select * into v_stint
    from public.ir_stints
    where team_id = p_team and ir_player_id = p_player and resolved_at is null
    for update;

    if found then
      update public.ir_stints
      set resolved_at = p_now, resolution = 'dropped'
      where id = v_stint.id;

      if v_stint.replacement_player_id is not null then
        update public.roster_entries
        set is_ir_replacement = false
        where team_id = p_team and player_id = v_stint.replacement_player_id and end_at is null;
      end if;
    end if;
  elsif v_entry.is_ir_replacement then
    update public.ir_stints
    set replacement_player_id = null
    where team_id = p_team and replacement_player_id = p_player and resolved_at is null;
  end if;

  if p_to_waivers then
    insert into public.waivers (player_id, dropped_by_team_id, created_at, expires_at)
    values (p_player, p_team, p_now, p_now + private.window_length('waiverHours'));
  end if;
end
$$;

-- Puts a player in an active slot. Returns true when he fills the spot of a
-- player on IR, which makes him that player's temporary replacement.
create function private.do_add(p_team uuid, p_player bigint, p_reason text, p_now timestamptz)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_group text;
  v_open int;
  v_stint_id uuid;
  v_is_replacement boolean := false;
begin
  select position_group into v_group from public.players where id = p_player;
  if not found then
    raise exception 'Unknown player.';
  end if;

  if exists (select 1 from public.roster_entries where player_id = p_player and end_at is null) then
    raise exception '% is already on a roster.', private.player_label(p_player);
  end if;

  v_open := private.roster_limit(v_group) - private.active_count(p_team, v_group);
  if v_open <= 0 then
    raise exception 'No open % slot. Drop a % first.', v_group, v_group;
  end if;

  -- If the only open slots are ones vacated by injured players, this add is a
  -- temporary replacement. Trades never are (see private.trade_problem).
  if p_reason in ('free_agent', 'waiver') and v_open <= private.unreplaced_ir_count(p_team, v_group) then
    select s.id into v_stint_id
    from public.ir_stints s
    join public.players ip on ip.id = s.ir_player_id
    where s.team_id = p_team and s.resolved_at is null and s.replacement_player_id is null
      and ip.position_group = v_group
    order by s.placed_at
    limit 1
    for update of s;

    v_is_replacement := v_stint_id is not null;
  end if;

  insert into public.roster_entries (team_id, player_id, slot, is_ir_replacement, reason, start_at)
  values (p_team, p_player, 'active', v_is_replacement, p_reason, p_now);

  if v_is_replacement then
    update public.ir_stints set replacement_player_id = p_player where id = v_stint_id;
  end if;

  return v_is_replacement;
end
$$;

-- ---------------------------------------------------------------------------
-- Free agency
-- ---------------------------------------------------------------------------

-- Add a free agent, optionally dropping someone in the same move.
create function public.add_player(p_player_id bigint, p_drop_player_id bigint default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_team uuid := private.caller_team();
  v_now timestamptz := now();
  v_is_replacement boolean;
  v_summary text;
begin
  perform private.lock_league();
  perform private.assert_season_open();

  if not exists (select 1 from public.players where id = p_player_id) then
    raise exception 'Unknown player.';
  end if;

  if exists (select 1 from public.waivers where player_id = p_player_id and status = 'open') then
    raise exception '% is on waivers. Place a claim instead.', private.player_label(p_player_id);
  end if;

  if p_drop_player_id is not null then
    if p_drop_player_id = p_player_id then
      raise exception 'Pick a different player to drop.';
    end if;
    perform private.do_drop(v_team, p_drop_player_id, v_now, true);
  end if;

  v_is_replacement := private.do_add(v_team, p_player_id, 'free_agent', v_now);

  v_summary := private.team_name(v_team) || ' added ' || private.player_label(p_player_id);
  if v_is_replacement then
    v_summary := v_summary || ' as a temporary IR replacement';
  end if;
  if p_drop_player_id is not null then
    v_summary := v_summary || ' and dropped ' || private.player_label(p_drop_player_id);
  end if;

  perform private.log_tx('add', v_team, (select auth.uid()), v_summary, jsonb_build_object(
    'added', private.player_json(p_player_id),
    'dropped', private.player_json(p_drop_player_id),
    'ir_replacement', v_is_replacement
  ));
end
$$;

-- Drop a player. He goes on waivers for LEAGUE.windows.waiverHours.
create function public.drop_player(p_player_id bigint)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_team uuid := private.caller_team();
  v_now timestamptz := now();
begin
  perform private.lock_league();
  perform private.assert_season_open();
  perform private.do_drop(v_team, p_player_id, v_now, true);

  perform private.log_tx(
    'drop', v_team, (select auth.uid()),
    private.team_name(v_team) || ' dropped ' || private.player_label(p_player_id),
    jsonb_build_object('dropped', private.player_json(p_player_id))
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Waivers
-- ---------------------------------------------------------------------------

-- Place (or update) a claim on a player who is on waivers.
create function public.claim_waiver(p_player_id bigint, p_drop_player_id bigint default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_team uuid := private.caller_team();
  v_waiver public.waivers;
  v_group text;
  v_drop_group text;
  v_open int;
begin
  perform private.lock_league();
  perform private.assert_season_open();

  select * into v_waiver
  from public.waivers
  where player_id = p_player_id and status = 'open'
  for update;

  if not found then
    raise exception '% is not on waivers.', coalesce(private.player_label(p_player_id), 'That player');
  end if;
  if v_waiver.expires_at <= now() then
    raise exception 'The waiver window for % has closed.', private.player_label(p_player_id);
  end if;

  select position_group into v_group from public.players where id = p_player_id;
  v_open := private.roster_limit(v_group) - private.active_count(v_team, v_group);

  if p_drop_player_id is not null then
    select p.position_group into v_drop_group
    from public.roster_entries r
    join public.players p on p.id = r.player_id
    where r.team_id = v_team and r.player_id = p_drop_player_id and r.end_at is null and r.slot = 'active';

    if not found then
      raise exception '% is not on your active roster.', coalesce(private.player_label(p_drop_player_id), 'That player');
    end if;
    if v_drop_group = v_group then
      v_open := v_open + 1;
    end if;
  end if;

  if v_open <= 0 then
    raise exception 'No open % slot. Choose a % to drop if your claim wins.', v_group, v_group;
  end if;

  insert into public.waiver_claims (waiver_id, team_id, drop_player_id)
  values (v_waiver.id, v_team, p_drop_player_id)
  on conflict (waiver_id, team_id) do update
    set drop_player_id = excluded.drop_player_id, status = 'pending', created_at = now();
end
$$;

create function public.withdraw_waiver_claim(p_player_id bigint)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_team uuid := private.caller_team();
begin
  perform private.lock_league();

  update public.waiver_claims c
  set status = 'withdrawn'
  from public.waivers w
  where w.id = c.waiver_id and w.player_id = p_player_id and w.status = 'open'
    and c.team_id = v_team and c.status = 'pending';

  if not found then
    raise exception 'You don''t have a pending claim on that player.';
  end if;
end
$$;

-- Resolve one waiver. The claim from the owner lowest on the leaderboard wins;
-- ties go to whoever claimed first. A claim that would leave its roster
-- invalid is skipped.
create function private.process_waiver(p_waiver_id uuid, p_actor uuid default null)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_waiver public.waivers;
  v_now timestamptz := now();
  v_claim record;
  v_group text;
  v_drop_group text;
  v_open int;
  v_winner uuid;
  v_is_replacement boolean;
  v_summary text;
begin
  select * into v_waiver from public.waivers where id = p_waiver_id and status = 'open' for update;
  if not found then
    return 'not_open';
  end if;

  select position_group into v_group from public.players where id = v_waiver.player_id;

  for v_claim in
    select c.id, c.team_id, c.drop_player_id
    from public.waiver_claims c
    join public.team_standings s on s.team_id = c.team_id
    where c.waiver_id = p_waiver_id and c.status = 'pending'
    order by s.total_points asc, s.total_goals asc, c.created_at asc
  loop
    if v_winner is not null then
      update public.waiver_claims set status = 'lost' where id = v_claim.id;
      perform private.alert(
        v_claim.team_id, 'waiver_processed',
        'Your claim on ' || private.player_label(v_waiver.player_id) || ' lost to ' || private.team_name(v_winner) || '.',
        jsonb_build_object('player_id', v_waiver.player_id, 'won', false)
      );
      continue;
    end if;

    -- Would the claim leave the roster valid right now?
    v_open := private.roster_limit(v_group) - private.active_count(v_claim.team_id, v_group);
    v_drop_group := null;
    if v_claim.drop_player_id is not null then
      select p.position_group into v_drop_group
      from public.roster_entries r
      join public.players p on p.id = r.player_id
      where r.team_id = v_claim.team_id and r.player_id = v_claim.drop_player_id
        and r.end_at is null and r.slot = 'active';

      if v_drop_group = v_group then
        v_open := v_open + 1;
      end if;
    end if;

    if v_open <= 0 or (v_claim.drop_player_id is not null and v_drop_group is null) then
      update public.waiver_claims set status = 'invalid' where id = v_claim.id;
      perform private.alert(
        v_claim.team_id, 'waiver_processed',
        'Your claim on ' || private.player_label(v_waiver.player_id)
          || ' couldn''t be processed because your roster had no room for him.',
        jsonb_build_object('player_id', v_waiver.player_id, 'won', false)
      );
      continue;
    end if;

    -- Close this waiver first so the player counts as available.
    update public.waivers
    set status = 'awarded', awarded_team_id = v_claim.team_id, processed_at = v_now
    where id = p_waiver_id;

    if v_claim.drop_player_id is not null then
      perform private.do_drop(v_claim.team_id, v_claim.drop_player_id, v_now, true);
    end if;
    v_is_replacement := private.do_add(v_claim.team_id, v_waiver.player_id, 'waiver', v_now);

    update public.waiver_claims set status = 'won' where id = v_claim.id;
    v_winner := v_claim.team_id;

    v_summary := private.team_name(v_winner) || ' claimed ' || private.player_label(v_waiver.player_id) || ' off waivers';
    if v_is_replacement then
      v_summary := v_summary || ' as a temporary IR replacement';
    end if;
    if v_claim.drop_player_id is not null then
      v_summary := v_summary || ' and dropped ' || private.player_label(v_claim.drop_player_id);
    end if;

    perform private.log_tx('waiver_claim', v_winner, p_actor, v_summary, jsonb_build_object(
      'added', private.player_json(v_waiver.player_id),
      'dropped', private.player_json(v_claim.drop_player_id),
      'ir_replacement', v_is_replacement
    ));
    perform private.alert(
      v_winner, 'waiver_processed',
      'Your claim on ' || private.player_label(v_waiver.player_id) || ' won. He''s on your roster.',
      jsonb_build_object('player_id', v_waiver.player_id, 'won', true)
    );
  end loop;

  if v_winner is null then
    update public.waivers set status = 'cleared', processed_at = v_now where id = p_waiver_id;
    return 'cleared';
  end if;

  return 'awarded';
end
$$;

create function private.process_waivers()
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  for v_id in
    select id from public.waivers where status = 'open' and expires_at <= now() order by expires_at, created_at
  loop
    perform private.process_waiver(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;
