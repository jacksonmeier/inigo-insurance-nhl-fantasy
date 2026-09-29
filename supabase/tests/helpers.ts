// Shared setup for the rule tests: an in-memory Postgres with the real
// migrations applied, a 4-team league, and a pool of players to draft.

import { PGlite, type Transaction } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

export const OWNERS = {
  a: '00000000-0000-0000-0000-00000000000a', // also the commissioner
  b: '00000000-0000-0000-0000-00000000000b',
  c: '00000000-0000-0000-0000-00000000000c',
  d: '00000000-0000-0000-0000-00000000000d',
} as const
export const STRANGER = '00000000-0000-0000-0000-0000000000ff'
export const COMMISH = OWNERS.a

export const TEAMS = {
  a: '10000000-0000-0000-0000-00000000000a',
  b: '10000000-0000-0000-0000-00000000000b',
  c: '10000000-0000-0000-0000-00000000000c',
  d: '10000000-0000-0000-0000-00000000000d',
} as const

export type TeamKey = keyof typeof TEAMS
export const TEAM_KEYS: TeamKey[] = ['a', 'b', 'c', 'd']

// Player ids encode position and rank: F 101..130, D 201..220, G 301..312.
// Lower id = more fantasy points last season, so "best available" is
// predictable: the lowest id of a position group the team still needs.
export const F = (n: number) => 100 + n
export const D = (n: number) => 200 + n
export const G = (n: number) => 300 + n

export const SEASON = 20262027

export type Args = Record<string, unknown>

export type League = {
  db: PGlite
  /** Call a function as a signed-in user (or signed out, with null). */
  rpc: <T = unknown>(uid: string | null, fn: string, args?: Args) => Promise<T>
  /** Call a function with the service role, as the sync function does. */
  service: <T = unknown>(fn: string, args?: Args) => Promise<T>
  /** The same, for a function that returns rows. The API returns those as an array. */
  serviceRows: <T = unknown>(fn: string, args?: Args) => Promise<T[]>
  /** Run a query as a signed-in user, so row-level security applies. */
  queryAs: <T>(uid: string | null, sql: string, params?: unknown[]) => Promise<T[]>
  /** Run a query as the database owner. */
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>
  roster: (team: TeamKey) => Promise<RosterRow[]>
}

export type RosterRow = { player_id: number; slot: string; is_ir_replacement: boolean; group: string }

class Json {
  readonly value: unknown

  constructor(value: unknown) {
    this.value = value
  }
}

/** Forces an argument to be sent as JSON. Only needed for an empty array. */
export const json = (value: unknown) => new Json(value)

// Arrays of ids become Postgres arrays; objects (and arrays of them) become JSON.
function toParam(value: unknown): unknown {
  if (value instanceof Json) return JSON.stringify(value.value)
  if (Array.isArray(value)) {
    const isJson = value.some((item) => item !== null && typeof item === 'object')
    return isJson ? JSON.stringify(value) : `{${value.join(',')}}`
  }
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return value
}

function callSql(fn: string, args: Args) {
  const names = Object.keys(args)
  const list = names.map((name, i) => `${name} => $${i + 1}`).join(', ')
  return { sql: `select public.${fn}(${list}) as result`, params: names.map((n) => toParam(args[n])) }
}

async function withRole<T>(db: PGlite, role: string, uid: string | null, fn: (tx: Transaction) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`)
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ''])
    return fn(tx)
  })
}

/** Applies the Supabase stand-ins and every migration to an empty database. */
export async function migrate(db: PGlite) {
  await db.exec(readFileSync(join(root, 'tests/supabase-stubs.sql'), 'utf8'))

  const migrationsDir = join(root, 'migrations')
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'))
  }
}

async function buildLeague(withPlayers: boolean) {
  const db = await PGlite.create({ extensions: { btree_gist } })
  await migrate(db)

  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNERS.a}', 'a@example.com'), ('${OWNERS.b}', 'b@example.com'),
      ('${OWNERS.c}', 'c@example.com'), ('${OWNERS.d}', 'd@example.com'),
      ('${STRANGER}', 'stranger@example.com');
    update public.league_settings set commissioner_id = '${COMMISH}';
    insert into public.teams (id, name, owner_id) values
      ('${TEAMS.a}', 'Team A', '${OWNERS.a}'), ('${TEAMS.b}', 'Team B', '${OWNERS.b}'),
      ('${TEAMS.c}', 'Team C', '${OWNERS.c}'), ('${TEAMS.d}', 'Team D', '${OWNERS.d}');
  `)

  if (withPlayers) {
    await db.exec(`
      insert into public.players (id, first_name, last_name, position, nhl_team)
      select 100 + n, 'Forward', 'F' || n, (array['C', 'L', 'R'])[1 + n % 3], 'EDM' from generate_series(1, 30) n
      union all
      select 200 + n, 'Defender', 'D' || n, 'D', 'TOR' from generate_series(1, 20) n
      union all
      select 300 + n, 'Goalie', 'G' || n, 'G', 'BOS' from generate_series(1, 12) n;

      insert into public.player_season_stats (player_id, season, games_played, fantasy_points)
      select id, ${SEASON - 10001}, 82, 1000 - id from public.players;
    `)
  }
  return db
}

// Running the migrations takes over a second; restoring a snapshot of the
// result takes a fraction of that. Build each starting point once per file.
const snapshots = new Map<boolean, Promise<File | Blob>>()

export async function createLeague(options: { players?: boolean } = {}): Promise<League> {
  const withPlayers = options.players !== false
  if (!snapshots.has(withPlayers)) {
    snapshots.set(
      withPlayers,
      buildLeague(withPlayers).then(async (template) => {
        const dump = await template.dumpDataDir('none')
        await template.close()
        return dump
      }),
    )
  }
  const db = await PGlite.create({ extensions: { btree_gist }, loadDataDir: await snapshots.get(withPlayers)! })

  const league: League = {
    db,
    async rpc<T>(uid: string | null, fn: string, args: Args = {}) {
      const { sql, params } = callSql(fn, args)
      return withRole(db, uid ? 'authenticated' : 'anon', uid, async (tx) => {
        const { rows } = await tx.query<{ result: T }>(sql, params)
        return rows[0]?.result as T
      })
    },
    async service<T>(fn: string, args: Args = {}) {
      const { sql, params } = callSql(fn, args)
      return withRole(db, 'service_role', null, async (tx) => {
        const { rows } = await tx.query<{ result: T }>(sql, params)
        return rows[0]?.result as T
      })
    },
    async serviceRows<T>(fn: string, args: Args = {}) {
      const { sql, params } = callSql(fn, args)
      const rowsSql = sql.replace(/^select (.*) as result$/, 'select * from $1')
      return withRole(db, 'service_role', null, async (tx) => (await tx.query<T>(rowsSql, params)).rows)
    },
    async queryAs<T>(uid: string | null, sql: string, params: unknown[] = []) {
      return withRole(db, uid ? 'authenticated' : 'anon', uid, async (tx) => (await tx.query<T>(sql, params)).rows)
    },
    async query<T>(sql: string, params: unknown[] = []) {
      return (await db.query<T>(sql, params)).rows
    },
    async roster(team: TeamKey) {
      return league.query<RosterRow>(
        `select r.player_id::int as player_id, r.slot, r.is_ir_replacement, p.position_group as "group"
         from public.roster_entries r join public.players p on p.id = r.player_id
         where r.team_id = $1 and r.end_at is null
         order by r.slot, r.player_id`,
        [TEAMS[team]],
      )
    },
  }
  return league
}

/** Which team owns pick n (1-based) of a snake draft in the given order. */
export function snakeTeam(order: TeamKey[], pick: number): TeamKey {
  const round = Math.floor((pick - 1) / order.length)
  const index = (pick - 1) % order.length
  return round % 2 === 0 ? order[index] : order[order.length - 1 - index]
}

/**
 * Hands out picks that are always legal, for the teams a test doesn't care
 * about: each team's first three picks are forwards, then two defenders, then
 * a goalie. Starts at F13, D11 and G7 to stay clear of the players tests name.
 */
export function fillerPicks() {
  const taken: Record<string, number> = {}
  const next = { F: 12, D: 10, G: 6 }
  return (team: TeamKey) => {
    const count = (taken[team] = (taken[team] ?? 0) + 1)
    if (count <= 3) return F(++next.F)
    if (count <= 5) return D(++next.D)
    return G(++next.G)
  }
}

// Round by round, everyone takes the same position: F, F, F, D, D, G.
const ROUND_POSITIONS = [F, F, F, D, D, G]

/**
 * Runs a whole draft in order a, b, c, d with no timer. The rosters come out as:
 *
 *   a: F1, F8, F9,  D4, D5, G4
 *   b: F2, F7, F10, D3, D6, G3
 *   c: F3, F6, F11, D2, D7, G2
 *   d: F4, F5, F12, D1, D8, G1
 *
 * Free agents: F13 and up, D9 and up, G5 and up.
 */
export async function runDraft(league: League) {
  const order: TeamKey[] = ['a', 'b', 'c', 'd']
  await league.rpc(COMMISH, 'draft_set_order', { p_order: order.map((k) => TEAMS[k]) })
  await league.rpc(COMMISH, 'draft_set_timer', { p_seconds: null })
  await league.rpc(COMMISH, 'draft_start')

  const next = new Map<(n: number) => number, number>()
  for (let pick = 1; pick <= 24; pick++) {
    const make = ROUND_POSITIONS[Math.floor((pick - 1) / 4)]
    const n = (next.get(make) ?? 0) + 1
    next.set(make, n)
    await league.rpc(OWNERS[snakeTeam(order, pick)], 'draft_pick', { p_player_id: make(n) })
  }
}

/** Moves every roster entry back in time, so games "now" happen after the draft. */
export async function backdateRosters(league: League, interval = '30 days') {
  await league.query(`update public.roster_entries set start_at = start_at - interval '${interval}' where true`)
}

export async function expectError(promise: Promise<unknown>, pattern: RegExp) {
  let message: string | null = null
  try {
    await promise
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  if (message === null) throw new Error(`Expected an error matching ${pattern}, but the call succeeded.`)
  if (!pattern.test(message)) throw new Error(`Expected an error matching ${pattern}, got: ${message}`)
}

let nextGameId = 2026020001

/**
 * Records a finished game with the given fantasy points, the way the sync
 * function would. `at` is puck drop, as a Postgres expression.
 */
export async function scoreGame(
  league: League,
  lines: { player: number; points: number; goals?: number }[],
  at = `now() - interval '1 hour'`,
) {
  const id = nextGameId++
  const [{ start, day }] = await league.query<{ start: string; day: string }>(
    `select (${at})::timestamptz::text as start, public.fantasy_today()::text as day`,
  )
  await league.service('ingest_game', {
    p_game: {
      id, season: SEASON, game_type: 2, game_date: day, start_time_utc: start,
      home_team: 'EDM', away_team: 'TOR', home_score: 3, away_score: 2, game_state: 'OFF', period: 3,
    },
    p_stats: lines.map((line) => ({
      player_id: line.player, nhl_team: 'EDM', goals: line.goals ?? 0,
      points: line.points, breakdown: { goals: line.points },
    })),
  })
  return id
}

export const standings = (league: League) =>
  league.query<{ name: string; total_points: string; total_goals: number; today_points: string; rank: number }>(
    `select name, total_points::text, total_goals, today_points::text, rank
     from public.team_standings order by rank, name`,
  )

export const alertsFor = (league: League, team: TeamKey) =>
  league.query<{ type: string; message: string }>(
    `select type, message from public.alerts where team_id = $1 order by id`,
    [TEAMS[team]],
  )

export const activity = (league: League, type?: string) =>
  league.query<{ type: string; summary: string }>(
    `select type, summary from public.transactions where $1::text is null or type = $1 order by id`,
    [type ?? null],
  )
