// The views behind the season history, the Tonight screen and the player
// sheet: points by day, tonight's lines, season totals, and games to come.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  COMMISH, backdateRosters, createLeague, D, F, G, OWNERS, runDraft, SEASON, standings, TEAMS, type League,
} from './helpers.ts'

let league: League
let nextGameId = 2026030001

type Line = {
  player: number
  points: number
  goals?: number
  assists?: number
  ppp?: number
  shots?: number
  hits?: number
  blocks?: number
  decision?: 'W' | 'L' | 'O'
  saves?: number
  against?: number
  shutout?: boolean
}

type GameOptions = { daysAgo?: number; hoursAgo?: number; state?: string; type?: number }

// Test players' NHL teams: forwards EDM, defense TOR, goalies BOS.
const nhlTeam = (player: number) => (player >= 300 ? 'BOS' : player >= 200 ? 'TOR' : 'EDM')

/** Imports a game's boxscore the way the sync function does. */
async function playGame(lines: Line[], options: GameOptions = {}) {
  const { daysAgo = 0, hoursAgo = 1, state = 'OFF', type = 2 } = options
  const id = nextGameId++
  const [{ start, day }] = await league.query<{ start: string; day: string }>(
    `select (now() - make_interval(days => $1::int, hours => $2::int))::text as start,
            (public.fantasy_today() - $1::int)::text as day`,
    [daysAgo, hoursAgo],
  )
  await league.service('ingest_game', {
    p_game: {
      id, season: SEASON, game_type: type, game_date: day, start_time_utc: start,
      home_team: 'EDM', away_team: 'TOR', home_score: 3, away_score: 2, game_state: state, period: 2,
    },
    p_stats: lines.map((line) => ({
      player_id: line.player,
      nhl_team: nhlTeam(line.player),
      goals: line.goals ?? 0,
      assists: line.assists ?? 0,
      power_play_points: line.ppp ?? 0,
      shots: line.shots ?? 0,
      hits: line.hits ?? 0,
      blocked_shots: line.blocks ?? 0,
      decision: line.decision ?? null,
      saves: line.saves ?? 0,
      goals_against: line.against ?? 0,
      shutout: line.shutout ?? false,
      points: line.points,
      breakdown: {},
    })),
  })
  return id
}

beforeEach(async () => {
  league = await createLeague()
  await runDraft(league)
  await backdateRosters(league)
})

describe('team_daily_points', () => {
  it("adds up each team's points by day, with the commissioner's adjustments kept apart", async () => {
    await playGame([{ player: F(1), points: 5, goals: 1 }, { player: D(3), points: 2 }, { player: F(13), points: 9 }], { daysAgo: 2 })
    await playGame([{ player: F(2), points: 4, goals: 1 }], { daysAgo: 2 })
    await playGame([{ player: F(1), points: 1 }, { player: F(8), points: 3, goals: 1 }, { player: G(3), points: -1 }], { daysAgo: 1 })
    await playGame([{ player: F(1), points: 10, goals: 3 }], { daysAgo: 1, type: 1 }) // preseason
    await league.rpc(COMMISH, 'commish_adjust_points', { p_team_id: TEAMS.a, p_points: 2.5, p_reason: 'Scoring fix' })

    const rows = await league.queryAs<Record<string, unknown>>(
      OWNERS.c,
      `select t.name, public.fantasy_today() - d.day as days_ago, d.game_points::text, d.goals,
              d.adjustment_points::text
       from public.team_daily_points d join public.teams t on t.id = d.team_id
       order by t.name, d.day`,
    )
    expect(rows).toEqual([
      { name: 'Team A', days_ago: 2, game_points: '5.00', goals: 1, adjustment_points: '0.00' },
      { name: 'Team A', days_ago: 1, game_points: '4.00', goals: 1, adjustment_points: '0.00' },
      { name: 'Team A', days_ago: 0, game_points: '0.00', goals: 0, adjustment_points: '2.50' },
      { name: 'Team B', days_ago: 2, game_points: '6.00', goals: 1, adjustment_points: '0.00' },
      { name: 'Team B', days_ago: 1, game_points: '-1.00', goals: 0, adjustment_points: '0.00' },
    ])

    // Day by day, it ends where the standings are.
    const sums = await league.query<{ name: string; total: string }>(
      `select t.name, sum(d.game_points + d.adjustment_points)::numeric(10, 2)::text as total
       from public.team_daily_points d join public.teams t on t.id = d.team_id group by t.name order by t.name`,
    )
    const table = await standings(league)
    for (const { name, total } of sums) {
      expect(table.find((team) => team.name === name)?.total_points).toBe(total)
    }
  })
})

describe('tonight_lines', () => {
  type Tonight = {
    player_id: number
    on_roster: boolean
    game_id: number | null
    game_state: string | null
    has_stats: boolean
    goals: number
    shots: number
    points: string
    credited_team_id: string | null
  }

  const tonight = (teamId: string) =>
    league.queryAs<Tonight>(
      OWNERS.b,
      `select player_id::int as player_id, on_roster, game_id::int as game_id, game_state, has_stats, goals, shots,
              points::text, credited_team_id
       from public.tonight_lines where team_id = $1 order by player_id`,
      [teamId],
    )

  it("lists every active player with tonight's game, stats and points", async () => {
    // F9's NHL team has the night off. Goalies (BOS) play later tonight.
    await league.query(`update public.players set nhl_team = 'SEA' where id = $1`, [F(9)])
    await league.query(
      `insert into public.games (id, season, game_type, game_date, start_time_utc, home_team, away_team, game_state)
       values (2026039999, $1, 2, public.fantasy_today(), now() + interval '2 hours', 'BOS', 'MTL', 'FUT')`,
      [SEASON],
    )
    // Team A swaps F8 for F13 after tonight's first game has started.
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13), p_drop_player_id: F(8) })
    const live = await playGame(
      [
        { player: F(1), points: 3.6, goals: 1, shots: 2 },
        { player: F(8), points: 1, shots: 1 },
        { player: F(13), points: 2, shots: 2 },
      ],
      { state: 'LIVE' },
    )

    expect(await tonight(TEAMS.a)).toEqual([
      { player_id: F(1), on_roster: true, game_id: live, game_state: 'LIVE', has_stats: true, goals: 1, shots: 2, points: '3.60', credited_team_id: TEAMS.a },
      // Dropped after puck drop: his points still count for Team A, so he's listed.
      { player_id: F(8), on_roster: false, game_id: live, game_state: 'LIVE', has_stats: true, goals: 0, shots: 1, points: '1.00', credited_team_id: TEAMS.a },
      { player_id: F(9), on_roster: true, game_id: null, game_state: null, has_stats: false, goals: 0, shots: 0, points: '0.00', credited_team_id: null },
      // Joined after puck drop: listed, but his points go to nobody.
      { player_id: F(13), on_roster: true, game_id: live, game_state: 'LIVE', has_stats: true, goals: 0, shots: 2, points: '2.00', credited_team_id: null },
      { player_id: D(4), on_roster: true, game_id: live, game_state: 'LIVE', has_stats: false, goals: 0, shots: 0, points: '0.00', credited_team_id: null },
      { player_id: D(5), on_roster: true, game_id: live, game_state: 'LIVE', has_stats: false, goals: 0, shots: 0, points: '0.00', credited_team_id: null },
      { player_id: G(4), on_roster: true, game_id: 2026039999, game_state: 'FUT', has_stats: false, goals: 0, shots: 0, points: '0.00', credited_team_id: null },
    ])
    expect((await tonight(TEAMS.c)).map((line) => line.player_id)).toEqual([F(3), F(6), F(11), D(2), D(7), G(2)])

    // What counts for the team adds up to its points today.
    const counted = (await tonight(TEAMS.a))
      .filter((line) => line.credited_team_id === TEAMS.a)
      .reduce((sum, line) => sum + Number(line.points), 0)
    expect((await standings(league)).find((team) => team.name === 'Team A')?.today_points).toBe(counted.toFixed(2))
  })

  it('leaves out players on IR and games from other days', async () => {
    await playGame([{ player: F(1), points: 4 }], { daysAgo: 1 })
    await league.service('ingest_injuries', {
      p_rows: [{
        espn_athlete_id: 'e1', espn_name: 'Forward F1', espn_team: 'EDM', espn_position: 'LW',
        player_id: F(1), match_confidence: 'high', status: 'Out', description: 'Upper body',
      }],
    })
    await league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(1) })

    const lines = await tonight(TEAMS.a)
    expect(lines.map((line) => line.player_id)).toEqual([F(8), F(9), D(4), D(5), G(4)])
    expect(lines.every((line) => line.game_id === null)).toBe(true)
  })
})

describe('player_season_totals', () => {
  it("adds up a player's regular-season games", async () => {
    await playGame([
      { player: F(1), points: 7.2, goals: 1, assists: 1, ppp: 1, shots: 3, hits: 2, blocks: 1 },
      { player: G(1), points: 8, decision: 'W', saves: 30, against: 1 },
    ], { daysAgo: 3 })
    await playGame([
      { player: F(1), points: 4.3, assists: 2, shots: 1 },
      { player: G(1), points: 12, decision: 'W', saves: 25, shutout: true },
    ], { daysAgo: 1 })
    await playGame([{ player: F(1), points: 12, goals: 3 }], { daysAgo: 2, type: 1 }) // preseason

    const totals = await league.queryAs<Record<string, unknown>>(
      OWNERS.c,
      `select player_id::int as player_id, games_played, goals, assists, power_play_points, shorthanded_points, shots,
              hits, blocked_shots, wins, saves, goals_against, shutouts, fantasy_points::text
       from public.player_season_totals where season = $1 order by player_id`,
      [SEASON],
    )
    expect(totals).toEqual([
      {
        player_id: F(1), games_played: 2, goals: 1, assists: 3, power_play_points: 1, shorthanded_points: 0, shots: 4,
        hits: 2, blocked_shots: 1, wins: 0, saves: 0, goals_against: 0, shutouts: 0, fantasy_points: '11.50',
      },
      {
        player_id: G(1), games_played: 2, goals: 0, assists: 0, power_play_points: 0, shorthanded_points: 0, shots: 0,
        hits: 0, blocked_shots: 0, wins: 2, saves: 55, goals_against: 1, shutouts: 1, fantasy_points: '20.00',
      },
    ])
  })
})

describe('upcoming_games', () => {
  it("lists this season's regular-season games that haven't finished, with days to go", async () => {
    await league.query(
      `insert into public.games
         (id, season, game_type, game_date, start_time_utc, home_team, away_team, game_state, schedule_state)
       values
         (1, $1, 2, public.fantasy_today(), now() + interval '3 hours', 'EDM', 'TOR', 'FUT', 'OK'),
         (2, $1, 2, public.fantasy_today() + 2, now() + interval '2 days', 'EDM', 'BOS', 'FUT', 'OK'),
         (3, $1, 2, public.fantasy_today() - 1, now() - interval '1 day', 'EDM', 'TOR', 'OFF', 'OK'),
         (4, $1, 2, public.fantasy_today() + 1, now() + interval '1 day', 'TOR', 'BOS', 'FUT', 'PPD'),
         (5, $1, 1, public.fantasy_today() + 1, now() + interval '1 day', 'TOR', 'BOS', 'FUT', 'OK'),
         (6, $1 - 10001, 2, public.fantasy_today() + 1, now() + interval '1 day', 'TOR', 'BOS', 'FUT', 'OK'),
         (7, $1, 2, public.fantasy_today(), now() - interval '1 hour', 'BOS', 'MTL', 'LIVE', 'OK'),
         (8, $1, 2, public.fantasy_today() - 1, now() - interval '10 hours', 'SEA', 'VAN', 'LIVE', 'OK')`,
      [SEASON],
    )

    expect(
      await league.queryAs(OWNERS.d, `select id::int as id, days_away from public.upcoming_games order by start_time_utc`),
    ).toEqual([
      { id: 7, days_away: 0 },
      { id: 1, days_away: 0 },
      { id: 2, days_away: 2 },
    ])
  })
})
