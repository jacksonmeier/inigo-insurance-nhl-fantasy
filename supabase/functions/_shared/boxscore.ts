// Turns the NHL's boxscore and scoring summary for one game into the rows the
// database stores: one per player who played, with raw stats and fantasy
// points. Pure: no I/O, so it can be tested against saved NHL responses.

import type { NhlPosition } from './league.config.ts'
import type { NhlBoxscore, NhlBoxscoreGoalie, NhlBoxscoreSkater, NhlLanding } from './nhl.ts'
import { SCORING, type ScoringConfig } from './scoring.config.ts'
import { scoreGoalie, scoreSkater, type Breakdown } from './scoring.ts'

export type GameRow = {
  id: number
  season: number
  game_type: number
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

export type PlayerGameRow = {
  player_id: number
  nhl_team: string
  position: NhlPosition
  /** As the boxscore gives it, e.g. "C. McDavid". */
  name: string
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
}

// FINAL means the game is over; OFF means the stats are official.
export const isOver = (gameState: string) => gameState === 'FINAL' || gameState === 'OFF'

function seconds(toi: string | undefined): number {
  if (!toi) return 0
  const [minutes, secs] = toi.split(':').map(Number)
  return (minutes || 0) * 60 + (secs || 0)
}

/** Power play and shorthanded points per player: the scorer and each assist get one. */
export function specialTeamsPoints(landing: NhlLanding | null) {
  const powerPlay = new Map<number, number>()
  const shorthanded = new Map<number, number>()

  for (const period of landing?.summary?.scoring ?? []) {
    // Shootout goals aren't goals in the stats.
    if (period.periodDescriptor.periodType === 'SO') continue

    for (const goal of period.goals) {
      const tally = goal.strength === 'pp' ? powerPlay : goal.strength === 'sh' ? shorthanded : null
      if (!tally) continue
      for (const playerId of [goal.playerId, ...goal.assists.map((assist) => assist.playerId)]) {
        tally.set(playerId, (tally.get(playerId) ?? 0) + 1)
      }
    }
  }
  return { powerPlay, shorthanded }
}

export function gameRow(boxscore: NhlBoxscore): GameRow {
  return {
    id: boxscore.id,
    season: boxscore.season,
    game_type: boxscore.gameType,
    game_date: boxscore.gameDate,
    start_time_utc: boxscore.startTimeUTC,
    home_team: boxscore.homeTeam.abbrev,
    away_team: boxscore.awayTeam.abbrev,
    home_score: boxscore.homeTeam.score ?? null,
    away_score: boxscore.awayTeam.score ?? null,
    game_state: boxscore.gameState,
    schedule_state: boxscore.gameScheduleState ?? 'OK',
    period: boxscore.periodDescriptor?.number ?? null,
  }
}

export function buildGame(
  boxscore: NhlBoxscore,
  landing: NhlLanding | null,
  scoring: ScoringConfig = SCORING,
): { game: GameRow; players: PlayerGameRow[] } {
  const game = gameRow(boxscore)
  const players: PlayerGameRow[] = []
  const { powerPlay, shorthanded } = specialTeamsPoints(landing)
  const over = isOver(boxscore.gameState)

  const sides = [
    { abbrev: boxscore.awayTeam.abbrev, stats: boxscore.playerByGameStats?.awayTeam },
    { abbrev: boxscore.homeTeam.abbrev, stats: boxscore.playerByGameStats?.homeTeam },
  ]

  for (const { abbrev, stats } of sides) {
    if (!stats) continue

    const skaters: NhlBoxscoreSkater[] = [...(stats.forwards ?? []), ...(stats.defense ?? [])]
    for (const skater of skaters) {
      // Dressed but never took a shift: he didn't play.
      if (seconds(skater.toi) === 0) continue

      const line = {
        goals: skater.goals ?? 0,
        assists: skater.assists ?? 0,
        powerPlayPoints: powerPlay.get(skater.playerId) ?? 0,
        shorthandedPoints: shorthanded.get(skater.playerId) ?? 0,
        shots: skater.sog ?? 0,
        hits: skater.hits ?? 0,
        blockedShots: skater.blockedShots ?? 0,
      }
      const { points, breakdown } = scoreSkater(line, scoring)

      players.push({
        player_id: skater.playerId,
        nhl_team: abbrev,
        position: skater.position,
        name: skater.name.default,
        goals: line.goals,
        assists: line.assists,
        power_play_points: line.powerPlayPoints,
        shorthanded_points: line.shorthandedPoints,
        shots: line.shots,
        hits: line.hits,
        blocked_shots: line.blockedShots,
        decision: null,
        saves: 0,
        goals_against: 0,
        shutout: false,
        toi: skater.toi ?? null,
        points,
        breakdown,
      })
    }

    const goalies: NhlBoxscoreGoalie[] = (stats.goalies ?? []).filter((goalie) => seconds(goalie.toi) > 0)
    for (const goalie of goalies) {
      const decision = goalie.decision === 'W' || goalie.decision === 'L' || goalie.decision === 'O' ? goalie.decision : null
      const goalsAgainst = goalie.goalsAgainst ?? 0
      // A shutout needs the whole game: it's over, he allowed nothing, and no
      // other goalie played for his team. Losing 1-0 in a shootout still counts.
      const shutout = over && goalsAgainst === 0 && goalies.length === 1

      const { points, breakdown } = scoreGoalie(
        { wins: decision === 'W' ? 1 : 0, saves: goalie.saves ?? 0, goalsAgainst, shutouts: shutout ? 1 : 0 },
        scoring,
      )

      players.push({
        player_id: goalie.playerId,
        nhl_team: abbrev,
        position: 'G',
        name: goalie.name.default,
        goals: 0,
        assists: 0,
        power_play_points: 0,
        shorthanded_points: 0,
        shots: 0,
        hits: 0,
        blocked_shots: 0,
        decision,
        saves: goalie.saves ?? 0,
        goals_against: goalsAgainst,
        shutout,
        toi: goalie.toi ?? null,
        points,
        breakdown,
      })
    }
  }

  return { game, players }
}
