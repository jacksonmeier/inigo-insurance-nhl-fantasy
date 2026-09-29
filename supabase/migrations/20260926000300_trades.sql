-- Trades.
--
-- An owner proposes, the other owner accepts, and the trade goes through once
-- the veto window passes, unless one of the owners who isn't part of it vetoes.
-- Only players in active slots can be traded. Players on IR and temporary IR
-- replacements can't, because their roster spot isn't permanent.

-- Returns what's wrong with a trade as it stands right now, or null if it's
-- fine. Checked when proposing, when accepting, and again when it executes.
create function private.trade_problem(p_trade_id uuid)
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v_trade public.trades;
  v_row record;
  v_team uuid;
  v_group text;
  v_after int;
begin
  select * into v_trade from public.trades where id = p_trade_id;

  if not exists (select 1 from public.trade_players where trade_id = p_trade_id) then
    return 'A trade needs at least one player.';
  end if;

  for v_row in
    select tp.player_id, tp.from_team_id, r.id as entry_id, r.slot, r.is_ir_replacement
    from public.trade_players tp
    left join public.roster_entries r
      on r.player_id = tp.player_id and r.team_id = tp.from_team_id and r.end_at is null
    where tp.trade_id = p_trade_id
  loop
    if v_row.from_team_id not in (v_trade.proposing_team_id, v_trade.receiving_team_id) then
      return 'Every player must come from one of the two teams.';
    end if;
    if v_row.entry_id is null then
      return private.player_label(v_row.player_id) || ' is no longer on ' || private.team_name(v_row.from_team_id) || '.';
    end if;
    if v_row.slot <> 'active' then
      return private.player_label(v_row.player_id) || ' is on IR and can''t be traded.';
    end if;
    if v_row.is_ir_replacement then
      return private.player_label(v_row.player_id) || ' is a temporary IR replacement and can''t be traded.';
    end if;
  end loop;

  -- Both rosters must fit the limits afterwards. A spot held open for a player
  -- on IR counts as taken, so a trade can't strand him with nowhere to return.
  foreach v_team in array array[v_trade.proposing_team_id, v_trade.receiving_team_id] loop
    foreach v_group in array array['F', 'D', 'G'] loop
      select private.active_count(v_team, v_group)
          + private.unreplaced_ir_count(v_team, v_group)
          - count(*) filter (where tp.from_team_id = v_team)
          + count(*) filter (where tp.from_team_id <> v_team)
        into v_after
      from public.trade_players tp
      join public.players p on p.id = tp.player_id
      where tp.trade_id = p_trade_id and p.position_group = v_group;

      if v_after > private.roster_limit(v_group) then
        return private.team_name(v_team) || ' would have too many ' || v_group || ' ('
          || v_after || ', limit ' || private.roster_limit(v_group) || ').';
      end if;
    end loop;
  end loop;

  return null;
end
$$;

-- "A gets X, Y; B gets Z"
create function private.trade_summary(p_trade_id uuid)
returns text
language sql stable
set search_path = ''
as $$
  select
    private.team_name(t.proposing_team_id) || ' gets '
      || coalesce((
        select string_agg(private.player_label(tp.player_id), ', ' order by tp.player_id)
        from public.trade_players tp
        where tp.trade_id = t.id and tp.from_team_id = t.receiving_team_id
      ), 'nothing')
      || '; ' || private.team_name(t.receiving_team_id) || ' gets '
      || coalesce((
        select string_agg(private.player_label(tp.player_id), ', ' order by tp.player_id)
        from public.trade_players tp
        where tp.trade_id = t.id and tp.from_team_id = t.proposing_team_id
      ), 'nothing')
  from public.trades t
  where t.id = p_trade_id;
$$;

create function private.trade_json(p_trade_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'trade_id', t.id,
    'proposing_team_id', t.proposing_team_id,
    'receiving_team_id', t.receiving_team_id,
    'players', coalesce((
      select jsonb_agg(private.player_json(tp.player_id) || jsonb_build_object('from_team_id', tp.from_team_id))
      from public.trade_players tp
      where tp.trade_id = t.id
    ), '[]'::jsonb)
  )
  from public.trades t
  where t.id = p_trade_id;
$$;

-- ---------------------------------------------------------------------------
-- Owner actions
-- ---------------------------------------------------------------------------

create function public.propose_trade(
  p_receiving_team_id uuid,
  p_give_player_ids bigint[],
  p_receive_player_ids bigint[],
  p_message text default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_team uuid := private.caller_team();
  v_trade_id uuid;
  v_problem text;
begin
  perform private.lock_league();
  perform private.assert_season_open();

  if p_receiving_team_id = v_team or not exists (select 1 from public.teams where id = p_receiving_team_id) then
    raise exception 'Choose another team to trade with.';
  end if;

  insert into public.trades (proposing_team_id, receiving_team_id, message)
  values (v_team, p_receiving_team_id, nullif(trim(p_message), ''))
  returning id into v_trade_id;

  insert into public.trade_players (trade_id, player_id, from_team_id)
  select v_trade_id, player_id, v_team
  from unnest(coalesce(p_give_player_ids, '{}')) as player_id
  union
  select v_trade_id, player_id, p_receiving_team_id
  from unnest(coalesce(p_receive_player_ids, '{}')) as player_id;

  v_problem := private.trade_problem(v_trade_id);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;

  perform private.alert(
    p_receiving_team_id, 'trade_response_needed',
    private.team_name(v_team) || ' proposed a trade: ' || private.trade_summary(v_trade_id) || '.',
    jsonb_build_object('trade_id', v_trade_id)
  );

  return v_trade_id;
end
$$;

create function public.respond_to_trade(p_trade_id uuid, p_accept boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_team uuid := private.caller_team();
  v_trade public.trades;
  v_problem text;
  v_deadline timestamptz;
  v_other record;
begin
  perform private.lock_league();

  select * into v_trade from public.trades where id = p_trade_id for update;
  if not found or v_trade.receiving_team_id <> v_team then
    raise exception 'That trade isn''t yours to answer.';
  end if;
  if v_trade.status <> 'proposed' then
    raise exception 'That trade is no longer open.';
  end if;

  if not p_accept then
    update public.trades set status = 'rejected', responded_at = now() where id = p_trade_id;
    perform private.alert(
      v_trade.proposing_team_id, 'trade_update',
      private.team_name(v_team) || ' rejected your trade offer.',
      jsonb_build_object('trade_id', p_trade_id)
    );
    return;
  end if;

  perform private.assert_season_open();
  v_problem := private.trade_problem(p_trade_id);
  if v_problem is not null then
    raise exception 'This trade can''t go through as offered: %', v_problem;
  end if;

  v_deadline := now() + private.window_length('tradeVetoHours');
  update public.trades
  set status = 'accepted', responded_at = now(), veto_deadline = v_deadline
  where id = p_trade_id;

  perform private.log_tx(
    'trade', v_trade.proposing_team_id, (select auth.uid()),
    'Trade agreed: ' || private.trade_summary(p_trade_id) || '. It goes through after the veto window.',
    private.trade_json(p_trade_id) || jsonb_build_object('stage', 'accepted', 'veto_deadline', v_deadline)
  );

  perform private.alert(
    v_trade.proposing_team_id, 'trade_update',
    private.team_name(v_team) || ' accepted your trade. It goes through after the veto window.',
    jsonb_build_object('trade_id', p_trade_id)
  );

  for v_other in
    select id from public.teams
    where id not in (v_trade.proposing_team_id, v_trade.receiving_team_id)
  loop
    perform private.alert(
      v_other.id, 'trade_update',
      'Trade pending: ' || private.trade_summary(p_trade_id) || '. You can veto it during the veto window.',
      jsonb_build_object('trade_id', p_trade_id)
    );
  end loop;
end
$$;

create function public.withdraw_trade(p_trade_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_team uuid := private.caller_team();
  v_trade public.trades;
begin
  perform private.lock_league();

  select * into v_trade from public.trades where id = p_trade_id for update;
  if not found or v_trade.proposing_team_id <> v_team then
    raise exception 'That trade isn''t yours to withdraw.';
  end if;
  if v_trade.status <> 'proposed' then
    raise exception 'Only an offer that hasn''t been answered can be withdrawn.';
  end if;

  update public.trades set status = 'withdrawn', responded_at = now() where id = p_trade_id;

  perform private.alert(
    v_trade.receiving_team_id, 'trade_update',
    private.team_name(v_team) || ' withdrew their trade offer.',
    jsonb_build_object('trade_id', p_trade_id)
  );
end
$$;

-- One veto from an owner who isn't part of the trade cancels it.
create function public.veto_trade(p_trade_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_team uuid := private.caller_team();
  v_trade public.trades;
begin
  perform private.lock_league();

  select * into v_trade from public.trades where id = p_trade_id for update;
  if not found then
    raise exception 'Unknown trade.';
  end if;
  if v_team in (v_trade.proposing_team_id, v_trade.receiving_team_id) then
    raise exception 'You can''t veto your own trade.';
  end if;
  if v_trade.status <> 'accepted' or v_trade.veto_deadline <= now() then
    raise exception 'The veto window for that trade isn''t open.';
  end if;

  insert into public.trade_vetoes (trade_id, team_id) values (p_trade_id, v_team);
  update public.trades set status = 'vetoed', processed_at = now() where id = p_trade_id;

  perform private.log_tx(
    'trade_veto', v_team, (select auth.uid()),
    private.team_name(v_team) || ' vetoed the trade: ' || private.trade_summary(p_trade_id),
    private.trade_json(p_trade_id)
  );

  perform private.alert(
    v_trade.proposing_team_id, 'trade_update',
    private.team_name(v_team) || ' vetoed your trade with ' || private.team_name(v_trade.receiving_team_id) || '.',
    jsonb_build_object('trade_id', p_trade_id)
  );
  perform private.alert(
    v_trade.receiving_team_id, 'trade_update',
    private.team_name(v_team) || ' vetoed your trade with ' || private.team_name(v_trade.proposing_team_id) || '.',
    jsonb_build_object('trade_id', p_trade_id)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Processing
-- ---------------------------------------------------------------------------

-- Moves the players. If the trade is no longer valid (a player was dropped in
-- the meantime, say) it's marked failed and both owners are told why.
create function private.execute_trade(p_trade_id uuid, p_actor uuid default null)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_trade public.trades;
  v_now timestamptz := now();
  v_problem text;
  v_row record;
begin
  select * into v_trade from public.trades where id = p_trade_id and status = 'accepted' for update;
  if not found then
    return 'not_accepted';
  end if;

  v_problem := private.trade_problem(p_trade_id);
  if v_problem is not null then
    update public.trades set status = 'failed', processed_at = v_now where id = p_trade_id;

    perform private.log_tx(
      'trade', v_trade.proposing_team_id, p_actor,
      'Trade cancelled: ' || private.trade_summary(p_trade_id) || '. ' || v_problem,
      private.trade_json(p_trade_id) || jsonb_build_object('stage', 'failed', 'problem', v_problem)
    );
    perform private.alert(
      v_trade.proposing_team_id, 'trade_update', 'Your trade was cancelled. ' || v_problem,
      jsonb_build_object('trade_id', p_trade_id)
    );
    perform private.alert(
      v_trade.receiving_team_id, 'trade_update', 'Your trade was cancelled. ' || v_problem,
      jsonb_build_object('trade_id', p_trade_id)
    );
    return 'failed';
  end if;

  -- Everyone leaves first, then everyone arrives, so the limits hold throughout.
  for v_row in select player_id, from_team_id from public.trade_players where trade_id = p_trade_id loop
    perform private.do_drop(v_row.from_team_id, v_row.player_id, v_now, false);
  end loop;

  for v_row in select player_id, from_team_id from public.trade_players where trade_id = p_trade_id loop
    perform private.do_add(
      case
        when v_row.from_team_id = v_trade.proposing_team_id then v_trade.receiving_team_id
        else v_trade.proposing_team_id
      end,
      v_row.player_id, 'trade', v_now
    );
  end loop;

  update public.trades set status = 'completed', processed_at = v_now where id = p_trade_id;

  perform private.log_tx(
    'trade', v_trade.proposing_team_id, p_actor,
    'Trade completed: ' || private.trade_summary(p_trade_id),
    private.trade_json(p_trade_id) || jsonb_build_object('stage', 'completed')
  );
  perform private.alert(
    v_trade.proposing_team_id, 'trade_update',
    'Your trade went through: ' || private.trade_summary(p_trade_id) || '.',
    jsonb_build_object('trade_id', p_trade_id)
  );
  perform private.alert(
    v_trade.receiving_team_id, 'trade_update',
    'Your trade went through: ' || private.trade_summary(p_trade_id) || '.',
    jsonb_build_object('trade_id', p_trade_id)
  );

  return 'completed';
end
$$;

create function private.process_trades()
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  for v_id in
    select id from public.trades
    where status = 'accepted' and veto_deadline <= now()
    order by veto_deadline, created_at
  loop
    perform private.execute_trade(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;
