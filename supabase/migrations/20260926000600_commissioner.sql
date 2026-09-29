-- Commissioner tools. Every one of them writes a 'commissioner' row to the
-- transactions log, which the whole league can read.

create function private.log_commissioner(p_team uuid, p_summary text, p_details jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.log_tx('commissioner', p_team, (select auth.uid()), 'Commissioner: ' || p_summary, p_details);
end
$$;

-- ---------------------------------------------------------------------------
-- Roster corrections
-- ---------------------------------------------------------------------------

-- Put a player on a team's active roster, skipping free agency and waivers.
-- p_effective_at backdates the move so points from games already played are
-- credited correctly.
create function public.commish_add_to_roster(
  p_team_id uuid,
  p_player_id bigint,
  p_effective_at timestamptz default null,
  p_note text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(p_effective_at, now());
begin
  perform private.assert_commissioner();
  perform private.lock_league();

  if not exists (select 1 from public.teams where id = p_team_id) then
    raise exception 'Unknown team.';
  end if;
  if v_at > now() then
    raise exception 'The effective time can''t be in the future.';
  end if;

  update public.waivers
  set status = 'cancelled', processed_at = now()
  where player_id = p_player_id and status = 'open';

  perform private.do_add(p_team_id, p_player_id, 'commissioner', v_at);
  perform private.reattribute(array[p_player_id], v_at);

  perform private.log_commissioner(
    p_team_id,
    'added ' || private.player_label(p_player_id) || ' to ' || private.team_name(p_team_id)
      || coalesce('. ' || nullif(trim(p_note), ''), ''),
    jsonb_build_object(
      'action', 'roster_add', 'player', private.player_json(p_player_id),
      'effective_at', v_at, 'note', p_note
    )
  );
end
$$;

-- Take a player off whatever roster he's on. He becomes a free agent unless
-- p_to_waivers is set.
create function public.commish_remove_from_roster(
  p_player_id bigint,
  p_to_waivers boolean default false,
  p_effective_at timestamptz default null,
  p_note text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(p_effective_at, now());
  v_team uuid;
begin
  perform private.assert_commissioner();
  perform private.lock_league();

  select team_id into v_team from public.roster_entries where player_id = p_player_id and end_at is null;
  if v_team is null then
    raise exception '% is not on a roster.', coalesce(private.player_label(p_player_id), 'That player');
  end if;
  if v_at > now() then
    raise exception 'The effective time can''t be in the future.';
  end if;

  perform private.do_drop(v_team, p_player_id, v_at, p_to_waivers);
  perform private.reattribute(array[p_player_id], v_at);

  perform private.log_commissioner(
    v_team,
    'removed ' || private.player_label(p_player_id) || ' from ' || private.team_name(v_team)
      || coalesce('. ' || nullif(trim(p_note), ''), ''),
    jsonb_build_object(
      'action', 'roster_remove', 'player', private.player_json(p_player_id),
      'effective_at', v_at, 'to_waivers', p_to_waivers, 'note', p_note
    )
  );
end
$$;

-- Move a player to IR even if ESPN doesn't list him as out, for when the
-- injury feed is wrong or the player couldn't be matched.
create function public.commish_place_on_ir(p_player_id bigint, p_note text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_entry public.roster_entries;
begin
  perform private.assert_commissioner();
  perform private.lock_league();

  select * into v_entry
  from public.roster_entries
  where player_id = p_player_id and end_at is null
  for update;

  if not found or v_entry.slot <> 'active' or v_entry.is_ir_replacement then
    raise exception 'Only a regular active player can be moved to IR.';
  end if;
  if (
    select count(*) from public.roster_entries
    where team_id = v_entry.team_id and slot = 'ir' and end_at is null
  ) >= (private.config() ->> 'irSlots')::int then
    raise exception 'That team''s IR slot is full.';
  end if;

  update public.roster_entries set end_at = v_now where id = v_entry.id;
  insert into public.roster_entries (team_id, player_id, slot, reason, start_at)
  values (v_entry.team_id, p_player_id, 'ir', 'commissioner', v_now);
  insert into public.ir_stints (team_id, ir_player_id, placed_at)
  values (v_entry.team_id, p_player_id, v_now);

  perform private.log_commissioner(
    v_entry.team_id,
    'placed ' || private.player_label(p_player_id) || ' on IR for ' || private.team_name(v_entry.team_id)
      || coalesce('. ' || nullif(trim(p_note), ''), ''),
    jsonb_build_object('action', 'ir_place', 'player', private.player_json(p_player_id), 'note', p_note)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Point corrections
-- ---------------------------------------------------------------------------

create function public.commish_adjust_points(
  p_team_id uuid, p_points numeric, p_reason text, p_goals int default 0
)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.assert_commissioner();

  if not exists (select 1 from public.teams where id = p_team_id) then
    raise exception 'Unknown team.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason so the league knows why.';
  end if;
  if coalesce(p_points, 0) = 0 and coalesce(p_goals, 0) = 0 then
    raise exception 'Enter the points or goals to add or take away.';
  end if;

  insert into public.point_adjustments (team_id, points, goals, reason, created_by)
  values (p_team_id, coalesce(p_points, 0), coalesce(p_goals, 0), trim(p_reason), (select auth.uid()));

  perform private.log_commissioner(
    p_team_id,
    'adjusted ' || private.team_name(p_team_id) || ' by '
      || case when coalesce(p_points, 0) >= 0 then '+' else '' end || trim(to_char(coalesce(p_points, 0), 'FM999990.00'))
      || ' points'
      || case when coalesce(p_goals, 0) <> 0 then ' and ' || p_goals || ' goals' else '' end
      || '. ' || trim(p_reason),
    jsonb_build_object('action', 'point_adjustment', 'points', p_points, 'goals', p_goals, 'reason', p_reason)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Unsticking things
-- ---------------------------------------------------------------------------

-- Run the scheduled processing right now for anything that's due.
create function public.commish_process_now()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.assert_commissioner();
  return public.process_windows();
end
$$;

-- Resolve a waiver without waiting for its window to close.
create function public.commish_force_waiver(p_waiver_id uuid)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_player bigint;
  v_result text;
begin
  perform private.assert_commissioner();
  perform private.lock_league();

  select player_id into v_player from public.waivers where id = p_waiver_id and status = 'open';
  if v_player is null then
    raise exception 'That waiver is already resolved.';
  end if;

  v_result := private.process_waiver(p_waiver_id, (select auth.uid()));

  perform private.log_commissioner(
    null,
    'processed waivers early for ' || private.player_label(v_player)
      || case v_result when 'awarded' then '' else ' (no valid claims, so he''s a free agent)' end,
    jsonb_build_object('action', 'force_waiver', 'player', private.player_json(v_player), 'result', v_result)
  );
  return v_result;
end
$$;

-- Push an accepted trade through now, or cancel a trade that's still pending.
create function public.commish_force_trade(p_trade_id uuid, p_execute boolean)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_trade public.trades;
  v_result text;
begin
  perform private.assert_commissioner();
  perform private.lock_league();

  select * into v_trade from public.trades where id = p_trade_id for update;
  if not found or v_trade.status not in ('proposed', 'accepted') then
    raise exception 'That trade is already settled.';
  end if;

  if p_execute then
    if v_trade.status <> 'accepted' then
      raise exception 'Both owners have to agree before a trade can go through.';
    end if;
    v_result := private.execute_trade(p_trade_id, (select auth.uid()));
    perform private.log_commissioner(
      null, 'pushed a trade through early: ' || private.trade_summary(p_trade_id),
      private.trade_json(p_trade_id) || jsonb_build_object('action', 'force_trade', 'result', v_result)
    );
    return v_result;
  end if;

  update public.trades set status = 'vetoed', processed_at = now() where id = p_trade_id;

  perform private.alert(
    v_trade.proposing_team_id, 'trade_update', 'The commissioner cancelled your trade.',
    jsonb_build_object('trade_id', p_trade_id)
  );
  perform private.alert(
    v_trade.receiving_team_id, 'trade_update', 'The commissioner cancelled your trade.',
    jsonb_build_object('trade_id', p_trade_id)
  );
  perform private.log_commissioner(
    null, 'cancelled a trade: ' || private.trade_summary(p_trade_id),
    private.trade_json(p_trade_id) || jsonb_build_object('action', 'cancel_trade')
  );
  return 'cancelled';
end
$$;

-- Settle an IR stint: 'activate' brings the injured player back,
-- 'keep_replacement' keeps the replacement and drops the injured player.
create function public.commish_force_ir(p_stint_id uuid, p_action text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.assert_commissioner();
  perform private.lock_league();

  if p_action = 'activate' then
    perform private.ir_activate(p_stint_id, 'commissioner', (select auth.uid()));
  elsif p_action = 'keep_replacement' then
    perform private.ir_keep_replacement(p_stint_id, 'commissioner', (select auth.uid()));
  else
    raise exception 'Unknown action.';
  end if;

  perform private.log_commissioner(
    (select team_id from public.ir_stints where id = p_stint_id),
    'settled an IR stint ('
      || case p_action when 'activate' then 'activated the injured player' else 'kept the replacement' end || ')',
    jsonb_build_object('action', 'force_ir', 'stint_id', p_stint_id, 'choice', p_action)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- ESPN player matching
-- ---------------------------------------------------------------------------

-- Link an ESPN athlete to the right NHL player (or to nobody, with null).
-- Manual links are never overwritten by the automatic matcher.
create function public.commish_map_espn_player(p_espn_athlete_id text, p_player_id bigint)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_map public.espn_player_map;
begin
  perform private.assert_commissioner();
  perform private.lock_league();

  select * into v_map from public.espn_player_map where espn_athlete_id = p_espn_athlete_id for update;
  if not found then
    raise exception 'Unknown ESPN player.';
  end if;
  if p_player_id is not null and not exists (select 1 from public.players where id = p_player_id) then
    raise exception 'Unknown NHL player.';
  end if;

  update public.espn_player_map
  set player_id = p_player_id, match_confidence = 'manual', updated_at = now()
  where espn_athlete_id = p_espn_athlete_id;

  update public.player_injuries
  set player_id = p_player_id
  where espn_athlete_id = p_espn_athlete_id;

  perform private.log_commissioner(
    null,
    'matched ESPN''s ' || v_map.espn_name || ' to '
      || coalesce(private.player_label(p_player_id), 'no NHL player'),
    jsonb_build_object(
      'action', 'espn_map', 'espn_athlete_id', p_espn_athlete_id,
      'player', private.player_json(p_player_id)
    )
  );
end
$$;
