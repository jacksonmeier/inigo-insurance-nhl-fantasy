// The league's roster rules, mirrored for the interface: which buttons to
// offer and what to say. The database enforces the real thing (see
// supabase/migrations); if the two ever disagree, the database wins and its
// message is shown.

import { LEAGUE, type PositionGroup } from '@shared/league.config.ts'

export const GROUPS: PositionGroup[] = ['F', 'D', 'G']

type Rostered = { position_group: PositionGroup; slot: 'active' | 'ir'; is_ir_replacement: boolean }

export type Needs = Record<PositionGroup, number>

/** Open active slots per position group. */
export function openSlots(roster: readonly Rostered[]): Needs {
  const open = { ...LEAGUE.roster } as Needs
  for (const player of roster) {
    if (player.slot === 'active') open[player.position_group] -= 1
  }
  for (const group of GROUPS) open[group] = Math.max(0, open[group])
  return open
}

export const hasOpenIrSlot = (roster: readonly Rostered[]) =>
  roster.filter((player) => player.slot === 'ir').length < LEAGUE.irSlots

/** "2 F, 1 G", or null when the roster is full. */
export function describeNeeds(needs: Needs) {
  const parts = GROUPS.filter((group) => needs[group] > 0).map((group) => `${needs[group]} ${group}`)
  return parts.length > 0 ? parts.join(', ') : null
}

// --- Draft -------------------------------------------------------------------

export const totalPicks = (teamCount: number) => LEAGUE.draft.rounds * teamCount

/** Snake order: even rounds run in reverse. Picks count from 1. */
export function teamOnClock(order: readonly string[], pick: number): string | null {
  if (order.length === 0 || pick < 1) return null
  const round = Math.floor((pick - 1) / order.length)
  const index = (pick - 1) % order.length
  return order[round % 2 === 0 ? index : order.length - 1 - index]
}

export const roundOf = (pick: number, teamCount: number) => Math.floor((pick - 1) / teamCount) + 1

/** How many picks until this team is up, or null if it has none left. 0 means now. */
export function picksUntil(order: readonly string[], currentPick: number, teamId: string): number | null {
  for (let pick = currentPick; pick <= totalPicks(order.length); pick++) {
    if (teamOnClock(order, pick) === teamId) return pick - currentPick
  }
  return null
}

// --- Trades ------------------------------------------------------------------

type Tradeable = { player_id: number; position_group: PositionGroup }

/**
 * Why a trade can't work, or null if it can. `give` leaves my roster and
 * `receive` joins it; the other team's roster does the opposite.
 */
export function tradeProblem(
  mine: { name: string; roster: readonly Rostered[] },
  theirs: { name: string; roster: readonly Rostered[] },
  give: readonly Tradeable[],
  receive: readonly Tradeable[],
): string | null {
  if (give.length + receive.length === 0) return 'Choose at least one player.'

  for (const group of GROUPS) {
    const out = give.filter((p) => p.position_group === group).length
    const incoming = receive.filter((p) => p.position_group === group).length
    // A slot held for a player on IR doesn't count as open for a trade.
    const held = (roster: readonly Rostered[]) => {
      const onIr = roster.filter((p) => p.slot === 'ir' && p.position_group === group).length
      const replacements = roster.filter((p) => p.is_ir_replacement && p.position_group === group).length
      return Math.max(0, onIr - replacements)
    }
    const active = (roster: readonly Rostered[]) =>
      roster.filter((p) => p.slot === 'active' && p.position_group === group).length

    const limit = LEAGUE.roster[group]
    if (active(mine.roster) + held(mine.roster) - out + incoming > limit) {
      return `${mine.name} would have too many ${group} (limit ${limit}).`
    }
    if (active(theirs.roster) + held(theirs.roster) - incoming + out > limit) {
      return `${theirs.name} would have too many ${group} (limit ${limit}).`
    }
  }
  return null
}
