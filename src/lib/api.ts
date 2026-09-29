// Every read the app makes. Writes go through call() in supabase.ts, which
// runs the database's rule functions.

import { friendlyMessage, supabase } from './supabase.ts'
import type {
  Activity, Alert, Availability, Draft, DraftPick, EspnIssue, Game, GameLogRow, IrStint, PoolPlayer,
  PositionGroup, RosterPlayer, SeasonTotals, Standing, SyncStatus, Team, TeamDay, TonightLine, Trade,
  TransactionType, UpcomingGame, Waiver, WaiverClaim, WeekScorer,
} from './types.ts'

type Result = { data: unknown; error: { message: string } | null }

// The views are typed by hand in types.ts (see the note there), so results are
// cast once, here.
async function rows<T>(query: PromiseLike<Result>): Promise<T[]> {
  const { data, error } = await query
  if (error) throw new Error(friendlyMessage(error.message))
  return (data ?? []) as T[]
}

async function row<T>(query: PromiseLike<Result>): Promise<T | null> {
  const { data, error } = await query
  if (error) throw new Error(friendlyMessage(error.message))
  return (data ?? null) as T | null
}

// --- League ------------------------------------------------------------------

export const fetchTeams = () => rows<Team>(supabase.from('teams').select('id, name, owner_id').order('name'))

export const fetchStandings = () =>
  rows<Standing>(supabase.from('team_standings').select('*').order('rank').order('name'))

export const fetchWeekScorers = (limit = 3) =>
  rows<WeekScorer>(supabase.from('week_scorers').select('*').order('points', { ascending: false }).limit(limit))

export const fetchTodaysGames = () =>
  rows<Game>(supabase.from('todays_games').select('*').order('start_time_utc').order('id'))

/** Every team's points by day this season: about 4 rows a day, so a whole season fits in one request. */
export const fetchTeamDays = () =>
  rows<TeamDay>(supabase.from('team_daily_points').select('*').order('day').order('team_id'))

export const fetchTonight = () => rows<TonightLine>(supabase.from('tonight_lines').select('*'))

// --- Schedule ------------------------------------------------------------------

// NHL team abbreviations are 2 to 4 capital letters. Anything else would
// change the meaning of the filter below, so it isn't sent.
const isTeamAbbrev = (team: string) => /^[A-Z]{2,4}$/.test(team)

/** A team's next games, including one in progress. */
export const fetchTeamSchedule = (nhlTeam: string, limit = 5) =>
  isTeamAbbrev(nhlTeam)
    ? rows<UpcomingGame>(
      supabase
        .from('upcoming_games')
        .select('*')
        .or(`home_team.eq.${nhlTeam},away_team.eq.${nhlTeam}`)
        .order('start_time_utc')
        .limit(limit),
    )
    : Promise.resolve([])

/** Every game from today through the next six days that hasn't finished. */
export const fetchWeekAhead = () =>
  rows<UpcomingGame>(supabase.from('upcoming_games').select('*').lt('days_away', 7).order('start_time_utc'))

export const fetchNextGame = () =>
  row<UpcomingGame>(supabase.from('upcoming_games').select('*').order('start_time_utc').limit(1).maybeSingle())

// --- Rosters and players -----------------------------------------------------

export const fetchRoster = (teamId: string) =>
  rows<RosterPlayer>(supabase.from('team_rosters').select('*').eq('team_id', teamId))

export const fetchAllRosters = () => rows<RosterPlayer>(supabase.from('team_rosters').select('*'))

export type PlayerSort = 'season' | 'last_season' | 'name'

export type PlayerQuery = {
  search?: string
  group?: PositionGroup | null
  availability?: Availability | 'available' | null
  /** Only these players, e.g. a watchlist. */
  ids?: number[]
  sort?: PlayerSort
  includeInactive?: boolean
  offset?: number
  limit?: number
}

export const PLAYERS_PAGE_SIZE = 40

export function fetchPlayers(params: PlayerQuery = {}) {
  const {
    search, group, availability, ids, sort = 'season', includeInactive, offset = 0, limit = PLAYERS_PAGE_SIZE,
  } = params
  if (ids?.length === 0) return Promise.resolve([])
  let query = supabase.from('player_pool').select('*')

  const term = search?.trim()
  // Commas and parentheses have meaning in a filter, so keep them out of it.
  if (term) query = query.ilike('full_name', `%${term.replace(/[%_,()\\]/g, ' ')}%`)
  if (group) query = query.eq('position_group', group)
  if (availability === 'available') query = query.neq('availability', 'rostered')
  else if (availability) query = query.eq('availability', availability)
  if (ids) query = query.in('id', ids)
  // Someone searching by name, or looking at players they picked out, wants
  // to find each player wherever he is.
  if (!includeInactive && !term && !ids) query = query.eq('is_active', true)

  if (sort === 'name') {
    query = query.order('last_name').order('first_name')
  } else {
    const first = sort === 'season' ? 'season_points' : 'last_season_points'
    const second = sort === 'season' ? 'last_season_points' : 'season_points'
    query = query.order(first, { ascending: false }).order(second, { ascending: false }).order('last_name')
  }

  return rows<PoolPlayer>(query.order('id').range(offset, offset + limit - 1))
}

export const fetchPlayer = (playerId: number) =>
  row<PoolPlayer>(supabase.from('player_pool').select('*').eq('id', playerId).maybeSingle())

export const fetchGameLog = (playerId: number, season: number, limit = 12) =>
  rows<GameLogRow>(
    supabase
      .from('player_game_log')
      .select('*')
      .eq('player_id', playerId)
      .eq('season', season)
      .order('start_time_utc', { ascending: false })
      .limit(limit),
  )

/** This season's totals so far and last season's, either of which may be missing. */
export async function fetchSeasonTotals(playerId: number, season: number) {
  const [current, last] = await Promise.all([
    row<SeasonTotals>(
      supabase.from('player_season_totals').select('*').eq('player_id', playerId).eq('season', season).maybeSingle(),
    ),
    row<SeasonTotals>(
      supabase
        .from('player_season_stats')
        .select('*')
        .eq('player_id', playerId)
        .eq('season', season - 10001)
        .maybeSingle(),
    ),
  ])
  return { current, last }
}

/** The signed-in owner's watchlist. Other teams' lists aren't readable. */
export const fetchWatchlist = async () =>
  (await rows<{ player_id: number }>(supabase.from('watchlist').select('player_id'))).map((r) => Number(r.player_id))

export const fetchSeason = async () => {
  const settings = await row<{ season: number; commissioner_id: string | null }>(
    supabase.from('league_settings').select('season, commissioner_id').maybeSingle(),
  )
  return settings
}

// --- Draft -------------------------------------------------------------------

export const fetchDraft = () =>
  row<Draft>(supabase.from('drafts').select('*').order('season', { ascending: false }).limit(1).maybeSingle())

export const fetchDraftBoard = () =>
  rows<DraftPick>(supabase.from('draft_board').select('*').order('pick_number'))

// --- Waivers, IR, trades ---------------------------------------------------------

export const fetchWaivers = () => rows<Waiver>(supabase.from('waiver_wire').select('*').order('expires_at'))

/** Only the caller's own claims come back: claims are private until processed. */
export const fetchPendingClaims = () =>
  rows<WaiverClaim>(supabase.from('waiver_claims').select('*').eq('status', 'pending'))

export const fetchIrStints = () => rows<IrStint>(supabase.from('ir_status').select('*').order('placed_at'))

export const fetchTrades = (limit = 40) =>
  rows<Trade>(supabase.from('trade_details').select('*').order('created_at', { ascending: false }).limit(limit))

// --- Activity and alerts -----------------------------------------------------

export const ACTIVITY_PAGE_SIZE = 30

export function fetchActivity(params: { types?: TransactionType[]; teamId?: string; offset?: number; limit?: number } = {}) {
  const { types, teamId, offset = 0, limit = ACTIVITY_PAGE_SIZE } = params
  let query = supabase.from('activity_feed').select('*')
  if (types?.length) query = query.in('type', types)
  if (teamId) query = query.eq('team_id', teamId)
  return rows<Activity>(query.order('id', { ascending: false }).range(offset, offset + limit - 1))
}

export const fetchAlerts = (teamId: string, limit = 50) =>
  rows<Alert>(
    supabase.from('alerts').select('*').eq('team_id', teamId).order('id', { ascending: false }).limit(limit),
  )

export async function markAlertsRead(ids: number[]) {
  if (ids.length === 0) return
  const { error } = await supabase.from('alerts').update({ read_at: new Date().toISOString() }).in('id', ids)
  if (error) throw new Error(friendlyMessage(error.message))
}

export async function renameTeam(teamId: string, name: string) {
  const { error } = await supabase.from('teams').update({ name }).eq('id', teamId)
  if (error) {
    throw new Error(/teams_name_check/.test(error.message) ? 'A team name needs 1 to 40 characters.' : friendlyMessage(error.message))
  }
}

// --- Commissioner ------------------------------------------------------------

export const fetchSyncStatus = () => rows<SyncStatus>(supabase.from('sync_status').select('*').order('job'))

export const fetchEspnIssues = () =>
  rows<EspnIssue>(supabase.from('espn_issues').select('*').order('match_confidence').order('espn_name'))

export type SyncJob = 'players' | 'schedule' | 'live' | 'finals' | 'injuries' | 'setup'

export type SyncResult = { job: string; ok: boolean; message: string }

/** Asks the sync function to run a job now. Commissioner only. */
export async function runSync(job: SyncJob): Promise<SyncResult[]> {
  const { data, error } = await supabase.functions.invoke<{ results?: SyncResult[]; error?: string }>('sync', {
    body: { job },
  })
  if (error) {
    // The function's own explanation is in the response body, if there is one.
    const context = (error as { context?: Response }).context
    const body = context ? await context.json().catch(() => null) : null
    throw new Error(friendlyMessage(body?.error ?? error.message))
  }
  if (data?.error) throw new Error(data.error)
  return data?.results ?? []
}
