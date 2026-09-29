-- Injured reserve.
--
-- A player ESPN lists as Out or Injured Reserve can be moved to the team's IR
-- slot. That opens his active slot for a temporary replacement from free
-- agency (see private.do_add). When he's healthy again the owner has
-- LEAGUE.windows.irReturnDecisionHours to choose between him and the
-- replacement; after that he's activated automatically.

create function public.place_on_ir(p_player_id bigint)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_team uuid := private.caller_team();
  v_now timestamptz := now();
  v_entry public.roster_entries;
  v_status text;
begin
  perform private.lock_league();
  perform private.assert_season_open();

  select * into v_entry
  from public.roster_entries
  where team_id = v_team and player_id = p_player_id and end_at is null
  for update;

  if not found then
    raise exception '% is not on your roster.', coalesce(private.player_label(p_player_id), 'That player');
  end if;
  if v_entry.slot = 'ir' then
    raise exception '% is already on IR.', private.player_label(p_player_id);
  end if;
  if v_entry.is_ir_replacement then
    raise exception '% is a temporary replacement. Drop him instead.', private.player_label(p_player_id);
  end if;

  if (
    select count(*) from public.roster_entries
    where team_id = v_team and slot = 'ir' and end_at is null
  ) >= (private.config() ->> 'irSlots')::int then
    raise exception 'Your IR slot is full.';
  end if;

  select status into v_status
  from public.player_injuries
  where player_id = p_player_id and is_ir_eligible
  limit 1;

  if not found then
    raise exception '% isn''t listed as Out or on Injured Reserve, so he can''t go on IR.',
      private.player_label(p_player_id);
  end if;

  update public.roster_entries set end_at = v_now where id = v_entry.id;

  insert into public.roster_entries (team_id, player_id, slot, reason, start_at)
  values (v_team, p_player_id, 'ir', 'ir_place', v_now);

  insert into public.ir_stints (team_id, ir_player_id, placed_at)
  values (v_team, p_player_id, v_now);

  perform private.log_tx(
    'ir_place', v_team, (select auth.uid()),
    private.team_name(v_team) || ' placed ' || private.player_label(p_player_id) || ' on IR (' || v_status || ')',
    jsonb_build_object('player', private.player_json(p_player_id), 'status', v_status)
  );
end
$$;

-- Brings the injured player back. His temporary replacement, if there is one,
-- is released straight to free agency.
create function private.ir_activate(p_stint_id uuid, p_resolution text, p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_stint public.ir_stints;
  v_now timestamptz := now();
  v_group text;
  v_summary text;
begin
  select * into v_stint from public.ir_stints where id = p_stint_id and resolved_at is null for update;
  if not found then
    raise exception 'That IR stint is already resolved.';
  end if;

  select position_group into v_group from public.players where id = v_stint.ir_player_id;

  if v_stint.replacement_player_id is not null then
    update public.roster_entries
    set end_at = v_now
    where team_id = v_stint.team_id and player_id = v_stint.replacement_player_id and end_at is null;
  end if;

  if private.active_count(v_stint.team_id, v_group) >= private.roster_limit(v_group) then
    raise exception 'No open % slot for %. Drop a % first.',
      v_group, private.player_label(v_stint.ir_player_id), v_group;
  end if;

  update public.roster_entries
  set end_at = v_now
  where team_id = v_stint.team_id and player_id = v_stint.ir_player_id and slot = 'ir' and end_at is null;

  insert into public.roster_entries (team_id, player_id, slot, reason, start_at)
  values (v_stint.team_id, v_stint.ir_player_id, 'active', 'ir_activate', v_now);

  update public.ir_stints set resolved_at = v_now, resolution = p_resolution where id = p_stint_id;

  v_summary := private.team_name(v_stint.team_id) || ' activated '
    || private.player_label(v_stint.ir_player_id) || ' from IR';
  if p_resolution = 'auto_activated' then
    v_summary := private.player_label(v_stint.ir_player_id) || ' was activated from IR automatically for '
      || private.team_name(v_stint.team_id);
  end if;
  if v_stint.replacement_player_id is not null then
    v_summary := v_summary || '. ' || private.player_label(v_stint.replacement_player_id)
      || ' was released to free agency';
  end if;

  perform private.log_tx(
    'ir_activate', v_stint.team_id, p_actor, v_summary,
    jsonb_build_object(
      'player', private.player_json(v_stint.ir_player_id),
      'released', private.player_json(v_stint.replacement_player_id),
      'resolution', p_resolution
    )
  );
end
$$;

-- Keeps the replacement for good and drops the injured player to waivers.
create function private.ir_keep_replacement(p_stint_id uuid, p_resolution text, p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_stint public.ir_stints;
  v_now timestamptz := now();
begin
  select * into v_stint from public.ir_stints where id = p_stint_id and resolved_at is null for update;
  if not found then
    raise exception 'That IR stint is already resolved.';
  end if;
  if v_stint.replacement_player_id is null then
    raise exception 'There''s no replacement to keep. Drop % instead.', private.player_label(v_stint.ir_player_id);
  end if;

  -- do_drop ends the stint and makes the replacement permanent.
  perform private.do_drop(v_stint.team_id, v_stint.ir_player_id, v_now, true);
  update public.ir_stints set resolution = p_resolution where id = p_stint_id;

  perform private.log_tx(
    'ir_keep_replacement', v_stint.team_id, p_actor,
    private.team_name(v_stint.team_id) || ' kept ' || private.player_label(v_stint.replacement_player_id)
      || ' and dropped ' || private.player_label(v_stint.ir_player_id) || ' from IR',
    jsonb_build_object(
      'kept', private.player_json(v_stint.replacement_player_id),
      'dropped', private.player_json(v_stint.ir_player_id),
      'resolution', p_resolution
    )
  );
end
$$;

create function private.my_open_stint(p_team uuid, p_player bigint)
returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.ir_stints
  where team_id = p_team and ir_player_id = p_player and resolved_at is null;

  if v_id is null then
    raise exception '% is not on your IR.', coalesce(private.player_label(p_player), 'That player');
  end if;
  return v_id;
end
$$;

create function public.activate_from_ir(p_player_id bigint)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_team uuid := private.caller_team();
begin
  perform private.lock_league();
  perform private.ir_activate(private.my_open_stint(v_team, p_player_id), 'activated', (select auth.uid()));
end
$$;

create function public.keep_ir_replacement(p_player_id bigint)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_team uuid := private.caller_team();
begin
  perform private.lock_league();
  perform private.ir_keep_replacement(
    private.my_open_stint(v_team, p_player_id), 'kept_replacement', (select auth.uid())
  );
end
$$;

-- Activates every healthy player whose decision window has run out. If a
-- roster has no room (which takes a commissioner edit to cause), the owner is
-- told and the stint waits for them or the commissioner.
create function private.process_ir()
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_stint record;
  v_count int := 0;
begin
  for v_stint in
    select id, team_id, ir_player_id
    from public.ir_stints
    where resolved_at is null and decision_deadline is not null and decision_deadline <= now()
    order by decision_deadline
  loop
    begin
      perform private.ir_activate(v_stint.id, 'auto_activated', null);
      v_count := v_count + 1;
    exception when raise_exception then
      update public.ir_stints set decision_deadline = null where id = v_stint.id;
      perform private.alert(
        v_stint.team_id, 'general',
        private.player_label(v_stint.ir_player_id)
          || ' couldn''t be activated from IR automatically: ' || sqlerrm,
        jsonb_build_object('player_id', v_stint.ir_player_id)
      );
    end;
  end loop;
  return v_count;
end
$$;

-- ---------------------------------------------------------------------------
-- Everything with a deadline, in one call. Runs every 15 minutes from cron.
-- ---------------------------------------------------------------------------

create function public.process_windows()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_waivers int;
  v_trades int;
  v_ir int;
begin
  perform private.lock_league();
  -- IR first so released replacements are free agents, then trades, then
  -- waivers, so a claim sees rosters as they'll be.
  v_ir := private.process_ir();
  v_trades := private.process_trades();
  v_waivers := private.process_waivers();
  return jsonb_build_object('ir', v_ir, 'trades', v_trades, 'waivers', v_waivers);
end
$$;
