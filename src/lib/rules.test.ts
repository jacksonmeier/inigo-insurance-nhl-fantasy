import { describe, expect, it } from 'vitest'
import { clock, gameStatus, injuryTag, points, signed, timeAgo, timeLeft } from './format.ts'
import { describeNeeds, hasOpenIrSlot, openSlots, picksUntil, roundOf, teamOnClock, totalPicks, tradeProblem } from './rules.ts'

const player = (position_group: 'F' | 'D' | 'G', slot: 'active' | 'ir' = 'active', is_ir_replacement = false) => ({
  position_group, slot, is_ir_replacement,
})
const full = [player('F'), player('F'), player('F'), player('D'), player('D'), player('G')]

describe('roster needs', () => {
  it('counts open slots by position', () => {
    expect(openSlots([])).toEqual({ F: 3, D: 2, G: 1 })
    expect(openSlots([player('F'), player('G')])).toEqual({ F: 2, D: 2, G: 0 })
    expect(openSlots(full)).toEqual({ F: 0, D: 0, G: 0 })
  })

  it('does not count a player on IR as filling a slot', () => {
    const roster = [player('F'), player('F'), player('F', 'ir'), player('D'), player('D'), player('G')]
    expect(openSlots(roster)).toEqual({ F: 1, D: 0, G: 0 })
    expect(hasOpenIrSlot(roster)).toBe(false)
    expect(hasOpenIrSlot(full)).toBe(true)
  })

  it('describes them', () => {
    expect(describeNeeds({ F: 2, D: 0, G: 1 })).toBe('2 F, 1 G')
    expect(describeNeeds({ F: 0, D: 0, G: 0 })).toBeNull()
  })
})

describe('draft order', () => {
  const order = ['a', 'b', 'c', 'd']

  it('snakes', () => {
    const picks = Array.from({ length: 12 }, (_, i) => teamOnClock(order, i + 1))
    expect(picks.join('')).toBe('abcddcbaabcd')
    expect(teamOnClock([], 1)).toBeNull()
  })

  it('knows the round and the length of the draft', () => {
    expect(roundOf(1, 4)).toBe(1)
    expect(roundOf(4, 4)).toBe(1)
    expect(roundOf(5, 4)).toBe(2)
    expect(roundOf(24, 4)).toBe(6)
    expect(totalPicks(4)).toBe(24)
  })

  it('counts the picks until a team is up', () => {
    expect(picksUntil(order, 1, 'a')).toBe(0)
    expect(picksUntil(order, 1, 'd')).toBe(3)
    expect(picksUntil(order, 5, 'a')).toBe(3) // d c b a
    expect(picksUntil(order, 9, 'd')).toBe(3)
    expect(picksUntil(order, 24, 'a')).toBe(0)
    expect(picksUntil(order, 24, 'd')).toBeNull()
  })
})

describe('trades', () => {
  const mine = { name: 'Mine', roster: full }
  const theirs = { name: 'Theirs', roster: full }
  const f = (player_id: number) => ({ player_id, position_group: 'F' as const })
  const d = (player_id: number) => ({ player_id, position_group: 'D' as const })

  it('allow like for like', () => {
    expect(tradeProblem(mine, theirs, [f(1)], [f(2)])).toBeNull()
    expect(tradeProblem(mine, theirs, [f(1), d(3)], [f(2), d(4)])).toBeNull()
  })

  it('refuse to overfill a position', () => {
    // A forward for a defenseman breaks both rosters. The first problem found is reported.
    expect(tradeProblem(mine, theirs, [f(1)], [d(2)])).toBe('Theirs would have too many F (limit 3).')
    expect(tradeProblem(mine, theirs, [], [d(2)])).toBe('Mine would have too many D (limit 2).')
    expect(tradeProblem(mine, theirs, [], [f(2)])).toBe('Mine would have too many F (limit 3).')
    expect(tradeProblem(mine, theirs, [f(1)], [])).toBe('Theirs would have too many F (limit 3).')
    expect(tradeProblem(mine, theirs, [], [])).toBe('Choose at least one player.')
  })

  it('keep the spot of a player on IR', () => {
    const short = { name: 'Mine', roster: [player('F'), player('F'), player('F', 'ir'), player('D'), player('D'), player('G')] }
    const roomy = { name: 'Theirs', roster: [player('F'), player('F'), player('D'), player('D'), player('G')] }
    expect(tradeProblem(short, roomy, [d(1)], [f(2)])).toBe('Mine would have too many F (limit 3).')

    // Once a replacement has the spot, it's an ordinary full roster.
    const replaced = { name: 'Mine', roster: [...short.roster, player('F', 'active', true)] }
    expect(tradeProblem(replaced, theirs, [f(1)], [f(2)])).toBeNull()
  })
})

describe('formatting', () => {
  it('shows points to one decimal', () => {
    expect(points(12.35)).toBe('12.4')
    expect(points(0)).toBe('0.0')
    expect(points(-0.04)).toBe('0.0')
    expect(points(-0.2)).toBe('-0.2')
    expect(points(null)).toBe('0.0')
    expect(signed(3.2)).toBe('+3.2')
    expect(signed(-1)).toBe('-1.0')
  })

  it('counts down', () => {
    expect(clock(120)).toBe('2:00')
    expect(clock(9.2)).toBe('0:10')
    expect(clock(-5)).toBe('0:00')
    expect(clock(3725)).toBe('1:02:05')
  })

  it('describes time left and time ago', () => {
    const now = Date.parse('2026-10-01T12:00:00Z')
    expect(timeLeft('2026-10-02T11:14:00Z', now)).toBe('23h 14m')
    expect(timeLeft('2026-10-01T12:09:30Z', now)).toBe('9m')
    expect(timeLeft('2026-10-01T12:00:20Z', now)).toBe('under a minute')
    expect(timeLeft('2026-10-01T11:00:00Z', now)).toBe('any minute now')
    expect(timeLeft('2026-10-04T14:00:00Z', now)).toBe('3d 2h')
    expect(timeAgo('2026-10-01T11:59:40Z', now)).toBe('just now')
    expect(timeAgo('2026-10-01T11:48:00Z', now)).toBe('12m ago')
    expect(timeAgo('2026-10-01T07:00:00Z', now)).toBe('5h ago')
    expect(timeAgo('2026-09-29T12:00:00Z', now)).toBe('2d ago')
  })

  it('labels game states and injuries', () => {
    const game = { start_time_utc: '2026-10-01T23:00:00Z', period: 2, game_state: 'LIVE' }
    expect(gameStatus(game)).toBe('P2')
    expect(gameStatus({ ...game, game_state: 'CRIT', period: 4 })).toBe('OT')
    expect(gameStatus({ ...game, game_state: 'OFF', period: 3 })).toBe('Final')
    expect(gameStatus({ ...game, game_state: 'FINAL', period: 5 })).toBe('Final/SO')
    expect(gameStatus({ ...game, game_state: 'FUT', schedule_state: 'PPD' })).toBe('Postponed')

    expect(injuryTag('Injured Reserve')).toEqual({ label: 'IR', tone: 'out' })
    expect(injuryTag('Out')).toEqual({ label: 'Out', tone: 'out' })
    expect(injuryTag('Day-To-Day')).toEqual({ label: 'DTD', tone: 'dtd' })
    expect(injuryTag(null)).toBeNull()
  })
})
