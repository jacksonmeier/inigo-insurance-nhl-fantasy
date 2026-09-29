-- Watchlists: players an owner is keeping an eye on. Each team's list is
-- private to that team. Owners are alerted when a player they watch becomes
-- available: dropped onto waivers, cleared from waivers, or released straight
-- to free agency. A player leaves the list when the team gets him.

create table public.watchlist (
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id bigint not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, player_id)
);

create index watchlist_player_idx on public.watchlist (player_id);

alter table public.watchlist enable row level security;
revoke all on public.watchlist from anon, authenticated;
grant select on public.watchlist to authenticated;
create policy "Owners can read their watchlist" on public.watchlist
  for select to authenticated
  using (team_id = (select public.my_team_id()));

alter publication supabase_realtime add table public.watchlist;

alter table public.alerts drop constraint alerts_type_check;
alter table public.alerts add constraint alerts_type_check check (
  type in (
    'ir_eligible', 'ir_player_healthy', 'trade_response_needed', 'trade_update', 'waiver_processed', 'general',
    'watchlist'
  )
);

-- ---------------------------------------------------------------------------
-- Owner actions
-- ---------------------------------------------------------------------------

create function public.watch_player(p_player_id bigint)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_team uuid := private.caller_team();
begin
  if not exists (select 1 from public.players where id = p_player_id) then
    raise exception 'Unknown player.';
  end if;
  if exists (
    select 1 from public.roster_entries where team_id = v_team and player_id = p_player_id and end_at is null
  ) then
    raise exception '% is already on your team.', private.player_label(p_player_id);
  end if;

  insert into public.watchlist (team_id, player_id) values (v_team, p_player_id)
  on conflict do nothing;
end
$$;

create function public.unwatch_player(p_player_id bigint)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.watchlist where team_id = private.caller_team() and player_id = p_player_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Alerts, and keeping the lists tidy
-- ---------------------------------------------------------------------------

create function private.alert_watchers(p_player bigint, p_except_team uuid, p_message text)
returns void
language sql
set search_path = ''
as $$
  insert into public.alerts (team_id, type, message, data)
  select w.team_id, 'watchlist', p_message, jsonb_build_object('player_id', p_player)
  from public.watchlist w
  where w.player_id = p_player and w.team_id is distinct from p_except_team;
$$;

-- The trigger functions below are security definer because the one that runs
-- at commit fires after the rule function that caused it has returned, when
-- the caller is back to being an ordinary signed-in user.

-- Dropped onto waivers, or cleared them.
create function private.tell_watchers_waivers()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'open' then
    perform private.alert_watchers(
      new.player_id, new.dropped_by_team_id,
      private.team_name(new.dropped_by_team_id) || ' dropped ' || private.player_label(new.player_id)
        || ', who''s on your watchlist. He''s on waivers, so you can put in a claim.'
    );
  elsif tg_op = 'UPDATE' and old.status = 'open' and new.status = 'cleared' then
    perform private.alert_watchers(
      new.player_id, new.dropped_by_team_id,
      private.player_label(new.player_id)
        || ', who''s on your watchlist, cleared waivers. He''s a free agent, so the first owner to add him gets him.'
    );
  end if;
  return null;
end
$$;

create trigger waivers_tell_watchers
after insert or update of status on public.waivers
for each row execute function private.tell_watchers_waivers();

-- Released straight to free agency: a temporary IR replacement when the
-- injured player comes back, or a commissioner removal. Checked when the
-- transaction commits, so a player who only changed teams or slots (a trade,
-- an IR move) or went to waivers (alerted above) doesn't count.
create function private.tell_watchers_released()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.roster_entries where player_id = new.player_id and end_at is null)
    or exists (select 1 from public.waivers where player_id = new.player_id and status = 'open')
  then
    return null;
  end if;

  perform private.alert_watchers(
    new.player_id, new.team_id,
    private.team_name(new.team_id) || ' released ' || private.player_label(new.player_id)
      || ', who''s on your watchlist. He''s a free agent, so the first owner to add him gets him.'
  );
  return null;
end
$$;

create constraint trigger roster_entries_tell_watchers
after update of end_at on public.roster_entries
deferrable initially deferred
for each row
when (old.end_at is null and new.end_at is not null)
execute function private.tell_watchers_released();

-- A team doesn't need to watch a player it has.
create function private.unwatch_rostered()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.watchlist where team_id = new.team_id and player_id = new.player_id;
  return null;
end
$$;

create trigger roster_entries_unwatch
after insert on public.roster_entries
for each row execute function private.unwatch_rostered();

-- ---------------------------------------------------------------------------

revoke execute on function
  public.watch_player(bigint),
  public.unwatch_player(bigint),
  private.alert_watchers(bigint, uuid, text),
  private.tell_watchers_waivers(),
  private.tell_watchers_released(),
  private.unwatch_rostered()
from public, anon, authenticated;

grant execute on function public.watch_player(bigint), public.unwatch_player(bigint) to authenticated;
