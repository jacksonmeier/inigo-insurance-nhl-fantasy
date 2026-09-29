// The scoring engine: stats in, fantasy points out. Pure functions with no
// I/O, shared by the Edge Functions (Deno) and the frontend (Vite).

import { SCORING, type ScoringConfig } from './scoring.config.ts'

export type SkaterStats = {
  goals: number
  assists: number
  powerPlayPoints: number
  shorthandedPoints: number
  shots: number
  hits: number
  blockedShots: number
}

// Counts, so the same function scores one game (wins is 0 or 1) or a season.
export type GoalieStats = {
  wins: number
  saves: number
  goalsAgainst: number
  shutouts: number
}

/** Fantasy points earned from each stat. Stats worth nothing are left out. */
export type Breakdown = Record<string, number>

export type Score = { points: number; breakdown: Breakdown }

// Add up in hundredths of a point: in floating point 3 x 0.3 is
// 0.8999999999999999, and those errors would pile up over a season.
function total(lines: [stat: string, count: number, value: number][]): Score {
  let hundredths = 0
  const breakdown: Breakdown = {}
  for (const [stat, count, value] of lines) {
    const earned = Math.round((count || 0) * value * 100)
    if (earned === 0) continue
    hundredths += earned
    breakdown[stat] = earned / 100
  }
  return { points: hundredths / 100, breakdown }
}

export function scoreSkater(stats: SkaterStats, scoring: ScoringConfig = SCORING): Score {
  const s = scoring.skater
  return total([
    ['goals', stats.goals, s.goal],
    ['assists', stats.assists, s.assist],
    ['powerPlayPoints', stats.powerPlayPoints, s.powerPlayPoint],
    ['shorthandedPoints', stats.shorthandedPoints, s.shorthandedPoint],
    ['shots', stats.shots, s.shotOnGoal],
    ['hits', stats.hits, s.hit],
    ['blockedShots', stats.blockedShots, s.blockedShot],
  ])
}

export function scoreGoalie(stats: GoalieStats, scoring: ScoringConfig = SCORING): Score {
  const g = scoring.goalie
  return total([
    ['wins', stats.wins, g.win],
    ['saves', stats.saves, g.save],
    ['goalsAgainst', stats.goalsAgainst, g.goalAgainst],
    ['shutouts', stats.shutouts, g.shutout],
  ])
}

/** Labels for showing a breakdown, in the order the stats are scored. */
export const STAT_LABELS: Record<string, string> = {
  goals: 'Goals',
  assists: 'Assists',
  powerPlayPoints: 'Power play points',
  shorthandedPoints: 'Shorthanded points',
  shots: 'Shots on goal',
  hits: 'Hits',
  blockedShots: 'Blocked shots',
  wins: 'Win',
  saves: 'Saves',
  goalsAgainst: 'Goals against',
  shutouts: 'Shutout',
}
