// The season as it happened: each team's running total day by day, and who
// won each day and each week. Worked out from team_daily_points.

import type { TeamDay } from './types.ts'

// Days are YYYY-MM-DD strings, the NHL's game dates. Converting them to a
// count of days keeps the arithmetic free of time zones.
const DAY_MS = 86_400_000
export const dayNumber = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / DAY_MS
const fromDayNumber = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10)

export const addDays = (day: string, days: number) => fromDayNumber(dayNumber(day) + days)

/** The Monday on or before a day. Weeks run Monday to Sunday, as they do for the week's top scorer. */
export function weekStart(day: string) {
  const n = dayNumber(day)
  // Day 0, 1 January 1970, was a Thursday: 3 days after a Monday.
  return fromDayNumber(n - ((n + 3) % 7))
}

const eastern = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** The league's today: the date in New York, rolling over at 6 AM, the same as fantasy_today() in the database. */
export function fantasyToday(now: number = Date.now()) {
  const parts = eastern.formatToParts(new Date(now - 6 * 3_600_000))
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

const round = (n: number) => Math.round(n * 100) / 100

// ---------------------------------------------------------------------------
// The race
// ---------------------------------------------------------------------------

export type Race = {
  /** Every day anyone scored, in order. */
  days: string[]
  /** Each team's running total at the end of each day, adjustments included. */
  totals: Map<string, number[]>
}

export function buildRace(rows: readonly TeamDay[], teamIds: readonly string[]): Race {
  const days = [...new Set(rows.map((row) => row.day))].sort()
  const index = new Map(days.map((day, i) => [day, i]))
  const totals = new Map(teamIds.map((id) => [id, days.map(() => 0)]))

  for (const row of rows) {
    const values = totals.get(row.team_id)
    const i = index.get(row.day)
    if (values && i !== undefined) values[i] += Number(row.game_points) + Number(row.adjustment_points)
  }
  for (const values of totals.values()) {
    for (let i = 0; i < values.length; i++) values[i] = round(values[i] + (i > 0 ? values[i - 1] : 0))
  }
  return { days, totals }
}

/** Colours follow the team, never its place, so a team keeps its colour all season. */
export function teamColors(teamIds: readonly string[]) {
  return new Map(
    [...teamIds].sort().map((id, i) => [id, i < 8 ? `var(--series-${i + 1})` : 'var(--frost-dim)'] as const),
  )
}

// ---------------------------------------------------------------------------
// Winners
// ---------------------------------------------------------------------------

export type Result = {
  /** The day, or the Monday a week starts on. */
  start: string
  /** The same day, or the Sunday a week ends on. */
  end: string
  /** Points from games only, for every team. */
  points: Map<string, number>
  /** The teams with the most points, more than one if they tied. Empty if nobody scored. */
  winners: string[]
  best: number
  /** Whether the day or week is over. */
  final: boolean
}

function tally(
  rows: readonly TeamDay[],
  teamIds: readonly string[],
  periodOf: (day: string) => string,
  endOf: (start: string) => string,
  today: string,
): Result[] {
  const periods = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const start = periodOf(row.day)
    let points = periods.get(start)
    if (!points) periods.set(start, (points = new Map(teamIds.map((id) => [id, 0]))))
    if (points.has(row.team_id)) points.set(row.team_id, round(points.get(row.team_id)! + Number(row.game_points)))
  }

  return [...periods]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([start, points]) => {
      const best = Math.max(...points.values())
      const end = endOf(start)
      return {
        start,
        end,
        points,
        winners: best > 0 ? [...points].filter(([, p]) => p === best).map(([id]) => id) : [],
        best,
        final: end < today,
      }
    })
}

/** Every day with points, newest first. Today is there too, not final yet. */
export const dailyResults = (rows: readonly TeamDay[], teamIds: readonly string[], today: string) =>
  tally(rows, teamIds, (day) => day, (day) => day, today)

/** Every week with points, newest first. The current week isn't final. */
export const weeklyResults = (rows: readonly TeamDay[], teamIds: readonly string[], today: string) =>
  tally(rows, teamIds, weekStart, (start) => addDays(start, 6), today)

/** How many finished days or weeks each team has won. A tie counts for everyone in it. */
export function winCounts(results: readonly Result[]) {
  const counts = new Map<string, number>()
  for (const result of results) {
    if (!result.final) continue
    for (const id of result.winners) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}
