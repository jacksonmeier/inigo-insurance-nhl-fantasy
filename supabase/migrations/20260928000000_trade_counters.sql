-- Counter-offers. The owner a trade was offered to can answer with a trade of
-- their own instead of a plain yes or no. The offer is closed as 'countered'
-- and the counter goes back the other way, pointing at the offer it answers.
-- From there it's an ordinary offer: accept, reject, withdraw, or counter it.

alter table public.trades drop constraint trades_status_check;
alter table public.trades add constraint trades_status_check check (
  status in ('proposed', 'accepted', 'rejected', 'withdrawn', 'vetoed', 'completed', 'failed', 'countered')
);

alter table public.trades add column countered_trade_id uuid references public.trades (id);

create function public.counter_trade(
  p_trade_id uuid,
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
  v_trade public.trades;
  v_counter_id uuid;
  v_problem text;
begin
  perform private.lock_league();

  select * into v_trade from public.trades where id = p_trade_id for update;
  if not found or v_trade.receiving_team_id <> v_team then
    raise exception 'That trade isn''t yours to answer.';
  end if;
  if v_trade.status <> 'proposed' then
    raise exception 'That trade is no longer open.';
  end if;
  perform private.assert_season_open();

  insert into public.trades (proposing_team_id, receiving_team_id, message, countered_trade_id)
  values (v_team, v_trade.proposing_team_id, nullif(trim(p_message), ''), p_trade_id)
  returning id into v_counter_id;

  insert into public.trade_players (trade_id, player_id, from_team_id)
  select v_counter_id, player_id, v_team
  from unnest(coalesce(p_give_player_ids, '{}')) as player_id
  union
  select v_counter_id, player_id, v_trade.proposing_team_id
  from unnest(coalesce(p_receive_player_ids, '{}')) as player_id;

  -- Asking for exactly what was offered is accepting it.
  if not exists (
    (
      select player_id, from_team_id from public.trade_players where trade_id = p_trade_id
      except
      select player_id, from_team_id from public.trade_players where trade_id = v_counter_id
    )
    union all
    (
      select player_id, from_team_id from public.trade_players where trade_id = v_counter_id
      except
      select player_id, from_team_id from public.trade_players where trade_id = p_trade_id
    )
  ) then
    raise exception 'That''s the trade you were offered. Accept it instead.';
  end if;

  v_problem := private.trade_problem(v_counter_id);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;

  update public.trades set status = 'countered', responded_at = now() where id = p_trade_id;

  perform private.alert(
    v_trade.proposing_team_id, 'trade_response_needed',
    private.team_name(v_team) || ' countered your offer: ' || private.trade_summary(v_counter_id) || '.',
    jsonb_build_object('trade_id', v_counter_id, 'countered_trade_id', p_trade_id)
  );

  return v_counter_id;
end
$$;

revoke execute on function public.counter_trade(uuid, bigint[], bigint[], text) from public, anon, authenticated;
grant execute on function public.counter_trade(uuid, bigint[], bigint[], text) to authenticated;

-- The same view with the offer each counter answers added at the end.
create or replace view public.trade_details with (security_invoker = true) as
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
    as vetoed_by_team_id,
  tr.countered_trade_id
from public.trades tr
join public.teams pt on pt.id = tr.proposing_team_id
join public.teams rt on rt.id = tr.receiving_team_id;
