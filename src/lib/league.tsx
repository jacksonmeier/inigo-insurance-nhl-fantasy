// What nearly every screen needs to know: the teams, where the draft stands,
// and the signed-in owner's roster, claims and unread alerts. Loaded once and
// kept live.

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import {
  fetchAlerts, fetchDraft, fetchIrStints, fetchPendingClaims, fetchRoster, fetchSeason, fetchTeams,
} from './api.ts'
import { useAuth } from './auth.tsx'
import { useLive } from './live.ts'
import type { Alert, Draft, IrStint, RosterPlayer, Team, WaiverClaim } from './types.ts'

type League = {
  /** False until the first load finishes. */
  ready: boolean
  season: number | null
  teams: Team[]
  teamName: (teamId: string | null | undefined) => string
  draft: Draft | null
  /** Roster moves open once the draft is complete. */
  seasonOpen: boolean
  myTeamId: string | null
  myRoster: RosterPlayer[]
  myClaims: WaiverClaim[]
  irStints: IrStint[]
  alerts: Alert[]
  unreadAlerts: number
  refreshAlerts: () => Promise<void>
}

const LeagueContext = createContext<League | null>(null)

const NONE: never[] = []

export function LeagueProvider({ children }: { children: ReactNode }) {
  const { team } = useAuth()
  const myTeamId = team?.id ?? null

  const settings = useLive(fetchSeason, [], ['league_settings'])
  const teams = useLive(fetchTeams, [], ['teams'])
  // The draft is the one thing that must never look stale, so it's also polled.
  const draft = useLive(fetchDraft, [], ['drafts', 'draft_picks'], { pollMs: 15_000 })
  const irStints = useLive(fetchIrStints, [], ['ir_stints', 'player_injuries', 'roster_entries'])

  const myRoster = useLive(
    () => (myTeamId ? fetchRoster(myTeamId) : Promise.resolve([])),
    [myTeamId],
    ['roster_entries', 'player_game_points', 'player_injuries', 'games', 'ir_stints'],
  )
  const myClaims = useLive(fetchPendingClaims, [myTeamId], ['waiver_claims', 'waivers'])
  const alerts = useLive(
    () => (myTeamId ? fetchAlerts(myTeamId) : Promise.resolve([])),
    [myTeamId],
    ['alerts'],
  )

  const teamList = teams.data ?? NONE
  const teamName = useCallback(
    (teamId: string | null | undefined) => teamList.find((t) => t.id === teamId)?.name ?? 'Unknown team',
    [teamList],
  )

  const value = useMemo<League>(() => {
    const alertList = alerts.data ?? NONE
    return {
      ready: teams.data !== undefined && draft.data !== undefined && myRoster.data !== undefined,
      season: settings.data?.season ?? null,
      teams: teamList,
      teamName,
      draft: draft.data ?? null,
      seasonOpen: draft.data?.status === 'complete',
      myTeamId,
      myRoster: myRoster.data ?? NONE,
      // Claims come back for every team when the commissioner asks.
      myClaims: (myClaims.data ?? NONE).filter((claim) => claim.team_id === myTeamId),
      irStints: irStints.data ?? NONE,
      alerts: alertList,
      unreadAlerts: alertList.filter((alert) => !alert.read_at).length,
      refreshAlerts: alerts.refresh,
    }
  }, [
    alerts.data, alerts.refresh, draft.data, irStints.data, myClaims.data, myRoster.data, myTeamId,
    settings.data, teamList, teamName, teams.data,
  ])

  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>
}

// oxlint-disable-next-line react/only-export-components
export function useLeague() {
  const league = useContext(LeagueContext)
  if (!league) throw new Error('useLeague must be used inside LeagueProvider')
  return league
}
