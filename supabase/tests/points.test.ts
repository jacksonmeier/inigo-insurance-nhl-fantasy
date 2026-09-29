// Who gets the points: roster history, the leaderboard, and the
// commissioner's corrections.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  activity, backdateRosters, COMMISH, createLeague, D, expectError, F, G, json, OWNERS, runDraft, scoreGame,
  SEASON, standings, TEAMS, type League,
} from './helpers.ts'

let league: League

const credited = (gameId: number, player: number) =>
  league
    .query<{ team_id: string | null; points: string }>(
      `select team_id, points::text from public.player_game_points where game_id = $1 and player_id = $2`,
      [gameId, player],
    )
    .then((rows) => rows[0])

const totals = async () => Object.fromEntries((await standings(league)).map((t) => [t.name, t.total_points]))

beforeEach(async () => {
  league = await createLeague()
  await runDraft(league)
  await backdateRosters(league)
})

describe('points for a game', () => {
  it('go to the team that had the player at puck drop', async () => {
    const game = await scoreGame(league, [
      { player: F(1), points: 8.4, goals: 2 },
      { player: D(3), points: 1.5 },
      { player: F(13), points: 9 }, // a free agent: tracked, credited to nobody
    ])

    expect(await credited(game, F(1))).toEqual({ team_id: TEAMS.a, points: '8.40' })
    expect(await credited(game, D(3))).toEqual({ team_id: TEAMS.b, points: '1.50' })
    expect(await credited(game, F(13))).toEqual({ team_id: null, points: '9.00' })
    expect(await totals()).toEqual({ 'Team A': '8.40', 'Team B': '1.50', 'Team C': '0.00', 'Team D': '0.00' })
  })

  it('stay with the old team after the player is dropped', async () => {
    const before = await scoreGame(league, [{ player: F(1), points: 5 }], `now() - interval '3 hours'`)
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13), p_drop_player_id: F(1) })

    expect(await credited(before, F(1))).toMatchObject({ team_id: TEAMS.a })
    expect((await totals())['Team A']).toBe('5.00')
  })

  it('do not count for a player added after puck drop', async () => {
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13), p_drop_player_id: F(1) })
    // The game started an hour ago; the add happened just now.
    const game = await scoreGame(league, [{ player: F(13), points: 6 }, { player: F(1), points: 2 }])

    expect(await credited(game, F(13))).toMatchObject({ team_id: null })
    // F1 was still Team A's when it started, so his points count.
    expect(await credited(game, F(1))).toMatchObject({ team_id: TEAMS.a })
    expect((await totals())['Team A']).toBe('2.00')
  })

  it('follow a stat correction when the game is re-imported', async () => {
    const game = await scoreGame(league, [{ player: F(1), points: 8.4, goals: 2 }, { player: F(8), points: 1 }])

    const again = await league.service<Record<string, number>>('ingest_game', {
      p_game: {
        id: game, season: SEASON, game_type: 2, game_date: '2026-10-07',
        start_time_utc: new Date(Date.now() - 3_600_000).toISOString(),
        home_team: 'EDM', away_team: 'TOR', home_score: 3, away_score: 2, game_state: 'OFF',
      },
      // The NHL took a goal away from F1, and F8 turned out not to have played.
      p_stats: [{ player_id: F(1), nhl_team: 'EDM', goals: 1, points: 5.4, breakdown: { goals: 3 } }],
    })

    expect(again).toMatchObject({ points_changed: 1, removed: 1 })
    expect(await credited(game, F(1))).toEqual({ team_id: TEAMS.a, points: '5.40' })
    expect(await credited(game, F(8))).toBeUndefined()
    expect((await totals())['Team A']).toBe('5.40')
  })

  it('are left alone when nothing changed, so screens are not refreshed for nothing', async () => {
    const lines = [{ player: F(1), points: 8.4, goals: 2 }]
    const game = await scoreGame(league, lines)
    const [{ calculated_at: first }] = await league.query<{ calculated_at: string }>(
      `select calculated_at::text from public.player_game_points where game_id = $1`, [game],
    )

    const again = await league.service<Record<string, number>>('ingest_game', {
      p_game: {
        id: game, season: SEASON, game_type: 2, game_date: '2026-10-07',
        start_time_utc: new Date(Date.now() - 3_600_000).toISOString(),
        home_team: 'EDM', away_team: 'TOR', game_state: 'OFF',
      },
      p_stats: [{ player_id: F(1), nhl_team: 'EDM', goals: 2, points: 8.4, breakdown: { goals: 8.4 } }],
    })
    expect(again).toMatchObject({ stats_changed: 0, points_changed: 0 })

    const [{ calculated_at: second }] = await league.query<{ calculated_at: string }>(
      `select calculated_at::text from public.player_game_points where game_id = $1`, [game],
    )
    expect(second).toBe(first)
  })

  it('are not wiped by an empty boxscore', async () => {
    const game = await scoreGame(league, [{ player: F(1), points: 8.4 }])
    await league.service('ingest_game', {
      p_game: {
        id: game, season: SEASON, game_type: 2, game_date: '2026-10-07',
        start_time_utc: new Date().toISOString(), home_team: 'EDM', away_team: 'TOR', game_state: 'LIVE',
      },
      p_stats: json([]),
    })
    expect(await credited(game, F(1))).toMatchObject({ points: '8.40' })
  })

  it('cannot be written from the browser', async () => {
    await expectError(
      league.rpc(OWNERS.a, 'ingest_game', { p_game: { id: 1 }, p_stats: json([]) }),
      /permission denied/,
    )
    await expectError(
      league.queryAs(OWNERS.a, `update public.player_game_points set points = 999 where true`),
      /permission denied/,
    )
  })
})

describe('the leaderboard', () => {
  it('ranks by points, then by goals', async () => {
    await scoreGame(league, [
      { player: F(1), points: 10, goals: 1 }, // A
      { player: F(2), points: 10, goals: 3 }, // B: same points, more goals
      { player: F(3), points: 12, goals: 0 }, // C
    ])

    expect(await standings(league)).toEqual([
      { name: 'Team C', total_points: '12.00', total_goals: 0, today_points: '12.00', rank: 1 },
      { name: 'Team B', total_points: '10.00', total_goals: 3, today_points: '10.00', rank: 2 },
      { name: 'Team A', total_points: '10.00', total_goals: 1, today_points: '10.00', rank: 3 },
      { name: 'Team D', total_points: '0.00', total_goals: 0, today_points: '0.00', rank: 4 },
    ])
  })

  it('counts regular season games from this season only', async () => {
    const game = (type: number, season: number, id: number) =>
      league.service('ingest_game', {
        p_game: {
          id, season, game_type: type, game_date: '2026-10-07',
          start_time_utc: new Date(Date.now() - 3_600_000).toISOString(),
          home_team: 'EDM', away_team: 'TOR', game_state: 'OFF',
        },
        p_stats: [{ player_id: F(1), nhl_team: 'EDM', goals: 1, points: 5, breakdown: {} }],
      })

    await game(1, SEASON, 2026010001) // preseason
    await game(3, SEASON, 2026030001) // playoffs
    await game(2, SEASON - 10001, 2025020001) // last season
    expect((await totals())['Team A']).toBe('0.00')

    await game(2, SEASON, 2026020500)
    expect((await totals())['Team A']).toBe('5.00')
  })

  it('shows today separately from the season total', async () => {
    await scoreGame(league, [{ player: F(1), points: 4 }])
    const yesterday = await scoreGame(league, [{ player: F(1), points: 6 }], `now() - interval '2 days'`)
    await league.query(`update public.games set game_date = public.fantasy_today() - 1 where id = $1`, [yesterday])

    expect((await standings(league)).find((t) => t.name === 'Team A')).toMatchObject({
      total_points: '10.00', today_points: '4.00',
    })
  })

  it('names the top scorers of the week', async () => {
    await scoreGame(league, [{ player: F(1), points: 4 }, { player: F(2), points: 9.5 }, { player: F(13), points: 30 }])
    const top = await league.query<{ full_name: string; team_name: string; points: string }>(
      `select full_name, team_name, points::text from public.week_scorers order by points desc`,
    )
    // F13 scored the most but is a free agent, so he's not in the running.
    expect(top).toEqual([
      { full_name: 'Forward F2', team_name: 'Team B', points: '9.50' },
      { full_name: 'Forward F1', team_name: 'Team A', points: '4.00' },
    ])
  })
})

describe('the team page', () => {
  it('shows each player with his points, injury and next game', async () => {
    await scoreGame(league, [{ player: F(1), points: 4 }])
    await league.service('ingest_schedule', {
      p_games: [{
        id: 2026020900, season: SEASON, game_type: 2, game_date: '2026-12-01',
        start_time_utc: new Date(Date.now() + 86_400_000).toISOString(),
        home_team: 'VAN', away_team: 'EDM', game_state: 'FUT', schedule_state: 'OK',
      }],
    })
    await league.service('ingest_injuries', {
      p_rows: [{ espn_athlete_id: 'e1', espn_name: 'F1', player_id: F(1), match_confidence: 'high', status: 'Day-To-Day', description: 'Flu' }],
    })

    const rows = await league.queryAs<Record<string, unknown>>(
      OWNERS.c,
      `select full_name, slot, season_points::text, team_points::text, today_points::text, injury_status,
              is_ir_eligible, next_game_home, next_game_away
       from public.team_rosters where team_id = $1 and player_id = $2`,
      [TEAMS.a, F(1)],
    )
    expect(rows).toEqual([{
      full_name: 'Forward F1', slot: 'active', season_points: '4.00', team_points: '4.00', today_points: '4.00',
      injury_status: 'Day-To-Day', is_ir_eligible: false, next_game_home: 'VAN', next_game_away: 'EDM',
    }])
  })

  it('does not count tonight for a player added after puck drop', async () => {
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13), p_drop_player_id: F(9) })
    await scoreGame(league, [{ player: F(13), points: 6 }, { player: F(1), points: 2 }])

    const rows = await league.queryAs<Record<string, unknown>>(
      OWNERS.a,
      `select player_id::int as player_id, today_points::text, today_not_counting, season_points::text, team_points::text
       from public.team_rosters where team_id = $1 and player_id in (${F(1)}, ${F(13)}) order by player_id`,
      [TEAMS.a],
    )
    expect(rows).toEqual([
      { player_id: F(1), today_points: '2.00', today_not_counting: false, season_points: '2.00', team_points: '2.00' },
      // He has 6 points tonight, but he joined after the game started.
      { player_id: F(13), today_points: '0.00', today_not_counting: true, season_points: '6.00', team_points: '0.00' },
    ])
  })

  it('lists free agents, waivers and rostered players in the player pool', async () => {
    await league.rpc(OWNERS.a, 'drop_player', { p_player_id: F(9) })
    const pool = await league.queryAs<{ id: number; availability: string; last_season_points: string }>(
      OWNERS.b,
      `select id::int as id, availability, last_season_points::text from public.player_pool
       where id in (${F(1)}, ${F(9)}, ${F(13)}) order by id`,
    )
    expect(pool).toEqual([
      { id: F(1), availability: 'rostered', last_season_points: '899.00' },
      { id: F(9), availability: 'waivers', last_season_points: '891.00' },
      { id: F(13), availability: 'free_agent', last_season_points: '887.00' },
    ])
  })
})

describe('commissioner corrections', () => {
  it('adjust a team total, with a reason everyone can see', async () => {
    await scoreGame(league, [{ player: F(1), points: 10, goals: 1 }])
    await league.rpc(COMMISH, 'commish_adjust_points', {
      p_team_id: TEAMS.a, p_points: -2.5, p_reason: 'Assist was taken away after the app stopped checking',
    })

    expect((await standings(league)).find((t) => t.name === 'Team A')).toMatchObject({
      total_points: '7.50', total_goals: 1,
    })
    expect((await activity(league, 'commissioner')).at(-1)?.summary).toBe(
      'Commissioner: adjusted Team A by -2.50 points. Assist was taken away after the app stopped checking',
    )

    await expectError(
      league.rpc(COMMISH, 'commish_adjust_points', { p_team_id: TEAMS.a, p_points: 1, p_reason: ' ' }),
      /Give a reason/,
    )
    await expectError(
      league.rpc(OWNERS.b, 'commish_adjust_points', { p_team_id: TEAMS.b, p_points: 100, p_reason: 'because' }),
      /Only the commissioner/,
    )
  })

  it('fix a roster after the fact and move the points with it', async () => {
    // Team A meant to add F13 two days ago but the app was down.
    const game = await scoreGame(league, [{ player: F(13), points: 6 }, { player: F(9), points: 3 }])
    expect((await totals())['Team A']).toBe('3.00')

    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString()
    await league.rpc(COMMISH, 'commish_remove_from_roster', { p_player_id: F(9), p_effective_at: twoDaysAgo })
    await league.rpc(COMMISH, 'commish_add_to_roster', {
      p_team_id: TEAMS.a, p_player_id: F(13), p_effective_at: twoDaysAgo, p_note: 'App was down',
    })

    expect(await credited(game, F(13))).toMatchObject({ team_id: TEAMS.a })
    expect(await credited(game, F(9))).toMatchObject({ team_id: null })
    expect((await totals())['Team A']).toBe('6.00')
    expect((await league.roster('a')).map((r) => r.player_id)).toEqual([F(1), F(8), F(13), D(4), D(5), G(4)])
    expect((await activity(league, 'commissioner')).map((t) => t.summary)).toEqual(
      expect.arrayContaining([
        'Commissioner: removed Forward F9 (C, EDM) from Team A',
        'Commissioner: added Forward F13 (L, EDM) to Team A. App was down',
      ]),
    )
  })

  it('still respect the roster limits and one team per player', async () => {
    await expectError(
      league.rpc(COMMISH, 'commish_add_to_roster', { p_team_id: TEAMS.a, p_player_id: G(5) }),
      /No open G slot/,
    )
    await expectError(
      league.rpc(COMMISH, 'commish_add_to_roster', { p_team_id: TEAMS.a, p_player_id: F(2) }),
      /already on a roster/,
    )
    await expectError(
      league.rpc(OWNERS.b, 'commish_add_to_roster', { p_team_id: TEAMS.b, p_player_id: F(13) }),
      /Only the commissioner/,
    )
    await expectError(
      league.rpc(OWNERS.b, 'commish_remove_from_roster', { p_player_id: F(1) }),
      /Only the commissioner/,
    )
  })

  it('can resolve a waiver early', async () => {
    await league.rpc(OWNERS.a, 'drop_player', { p_player_id: F(9) })
    await league.rpc(OWNERS.b, 'claim_waiver', { p_player_id: F(9), p_drop_player_id: F(10) })
    const [{ id }] = await league.query<{ id: string }>(`select id from public.waivers where status = 'open'`)

    await expectError(league.rpc(OWNERS.b, 'commish_force_waiver', { p_waiver_id: id }), /Only the commissioner/)
    expect(await league.rpc(COMMISH, 'commish_force_waiver', { p_waiver_id: id })).toBe('awarded')
    expect((await league.roster('b')).map((r) => r.player_id)).toContain(F(9))
  })
})
