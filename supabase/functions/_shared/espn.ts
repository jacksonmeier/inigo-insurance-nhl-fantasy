// ESPN's public NHL injury list. Unofficial and undocumented, like the NHL
// API, so everything that knows its shape lives here.

import { fetchJson, type FetchOptions } from './http.ts'

const INJURIES_URL = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries'

// Where ESPN's team abbreviations differ from the NHL's.
const ESPN_TO_NHL_TEAM: Record<string, string> = {
  LA: 'LAK',
  NJ: 'NJD',
  SJ: 'SJS',
  TB: 'TBL',
  UTAH: 'UTA',
}

export const nhlTeamFromEspn = (abbrev: string | undefined) =>
  abbrev ? (ESPN_TO_NHL_TEAM[abbrev.toUpperCase()] ?? abbrev.toUpperCase()) : null

type EspnInjury = {
  status?: string
  date?: string
  shortComment?: string
  details?: { type?: string; returnDate?: string }
  athlete?: {
    firstName?: string
    lastName?: string
    displayName?: string
    position?: { abbreviation?: string }
    team?: { abbreviation?: string }
    links?: { href?: string }[]
    headshot?: { href?: string }
  }
}

type EspnResponse = {
  injuries?: { displayName?: string; injuries?: EspnInjury[] }[]
}

export type EspnInjuredPlayer = {
  espnAthleteId: string
  name: string
  firstName: string
  lastName: string
  /** NHL abbreviation, e.g. TBL where ESPN says TB. */
  team: string | null
  /** ESPN's position: C, LW, RW, D or G. */
  position: string | null
  /** As ESPN reports it: Out, Injured Reserve, Day-To-Day, Suspension. */
  status: string
  description: string | null
  updatedAt: string | null
}

// The injury list doesn't carry the athlete's id as a field. It's in his
// player-card link (.../player/_/id/5080154) and his headshot URL.
function athleteId(athlete: NonNullable<EspnInjury['athlete']>): string | null {
  for (const link of athlete.links ?? []) {
    const match = link.href?.match(/\/id\/(\d+)/)
    if (match) return match[1]
  }
  return athlete.headshot?.href?.match(/\/(\d+)\.png/)?.[1] ?? null
}

function describe(injury: EspnInjury): string | null {
  const parts = [injury.details?.type, injury.details?.returnDate && `expected back ${injury.details.returnDate}`]
  const summary = parts.filter(Boolean).join(', ')
  return summary || injury.shortComment || null
}

export function parseInjuries(response: EspnResponse): EspnInjuredPlayer[] {
  const players = new Map<string, EspnInjuredPlayer>()

  for (const team of response.injuries ?? []) {
    for (const injury of team.injuries ?? []) {
      const athlete = injury.athlete
      if (!athlete || !injury.status) continue

      const id = athleteId(athlete)
      const name = athlete.displayName ?? [athlete.firstName, athlete.lastName].filter(Boolean).join(' ')
      if (!id || !name) continue

      const player: EspnInjuredPlayer = {
        espnAthleteId: id,
        name,
        firstName: athlete.firstName ?? name.split(' ')[0],
        lastName: athlete.lastName ?? name.split(' ').slice(1).join(' '),
        team: nhlTeamFromEspn(athlete.team?.abbreviation),
        position: athlete.position?.abbreviation ?? null,
        status: injury.status,
        description: describe(injury),
        updatedAt: injury.date ?? null,
      }

      // A player can be listed twice. Keep the most recent report.
      const existing = players.get(id)
      if (!existing || (player.updatedAt ?? '') > (existing.updatedAt ?? '')) players.set(id, player)
    }
  }
  return [...players.values()]
}

export async function getInjuries(options?: FetchOptions): Promise<EspnInjuredPlayer[]> {
  const response = await fetchJson<EspnResponse>(INJURIES_URL, { timeoutMs: 20_000, ...options })
  return parseInjuries(response)
}
