import { describe, expect, it } from 'vitest'
import {
  addDays, buildRace, dailyResults, fantasyToday, teamColors, weekStart, weeklyResults, winCounts,
} from './history.ts'
import type { TeamDay } from './types.ts'

const day = (team_id: string, date: string, game_points: number, adjustment_points = 0): TeamDay => ({
  team_id, day: date, game_points, goals: 0, adjustment_points,
})

// Mon 12 Oct to Tue 20 Oct 2026. B has an off night on the 13th.
const rows = [
  day('a', '2026-10-12', 10), day('b', '2026-10-12', 12.5),
  day('a', '2026-10-13', 7.1),
  day('a', '2026-10-17', 3), day('b', '2026-10-17', 3),
  day('a', '2026-10-19', 1), day('b', '2026-10-19', 4, -2),
  day('b', '2026-10-20', 0, 5),
]
const teams = ['a', 'b', 'c']

describe('days', () => {
  it('count and step without time zones getting in the way', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2027-03-08', -1)).toBe('2027-03-07')
  })

  it('group into Monday-to-Sunday weeks', () => {
    expect(weekStart('2026-10-12')).toBe('2026-10-12') // a Monday
    expect(weekStart('2026-10-18')).toBe('2026-10-12') // the Sunday after
    expect(weekStart('2026-10-19')).toBe('2026-10-19')
    expect(weekStart('2027-01-01')).toBe('2026-12-28')
  })

  it("roll over at 6 AM in New York, like the database's today", () => {
    // 2026-10-13 05:59 and 06:00 Eastern (EDT, UTC-4).
    expect(fantasyToday(Date.parse('2026-10-13T09:59:00Z'))).toBe('2026-10-12')
    expect(fantasyToday(Date.parse('2026-10-13T10:00:00Z'))).toBe('2026-10-13')
    // In winter (EST, UTC-5) the rollover moves an hour later in UTC.
    expect(fantasyToday(Date.parse('2027-01-15T10:30:00Z'))).toBe('2027-01-14')
  })
})

describe('the race', () => {
  it("keeps each team's running total, adjustments included", () => {
    const race = buildRace(rows, teams)
    expect(race.days).toEqual(['2026-10-12', '2026-10-13', '2026-10-17', '2026-10-19', '2026-10-20'])
    expect(race.totals.get('a')).toEqual([10, 17.1, 20.1, 21.1, 21.1])
    expect(race.totals.get('b')).toEqual([12.5, 12.5, 15.5, 17.5, 22.5])
    expect(race.totals.get('c')).toEqual([0, 0, 0, 0, 0])
  })

  it('gives each team the same colour whatever its place', () => {
    const colors = teamColors(['c', 'a', 'b'])
    expect(colors.get('a')).toBe('var(--series-1)')
    expect(colors.get('b')).toBe('var(--series-2)')
    expect(colors.get('c')).toBe('var(--series-3)')
    expect(teamColors(['b', 'c', 'a'])).toEqual(colors)
  })
})

describe('winners', () => {
  it('of each day, newest first, counting only points from games', () => {
    const days = dailyResults(rows, teams, '2026-10-20')
    expect(days.map((d) => [d.start, d.winners, d.best, d.final])).toEqual([
      ['2026-10-20', [], 0, false], // only an adjustment, and not over yet
      ['2026-10-19', ['b'], 4, true],
      ['2026-10-17', ['a', 'b'], 3, true], // a tie
      ['2026-10-13', ['a'], 7.1, true],
      ['2026-10-12', ['b'], 12.5, true],
    ])
    expect(days[1].points).toEqual(new Map([['a', 1], ['b', 4], ['c', 0]]))
  })

  it('of each week, with the current week still open', () => {
    const weeks = weeklyResults(rows, teams, '2026-10-20')
    expect(weeks.map((w) => [w.start, w.end, w.winners, w.best, w.final])).toEqual([
      ['2026-10-19', '2026-10-25', ['b'], 4, false],
      ['2026-10-12', '2026-10-18', ['a'], 20.1, true],
    ])
  })

  it('are counted only once the day or week is over, with ties counting for each', () => {
    expect(winCounts(dailyResults(rows, teams, '2026-10-20'))).toEqual(new Map([['b', 3], ['a', 2]]))
    expect(winCounts(weeklyResults(rows, teams, '2026-10-20'))).toEqual(new Map([['a', 1]]))
  })
})
