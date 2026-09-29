// The season so far, shaped for the race chart and the lists of winners.
// Shared by the standings and the season history page.

import { useMemo } from 'react'
import type { RaceLine } from '../components/RaceChart.tsx'
import { fetchTeamDays } from './api.ts'
import { formatGameDay } from './format.ts'
import { addDays, buildRace, dailyResults, fantasyToday, teamColors, weeklyResults } from './history.ts'
import { useNow } from './hooks.ts'
import { useLeague } from './league.tsx'
import { useLive } from './live.ts'

export function useSeasonHistory() {
  const league = useLeague()
  const live = useLive(fetchTeamDays, [], ['player_game_points', 'point_adjustments', 'games'])
  const today = fantasyToday(useNow(60_000))

  const season = useMemo(() => {
    if (!live.data) return null
    const teamIds = league.teams.map((team) => team.id)
    const race = buildRace(live.data, teamIds)
    const colors = teamColors(teamIds)
    const lines: RaceLine[] = league.teams.map((team) => ({
      teamId: team.id,
      name: team.name,
      color: colors.get(team.id) ?? 'var(--frost-dim)',
      totals: race.totals.get(team.id) ?? [],
      mine: team.id === league.myTeamId,
    }))
    return {
      days: race.days,
      lines,
      colors,
      nights: dailyResults(live.data, teamIds, today),
      weeks: weeklyResults(live.data, teamIds, today),
    }
  }, [live.data, league.teams, league.myTeamId, today])

  return { live, today, season }
}

/** "Team A leads with 412.3, then Team B 398.0, ...": what the chart shows, in words. */
export function describeRace(lines: readonly RaceLine[]) {
  const ranked = [...lines].sort((a, b) => (b.totals.at(-1) ?? 0) - (a.totals.at(-1) ?? 0))
  if (ranked.length === 0) return 'No points yet.'
  const [first, ...rest] = ranked
  const total = (line: RaceLine) => (line.totals.at(-1) ?? 0).toFixed(1)
  return `${first.name} leads with ${total(first)}`
    + (rest.length > 0 ? `, then ${rest.map((line) => `${line.name} ${total(line)}`).join(', ')}.` : '.')
}

/** "Last night" for yesterday, otherwise the day and date. */
export function nightLabel(day: string, today: string) {
  return day === addDays(today, -1) ? 'Last night' : formatGameDay(day)
}

/** "Team A", or "Team A and Team B" for a tie. */
export function teamNames(ids: readonly string[], teamName: (id: string) => string) {
  const list = ids.map(teamName)
  return list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
}
