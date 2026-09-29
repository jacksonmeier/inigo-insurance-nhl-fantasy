
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "alerts": {
                  Row: {
                    "created_at": string,"data": NonNullable<Json>,"id": number,"message": string,"read_at": string | null,"team_id": string,"type": string
                  }
                  Insert: {
                    "created_at"?: string,"data"?: NonNullable<Json>,"id"?: never,"message": string,"read_at"?: string | null,"team_id": string,"type": string
                  }
                  Update: {
                    "created_at"?: string,"data"?: NonNullable<Json>,"id"?: never,"message"?: string,"read_at"?: string | null,"team_id"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "alerts_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "alerts_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"draft_picks": {
                  Row: {
                    "is_auto_pick": boolean,"pick_number": number,"picked_at": string,"picked_by": string | null,"player_id": number,"round": number,"season": number,"team_id": string
                  }
                  Insert: {
                    "is_auto_pick"?: boolean,"pick_number": number,"picked_at"?: string,"picked_by"?: string | null,"player_id": number,"round": number,"season": number,"team_id": string
                  }
                  Update: {
                    "is_auto_pick"?: boolean,"pick_number"?: number,"picked_at"?: string,"picked_by"?: string | null,"player_id"?: number,"round"?: number,"season"?: number,"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "draft_picks_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "draft_picks_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "draft_picks_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    },{
      foreignKeyName: "draft_picks_season_fkey"
      columns: ["season"]
isOneToOne: false
      referencedRelation: "drafts"
      referencedColumns: ["season"]
    },{
      foreignKeyName: "draft_picks_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "draft_picks_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"drafts": {
                  Row: {
                    "completed_at": string | null,"current_pick": number,"draft_order": (string)[],"paused_seconds_remaining": number | null,"pick_deadline": string | null,"pick_seconds": number | null,"season": number,"started_at": string | null,"status": string
                  }
                  Insert: {
                    "completed_at"?: string | null,"current_pick"?: number,"draft_order"?: (string)[],"paused_seconds_remaining"?: number | null,"pick_deadline"?: string | null,"pick_seconds"?: number | null,"season": number,"started_at"?: string | null,"status"?: string
                  }
                  Update: {
                    "completed_at"?: string | null,"current_pick"?: number,"draft_order"?: (string)[],"paused_seconds_remaining"?: number | null,"pick_deadline"?: string | null,"pick_seconds"?: number | null,"season"?: number,"started_at"?: string | null,"status"?: string
                  }
                  Relationships: [
                    
                  ]
                },"espn_player_map": {
                  Row: {
                    "espn_athlete_id": string,"espn_name": string,"espn_position": string | null,"espn_team": string | null,"match_confidence": string,"player_id": number | null,"updated_at": string
                  }
                  Insert: {
                    "espn_athlete_id": string,"espn_name": string,"espn_position"?: string | null,"espn_team"?: string | null,"match_confidence": string,"player_id"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "espn_athlete_id"?: string,"espn_name"?: string,"espn_position"?: string | null,"espn_team"?: string | null,"match_confidence"?: string,"player_id"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "espn_player_map_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "espn_player_map_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "espn_player_map_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    }
                  ]
                },"games": {
                  Row: {
                    "away_score": number | null,"away_team": string,"game_date": string,"game_state": string,"game_type": number,"home_score": number | null,"home_team": string,"id": number,"last_synced_at": string | null,"period": number | null,"schedule_state": string,"season": number,"start_time_utc": string
                  }
                  Insert: {
                    "away_score"?: number | null,"away_team": string,"game_date": string,"game_state"?: string,"game_type": number,"home_score"?: number | null,"home_team": string,"id": number,"last_synced_at"?: string | null,"period"?: number | null,"schedule_state"?: string,"season": number,"start_time_utc": string
                  }
                  Update: {
                    "away_score"?: number | null,"away_team"?: string,"game_date"?: string,"game_state"?: string,"game_type"?: number,"home_score"?: number | null,"home_team"?: string,"id"?: number,"last_synced_at"?: string | null,"period"?: number | null,"schedule_state"?: string,"season"?: number,"start_time_utc"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ir_stints": {
                  Row: {
                    "decision_deadline": string | null,"healthy_at": string | null,"id": string,"ir_player_id": number,"placed_at": string,"replacement_player_id": number | null,"resolution": string | null,"resolved_at": string | null,"team_id": string
                  }
                  Insert: {
                    "decision_deadline"?: string | null,"healthy_at"?: string | null,"id"?: string,"ir_player_id": number,"placed_at"?: string,"replacement_player_id"?: number | null,"resolution"?: string | null,"resolved_at"?: string | null,"team_id": string
                  }
                  Update: {
                    "decision_deadline"?: string | null,"healthy_at"?: string | null,"id"?: string,"ir_player_id"?: number,"placed_at"?: string,"replacement_player_id"?: number | null,"resolution"?: string | null,"resolved_at"?: string | null,"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ir_stints_ir_player_id_fkey"
      columns: ["ir_player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ir_stints_ir_player_id_fkey"
      columns: ["ir_player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ir_stints_ir_player_id_fkey"
      columns: ["ir_player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    },{
      foreignKeyName: "ir_stints_replacement_player_id_fkey"
      columns: ["replacement_player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ir_stints_replacement_player_id_fkey"
      columns: ["replacement_player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ir_stints_replacement_player_id_fkey"
      columns: ["replacement_player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    },{
      foreignKeyName: "ir_stints_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "ir_stints_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"league_settings": {
                  Row: {
                    "commissioner_id": string | null,"config": NonNullable<Json>,"created_at": string,"id": boolean,"season": number
                  }
                  Insert: {
                    "commissioner_id"?: string | null,"config"?: NonNullable<Json>,"created_at"?: string,"id"?: boolean,"season": number
                  }
                  Update: {
                    "commissioner_id"?: string | null,"config"?: NonNullable<Json>,"created_at"?: string,"id"?: boolean,"season"?: number
                  }
                  Relationships: [
                    
                  ]
                },"player_game_points": {
                  Row: {
                    "breakdown": NonNullable<Json>,"calculated_at": string,"game_id": number,"goals": number,"player_id": number,"points": number,"team_id": string | null
                  }
                  Insert: {
                    "breakdown"?: NonNullable<Json>,"calculated_at"?: string,"game_id": number,"goals"?: number,"player_id": number,"points": number,"team_id"?: string | null
                  }
                  Update: {
                    "breakdown"?: NonNullable<Json>,"calculated_at"?: string,"game_id"?: number,"goals"?: number,"player_id"?: number,"points"?: number,"team_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "player_game_points_game_id_player_id_fkey"
      columns: ["game_id","player_id"]
isOneToOne: true
      referencedRelation: "player_game_log"
      referencedColumns: ["game_id","player_id"]
    },{
      foreignKeyName: "player_game_points_game_id_player_id_fkey"
      columns: ["game_id","player_id"]
isOneToOne: true
      referencedRelation: "player_game_stats"
      referencedColumns: ["game_id","player_id"]
    },{
      foreignKeyName: "player_game_points_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "player_game_points_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"player_game_stats": {
                  Row: {
                    "assists": number,"blocked_shots": number,"decision": string | null,"game_id": number,"goals": number,"goals_against": number,"hits": number,"nhl_team": string,"player_id": number,"power_play_points": number,"saves": number,"shorthanded_points": number,"shots": number,"shutout": boolean,"toi": string | null,"updated_at": string
                  }
                  Insert: {
                    "assists"?: number,"blocked_shots"?: number,"decision"?: string | null,"game_id": number,"goals"?: number,"goals_against"?: number,"hits"?: number,"nhl_team": string,"player_id": number,"power_play_points"?: number,"saves"?: number,"shorthanded_points"?: number,"shots"?: number,"shutout"?: boolean,"toi"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "assists"?: number,"blocked_shots"?: number,"decision"?: string | null,"game_id"?: number,"goals"?: number,"goals_against"?: number,"hits"?: number,"nhl_team"?: string,"player_id"?: number,"power_play_points"?: number,"saves"?: number,"shorthanded_points"?: number,"shots"?: number,"shutout"?: boolean,"toi"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "player_game_stats_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "games"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "player_game_stats_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["next_game_id"]
    },{
      foreignKeyName: "player_game_stats_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "todays_games"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "player_game_stats_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "player_game_stats_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "player_game_stats_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    }
                  ]
                },"player_injuries": {
                  Row: {
                    "description": string | null,"espn_athlete_id": string,"espn_updated_at": string | null,"is_ir_eligible": boolean,"player_id": number | null,"status": string,"synced_at": string
                  }
                  Insert: {
                    "description"?: string | null,"espn_athlete_id": string,"espn_updated_at"?: string | null,"is_ir_eligible": boolean,"player_id"?: number | null,"status": string,"synced_at"?: string
                  }
                  Update: {
                    "description"?: string | null,"espn_athlete_id"?: string,"espn_updated_at"?: string | null,"is_ir_eligible"?: boolean,"player_id"?: number | null,"status"?: string,"synced_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "player_injuries_espn_athlete_id_fkey"
      columns: ["espn_athlete_id"]
isOneToOne: true
      referencedRelation: "espn_issues"
      referencedColumns: ["espn_athlete_id"]
    },{
      foreignKeyName: "player_injuries_espn_athlete_id_fkey"
      columns: ["espn_athlete_id"]
isOneToOne: true
      referencedRelation: "espn_player_map"
      referencedColumns: ["espn_athlete_id"]
    },{
      foreignKeyName: "player_injuries_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "player_injuries_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "player_injuries_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    }
                  ]
                },"player_season_stats": {
                  Row: {
                    "assists": number,"blocked_shots": number,"fantasy_points": number,"games_played": number,"goals": number,"goals_against": number,"hits": number,"player_id": number,"power_play_points": number,"saves": number,"season": number,"shorthanded_points": number,"shots": number,"shutouts": number,"updated_at": string,"wins": number
                  }
                  Insert: {
                    "assists"?: number,"blocked_shots"?: number,"fantasy_points"?: number,"games_played"?: number,"goals"?: number,"goals_against"?: number,"hits"?: number,"player_id": number,"power_play_points"?: number,"saves"?: number,"season": number,"shorthanded_points"?: number,"shots"?: number,"shutouts"?: number,"updated_at"?: string,"wins"?: number
                  }
                  Update: {
                    "assists"?: number,"blocked_shots"?: number,"fantasy_points"?: number,"games_played"?: number,"goals"?: number,"goals_against"?: number,"hits"?: number,"player_id"?: number,"power_play_points"?: number,"saves"?: number,"season"?: number,"shorthanded_points"?: number,"shots"?: number,"shutouts"?: number,"updated_at"?: string,"wins"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "player_season_stats_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "player_season_stats_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "player_season_stats_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    }
                  ]
                },"players": {
                  Row: {
                    "first_name": string,"full_name": string | null,"headshot_url": string | null,"id": number,"is_active": boolean,"last_name": string,"nhl_team": string | null,"position": string,"position_group": string | null,"sweater_number": number | null,"updated_at": string
                  }
                  Insert: {
                    "first_name": string,"full_name"?: never,"headshot_url"?: string | null,"id": number,"is_active"?: boolean,"last_name": string,"nhl_team"?: string | null,"position": string,"position_group"?: never,"sweater_number"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "first_name"?: string,"full_name"?: never,"headshot_url"?: string | null,"id"?: number,"is_active"?: boolean,"last_name"?: string,"nhl_team"?: string | null,"position"?: string,"position_group"?: never,"sweater_number"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"point_adjustments": {
                  Row: {
                    "created_at": string,"created_by": string | null,"goals": number,"id": string,"points": number,"reason": string,"team_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"goals"?: number,"id"?: string,"points": number,"reason": string,"team_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"goals"?: number,"id"?: string,"points"?: number,"reason"?: string,"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "point_adjustments_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "point_adjustments_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"roster_entries": {
                  Row: {
                    "end_at": string | null,"id": string,"is_ir_replacement": boolean,"player_id": number,"reason": string,"slot": string,"start_at": string,"team_id": string
                  }
                  Insert: {
                    "end_at"?: string | null,"id"?: string,"is_ir_replacement"?: boolean,"player_id": number,"reason": string,"slot": string,"start_at"?: string,"team_id": string
                  }
                  Update: {
                    "end_at"?: string | null,"id"?: string,"is_ir_replacement"?: boolean,"player_id"?: number,"reason"?: string,"slot"?: string,"start_at"?: string,"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "roster_entries_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "roster_entries_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "roster_entries_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    },{
      foreignKeyName: "roster_entries_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "roster_entries_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"sync_status": {
                  Row: {
                    "details": NonNullable<Json>,"job": string,"last_ok_at": string | null,"last_run_at": string,"message": string | null,"status": string
                  }
                  Insert: {
                    "details"?: NonNullable<Json>,"job": string,"last_ok_at"?: string | null,"last_run_at"?: string,"message"?: string | null,"status": string
                  }
                  Update: {
                    "details"?: NonNullable<Json>,"job"?: string,"last_ok_at"?: string | null,"last_run_at"?: string,"message"?: string | null,"status"?: string
                  }
                  Relationships: [
                    
                  ]
                },"teams": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"owner_id": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"owner_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"owner_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"trade_players": {
                  Row: {
                    "from_team_id": string,"player_id": number,"trade_id": string
                  }
                  Insert: {
                    "from_team_id": string,"player_id": number,"trade_id": string
                  }
                  Update: {
                    "from_team_id"?: string,"player_id"?: number,"trade_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "trade_players_from_team_id_fkey"
      columns: ["from_team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "trade_players_from_team_id_fkey"
      columns: ["from_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trade_players_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trade_players_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trade_players_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    },{
      foreignKeyName: "trade_players_trade_id_fkey"
      columns: ["trade_id"]
isOneToOne: false
      referencedRelation: "trade_details"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trade_players_trade_id_fkey"
      columns: ["trade_id"]
isOneToOne: false
      referencedRelation: "trades"
      referencedColumns: ["id"]
    }
                  ]
                },"trade_vetoes": {
                  Row: {
                    "created_at": string,"team_id": string,"trade_id": string
                  }
                  Insert: {
                    "created_at"?: string,"team_id": string,"trade_id": string
                  }
                  Update: {
                    "created_at"?: string,"team_id"?: string,"trade_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "trade_vetoes_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "trade_vetoes_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trade_vetoes_trade_id_fkey"
      columns: ["trade_id"]
isOneToOne: false
      referencedRelation: "trade_details"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trade_vetoes_trade_id_fkey"
      columns: ["trade_id"]
isOneToOne: false
      referencedRelation: "trades"
      referencedColumns: ["id"]
    }
                  ]
                },"trades": {
                  Row: {
                    "created_at": string,"id": string,"message": string | null,"processed_at": string | null,"proposing_team_id": string,"receiving_team_id": string,"responded_at": string | null,"status": string,"veto_deadline": string | null
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"message"?: string | null,"processed_at"?: string | null,"proposing_team_id": string,"receiving_team_id": string,"responded_at"?: string | null,"status"?: string,"veto_deadline"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"message"?: string | null,"processed_at"?: string | null,"proposing_team_id"?: string,"receiving_team_id"?: string,"responded_at"?: string | null,"status"?: string,"veto_deadline"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "trades_proposing_team_id_fkey"
      columns: ["proposing_team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "trades_proposing_team_id_fkey"
      columns: ["proposing_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_receiving_team_id_fkey"
      columns: ["receiving_team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "trades_receiving_team_id_fkey"
      columns: ["receiving_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"transactions": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"details": NonNullable<Json>,"id": number,"summary": string,"team_id": string | null,"type": string
                  }
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: never,"summary": string,"team_id"?: string | null,"type": string
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: never,"summary"?: string,"team_id"?: string | null,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transactions_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "transactions_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"waiver_claims": {
                  Row: {
                    "created_at": string,"drop_player_id": number | null,"id": string,"status": string,"team_id": string,"waiver_id": string
                  }
                  Insert: {
                    "created_at"?: string,"drop_player_id"?: number | null,"id"?: string,"status"?: string,"team_id": string,"waiver_id": string
                  }
                  Update: {
                    "created_at"?: string,"drop_player_id"?: number | null,"id"?: string,"status"?: string,"team_id"?: string,"waiver_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "waiver_claims_drop_player_id_fkey"
      columns: ["drop_player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waiver_claims_drop_player_id_fkey"
      columns: ["drop_player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waiver_claims_drop_player_id_fkey"
      columns: ["drop_player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    },{
      foreignKeyName: "waiver_claims_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "waiver_claims_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waiver_claims_waiver_id_fkey"
      columns: ["waiver_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["waiver_id"]
    },{
      foreignKeyName: "waiver_claims_waiver_id_fkey"
      columns: ["waiver_id"]
isOneToOne: false
      referencedRelation: "waiver_wire"
      referencedColumns: ["waiver_id"]
    },{
      foreignKeyName: "waiver_claims_waiver_id_fkey"
      columns: ["waiver_id"]
isOneToOne: false
      referencedRelation: "waivers"
      referencedColumns: ["id"]
    }
                  ]
                },"waivers": {
                  Row: {
                    "awarded_team_id": string | null,"created_at": string,"dropped_by_team_id": string,"expires_at": string,"id": string,"player_id": number,"processed_at": string | null,"status": string
                  }
                  Insert: {
                    "awarded_team_id"?: string | null,"created_at"?: string,"dropped_by_team_id": string,"expires_at": string,"id"?: string,"player_id": number,"processed_at"?: string | null,"status"?: string
                  }
                  Update: {
                    "awarded_team_id"?: string | null,"created_at"?: string,"dropped_by_team_id"?: string,"expires_at"?: string,"id"?: string,"player_id"?: number,"processed_at"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "waivers_awarded_team_id_fkey"
      columns: ["awarded_team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "waivers_awarded_team_id_fkey"
      columns: ["awarded_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waivers_dropped_by_team_id_fkey"
      columns: ["dropped_by_team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "waivers_dropped_by_team_id_fkey"
      columns: ["dropped_by_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waivers_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waivers_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waivers_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    }
                  ]
                }
          }
          Views: {
            "activity_feed": {
                  Row: {
                    "actor_id": string | null,"created_at": string | null,"details": Json | null,"id": number | null,"summary": string | null,"team_id": string | null,"team_name": string | null,"type": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "transactions_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "transactions_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"draft_board": {
                  Row: {
                    "full_name": string | null,"headshot_url": string | null,"is_auto_pick": boolean | null,"nhl_team": string | null,"pick_number": number | null,"picked_at": string | null,"player_id": number | null,"position": string | null,"position_group": string | null,"round": number | null,"season": number | null,"team_id": string | null,"team_name": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "draft_picks_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "draft_picks_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "draft_picks_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    },{
      foreignKeyName: "draft_picks_season_fkey"
      columns: ["season"]
isOneToOne: false
      referencedRelation: "drafts"
      referencedColumns: ["season"]
    },{
      foreignKeyName: "draft_picks_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "draft_picks_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"espn_issues": {
                  Row: {
                    "espn_athlete_id": string | null,"espn_name": string | null,"espn_position": string | null,"espn_team": string | null,"match_confidence": string | null,"matched_name": string | null,"matched_position": string | null,"matched_team": string | null,"player_id": number | null,"status": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "espn_player_map_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "espn_player_map_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "espn_player_map_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    }
                  ]
                },"ir_status": {
                  Row: {
                    "decision_deadline": string | null,"healthy_at": string | null,"injury_status": string | null,"ir_player_id": number | null,"ir_player_name": string | null,"placed_at": string | null,"position_group": string | null,"replacement_player_id": number | null,"replacement_player_name": string | null,"still_out": boolean | null,"stint_id": string | null,"team_id": string | null,"team_name": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ir_stints_ir_player_id_fkey"
      columns: ["ir_player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ir_stints_ir_player_id_fkey"
      columns: ["ir_player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ir_stints_ir_player_id_fkey"
      columns: ["ir_player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    },{
      foreignKeyName: "ir_stints_replacement_player_id_fkey"
      columns: ["replacement_player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ir_stints_replacement_player_id_fkey"
      columns: ["replacement_player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ir_stints_replacement_player_id_fkey"
      columns: ["replacement_player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    },{
      foreignKeyName: "ir_stints_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "ir_stints_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"player_game_log": {
                  Row: {
                    "assists": number | null,"away_score": number | null,"away_team": string | null,"blocked_shots": number | null,"breakdown": Json | null,"credited_team_id": string | null,"decision": string | null,"game_date": string | null,"game_id": number | null,"game_state": string | null,"game_type": number | null,"goals": number | null,"goals_against": number | null,"hits": number | null,"home_score": number | null,"home_team": string | null,"is_home": boolean | null,"nhl_team": string | null,"opponent": string | null,"player_id": number | null,"points": number | null,"power_play_points": number | null,"saves": number | null,"season": number | null,"shorthanded_points": number | null,"shots": number | null,"shutout": boolean | null,"start_time_utc": string | null,"toi": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "player_game_points_team_id_fkey"
      columns: ["credited_team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "player_game_points_team_id_fkey"
      columns: ["credited_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "player_game_stats_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "games"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "player_game_stats_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["next_game_id"]
    },{
      foreignKeyName: "player_game_stats_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "todays_games"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "player_game_stats_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "player_game_stats_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "player_game_stats_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    }
                  ]
                },"player_pool": {
                  Row: {
                    "availability": string | null,"fantasy_team_id": string | null,"first_name": string | null,"full_name": string | null,"headshot_url": string | null,"id": number | null,"injury_description": string | null,"injury_status": string | null,"is_active": boolean | null,"is_ir_eligible": boolean | null,"is_ir_replacement": boolean | null,"last_name": string | null,"last_season_games": number | null,"last_season_points": number | null,"nhl_team": string | null,"position": string | null,"position_group": string | null,"roster_slot": string | null,"season_games": number | null,"season_points": number | null,"sweater_number": number | null,"waiver_dropped_by_team_id": string | null,"waiver_expires_at": string | null,"waiver_id": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "roster_entries_team_id_fkey"
      columns: ["fantasy_team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "roster_entries_team_id_fkey"
      columns: ["fantasy_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waivers_dropped_by_team_id_fkey"
      columns: ["waiver_dropped_by_team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "waivers_dropped_by_team_id_fkey"
      columns: ["waiver_dropped_by_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"team_rosters": {
                  Row: {
                    "first_name": string | null,"full_name": string | null,"headshot_url": string | null,"injury_description": string | null,"injury_status": string | null,"is_active": boolean | null,"is_ir_eligible": boolean | null,"is_ir_replacement": boolean | null,"last_name": string | null,"last_season_points": number | null,"next_game_away": string | null,"next_game_home": string | null,"next_game_id": number | null,"next_game_period": number | null,"next_game_start": string | null,"next_game_state": string | null,"nhl_team": string | null,"player_id": number | null,"position": string | null,"position_group": string | null,"reason": string | null,"roster_entry_id": string | null,"season_games": number | null,"season_points": number | null,"slot": string | null,"start_at": string | null,"sweater_number": number | null,"team_id": string | null,"team_points": number | null,"today_game_id": number | null,"today_points": number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "roster_entries_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "roster_entries_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"team_standings": {
                  Row: {
                    "adjustment_points": number | null,"name": string | null,"owner_id": string | null,"rank": number | null,"team_id": string | null,"today_points": number | null,"total_goals": number | null,"total_points": number | null
                  }
                  Relationships: [
                    
                  ]
                },"todays_games": {
                  Row: {
                    "away_score": number | null,"away_team": string | null,"game_date": string | null,"game_state": string | null,"home_score": number | null,"home_team": string | null,"id": number | null,"period": number | null,"schedule_state": string | null,"start_time_utc": string | null
                  }
                  Insert: {
                           "away_score"?: number | null,"away_team"?: string | null,"game_date"?: string | null,"game_state"?: string | null,"home_score"?: number | null,"home_team"?: string | null,"id"?: number | null,"period"?: number | null,"schedule_state"?: string | null,"start_time_utc"?: string | null
                         }
                        Update: {
                           "away_score"?: number | null,"away_team"?: string | null,"game_date"?: string | null,"game_state"?: string | null,"home_score"?: number | null,"home_team"?: string | null,"id"?: number | null,"period"?: number | null,"schedule_state"?: string | null,"start_time_utc"?: string | null
                         }
                        Relationships: [
                    
                  ]
                },"trade_details": {
                  Row: {
                    "created_at": string | null,"id": string | null,"message": string | null,"players": Json | null,"processed_at": string | null,"proposing_team_id": string | null,"proposing_team_name": string | null,"receiving_team_id": string | null,"receiving_team_name": string | null,"responded_at": string | null,"status": string | null,"veto_deadline": string | null,"vetoed_by_team_id": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "trades_proposing_team_id_fkey"
      columns: ["proposing_team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "trades_proposing_team_id_fkey"
      columns: ["proposing_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_receiving_team_id_fkey"
      columns: ["receiving_team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "trades_receiving_team_id_fkey"
      columns: ["receiving_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"waiver_wire": {
                  Row: {
                    "created_at": string | null,"dropped_by_team_id": string | null,"dropped_by_team_name": string | null,"expires_at": string | null,"full_name": string | null,"nhl_team": string | null,"player_id": number | null,"position": string | null,"position_group": string | null,"waiver_id": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "waivers_dropped_by_team_id_fkey"
      columns: ["dropped_by_team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "waivers_dropped_by_team_id_fkey"
      columns: ["dropped_by_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waivers_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "player_pool"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waivers_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waivers_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "team_rosters"
      referencedColumns: ["player_id"]
    }
                  ]
                },"week_scorers": {
                  Row: {
                    "full_name": string | null,"games": number | null,"goals": number | null,"headshot_url": string | null,"nhl_team": string | null,"player_id": number | null,"points": number | null,"position": string | null,"team_id": string | null,"team_name": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "player_game_points_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "team_standings"
      referencedColumns: ["team_id"]
    },{
      foreignKeyName: "player_game_points_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "activate_from_ir":
{ Args: { "p_player_id": number }; Returns: undefined
                           },
"add_player":
{ Args: { "p_drop_player_id"?: number,"p_player_id": number }; Returns: undefined
                           },
"claim_waiver":
{ Args: { "p_drop_player_id"?: number,"p_player_id": number }; Returns: undefined
                           },
"commish_add_to_roster":
{ Args: { "p_effective_at"?: string,"p_note"?: string,"p_player_id": number,"p_team_id": string }; Returns: undefined
                           },
"commish_adjust_points":
{ Args: { "p_goals"?: number,"p_points": number,"p_reason": string,"p_team_id": string }; Returns: undefined
                           },
"commish_force_ir":
{ Args: { "p_action": string,"p_stint_id": string }; Returns: undefined
                           },
"commish_force_trade":
{ Args: { "p_execute": boolean,"p_trade_id": string }; Returns: string
                           },
"commish_force_waiver":
{ Args: { "p_waiver_id": string }; Returns: string
                           },
"commish_map_espn_player":
{ Args: { "p_espn_athlete_id": string,"p_player_id": number }; Returns: undefined
                           },
"commish_place_on_ir":
{ Args: { "p_note"?: string,"p_player_id": number }; Returns: undefined
                           },
"commish_process_now":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"commish_remove_from_roster":
{ Args: { "p_effective_at"?: string,"p_note"?: string,"p_player_id": number,"p_to_waivers"?: boolean }; Returns: undefined
                           },
"draft_auto_pick":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"draft_pause":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"draft_pick":
{ Args: { "p_player_id": number }; Returns: undefined
                           },
"draft_randomize_order":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"draft_reset":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"draft_resume":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"draft_set_order":
{ Args: { "p_order": (string)[] }; Returns: undefined
                           },
"draft_set_timer":
{ Args: { "p_seconds": number }; Returns: undefined
                           },
"draft_start":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"draft_undo_last_pick":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"drop_player":
{ Args: { "p_player_id": number }; Returns: undefined
                           },
"fantasy_today":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"games_to_finalize":
{ Args: { "p_days"?: number }; Returns: {
              "away_score": number | null,
"away_team": string,
"game_date": string,
"game_state": string,
"game_type": number,
"home_score": number | null,
"home_team": string,
"id": number,
"last_synced_at": string | null,
"period": number | null,
"schedule_state": string,
"season": number,
"start_time_utc": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "games"
        isOneToOne: false
        isSetofReturn: true
      } },
"games_to_poll":
{ Args: Record<PropertyKey, never>; Returns: {
              "away_score": number | null,
"away_team": string,
"game_date": string,
"game_state": string,
"game_type": number,
"home_score": number | null,
"home_team": string,
"id": number,
"last_synced_at": string | null,
"period": number | null,
"schedule_state": string,
"season": number,
"start_time_utc": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "games"
        isOneToOne: false
        isSetofReturn: true
      } },
"ingest_game":
{ Args: { "p_game": Json,"p_stats": Json }; Returns: Json
                           },
"ingest_injuries":
{ Args: { "p_rows": Json }; Returns: Json
                           },
"ingest_players":
{ Args: { "p_full"?: boolean,"p_players": Json }; Returns: Json
                           },
"ingest_schedule":
{ Args: { "p_games": Json }; Returns: number
                           },
"ingest_season_stats":
{ Args: { "p_rows": Json }; Returns: number
                           },
"is_commissioner":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_league_member":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"keep_ir_replacement":
{ Args: { "p_player_id": number }; Returns: undefined
                           },
"my_team_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"place_on_ir":
{ Args: { "p_player_id": number }; Returns: undefined
                           },
"process_windows":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"propose_trade":
{ Args: { "p_give_player_ids": (number)[],"p_message"?: string,"p_receive_player_ids": (number)[],"p_receiving_team_id": string }; Returns: string
                           },
"push_config":
{ Args: { "p_config": Json }; Returns: undefined
                           },
"reattribute_points":
{ Args: { "p_since"?: string }; Returns: number
                           },
"record_sync":
{ Args: { "p_details"?: Json,"p_job": string,"p_message"?: string,"p_status": string }; Returns: undefined
                           },
"respond_to_trade":
{ Args: { "p_accept": boolean,"p_trade_id": string }; Returns: undefined
                           },
"server_time":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"set_cron_config":
{ Args: { "p_cron_secret": string,"p_functions_url": string }; Returns: undefined
                           },
"sync_context":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"veto_trade":
{ Args: { "p_trade_id": string }; Returns: undefined
                           },
"withdraw_trade":
{ Args: { "p_trade_id": string }; Returns: undefined
                           },
"withdraw_waiver_claim":
{ Args: { "p_player_id": number }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const

