// The scoring engine, checked against hand-calculated numbers from a real
// game: Montreal 4 at NY Rangers 5 (OT), 13 December 2025, NHL game 2025020500.
// The fixtures are the NHL's actual responses for that game.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGame, specialTeamsPoints, type PlayerGameRow } from '../functions/_shared/boxscore.ts'
import type { NhlBoxscore, NhlLanding } from '../functions/_shared/nhl.ts'
import { SCORING } from '../functions/_shared/scoring.config.ts'
import { scoreGoalie, scoreSkater } from '../functions/_shared/scoring.ts'

const fixture = <T>(name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')) as T

const boxscore = fixture<NhlBoxscore>('boxscore-2025020500.json')
const landing = fixture<NhlLanding>('landing-2025020500.json')

const nothing = { goals: 0, assists: 0, powerPlayPoints: 0, shorthandedPoints: 0, shots: 0, hits: 0, blockedShots: 0 }

describe('scoring values', () => {
  it('match the spec', () => {
    expect(SCORING).toEqual({
      skater: { goal: 3, assist: 2, powerPlayPoint: 1, shorthandedPoint: 1, shotOnGoal: 0.3, hit: 0.2, blockedShot: 0.3 },
      goalie: { win: 4, save: 0.2, goalAgainst: -1, shutout: 3 },
    })
  })
})

describe('scoreSkater', () => {
  it('scores each stat on its own', () => {
    expect(scoreSkater({ ...nothing, goals: 1 }).points).toBe(3)
    expect(scoreSkater({ ...nothing, assists: 1 }).points).toBe(2)
    expect(scoreSkater({ ...nothing, shots: 1 }).points).toBe(0.3)
    expect(scoreSkater({ ...nothing, hits: 1 }).points).toBe(0.2)
    expect(scoreSkater({ ...nothing, blockedShots: 1 }).points).toBe(0.3)
    expect(scoreSkater(nothing)).toEqual({ points: 0, breakdown: {} })
  })

  it('adds the power play and shorthanded bonus on top of the goal or assist', () => {
    // A power play goal is worth 3 + 1. A shorthanded assist is worth 2 + 1.
    expect(scoreSkater({ ...nothing, goals: 1, powerPlayPoints: 1 }).points).toBe(4)
    expect(scoreSkater({ ...nothing, assists: 1, shorthandedPoints: 1 }).points).toBe(3)
  })

  it('does not drift with floating point', () => {
    // 0.3 x 3 is 0.8999999999999999 in floating point.
    expect(scoreSkater({ ...nothing, shots: 3 }).points).toBe(0.9)
    expect(scoreSkater({ ...nothing, shots: 7, hits: 3, blockedShots: 1 }).points).toBe(3)
    // A full season's worth: 306 shots, 39 hits, 27 blocks.
    expect(scoreSkater({ ...nothing, shots: 306, hits: 39, blockedShots: 27 }).points).toBe(107.7)
  })

  it('explains where the points came from', () => {
    expect(scoreSkater({ ...nothing, goals: 2, shots: 3, hits: 3, powerPlayPoints: 1 })).toEqual({
      points: 8.5,
      breakdown: { goals: 6, powerPlayPoints: 1, shots: 0.9, hits: 0.6 },
    })
  })

  it('uses whatever values the config has', () => {
    const doubled = { ...SCORING, skater: { ...SCORING.skater, goal: 6 } }
    expect(scoreSkater({ ...nothing, goals: 2 }, doubled).points).toBe(12)
  })
})

describe('scoreGoalie', () => {
  it('scores wins, saves, goals against and shutouts', () => {
    expect(scoreGoalie({ wins: 1, saves: 0, goalsAgainst: 0, shutouts: 0 }).points).toBe(4)
    expect(scoreGoalie({ wins: 0, saves: 10, goalsAgainst: 0, shutouts: 0 }).points).toBe(2)
    expect(scoreGoalie({ wins: 0, saves: 0, goalsAgainst: 3, shutouts: 0 }).points).toBe(-3)
    // A 30-save shutout win: 4 + 6 + 3.
    expect(scoreGoalie({ wins: 1, saves: 30, goalsAgainst: 0, shutouts: 1 }).points).toBe(13)
  })

  it('can go negative on a bad night', () => {
    expect(scoreGoalie({ wins: 0, saves: 12, goalsAgainst: 6, shutouts: 0 })).toEqual({
      points: -3.6,
      breakdown: { saves: 2.4, goalsAgainst: -6 },
    })
  })
})

describe('a real game: MTL 4 at NYR 5 (OT)', () => {
  const { game, players } = buildGame(boxscore, landing)
  const player = (id: number) => players.find((p) => p.player_id === id) as PlayerGameRow

  it('reads the game itself', () => {
    expect(game).toEqual({
      id: 2025020500, season: 20252026, game_type: 2, game_date: '2025-12-13',
      start_time_utc: '2025-12-14T00:00:00Z', home_team: 'NYR', away_team: 'MTL',
      home_score: 5, away_score: 4, game_state: 'OFF', schedule_state: 'OK', period: 4,
    })
  })

  it('finds the power play points in the scoring summary', () => {
    // Two NYR power play goals: Laba from Cuylle and Sheary; Miller from
    // Zibanejad and Trocheck in overtime. Nothing shorthanded.
    const { powerPlay, shorthanded } = specialTeamsPoints(landing)
    expect(Object.fromEntries(powerPlay)).toEqual({
      8483690: 1, 8482157: 1, 8477839: 1, 8476468: 1, 8476459: 1, 8476389: 1,
    })
    expect(shorthanded.size).toBe(0)
  })

  // Each expected total below was worked out by hand from the boxscore.
  it.each([
    // J.T. Miller: 2 G (one on the power play), 3 SOG, 3 hits
    //   2x3 + 1x1 + 3x0.3 + 3x0.2 = 6 + 1 + 0.9 + 0.6
    { id: 8476468, name: 'J. Miller', points: 8.5, goals: 2, assists: 0, ppp: 1 },
    // Noah Laba: 1 G (power play), 1 A, 2 SOG, 5 hits, 1 block
    //   3 + 2 + 1 + 0.6 + 1.0 + 0.3
    { id: 8483690, name: 'N. Laba', points: 7.9, goals: 1, assists: 1, ppp: 1 },
    // Will Cuylle: 1 G, 1 A (on the power play), 1 SOG, 3 hits, 2 blocks
    //   3 + 2 + 1 + 0.3 + 0.6 + 0.6
    { id: 8482157, name: 'W. Cuylle', points: 7.5, goals: 1, assists: 1, ppp: 1 },
    // Artemi Panarin: 1 G (penalty shot, even strength), 8 SOG, 1 hit, 1 block
    //   3 + 2.4 + 0.2 + 0.3
    { id: 8478550, name: 'A. Panarin', points: 5.9, goals: 1, assists: 0, ppp: 0 },
    // Nick Suzuki: 2 A, 1 SOG, 1 hit
    //   4 + 0.3 + 0.2
    { id: 8480018, name: 'N. Suzuki', points: 4.5, goals: 0, assists: 2, ppp: 0 },
    // Lane Hutson (D): 2 A and nothing else
    { id: 8483457, name: 'L. Hutson', points: 4, goals: 0, assists: 2, ppp: 0 },
  ])('$name scores $points', ({ id, name, points, goals, assists, ppp }) => {
    expect(player(id)).toMatchObject({
      name, points, goals, assists, power_play_points: ppp, shorthanded_points: 0,
    })
  })

  it('scores the goalies', () => {
    // Igor Shesterkin: win, 14 saves, 4 goals against = 4 + 2.8 - 4
    expect(player(8478048)).toMatchObject({
      position: 'G', nhl_team: 'NYR', decision: 'W', saves: 14, goals_against: 4, shutout: false,
      points: 2.8, breakdown: { wins: 4, saves: 2.8, goalsAgainst: -4 },
    })
    // Jacob Fowler: overtime loss, 24 saves, 5 goals against = 4.8 - 5
    expect(player(8484170)).toMatchObject({
      nhl_team: 'MTL', decision: 'O', saves: 24, goals_against: 5, points: -0.2,
    })
  })

  it('leaves out the backup goalies, who dressed but did not play', () => {
    expect(player(8471734)).toBeUndefined() // Jonathan Quick
    expect(player(8478470)).toBeUndefined() // Sam Montembeault
    expect(players.filter((p) => p.position === 'G')).toHaveLength(2)
  })

  it('has one line per player who played, and the goals add up', () => {
    expect(players).toHaveLength(38) // 18 skaters and 1 goalie a side
    expect(new Set(players.map((p) => p.player_id)).size).toBe(38)

    const goals = (team: string) => players.filter((p) => p.nhl_team === team).reduce((sum, p) => sum + p.goals, 0)
    expect(goals('NYR')).toBe(5)
    expect(goals('MTL')).toBe(4)
  })
})

describe('shutouts', () => {
  const game = (overrides: Partial<NhlBoxscore>, goalies: object[]): NhlBoxscore => ({
    ...boxscore,
    ...overrides,
    playerByGameStats: {
      awayTeam: { forwards: [], defense: [], goalies: [] },
      homeTeam: { forwards: [], defense: [], goalies: goalies as never },
    },
  })
  const goalie = (id: number, toi: string, goalsAgainst: number, extra = {}) => ({
    playerId: id, name: { default: `G${id}` }, position: 'G', saves: 20, goalsAgainst, toi, ...extra,
  })

  it('go to a goalie who played the whole game and allowed nothing', () => {
    const { players } = buildGame(game({ gameState: 'OFF' }, [goalie(1, '60:00', 0, { decision: 'W' }), goalie(2, '00:00', 0)]), null)
    expect(players).toHaveLength(1)
    // 4 (win) + 4 (20 saves) + 3 (shutout)
    expect(players[0]).toMatchObject({ shutout: true, points: 11 })
  })

  it('are not awarded while the game is still being played', () => {
    const { players } = buildGame(game({ gameState: 'LIVE' }, [goalie(1, '31:12', 0)]), null)
    expect(players[0]).toMatchObject({ shutout: false, decision: null, points: 4 })
  })

  it('are not awarded when two goalies share one', () => {
    const { players } = buildGame(game({ gameState: 'FINAL' }, [goalie(1, '40:00', 0, { decision: 'W' }), goalie(2, '20:00', 0)]), null)
    expect(players.map((p) => p.shutout)).toEqual([false, false])
  })

  it('still count in a 1-0 shootout loss', () => {
    const { players } = buildGame(game({ gameState: 'OFF' }, [goalie(1, '65:00', 0, { decision: 'O' })]), null)
    expect(players[0]).toMatchObject({ shutout: true, decision: 'O', points: 7 })
  })
})

describe('a game that has not started', () => {
  it('has no player lines', () => {
    const { game, players } = buildGame({ ...boxscore, gameState: 'FUT', playerByGameStats: undefined }, { id: boxscore.id })
    expect(players).toEqual([])
    expect(game.game_state).toBe('FUT')
  })
})
