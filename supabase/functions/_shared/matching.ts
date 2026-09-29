// ESPN and the NHL use different player ids, so injured players are matched
// by name, team and position. Anything short of a confident match is flagged
// for the commissioner to check.

import type { EspnInjuredPlayer } from './espn.ts'
import { positionGroup, type NhlPosition, type PositionGroup } from './league.config.ts'

export type NhlPlayerRef = {
  id: number
  first_name: string
  last_name: string
  position: NhlPosition
  nhl_team: string | null
}

export type MatchConfidence = 'high' | 'low' | 'unmatched'

export type Match = { playerId: number | null; confidence: MatchConfidence }

/** Lowercase, no accents or punctuation: "Tim Stützle" -> "tim stutzle", "J.T. Miller" -> "jt miller". */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .trim()
    .replace(/\s+/g, ' ')
}

function espnGroup(position: string | null): PositionGroup | null {
  if (!position) return null
  const code = position.toUpperCase()
  if (code === 'G') return 'G'
  if (code === 'D') return 'D'
  if (['C', 'LW', 'RW', 'L', 'R', 'F', 'W'].includes(code)) return 'F'
  return null
}

// "Matt" for "Matthew", "Alex" for "Alexander": one first name starts the other.
function firstNamesAgree(a: string, b: string) {
  if (!a || !b) return false
  return a === b || a.startsWith(b) || b.startsWith(a) || a[0] === b[0]
}

export function matchPlayer(espn: EspnInjuredPlayer, players: readonly NhlPlayerRef[]): Match {
  const fullName = normalizeName(espn.name)
  const lastName = normalizeName(espn.lastName)
  const firstName = normalizeName(espn.firstName)
  const group = espnGroup(espn.position)

  const sameTeam = (p: NhlPlayerRef) => espn.team !== null && p.nhl_team === espn.team
  const sameGroup = (p: NhlPlayerRef) => group !== null && positionGroup(p.position) === group
  const differentGroup = (p: NhlPlayerRef) => group !== null && positionGroup(p.position) !== group

  // Exact name. There are players who share one (two Sebastian Ahos, two Elias
  // Petterssons), so team and position break the tie.
  const exact = players.filter((p) => normalizeName(`${p.first_name} ${p.last_name}`) === fullName)
  if (exact.length === 1) {
    const [player] = exact
    // Same name but a skater where ESPN has a goalie (or the reverse) and a
    // different team: probably someone else.
    if (differentGroup(player) && !sameTeam(player)) return { playerId: player.id, confidence: 'low' }
    return { playerId: player.id, confidence: 'high' }
  }
  if (exact.length > 1) {
    const narrowed = [
      exact.filter((p) => sameTeam(p) && sameGroup(p)),
      exact.filter(sameTeam),
      exact.filter(sameGroup),
    ].find((candidates) => candidates.length === 1)
    if (narrowed) return { playerId: narrowed[0].id, confidence: 'high' }
    return { playerId: null, confidence: 'unmatched' }
  }

  // Same last name on the same team, with a first name that could be a
  // nickname. Plausible, but worth a second look.
  const close = players.filter(
    (p) =>
      normalizeName(p.last_name) === lastName &&
      sameTeam(p) &&
      !differentGroup(p) &&
      firstNamesAgree(normalizeName(p.first_name), firstName),
  )
  if (close.length === 1) return { playerId: close[0].id, confidence: 'low' }

  return { playerId: null, confidence: 'unmatched' }
}
