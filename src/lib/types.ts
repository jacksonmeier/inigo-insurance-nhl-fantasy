// The rows each screen works with. The generated database types mark every
// view column as nullable; these say what's really there.

import type { NhlPosition, PositionGroup } from '@shared/league.config.ts'
import type { Breakdown } from '@shared/scoring.ts'

export type { NhlPosition, PositionGroup }

export type Team = { id: string; name: string; owner_id: string }

export type Standing = {
  team_id: string
  name: string
  owner_id: string
  total_points: number
  total_goals: number
  today_points: number
  adjustment_points: number
  rank: number
}

export type Availability = 'rostered' | 'waivers' | 'free_agent'

export type PlayerBasics = {
  full_name: string
  position: NhlPosition
  position_group: PositionGroup
  nhl_team: string | null
  headshot_url: string | null
}

export type PoolPlayer = PlayerBasics & {
  id: number
  first_name: string
  last_name: string
  sweater_number: number | null
  is_active: boolean
  season_points: number
  season_games: number
  last_season_points: number
  last_season_games: number
  fantasy_team_id: string | null
  roster_slot: 'active' | 'ir' | null
  is_ir_replacement: boolean
  waiver_id: string | null
  waiver_expires_at: string | null
  waiver_dropped_by_team_id: string | null
  availability: Availability
  injury_status: string | null
  is_ir_eligible: boolean
  injury_description: string | null
}

export type RosterPlayer = PlayerBasics & {
  roster_entry_id: string
  team_id: string
  slot: 'active' | 'ir'
  is_ir_replacement: boolean
  reason: string
  start_at: string
  player_id: number
  sweater_number: number | null
  is_active: boolean
  season_points: number
  season_games: number
  last_season_points: number
  injury_status: string | null
  is_ir_eligible: boolean
  injury_description: string | null
  team_points: number
  today_points: number
  today_game_id: number | null
  /** He's playing tonight but joined after puck drop, so it doesn't count for this team. */
  today_not_counting: boolean
  next_game_id: number | null
  next_game_start: string | null
  next_game_state: string | null
  next_game_period: number | null
  next_game_home: string | null
  next_game_away: string | null
}

export type GameLogRow = {
  game_id: number
  player_id: number
  game_date: string
  start_time_utc: string
  game_state: string
  nhl_team: string
  opponent: string
  is_home: boolean
  goals: number
  assists: number
  power_play_points: number
  shorthanded_points: number
  shots: number
  hits: number
  blocked_shots: number
  decision: 'W' | 'L' | 'O' | null
  saves: number
  goals_against: number
  shutout: boolean
  toi: string | null
  points: number
  breakdown: Breakdown
  credited_team_id: string | null
}

export type DraftStatus = 'not_started' | 'in_progress' | 'paused' | 'complete'

export type Draft = {
  season: number
  status: DraftStatus
  draft_order: string[]
  pick_seconds: number | null
  current_pick: number
  pick_deadline: string | null
  paused_seconds_remaining: number | null
  started_at: string | null
  completed_at: string | null
}

export type DraftPick = PlayerBasics & {
  pick_number: number
  round: number
  team_id: string
  team_name: string
  player_id: number
  is_auto_pick: boolean
  picked_at: string
}

export type TradeStatus = 'proposed' | 'accepted' | 'rejected' | 'withdrawn' | 'vetoed' | 'completed' | 'failed'

export type TradePlayer = PlayerBasics & { player_id: number; from_team_id: string }

export type Trade = {
  id: string
  status: TradeStatus
  message: string | null
  created_at: string
  responded_at: string | null
  veto_deadline: string | null
  processed_at: string | null
  proposing_team_id: string
  proposing_team_name: string
  receiving_team_id: string
  receiving_team_name: string
  players: TradePlayer[]
  vetoed_by_team_id: string | null
}

export type IrStint = {
  stint_id: string
  team_id: string
  team_name: string
  ir_player_id: number
  ir_player_name: string
  position_group: PositionGroup
  replacement_player_id: number | null
  replacement_player_name: string | null
  placed_at: string
  healthy_at: string | null
  decision_deadline: string | null
  injury_status: string | null
  still_out: boolean
}

export type TransactionType =
  | 'draft_pick' | 'add' | 'drop' | 'waiver_claim' | 'trade' | 'trade_veto'
  | 'ir_place' | 'ir_activate' | 'ir_keep_replacement' | 'commissioner'

export type Activity = {
  id: number
  type: TransactionType
  team_id: string | null
  team_name: string | null
  summary: string
  details: Record<string, unknown>
  created_at: string
}

export type AlertType =
  | 'ir_eligible' | 'ir_player_healthy' | 'trade_response_needed' | 'trade_update' | 'waiver_processed' | 'general'

export type Alert = {
  id: number
  team_id: string
  type: AlertType
  message: string
  data: Record<string, unknown>
  read_at: string | null
  created_at: string
}

export type Game = {
  id: number
  game_date: string
  start_time_utc: string
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  game_state: string
  schedule_state: string
  period: number | null
}

export type WeekScorer = {
  player_id: number
  full_name: string
  position: NhlPosition
  nhl_team: string | null
  headshot_url: string | null
  team_id: string
  team_name: string
  points: number
  goals: number
  games: number
}

export type WaiverClaim = {
  id: string
  waiver_id: string
  team_id: string
  drop_player_id: number | null
  status: 'pending' | 'won' | 'lost' | 'invalid' | 'withdrawn'
  created_at: string
}

export type Waiver = {
  waiver_id: string
  player_id: number
  full_name: string
  position: NhlPosition
  position_group: PositionGroup
  nhl_team: string | null
  dropped_by_team_id: string
  dropped_by_team_name: string
  created_at: string
  expires_at: string
}

export type SyncStatus = {
  job: string
  status: 'ok' | 'error'
  message: string | null
  last_run_at: string
  last_ok_at: string | null
}

export type EspnIssue = {
  espn_athlete_id: string
  espn_name: string
  espn_team: string | null
  espn_position: string | null
  match_confidence: 'low' | 'unmatched'
  player_id: number | null
  matched_name: string | null
  matched_team: string | null
  matched_position: string | null
  status: string
}
