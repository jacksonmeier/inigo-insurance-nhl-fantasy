// Every call to the NHL's APIs goes through this module, so when the NHL
// changes something there is one place to fix. Both APIs are public but
// unofficial and undocumented. Community reference:
// https://github.com/Zmalski/NHL-API-Reference
//
// Only the fields this app reads are typed.

import { fetchJson, type FetchOptions } from './http.ts'
import type { NhlPosition } from './league.config.ts'

const WEB_API = 'https://api-web.nhle.com/v1'
const STATS_API = 'https://api.nhle.com/stats/rest/en'

type Localized = { default: string }

// Used if the standings endpoint is unavailable. Update when the league
// expands or a team moves.
export const NHL_TEAMS = [
  'ANA', 'BOS', 'BUF', 'CAR', 'CBJ', 'CGY', 'CHI', 'COL', 'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL',
  'NJD', 'NSH', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SEA', 'SJS', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK',
  'WPG', 'WSH',
] as const

// ---------------------------------------------------------------------------
// Teams and rosters
// ---------------------------------------------------------------------------

export async function getTeamAbbrevs(options?: FetchOptions): Promise<string[]> {
  try {
    const data = await fetchJson<{ standings: { teamAbbrev: Localized }[] }>(`${WEB_API}/standings/now`, options)
    const teams = [...new Set(data.standings.map((row) => row.teamAbbrev.default))].sort()
    if (teams.length >= 30) return teams
  } catch {
    // Fall through to the built-in list.
  }
  return [...NHL_TEAMS]
}

export type NhlRosterPlayer = {
  id: number
  headshot?: string
  firstName: Localized
  lastName: Localized
  sweaterNumber?: number
  positionCode: NhlPosition
}

type RosterResponse = {
  forwards: NhlRosterPlayer[]
  defensemen: NhlRosterPlayer[]
  goalies: NhlRosterPlayer[]
}

export async function getRoster(team: string, options?: FetchOptions): Promise<NhlRosterPlayer[]> {
  const data = await fetchJson<RosterResponse>(`${WEB_API}/roster/${team}/current`, options)
  return [...(data.forwards ?? []), ...(data.defensemen ?? []), ...(data.goalies ?? [])]
}

export type NhlPlayerLanding = {
  playerId: number
  /** False once a player has retired or left the NHL. */
  isActive?: boolean
  firstName: Localized
  lastName: Localized
  position: NhlPosition
  sweaterNumber?: number
  headshot?: string
  /** Missing when he isn't with an NHL team. */
  currentTeamAbbrev?: string
}

/**
 * One player's profile. Used for players the roster lists leave out: injured
 * players, and call-ups who appear in a boxscore before the daily import.
 */
export function getPlayer(playerId: number, options?: FetchOptions): Promise<NhlPlayerLanding> {
  return fetchJson<NhlPlayerLanding>(`${WEB_API}/player/${playerId}/landing`, options)
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export type NhlScheduleGame = {
  id: number
  season: number
  gameType: number
  startTimeUTC: string
  gameState: string
  gameScheduleState: string
  awayTeam: { abbrev: string; score?: number }
  homeTeam: { abbrev: string; score?: number }
  periodDescriptor?: { number?: number }
}

export type NhlScheduleWeek = {
  nextStartDate?: string
  regularSeasonStartDate: string
  regularSeasonEndDate: string
  gameWeek: { date: string; games: NhlScheduleGame[] }[]
}

/** The week of games starting on a date (YYYY-MM-DD), or the current week for "now". */
export function getScheduleWeek(date: string, options?: FetchOptions): Promise<NhlScheduleWeek> {
  return fetchJson<NhlScheduleWeek>(`${WEB_API}/schedule/${date}`, options)
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export type NhlBoxscoreSkater = {
  playerId: number
  name: Localized
  position: NhlPosition
  goals?: number
  assists?: number
  sog?: number
  hits?: number
  blockedShots?: number
  toi?: string
}

export type NhlBoxscoreGoalie = {
  playerId: number
  name: Localized
  position: NhlPosition
  saves?: number
  goalsAgainst?: number
  shotsAgainst?: number
  decision?: string
  toi?: string
}

type BoxscoreTeamStats = {
  forwards?: NhlBoxscoreSkater[]
  defense?: NhlBoxscoreSkater[]
  goalies?: NhlBoxscoreGoalie[]
}

export type NhlBoxscore = {
  id: number
  season: number
  gameType: number
  gameDate: string
  startTimeUTC: string
  gameState: string
  gameScheduleState?: string
  periodDescriptor?: { number?: number; periodType?: string }
  awayTeam: { abbrev: string; score?: number }
  homeTeam: { abbrev: string; score?: number }
  /** Missing until shortly before the game starts. */
  playerByGameStats?: { awayTeam: BoxscoreTeamStats; homeTeam: BoxscoreTeamStats }
}

export function getBoxscore(gameId: number, options?: FetchOptions): Promise<NhlBoxscore> {
  return fetchJson<NhlBoxscore>(`${WEB_API}/gamecenter/${gameId}/boxscore`, options)
}

export type NhlGoal = {
  /** ev, pp or sh: the scoring team's strength, as the NHL rules it. */
  strength: string
  playerId: number
  assists: { playerId: number }[]
}

export type NhlLanding = {
  id: number
  /** Missing until the game starts. */
  summary?: {
    scoring?: { periodDescriptor: { periodType: string }; goals: NhlGoal[] }[]
  }
}

// The boxscore has power play goals but not power play assists or anything
// shorthanded, so those come from the scoring summary here.
export function getLanding(gameId: number, options?: FetchOptions): Promise<NhlLanding> {
  return fetchJson<NhlLanding>(`${WEB_API}/gamecenter/${gameId}/landing`, options)
}

// ---------------------------------------------------------------------------
// Season totals (stats API)
// ---------------------------------------------------------------------------

export type NhlSkaterSeason = {
  playerId: number
  gamesPlayed: number
  goals: number
  assists: number
  ppPoints: number
  shPoints: number
  shots: number
}

export type NhlSkaterRealtimeSeason = {
  playerId: number
  hits: number
  blockedShots: number
}

export type NhlGoalieSeason = {
  playerId: number
  gamesPlayed: number
  wins: number
  saves: number
  goalsAgainst: number
  shutouts: number
}

// A player traded mid-season still gets one row covering the whole season.
function seasonReport<T>(report: string, season: number, gameType: number, options?: FetchOptions): Promise<T[]> {
  const query = new URLSearchParams({
    limit: '-1',
    cayenneExp: `seasonId=${season} and gameTypeId=${gameType}`,
  })
  return fetchJson<{ data: T[] }>(`${STATS_API}/${report}?${query}`, { timeoutMs: 30_000, ...options }).then(
    (response) => response.data ?? [],
  )
}

export const getSkaterSeasons = (season: number, gameType = 2, options?: FetchOptions) =>
  seasonReport<NhlSkaterSeason>('skater/summary', season, gameType, options)

export const getSkaterRealtimeSeasons = (season: number, gameType = 2, options?: FetchOptions) =>
  seasonReport<NhlSkaterRealtimeSeason>('skater/realtime', season, gameType, options)

export const getGoalieSeasons = (season: number, gameType = 2, options?: FetchOptions) =>
  seasonReport<NhlGoalieSeason>('goalie/summary', season, gameType, options)
