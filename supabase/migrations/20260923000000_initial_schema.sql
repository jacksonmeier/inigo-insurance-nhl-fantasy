-- Initial schema for the fantasy hockey league.
--
-- Conventions:
--   * NHL ids (players, games) are used as primary keys directly.
--   * Status-like columns are text + check constraints (easier to extend than enums).
--   * League rules (roster sizes, window lengths, scoring values) live in
--     supabase/functions/_shared/*.config.ts, not here. The database stores facts;
--     server-side functions enforce the rules.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- League + teams
-- ---------------------------------------------------------------------------

-- Single-row table holding runtime league state that can't live in a config file.
create table public.league_settings (
  id boolean primary key default true check (id),
  season int not null,                          -- NHL season id, e.g. 20262027
  commissioner_id uuid references auth.users (id),
  created_at timestamptz not null default now()
);

insert into public.league_settings (season) values (20262027);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  owner_id uuid not null unique references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- NHL data (written only by Edge Functions)
-- ---------------------------------------------------------------------------

create table public.players (
  id bigint primary key,                        -- NHL player id
  first_name text not null,
  last_name text not null,
  full_name text generated always as (first_name || ' ' || last_name) stored,
  position text not null check (position in ('C', 'L', 'R', 'D', 'G')),
  position_group text generated always as (
    case position when 'D' then 'D' when 'G' then 'G' else 'F' end
  ) stored,
  nhl_team text,                                -- team abbreviation; null if not on an NHL roster
  sweater_number int,
  headshot_url text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create index players_position_group_idx on public.players (position_group);
create index players_nhl_team_idx on public.players (nhl_team);

create table public.games (
  id bigint primary key,                        -- NHL game id
  season int not null,
  game_type int not null,                       -- 1 preseason, 2 regular season, 3 playoffs
  game_date date not null,                      -- NHL's local game date
  start_time_utc timestamptz not null,
  home_team text not null,
  away_team text not null,
  home_score int,
  away_score int,
  game_state text not null default 'FUT',       -- NHL states: FUT, PRE, LIVE, CRIT, FINAL, OFF
  period int,
  last_synced_at timestamptz
);

create index games_game_date_idx on public.games (game_date);
create index games_game_state_idx on public.games (game_state);

-- Raw per-game stats. Fantasy points are derived from these, never edited directly.
create table public.player_game_stats (
  game_id bigint not null references public.games (id) on delete cascade,
  player_id bigint not null references public.players (id),
  nhl_team text not null,
  -- skaters
  goals int not null default 0,
  assists int not null default 0,
  power_play_points int not null default 0,
  shorthanded_points int not null default 0,
  shots int not null default 0,
  hits int not null default 0,
  blocked_shots int not null default 0,
  -- goalies
  decision text check (decision in ('W', 'L', 'O')),
  saves int not null default 0,
  goals_against int not null default 0,
  shutout boolean not null default false,
  toi text,
  updated_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

create index player_game_stats_player_idx on public.player_game_stats (player_id);

-- ---------------------------------------------------------------------------
-- Rosters
-- ---------------------------------------------------------------------------

-- Roster history. A row covers [start_at, end_at) for one player on one team in
-- one slot. The current roster is every row with end_at is null. Moving a player
-- between slots (active <-> IR) closes one row and opens another, so the full
-- history is always available for attributing points by date.
create table public.roster_entries (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id),
  player_id bigint not null references public.players (id),
  slot text not null check (slot in ('active', 'ir')),
  is_ir_replacement boolean not null default false,
  reason text not null check (
    reason in ('draft', 'free_agent', 'waiver', 'trade', 'ir_place', 'ir_activate', 'commissioner')
  ),
  start_at timestamptz not null default now(),
  end_at timestamptz,
  check (end_at is null or end_at > start_at),
  -- A player can only be on one fantasy team (in one slot) at any moment.
  constraint roster_entries_no_overlap
    exclude using gist (player_id with =, tstzrange(start_at, end_at) with &&)
);

create index roster_entries_team_idx on public.roster_entries (team_id) where end_at is null;

-- ---------------------------------------------------------------------------
-- Points
-- ---------------------------------------------------------------------------

-- Fantasy points per player per game, calculated for every player (rostered or
-- not) so free agents can be sorted by points. team_id is the fantasy team
-- credited: whoever had the player in an active slot for that game, else null.
create table public.player_game_points (
  game_id bigint not null,
  player_id bigint not null,
  team_id uuid references public.teams (id),
  points numeric(8, 2) not null,
  goals int not null default 0,                 -- copied for the tiebreaker
  breakdown jsonb not null default '{}',        -- per-stat points, for display
  calculated_at timestamptz not null default now(),
  primary key (game_id, player_id),
  foreign key (game_id, player_id)
    references public.player_game_stats (game_id, player_id) on delete cascade
);

create index player_game_points_team_idx on public.player_game_points (team_id);
create index player_game_points_player_idx on public.player_game_points (player_id);

-- Commissioner corrections to a team's total, kept separate so the audit trail
-- is clear and recalculations never wipe them out.
create table public.point_adjustments (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id),
  points numeric(8, 2) not null,
  goals int not null default 0,
  reason text not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Activity + alerts
-- ---------------------------------------------------------------------------

-- Every add, drop, trade, IR move, draft pick and commissioner action.
create table public.transactions (
  id bigint generated always as identity primary key,
  type text not null check (
    type in (
      'draft_pick', 'add', 'drop', 'waiver_claim', 'trade', 'trade_veto',
      'ir_place', 'ir_activate', 'ir_keep_replacement', 'commissioner'
    )
  ),
  team_id uuid references public.teams (id),
  actor_id uuid references auth.users (id),     -- null when done by a scheduled job
  summary text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index transactions_created_at_idx on public.transactions (created_at desc);

create table public.alerts (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  type text not null check (
    type in ('ir_eligible', 'ir_player_healthy', 'trade_response_needed', 'trade_update', 'waiver_processed', 'general')
  ),
  message text not null,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index alerts_team_idx on public.alerts (team_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Waivers
-- ---------------------------------------------------------------------------

create table public.waivers (
  id uuid primary key default gen_random_uuid(),
  player_id bigint not null references public.players (id),
  dropped_by_team_id uuid not null references public.teams (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'awarded', 'cleared', 'cancelled')),
  awarded_team_id uuid references public.teams (id),
  processed_at timestamptz
);

create unique index waivers_one_open_per_player on public.waivers (player_id) where status = 'open';

create table public.waiver_claims (
  id uuid primary key default gen_random_uuid(),
  waiver_id uuid not null references public.waivers (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  drop_player_id bigint references public.players (id),  -- who the claimant drops to make room
  status text not null default 'pending' check (status in ('pending', 'won', 'lost', 'invalid', 'withdrawn')),
  created_at timestamptz not null default now(),
  unique (waiver_id, team_id)
);

-- ---------------------------------------------------------------------------
-- Trades
-- ---------------------------------------------------------------------------

create table public.trades (
  id uuid primary key default gen_random_uuid(),
  proposing_team_id uuid not null references public.teams (id),
  receiving_team_id uuid not null references public.teams (id),
  status text not null default 'proposed' check (
    status in ('proposed', 'accepted', 'rejected', 'withdrawn', 'vetoed', 'completed', 'failed')
  ),
  message text,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  veto_deadline timestamptz,                    -- set when accepted
  processed_at timestamptz,
  check (proposing_team_id <> receiving_team_id)
);

create table public.trade_players (
  trade_id uuid not null references public.trades (id) on delete cascade,
  player_id bigint not null references public.players (id),
  from_team_id uuid not null references public.teams (id),
  primary key (trade_id, player_id)
);

create table public.trade_vetoes (
  trade_id uuid not null references public.trades (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  created_at timestamptz not null default now(),
  primary key (trade_id, team_id)
);

-- ---------------------------------------------------------------------------
-- Injuries + IR
-- ---------------------------------------------------------------------------

-- ESPN athlete id -> NHL player id. Matched by name/team/position during import;
-- the commissioner fixes anything flagged low confidence or unmatched.
create table public.espn_player_map (
  espn_athlete_id text primary key,
  player_id bigint references public.players (id),
  espn_name text not null,
  espn_team text,
  espn_position text,
  match_confidence text not null check (match_confidence in ('high', 'low', 'unmatched', 'manual')),
  updated_at timestamptz not null default now()
);

-- Current ESPN injury list. A player not in this table is healthy.
create table public.player_injuries (
  espn_athlete_id text primary key references public.espn_player_map (espn_athlete_id),
  player_id bigint references public.players (id),
  status text not null,                         -- as ESPN reports it, e.g. 'Out', 'Day-To-Day'
  is_ir_eligible boolean not null,              -- computed on import from league config
  description text,
  espn_updated_at timestamptz,
  synced_at timestamptz not null default now()
);

create index player_injuries_player_idx on public.player_injuries (player_id);

-- One row per IR placement, tracking the temporary replacement and the
-- 24-hour decision window once the player is healthy again.
create table public.ir_stints (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id),
  ir_player_id bigint not null references public.players (id),
  replacement_player_id bigint references public.players (id),
  placed_at timestamptz not null default now(),
  healthy_at timestamptz,                       -- when ESPN stopped listing him Out/IR
  decision_deadline timestamptz,
  resolved_at timestamptz,
  resolution text check (
    resolution in ('activated', 'kept_replacement', 'auto_activated', 'dropped', 'commissioner')
  )
);

create index ir_stints_open_idx on public.ir_stints (team_id) where resolved_at is null;

-- ---------------------------------------------------------------------------
-- Draft
-- ---------------------------------------------------------------------------

create table public.drafts (
  season int primary key,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'paused', 'complete')),
  draft_order uuid[] not null default '{}',     -- round 1 order; snake reverses on even rounds
  pick_seconds int check (pick_seconds is null or pick_seconds > 0),  -- null = no timer
  current_pick int not null default 1,
  pick_deadline timestamptz,
  paused_seconds_remaining int,
  started_at timestamptz,
  completed_at timestamptz
);

create table public.draft_picks (
  season int not null references public.drafts (season) on delete cascade,
  pick_number int not null,
  round int not null,
  team_id uuid not null references public.teams (id),
  player_id bigint not null references public.players (id),
  picked_by uuid references auth.users (id),
  is_auto_pick boolean not null default false,
  picked_at timestamptz not null default now(),
  primary key (season, pick_number),
  unique (season, player_id)
);
