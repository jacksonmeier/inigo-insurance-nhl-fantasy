// The sync jobs: fetch from the NHL and ESPN, then hand the results to the
// database's ingest functions. Used by the "sync" Edge Function (on a
// schedule) and by scripts/sync.ts (from a terminal), so nothing in here may
// depend on Deno or Node.

import { buildGame } from './boxscore.ts'
import { getInjuries } from './espn.ts'
import { mapLimit, type FetchOptions } from './http.ts'
import { LEAGUE, type NhlPosition } from './league.config.ts'
import { matchPlayer, type NhlPlayerRef } from './matching.ts'
import * as nhl from './nhl.ts'
import { SCORING } from './scoring.config.ts'
import { scoreGoalie, scoreSkater } from './scoring.ts'

// The one thing the jobs need from a Supabase client (service role).
export interface Db {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

export const JOBS = ['players', 'schedule', 'live', 'finals', 'injuries', 'game', 'setup'] as const
export type JobName = (typeof JOBS)[number]

export type JobResult = {
  job: JobName
  ok: boolean
  message: string
  details: Record<string, unknown>
}

export type JobParams = { gameId?: number; http?: FetchOptions }

type Outcome = { message: string; details: Record<string, unknown> }

type SyncContext = {
  season: number
  previous_season: number
  scoring_game_types: number[]
  players: NhlPlayerRef[]
}

type PlayerRow = {
  id: number
  first_name: string
  last_name: string
  position: NhlPosition
  nhl_team: string | null
  sweater_number: number | null
  headshot_url: string | null
}

async function call<T>(db: Db, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data as T
}

const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`

// ---------------------------------------------------------------------------
// Players: every NHL roster, plus last season's totals for ranking
// ---------------------------------------------------------------------------

async function seasonStatRows(season: number, gameType: number, http?: FetchOptions) {
  const [skaters, realtime, goalies] = await Promise.all([
    nhl.getSkaterSeasons(season, gameType, http),
    nhl.getSkaterRealtimeSeasons(season, gameType, http),
    nhl.getGoalieSeasons(season, gameType, http),
  ])
  const physical = new Map(realtime.map((row) => [row.playerId, row]))

  const skaterRows = skaters.map((row) => {
    const line = {
      goals: row.goals ?? 0,
      assists: row.assists ?? 0,
      powerPlayPoints: row.ppPoints ?? 0,
      shorthandedPoints: row.shPoints ?? 0,
      shots: row.shots ?? 0,
      hits: physical.get(row.playerId)?.hits ?? 0,
      blockedShots: physical.get(row.playerId)?.blockedShots ?? 0,
    }
    return {
      player_id: row.playerId,
      season,
      games_played: row.gamesPlayed ?? 0,
      goals: line.goals,
      assists: line.assists,
      power_play_points: line.powerPlayPoints,
      shorthanded_points: line.shorthandedPoints,
      shots: line.shots,
      hits: line.hits,
      blocked_shots: line.blockedShots,
      fantasy_points: scoreSkater(line, SCORING).points,
    }
  })

  const goalieRows = goalies.map((row) => {
    const line = {
      wins: row.wins ?? 0,
      saves: row.saves ?? 0,
      goalsAgainst: row.goalsAgainst ?? 0,
      shutouts: row.shutouts ?? 0,
    }
    return {
      player_id: row.playerId,
      season,
      games_played: row.gamesPlayed ?? 0,
      wins: line.wins,
      saves: line.saves,
      goals_against: line.goalsAgainst,
      shutouts: line.shutouts,
      fantasy_points: scoreGoalie(line, SCORING).points,
    }
  })

  return [...skaterRows, ...goalieRows]
}

const playerRow = (profile: nhl.NhlPlayerLanding, fallbackTeam: string | null = null): PlayerRow => ({
  id: profile.playerId,
  first_name: profile.firstName.default,
  last_name: profile.lastName.default,
  position: profile.position,
  nhl_team: profile.currentTeamAbbrev ?? fallbackTeam,
  sweater_number: profile.sweaterNumber ?? null,
  headshot_url: profile.headshot ?? null,
})

// A player needs this many games last season to be looked up when he's
// missing from the roster lists. Keeps the lookups to the regulars.
const MIN_GAMES_TO_LOOK_UP = 10

async function syncPlayers(db: Db, params: JobParams): Promise<Outcome> {
  const context = await call<SyncContext>(db, 'sync_context')
  const teams = await nhl.getTeamAbbrevs(params.http)
  const failed: string[] = []

  const rosters = await mapLimit(teams, 6, async (team) => {
    try {
      const roster = await nhl.getRoster(team, params.http)
      // A real roster never has this few players. Treat it as a bad response.
      if (roster.length < 15) throw new Error('roster too short')
      return roster.map(
        (player): PlayerRow => ({
          id: player.id,
          first_name: player.firstName.default,
          last_name: player.lastName.default,
          position: player.positionCode,
          nhl_team: team,
          sweater_number: player.sweaterNumber ?? null,
          headshot_url: player.headshot ?? null,
        }),
      )
    } catch {
      failed.push(team)
      return []
    }
  })

  const onRosters = new Map(rosters.flat().map((player) => [player.id, player]))
  if (onRosters.size === 0) throw new Error('The NHL returned no rosters.')

  let stats: Awaited<ReturnType<typeof seasonStatRows>> = []
  let statsError: string | null = null
  try {
    stats = await seasonStatRows(context.previous_season, context.scoring_game_types[0] ?? 2, params.http)
  } catch (error) {
    statsError = error instanceof Error ? error.message : String(error)
  }

  // The NHL leaves injured players off its roster lists, and those are exactly
  // the players an owner might want to draft and stash on IR. So look up last
  // season's regulars who are missing and keep the ones still with a team.
  const missing = stats.filter(
    (row) => row.games_played >= MIN_GAMES_TO_LOOK_UP && !onRosters.has(row.player_id),
  )
  let lookupsFailed = 0
  const offRoster = (
    await mapLimit(missing, 3, async (row): Promise<PlayerRow | null> => {
      try {
        const profile = await nhl.getPlayer(row.player_id, params.http)
        const withTeam = profile.isActive !== false && Boolean(profile.currentTeamAbbrev)
        return withTeam ? playerRow(profile) : null
      } catch {
        lookupsFailed++
        return null
      }
    })
  ).filter((player): player is PlayerRow => player !== null)

  const players = [...onRosters.values(), ...offRoster]

  // Only when everything arrived is a missing player really out of the NHL.
  const complete = failed.length === 0 && teams.length >= 30 && statsError === null && lookupsFailed === 0
  const imported = await call<{ changed: number; deactivated: number }>(db, 'ingest_players', {
    p_players: players,
    p_full: complete,
  })

  let statsChanged = 0
  if (stats.length > 0) {
    try {
      statsChanged = await call<number>(db, 'ingest_season_stats', { p_rows: stats })
    } catch (error) {
      statsError = error instanceof Error ? error.message : String(error)
    }
  }

  const problems = [
    failed.length > 0 && `Couldn't load ${failed.join(', ')}.`,
    statsError && `Last season's stats failed: ${statsError}`,
    lookupsFailed > 0 && `${plural(lookupsFailed, 'player lookup')} failed.`,
  ].filter(Boolean)

  return {
    message: [
      `${plural(onRosters.size, 'player')} on ${plural(teams.length - failed.length, 'roster')}`
        + (offRoster.length > 0 ? `, plus ${offRoster.length} injured or otherwise off the roster.` : '.'),
      ...problems,
    ].join(' '),
    details: {
      players: players.length,
      off_roster: offRoster.length,
      ...imported,
      stats_changed: statsChanged,
      failed_teams: failed,
      lookups_failed: lookupsFailed,
      stats_error: statsError,
    },
  }
}

// ---------------------------------------------------------------------------
// Schedule: the whole regular season, a week at a time
// ---------------------------------------------------------------------------

async function syncSchedule(db: Db, params: JobParams): Promise<Outcome> {
  const context = await call<SyncContext>(db, 'sync_context')
  const current = await nhl.getScheduleWeek('now', params.http)
  const end = current.regularSeasonEndDate
  const games = []

  let date: string | undefined = current.regularSeasonStartDate
  // A season is about 28 weeks. The cap is only there to stop a runaway loop.
  for (let week = 0; week < 40 && date && date <= end; week++) {
    const schedule: nhl.NhlScheduleWeek = await nhl.getScheduleWeek(date, params.http)
    for (const day of schedule.gameWeek) {
      for (const game of day.games) {
        if (!context.scoring_game_types.includes(game.gameType)) continue
        games.push({
          id: game.id,
          season: game.season,
          game_type: game.gameType,
          game_date: day.date,
          start_time_utc: game.startTimeUTC,
          home_team: game.homeTeam.abbrev,
          away_team: game.awayTeam.abbrev,
          home_score: game.homeTeam.score ?? null,
          away_score: game.awayTeam.score ?? null,
          game_state: game.gameState,
          schedule_state: game.gameScheduleState,
          period: game.periodDescriptor?.number ?? null,
        })
      }
    }
    date = schedule.nextStartDate
  }

  if (games.length === 0) throw new Error('The NHL returned no games.')
  const changed = await call<number>(db, 'ingest_schedule', { p_games: games })

  return {
    message: `${plural(games.length, 'game')} on the schedule, ${changed} changed.`,
    details: { games: games.length, changed },
  }
}

// ---------------------------------------------------------------------------
// Games: boxscores, fantasy points, and who they're credited to
// ---------------------------------------------------------------------------

type IngestResult = {
  game_id: number
  stats_changed: number
  points_changed: number
  removed: number
  unknown_players: number[]
}

// "C. McDavid" -> ["C.", "McDavid"]. Only used if a player's profile can't be loaded.
function splitBoxscoreName(name: string): [string, string] {
  const [first, ...rest] = name.split(' ')
  return rest.length > 0 ? [first, rest.join(' ')] : ['', first]
}

export async function syncGame(db: Db, gameId: number, http?: FetchOptions) {
  // Both or neither: without the scoring summary, power play points would
  // read as zero and totals would dip until the next run.
  const [boxscore, landing] = await Promise.all([nhl.getBoxscore(gameId, http), nhl.getLanding(gameId, http)])
  const { game, players } = buildGame(boxscore, landing, SCORING)

  let result = await call<IngestResult>(db, 'ingest_game', { p_game: game, p_stats: players })

  if (result.unknown_players.length > 0) {
    const newcomers = await mapLimit(result.unknown_players, 4, async (playerId): Promise<PlayerRow | null> => {
      const line = players.find((player) => player.player_id === playerId)
      try {
        const profile = await nhl.getPlayer(playerId, http)
        return { ...playerRow(profile, line?.nhl_team ?? null), id: playerId }
      } catch {
        if (!line) return null
        const [first, last] = splitBoxscoreName(line.name)
        return {
          id: playerId,
          first_name: first,
          last_name: last,
          position: line.position,
          nhl_team: line.nhl_team,
          sweater_number: null,
          headshot_url: null,
        }
      }
    })

    await call(db, 'ingest_players', { p_players: newcomers.filter(Boolean), p_full: false })
    result = await call<IngestResult>(db, 'ingest_game', { p_game: game, p_stats: players })
  }

  return { ...result, state: game.game_state, players: players.length }
}

async function syncGames(db: Db, games: { id: number }[], http?: FetchOptions) {
  const failed: { id: number; error: string }[] = []
  let pointsChanged = 0

  await mapLimit(games, 8, async (game) => {
    try {
      pointsChanged += (await syncGame(db, game.id, http)).points_changed
    } catch (error) {
      failed.push({ id: game.id, error: error instanceof Error ? error.message : String(error) })
    }
  })

  return { failed, pointsChanged }
}

async function syncLive(db: Db, params: JobParams): Promise<Outcome> {
  const games = await call<{ id: number }[]>(db, 'games_to_poll')
  if (games.length === 0) return { message: 'No games in progress.', details: { games: 0 } }

  const { failed, pointsChanged } = await syncGames(db, games, params.http)
  if (failed.length === games.length) throw new Error(`Every game failed. First: ${failed[0].error}`)

  return {
    message: `${plural(games.length, 'game')} checked, ${plural(pointsChanged, 'score')} updated.`
      + (failed.length > 0 ? ` ${failed.length} failed.` : ''),
    details: { games: games.length, points_changed: pointsChanged, failed },
  }
}

async function syncFinals(db: Db, params: JobParams): Promise<Outcome> {
  const games = await call<{ id: number }[]>(db, 'games_to_finalize', { p_days: 2 })
  const { failed, pointsChanged } = await syncGames(db, games, params.http)

  const since = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
  const moved = await call<number>(db, 'reattribute_points', { p_since: since })

  if (games.length > 0 && failed.length === games.length) {
    throw new Error(`Every game failed. First: ${failed[0].error}`)
  }
  return {
    message: `${plural(games.length, 'game')} re-checked, ${plural(pointsChanged, 'score')} corrected.`
      + (failed.length > 0 ? ` ${failed.length} failed.` : ''),
    details: { games: games.length, points_changed: pointsChanged, reattributed: moved, failed },
  }
}

// ---------------------------------------------------------------------------
// Injuries
// ---------------------------------------------------------------------------

async function syncInjuries(db: Db, params: JobParams): Promise<Outcome> {
  const injuries = await getInjuries(params.http)
  // The database refuses an empty list too. See ingest_injuries.
  if (injuries.length === 0) throw new Error('ESPN returned no injuries. Leaving the current list alone.')

  const { players } = await call<SyncContext>(db, 'sync_context')
  if (players.length === 0) throw new Error('Import NHL players before injuries.')

  const rows = injuries.map((injury) => {
    const match = matchPlayer(injury, players)
    return {
      espn_athlete_id: injury.espnAthleteId,
      espn_name: injury.name,
      espn_team: injury.team,
      espn_position: injury.position,
      player_id: match.playerId,
      match_confidence: match.confidence,
      status: injury.status,
      description: injury.description,
      espn_updated_at: injury.updatedAt,
    }
  })

  const result = await call<Record<string, number>>(db, 'ingest_injuries', { p_rows: rows })
  const flagged = (result.unmatched ?? 0) + (result.low_confidence ?? 0)

  return {
    message: `${plural(rows.length, 'injury', 'injuries')} listed.`
      + (flagged > 0 ? ` ${plural(flagged, 'player')} need${flagged === 1 ? 's' : ''} matching by the commissioner.` : ''),
    details: result,
  }
}

// ---------------------------------------------------------------------------
// Running a job
// ---------------------------------------------------------------------------

const RUNNERS: Record<Exclude<JobName, 'setup' | 'game'>, (db: Db, params: JobParams) => Promise<Outcome>> = {
  players: syncPlayers,
  schedule: syncSchedule,
  live: syncLive,
  finals: syncFinals,
  injuries: syncInjuries,
}

async function runOne(db: Db, job: Exclude<JobName, 'setup'>, params: JobParams): Promise<JobResult> {
  try {
    let outcome: Outcome
    if (job === 'game') {
      if (!params.gameId) throw new Error('Which game? Pass its NHL game id.')
      const result = await syncGame(db, params.gameId, params.http)
      outcome = { message: `Game ${params.gameId} imported (${result.state}).`, details: result }
    } else {
      outcome = await RUNNERS[job](db, params)
    }
    await call(db, 'record_sync', { p_job: job, p_status: 'ok', p_message: outcome.message, p_details: outcome.details })
    return { job, ok: true, ...outcome }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Best effort: if the database is what's broken, this fails too.
    await db.rpc('record_sync', { p_job: job, p_status: 'error', p_message: message, p_details: {} })
    return { job, ok: false, message, details: {} }
  }
}

/**
 * Runs one job and records how it went. Never throws: a failure comes back as
 * ok = false. "setup" runs everything a new league needs, in order.
 */
export async function runJob(db: Db, job: JobName, params: JobParams = {}): Promise<JobResult[]> {
  // Keep the database's copy of the league rules in step with the config file.
  await call(db, 'push_config', { p_config: LEAGUE })

  if (job !== 'setup') return [await runOne(db, job, params)]

  const results: JobResult[] = []
  for (const step of ['players', 'schedule', 'injuries'] as const) {
    results.push(await runOne(db, step, params))
  }
  return results
}
