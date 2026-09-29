// Tonight: every rostered player whose NHL team plays today, team by team,
// with his game and his stats as they happen.

import { useState } from 'react'
import GameStrip from '../components/GameStrip.tsx'
import PlayerLine from '../components/PlayerLine.tsx'
import PlayerSheet from '../components/PlayerSheet.tsx'
import Points from '../components/Points.tsx'
import { Empty, Loaded } from '../components/ui.tsx'
import { fetchNextGame, fetchTodaysGames, fetchTonight } from '../lib/api.ts'
import { formatGameDay, gameTime, isFinal, isLive, periodLabel, points } from '../lib/format.ts'
import { useLeague } from '../lib/league.tsx'
import { useLive } from '../lib/live.ts'
import type { Team, TonightLine } from '../lib/types.ts'

const TONIGHT_TABLES = ['player_game_points', 'games', 'roster_entries', 'player_injuries']

/** Where his game stands: "vs TOR · 7:00 PM", "@ MTL · P2", "vs TOR · Final". */
function gameLine(line: TonightLine) {
  if (line.schedule_state && line.schedule_state !== 'OK') return 'Postponed'
  const home = line.home_team === line.nhl_team
  const versus = `${home ? 'vs' : '@'} ${home ? line.away_team : line.home_team}`
  if (isLive(line.game_state)) return `${versus} · ${periodLabel(line.period)}`
  if (isFinal(line.game_state)) return `${versus} · Final`
  return line.start_time_utc ? `${versus} · ${gameTime(line.start_time_utc)}` : versus
}

const DECISIONS: Record<string, string> = { W: 'W', L: 'L', O: 'OTL' }

// A number stays on the same line as its stat.
const stat = (count: number, label: string) => `${count} ${label}`

/** "1 G · 2 A · 4 SOG · 3 HIT" for a skater, "31 SV · 2 GA · W" for a goalie. */
function statLine(line: TonightLine) {
  if (line.position_group === 'G') {
    const decision = line.decision ? DECISIONS[line.decision] : null
    return [stat(line.saves, 'SV'), stat(line.goals_against, 'GA'), decision, line.shutout && 'Shutout']
      .filter(Boolean)
      .join(' · ')
  }
  const extras: [number, string][] = [
    [line.power_play_points, 'PPP'], [line.shorthanded_points, 'SHP'], [line.shots, 'SOG'], [line.hits, 'HIT'],
    [line.blocked_shots, 'BLK'],
  ]
  return [stat(line.goals, 'G'), stat(line.assists, 'A'), ...extras.filter(([n]) => n > 0).map(([n, label]) => stat(n, label))]
    .join(' · ')
}

// Live games first, then the ones still to come in start order, then the finished.
const stage = (line: TonightLine) => (isLive(line.game_state) ? 0 : isFinal(line.game_state) ? 2 : 1)

function TonightRow({ line, teamId, onOpen }: { line: TonightLine; teamId: string; onOpen: () => void }) {
  const counts = line.credited_team_id === teamId
  const started = isLive(line.game_state) || isFinal(line.game_state)

  let note: string | null = null
  if (!line.on_roster) note = 'Since left the roster. Tonight still counts.'
  else if (line.has_stats && !counts) note = "Joined after puck drop. Tonight doesn't count."
  else if (started && !line.has_stats) note = isLive(line.game_state) ? 'Not in the lineup.' : "Didn't play."

  return (
    <PlayerLine
      player={line}
      injury={{ status: line.injury_status, description: line.injury_description }}
      tags={isLive(line.game_state) && <span className="tag live">Live</span>}
      meta={<span>{gameLine(line)}</span>}
      detail={
        (line.has_stats || note) && (
          <>
            {line.has_stats && <span className="stat-line">{statLine(line)}</span>}
            {note && <span className="dim">{note}</span>}
          </>
        )
      }
      onOpen={onOpen}
      right={
        // Nothing to show until his game starts.
        !started ? null : counts || !line.has_stats ? (
          <Points value={counts ? Number(line.points) : 0} showSign tone="auto" label="Tonight" />
        ) : (
          <span className="stat-col">
            <span className="points dim">{points(line.points)}</span>
            <span className="points-label">Not counted</span>
          </span>
        )
      }
    />
  )
}

function TeamTonight({ team, lines, total, mine, onOpen }: {
  team: Team
  lines: TonightLine[]
  total: number
  mine: boolean
  onOpen: (playerId: number) => void
}) {
  const playing = lines
    .filter((line) => line.game_id !== null)
    .sort(
      (a, b) =>
        stage(a) - stage(b)
        || (stage(a) === 1 ? (a.start_time_utc ?? '').localeCompare(b.start_time_utc ?? '') : 0)
        || Number(b.points) - Number(a.points)
        || a.full_name.localeCompare(b.full_name),
    )
  const resting = lines.filter((line) => line.game_id === null && line.on_roster)

  return (
    <div className="card flush">
      <div className="tonight-head">
        <span className="team-name grow">
          <span className="truncate">{team.name}</span>
          {mine && <span className="tag you">You</span>}
        </span>
        <Points value={total} showSign tone="auto" size="big" />
      </div>
      {playing.length === 0 && (
        <p className="muted fine" style={{ padding: '12px 16px', margin: 0 }}>Nobody playing tonight.</p>
      )}
      {playing.map((line) => (
        <TonightRow key={line.player_id} line={line} teamId={team.id} onOpen={() => onOpen(line.player_id)} />
      ))}
      {resting.length > 0 && (
        <p className="fine dim" style={{ padding: '10px 16px 12px', margin: 0 }}>
          Night off: {resting.map((line) => line.full_name).join(', ')}.
        </p>
      )}
    </div>
  )
}

export default function TonightPage() {
  const league = useLeague()
  const [open, setOpen] = useState<number | null>(null)
  const lines = useLive(fetchTonight, [], TONIGHT_TABLES)
  const games = useLive(fetchTodaysGames, [], ['games'])
  const noGames = games.data !== undefined && games.data.length === 0
  const next = useLive(fetchNextGame, [], ['games'], { paused: !noGames })

  return (
    <section>
      <h1>Tonight</h1>

      {games.data && games.data.length > 0 && <GameStrip games={games.data} />}

      {noGames ? (
        <div className="card">
          <Empty title="No games tonight">
            {next.data ? `The next games are on ${formatGameDay(next.data.game_date)}.` : null}
          </Empty>
        </div>
      ) : (
        <Loaded live={lines}>
          {(rows) => {
            const byTeam = new Map<string, TonightLine[]>(league.teams.map((team) => [team.id, []]))
            for (const row of rows) byTeam.get(row.team_id)?.push(row)
            const totals = new Map(
              [...byTeam].map(([teamId, teamLines]) => [
                teamId,
                teamLines
                  .filter((line) => line.credited_team_id === teamId)
                  .reduce((sum, line) => sum + Number(line.points), 0),
              ]),
            )
            // Your team first, then whoever is having the best night.
            const order = [...league.teams].sort(
              (a, b) =>
                Number(b.id === league.myTeamId) - Number(a.id === league.myTeamId)
                || (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0)
                || a.name.localeCompare(b.name),
            )
            return order.map((team) => (
              <TeamTonight
                key={team.id}
                team={team}
                lines={byTeam.get(team.id) ?? []}
                total={totals.get(team.id) ?? 0}
                mine={team.id === league.myTeamId}
                onOpen={setOpen}
              />
            ))
          }}
        </Loaded>
      )}

      {open !== null && <PlayerSheet playerId={open} onClose={() => setOpen(null)} />}
    </section>
  )
}
