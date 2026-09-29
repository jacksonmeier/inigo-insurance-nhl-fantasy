-- Who can call what.
--
-- Postgres lets everyone execute a new function by default, and Supabase also
-- grants it to the API roles. Start from nothing and grant back by name, so a
-- function added later is locked until someone decides who it's for.

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.signature);
  end loop;
end
$$;

-- League members, from the browser. Each function checks who's calling.
grant execute on function
  public.is_commissioner(),
  public.my_team_id(),
  public.is_league_member(),
  public.fantasy_today(),
  public.server_time(),
  -- draft
  public.draft_pick(bigint),
  public.draft_auto_pick(),
  public.draft_randomize_order(),
  public.draft_set_order(uuid[]),
  public.draft_set_timer(int),
  public.draft_start(),
  public.draft_pause(),
  public.draft_resume(),
  public.draft_undo_last_pick(),
  public.draft_reset(),
  -- roster moves
  public.add_player(bigint, bigint),
  public.drop_player(bigint),
  public.claim_waiver(bigint, bigint),
  public.withdraw_waiver_claim(bigint),
  public.place_on_ir(bigint),
  public.activate_from_ir(bigint),
  public.keep_ir_replacement(bigint),
  -- trades
  public.propose_trade(uuid, bigint[], bigint[], text),
  public.respond_to_trade(uuid, boolean),
  public.withdraw_trade(uuid),
  public.veto_trade(uuid),
  -- commissioner
  public.commish_add_to_roster(uuid, bigint, timestamptz, text),
  public.commish_remove_from_roster(bigint, boolean, timestamptz, text),
  public.commish_place_on_ir(bigint, text),
  public.commish_adjust_points(uuid, numeric, text, int),
  public.commish_process_now(),
  public.commish_force_waiver(uuid),
  public.commish_force_trade(uuid, boolean),
  public.commish_force_ir(uuid, text),
  public.commish_map_espn_player(text, bigint)
to authenticated;

-- The sync function and scheduled jobs only (service role).
grant execute on function
  public.push_config(jsonb),
  public.record_sync(text, text, text, jsonb),
  public.ingest_players(jsonb, boolean),
  public.ingest_season_stats(jsonb),
  public.ingest_schedule(jsonb),
  public.ingest_game(jsonb, jsonb),
  public.ingest_injuries(jsonb),
  public.reattribute_points(timestamptz),
  public.games_to_poll(),
  public.games_to_finalize(int),
  public.sync_context(),
  public.process_windows()
to service_role;

-- ---------------------------------------------------------------------------
-- Realtime: more tables whose changes should reach open screens.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.teams,
  public.ir_stints,
  public.waiver_claims,
  public.trade_vetoes,
  public.sync_status;
