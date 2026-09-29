// The sync jobs end to end: canned NHL and ESPN responses in, database rows
// out. Nothing here touches the network.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { NHL_TEAMS } from '../functions/_shared/nhl.ts'
import { runJob, type Db } from '../functions/_shared/sync.ts'
import { COMMISH, createLeague, SEASON, standings, TEAMS, type League } from './helpers.ts'

const fixture = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'))

const GAME = 2025020500
const MILLER = 8476468
const SHESTERKIN = 8478048

// Players who had a season last year but aren't on any roster list now.
const INJURED = 8477503
const RETIRED = 8471685
const UNSIGNED = 8470000
const CUP_OF_COFFEE = 8480001

let league: League
let db: Db
let requests: string[]
let broken: RegExp | null
let offRoster: boolean

// Twenty players a team, numbered so ids never collide: 1 goalie in every ten.
const rosterFor = (team: string) => {
  const base = 9_000_000 + NHL_TEAMS.indexOf(team as (typeof NHL_TEAMS)[number]) * 100
  const player = (n: number, positionCode: string) => ({
    id: base + n, firstName: { default: `${team}` }, lastName: { default: `Player${n}` },
    sweaterNumber: n, positionCode, headshot: `https://assets.nhle.com/mugs/${base + n}.png`,
  })
  return {
    forwards: Array.from({ length: 12 }, (_, i) => player(i + 1, 'C')),
    defensemen: Array.from({ length: 6 }, (_, i) => player(i + 13, 'D')),
    goalies: Array.from({ length: 2 }, (_, i) => player(i + 19, 'G')),
  }
}

const week = (start: string, next: string | undefined, games: object[]) => ({
  regularSeasonStartDate: '2026-09-29', regularSeasonEndDate: '2026-10-12', nextStartDate: next,
  gameWeek: [{ date: start, games }],
})

const scheduled = (id: number, gameType: number, away: string, home: string) => ({
  id, season: SEASON, gameType, startTimeUTC: '2026-09-29T23:00:00Z', gameState: 'FUT', gameScheduleState: 'OK',
  awayTeam: { abbrev: away }, homeTeam: { abbrev: home },
})

function respond(url: string): unknown {
  if (url.endsWith('/standings/now')) {
    return { standings: NHL_TEAMS.map((abbrev) => ({ teamAbbrev: { default: abbrev } })) }
  }
  const roster = url.match(/\/roster\/(\w+)\/current$/)
  if (roster) return rosterFor(roster[1])

  if (url.includes('/skater/summary')) {
    const season = (playerId: number, gamesPlayed: number) => ({
      playerId, gamesPlayed, goals: 0, assists: 0, ppPoints: 0, shPoints: 0, shots: 0,
    })
    return {
      data: [
        { playerId: 9_000_001, gamesPlayed: 82, goals: 48, assists: 90, ppPoints: 54, shPoints: 2, shots: 306 },
        ...(offRoster ? [season(INJURED, 80), season(RETIRED, 67), season(UNSIGNED, 40), season(CUP_OF_COFFEE, 3)] : []),
      ],
    }
  }
  if (url.includes('/skater/realtime')) return { data: [{ playerId: 9_000_001, hits: 39, blockedShots: 27 }] }
  if (url.includes('/goalie/summary')) {
    return { data: [{ playerId: 9_000_019, gamesPlayed: 58, wins: 39, saves: 1353, goalsAgainst: 132, shutouts: 2 }] }
  }

  if (url.endsWith('/schedule/now')) return week('2026-09-26', '2026-10-03', [])
  if (url.endsWith('/schedule/2026-09-29')) {
    return week('2026-09-29', '2026-10-06', [
      scheduled(2026020001, 2, 'FLA', 'CAR'),
      scheduled(2026010099, 1, 'NYR', 'BOS'), // preseason: ignored
    ])
  }
  if (url.endsWith('/schedule/2026-10-06')) return week('2026-10-06', '2026-10-13', [scheduled(2026020050, 2, 'EDM', 'CGY')])

  if (url.endsWith(`/gamecenter/${GAME}/boxscore`)) return fixture('boxscore-2025020500.json')
  if (url.endsWith(`/gamecenter/${GAME}/landing`)) return fixture('landing-2025020500.json')

  const profile = url.match(/\/player\/(\d+)\/landing$/)
  if (profile) {
    const id = Number(profile[1])
    const person = (first: string, last: string, extra: object) => ({
      playerId: id, firstName: { default: first }, lastName: { default: last }, position: 'C', ...extra,
    })
    if (id === INJURED) return person('Max', 'Domi', { isActive: true, currentTeamAbbrev: 'TOR', sweaterNumber: 11 })
    if (id === RETIRED) return person('Anze', 'Kopitar', { isActive: false })
    if (id === UNSIGNED) return person('Free', 'Agent', { isActive: true })
    if (id === MILLER) {
      return { playerId: id, firstName: { default: 'J.T.' }, lastName: { default: 'Miller' }, position: 'C', currentTeamAbbrev: 'NYR', sweaterNumber: 8 }
    }
    if (id === SHESTERKIN) {
      return { playerId: id, firstName: { default: 'Igor' }, lastName: { default: 'Shesterkin' }, position: 'G', currentTeamAbbrev: 'NYR' }
    }
    return null // profile unavailable: fall back to the boxscore
  }

  if (url.includes('espn.com')) return fixture('espn-injuries.json')
  return null
}

const fakeFetch = (async (input: Parameters<typeof fetch>[0]) => {
  const url = String(input)
  requests.push(url)
  if (broken?.test(url)) return new Response('upstream error', { status: 503 })
  const body = respond(url)
  return body === null ? new Response('not found', { status: 404 }) : Response.json(body)
}) as typeof fetch

const http = { fetch: fakeFetch, retries: 0 }

const syncStatus = () =>
  league.query<{ job: string; status: string; message: string }>(
    `select job, status, message from public.sync_status order by job`,
  )

beforeEach(async () => {
  league = await createLeague({ players: false })
  requests = []
  broken = null
  offRoster = false
  // Stands in for a Supabase client holding the service role key.
  const returnsRows = ['games_to_poll', 'games_to_finalize']
  db = {
    rpc: async (fn, args = {}) => {
      try {
        const data = returnsRows.includes(fn) ? await league.serviceRows(fn, args) : await league.service(fn, args)
        return { data, error: null }
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }
      }
    },
  }
})

describe('players', () => {
  it('imports every roster and last season\'s totals', async () => {
    const [result] = await runJob(db, 'players', { http })

    expect(result).toMatchObject({ ok: true, message: '640 players on 32 rosters.' })
    const [{ count }] = await league.query<{ count: number }>(`select count(*)::int as count from public.players where is_active`)
    expect(count).toBe(640)

    const stats = await league.query(
      `select player_id::int as player_id, season, fantasy_points::text, hits, wins
       from public.player_season_stats order by player_id`,
    )
    expect(stats).toEqual([
      // 48x3 + 90x2 + 54 + 2 + 306x0.3 + 39x0.2 + 27x0.3 = 487.7
      { player_id: 9_000_001, season: SEASON - 10001, fantasy_points: '487.70', hits: 39, wins: 0 },
      // 39x4 + 1353x0.2 - 132 + 2x3 = 300.6
      { player_id: 9_000_019, season: SEASON - 10001, fantasy_points: '300.60', hits: 0, wins: 39 },
    ])
  })

  it('marks players who left the NHL as inactive, but only when every roster loaded', async () => {
    await league.query(
      `insert into public.players (id, first_name, last_name, position, nhl_team) values (42, 'Sent', 'Down', 'C', 'EDM')`,
    )

    broken = /roster\/TOR/
    const [partial] = await runJob(db, 'players', { http })
    expect(partial.message).toBe("620 players on 31 rosters. Couldn't load TOR.")
    expect(await league.query(`select is_active, nhl_team from public.players where id = 42`)).toEqual([
      { is_active: true, nhl_team: 'EDM' },
    ])

    broken = null
    await runJob(db, 'players', { http })
    expect(await league.query(`select is_active, nhl_team from public.players where id = 42`)).toEqual([
      { is_active: false, nhl_team: null },
    ])
  })

  it('adds injured players, who the NHL leaves off its roster lists', async () => {
    offRoster = true
    const [result] = await runJob(db, 'players', { http })

    expect(result.message).toBe('640 players on 32 rosters, plus 1 injured or otherwise off the roster.')
    expect(
      await league.query(`select full_name, nhl_team, is_active from public.players where id < 9000000 order by id`),
    ).toEqual([{ full_name: 'Max Domi', nhl_team: 'TOR', is_active: true }])

    // The retired player and the one without a team were looked up and left
    // out. The one who barely played wasn't looked up at all.
    const lookedUp = requests.filter((url) => url.includes('/player/')).map((url) => Number(url.match(/player\/(\d+)/)![1]))
    expect(lookedUp.sort()).toEqual([UNSIGNED, RETIRED, INJURED].sort())

    // Next time he's still there, even though he's still not on a roster list.
    await runJob(db, 'players', { http })
    expect(await league.query(`select is_active from public.players where id = ${INJURED}`)).toEqual([{ is_active: true }])
  })

  it('does not write anyone off while a lookup is failing', async () => {
    offRoster = true
    await runJob(db, 'players', { http })

    broken = /player\/\d+\/landing/
    const [result] = await runJob(db, 'players', { http })
    expect(result.message).toBe('640 players on 32 rosters. 3 player lookups failed.')
    expect(await league.query(`select is_active from public.players where id = ${INJURED}`)).toEqual([{ is_active: true }])
  })

  it('keeps the rosters even if the stats API is down', async () => {
    broken = /stats\/rest/
    const [result] = await runJob(db, 'players', { http })
    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/^640 players on 32 rosters. Last season's stats failed: 503/)
  })
})

describe('schedule', () => {
  it('imports the regular season and skips everything else', async () => {
    const [result] = await runJob(db, 'schedule', { http })

    expect(result).toMatchObject({ ok: true, message: '2 games on the schedule, 2 changed.' })
    const games = await league.query(`select id::int as id, game_date::text, home_team, game_state from public.games order by id`)
    expect(games).toEqual([
      { id: 2026020001, game_date: '2026-09-29', home_team: 'CAR', game_state: 'FUT' },
      { id: 2026020050, game_date: '2026-10-06', home_team: 'CGY', game_state: 'FUT' },
    ])

    const [again] = await runJob(db, 'schedule', { http })
    expect(again.message).toBe('2 games on the schedule, 0 changed.')
  })
})

describe('a game', () => {
  beforeEach(async () => {
    // The fixture game is from 2025-26, so make that the league's season.
    await league.query(`update public.league_settings set season = 20252026 where true`)
  })

  it('is imported with its points, adding players the database has not seen', async () => {
    const [result] = await runJob(db, 'game', { gameId: GAME, http })

    expect(result).toMatchObject({ ok: true, message: 'Game 2025020500 imported (OFF).' })
    expect(result.details).toMatchObject({ players: 38, points_changed: 38, unknown_players: [] })

    const lines = await league.query(
      `select p.full_name, p.position, s.goals, s.power_play_points, pt.points::text, pt.team_id
       from public.player_game_points pt
       join public.player_game_stats s using (game_id, player_id)
       join public.players p on p.id = pt.player_id
       where pt.player_id in (${MILLER}, ${SHESTERKIN}, 8478550) order by pt.points desc`,
    )
    expect(lines).toEqual([
      { full_name: 'J.T. Miller', position: 'C', goals: 2, power_play_points: 1, points: '8.50', team_id: null },
      // His profile couldn't be loaded, so the name is the boxscore's.
      { full_name: 'A. Panarin', position: 'L', goals: 1, power_play_points: 0, points: '5.90', team_id: null },
      { full_name: 'Igor Shesterkin', position: 'G', goals: 0, power_play_points: 0, points: '2.80', team_id: null },
    ])
  })

  it('credits the fantasy team that had the player', async () => {
    await runJob(db, 'game', { gameId: GAME, http })
    await league.query(
      `insert into public.roster_entries (team_id, player_id, slot, reason, start_at)
       values ('${TEAMS.a}', ${MILLER}, 'active', 'draft', '2025-10-01')`,
    )

    const [result] = await runJob(db, 'game', { gameId: GAME, http })
    expect(result.details).toMatchObject({ points_changed: 1, stats_changed: 0 })
    expect((await standings(league)).find((t) => t.name === 'Team A')).toMatchObject({
      total_points: '8.50', total_goals: 2,
    })
  })

  it('is left alone if either half of the data is missing', async () => {
    broken = /landing/
    const [result] = await runJob(db, 'game', { gameId: GAME, http })
    expect(result.ok).toBe(false)
    expect(await league.query(`select 1 from public.player_game_points`)).toEqual([])
  })
})

describe('live scoring', () => {
  it('asks the NHL nothing when no game is on', async () => {
    const [result] = await runJob(db, 'live', { http })
    expect(result).toMatchObject({ ok: true, message: 'No games in progress.' })
    expect(requests).toEqual([])
  })

  it('imports the games that are under way', async () => {
    await league.query(`update public.league_settings set season = 20252026 where true`)
    await league.query(`
      insert into public.games (id, season, game_type, game_date, start_time_utc, home_team, away_team, game_state)
      values (${GAME}, 20252026, 2, current_date, now() - interval '1 hour', 'NYR', 'MTL', 'LIVE'),
             (2025020501, 20252026, 2, current_date, now() + interval '3 hours', 'EDM', 'CGY', 'FUT'),
             (2025020499, 20252026, 2, current_date - 1, now() - interval '20 hours', 'TOR', 'OTT', 'OFF')`)

    const [result] = await runJob(db, 'live', { http })
    expect(result).toMatchObject({ ok: true, message: '1 game checked, 38 scores updated.' })
    expect(requests.filter((url) => url.includes('/gamecenter/')).sort()).toEqual([
      `https://api-web.nhle.com/v1/gamecenter/${GAME}/boxscore`,
      `https://api-web.nhle.com/v1/gamecenter/${GAME}/landing`,
    ])
    // The boxscore says the game is over, so the next run has nothing to do.
    expect((await runJob(db, 'live', { http }))[0].message).toBe('No games in progress.')
  })
})

describe('injuries', () => {
  beforeEach(async () => {
    await league.query(`
      insert into public.players (id, first_name, last_name, position, nhl_team) values
        (1, 'Jonathan', 'Huberdeau', 'L', 'CGY'), (2, 'Charlie', 'McAvoy', 'D', 'BOS'),
        (3, 'Ukko-Pekka', 'Luukkonen', 'G', 'BUF'), (4, 'Alex', 'Barré-Boulet', 'C', 'SJS'),
        (5, 'Dom', 'James', 'C', 'TBL')`)
  })

  it('are matched to NHL players and marked IR-eligible or not', async () => {
    const [result] = await runJob(db, 'injuries', { http })

    expect(result.ok).toBe(true)
    expect(result.message).toBe('8 injuries listed. 4 players need matching by the commissioner.')

    const rows = await league.query(
      `select m.espn_name, i.player_id::int as player_id, m.match_confidence, i.status, i.is_ir_eligible
       from public.player_injuries i join public.espn_player_map m using (espn_athlete_id)
       order by m.espn_name`,
    )
    expect(rows).toEqual([
      { espn_name: 'Alex Barre-Boulet', player_id: 4, match_confidence: 'high', status: 'Out', is_ir_eligible: true },
      { espn_name: 'Charlie McAvoy', player_id: 2, match_confidence: 'high', status: 'Suspension', is_ir_eligible: false },
      { espn_name: 'Dominic James', player_id: 5, match_confidence: 'low', status: 'Out', is_ir_eligible: true },
      { espn_name: 'Joel Edmundson', player_id: null, match_confidence: 'unmatched', status: 'Day-To-Day', is_ir_eligible: false },
      { espn_name: 'Jonathan Huberdeau', player_id: 1, match_confidence: 'high', status: 'Injured Reserve', is_ir_eligible: true },
      { espn_name: 'Pavel Mintyukov', player_id: null, match_confidence: 'unmatched', status: 'Out', is_ir_eligible: true },
      { espn_name: 'Seamus Casey', player_id: null, match_confidence: 'unmatched', status: 'Out', is_ir_eligible: true },
      { espn_name: 'Ukko-Pekka Luukkonen', player_id: 3, match_confidence: 'high', status: 'Day-To-Day', is_ir_eligible: false },
    ])
  })

  it('leave the current list alone when ESPN is down', async () => {
    await runJob(db, 'injuries', { http })
    broken = /espn/
    const [result] = await runJob(db, 'injuries', { http })

    expect(result.ok).toBe(false)
    expect(await league.query(`select 1 from public.player_injuries`)).toHaveLength(8)
  })
})

describe('every run', () => {
  it('is recorded, so the commissioner can see data is fresh', async () => {
    await runJob(db, 'schedule', { http })
    broken = /espn/
    await runJob(db, 'injuries', { http })

    expect(await syncStatus()).toEqual([
      { job: 'injuries', status: 'error', message: expect.stringMatching(/^503 from https:\/\/site.api.espn.com/) },
      { job: 'schedule', status: 'ok', message: '2 games on the schedule, 2 changed.' },
    ])
    expect(await league.queryAs(COMMISH, `select 1 from public.sync_status`)).toHaveLength(2)
  })

  it('setup runs players, schedule and injuries in order', async () => {
    const results = await runJob(db, 'setup', { http })
    expect(results.map((r) => [r.job, r.ok])).toEqual([['players', true], ['schedule', true], ['injuries', true]])
  })

  it('pushes the league config to the database', async () => {
    await league.query(`update public.league_settings set config = '{}' where true`)
    await runJob(db, 'live', { http })
    const [{ rounds }] = await league.query<{ rounds: string }>(
      `select config -> 'draft' ->> 'rounds' as rounds from public.league_settings`,
    )
    expect(rounds).toBe('6')
  })
})
