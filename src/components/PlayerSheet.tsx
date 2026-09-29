import { STAT_LABELS } from '@shared/scoring.ts'
import type { ReactNode } from 'react'
import { fetchGameLog, fetchPlayer } from '../lib/api.ts'
import { formatGameDate, isLive, points, timeLeft } from '../lib/format.ts'
import { useNow } from '../lib/hooks.ts'
import { useLeague } from '../lib/league.tsx'
import { useLive } from '../lib/live.ts'
import type { GameLogRow, PoolPlayer } from '../lib/types.ts'
import PlayerActions from './PlayerActions.tsx'
import Sheet from './Sheet.tsx'
import { Avatar, InjuryTag, Loaded, PositionTag } from './ui.tsx'

function whereHeIs(player: PoolPlayer, teamName: (id: string) => string, now: number) {
  if (player.fantasy_team_id) {
    const spot = player.roster_slot === 'ir' ? ' (on IR)' : player.is_ir_replacement ? ' (temporary replacement)' : ''
    return `${teamName(player.fantasy_team_id)}${spot}`
  }
  if (player.waiver_id && player.waiver_expires_at) return `On waivers for ${timeLeft(player.waiver_expires_at, now)}`
  return 'Free agent'
}

function breakdownText(row: GameLogRow) {
  return Object.entries(row.breakdown)
    .map(([stat, earned]) => `${STAT_LABELS[stat] ?? stat} ${earned > 0 ? '+' : ''}${points(earned)}`)
    .join(', ')
}

function GameLog({ games, isGoalie, teamName }: {
  games: GameLogRow[]
  isGoalie: boolean
  teamName: (id: string) => string
}) {
  if (games.length === 0) return <p className="muted">No games yet this season.</p>

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Game</th>
            {isGoalie ? (
              <>
                <th title="Decision">Dec</th>
                <th title="Saves">SV</th>
                <th title="Goals against">GA</th>
              </>
            ) : (
              <>
                <th title="Goals">G</th>
                <th title="Assists">A</th>
                <th title="Power play and shorthanded points">PP+SH</th>
                <th title="Shots on goal">SOG</th>
                <th title="Hits">Hit</th>
                <th title="Blocked shots">Blk</th>
              </>
            )}
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {games.map((game) => (
            <tr key={game.game_id} title={breakdownText(game)}>
              <td>
                {formatGameDate(game.game_date)} {game.is_home ? 'vs' : '@'} {game.opponent}
                {isLive(game.game_state) && <span className="tag live" style={{ marginLeft: 6 }}>Live</span>}
                <div className="fine dim">
                  {game.credited_team_id ? `for ${teamName(game.credited_team_id)}` : 'not rostered'}
                </div>
              </td>
              {isGoalie ? (
                <>
                  <td>{game.shutout ? 'SO' : (game.decision ?? '-')}</td>
                  <td>{game.saves}</td>
                  <td>{game.goals_against}</td>
                </>
              ) : (
                <>
                  <td>{game.goals}</td>
                  <td>{game.assists}</td>
                  <td>{game.power_play_points + game.shorthanded_points}</td>
                  <td>{game.shots}</td>
                  <td>{game.hits}</td>
                  <td>{game.blocked_shots}</td>
                </>
              )}
              <td className="total">{points(game.points)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Everything about one player: status, points, recent games, and what you can do with him. */
export default function PlayerSheet({ playerId, onClose, actions }: {
  playerId: number
  onClose: () => void
  /** Replaces the usual roster moves, e.g. with a Draft button. */
  actions?: (player: PoolPlayer) => ReactNode
}) {
  const league = useLeague()
  const now = useNow(30_000)

  const player = useLive(
    () => fetchPlayer(playerId),
    [playerId],
    ['roster_entries', 'waivers', 'player_injuries', 'player_game_points', 'players'],
  )
  const log = useLive(
    () => (league.season ? fetchGameLog(playerId, league.season) : Promise.resolve([])),
    [playerId, league.season],
    ['player_game_points', 'player_game_stats'],
  )

  return (
    <Sheet title="Player details" onClose={onClose}>
      <Loaded live={player}>
        {(p) =>
          p === null ? (
            <p className="muted">That player couldn't be found.</p>
          ) : (
            <>
              <div className="row" style={{ gap: 14 }}>
                <Avatar name={p.full_name} src={p.headshot_url} large />
                <div className="grow">
                  <h3>{p.full_name}</h3>
                  <div className="player-meta">
                    <PositionTag group={p.position_group} position={p.position} />
                    <span>{p.nhl_team ?? 'No NHL team'}</span>
                    {p.sweater_number != null && <span className="dim">#{p.sweater_number}</span>}
                    <InjuryTag status={p.injury_status} />
                  </div>
                  <div className="fine muted" style={{ marginTop: 4 }}>
                    {whereHeIs(p, league.teamName, now)}
                  </div>
                </div>
              </div>

              {p.injury_status && (
                <div className={`notice ${p.is_ir_eligible ? 'error' : 'warn'}`} style={{ marginTop: 12 }}>
                  {p.injury_status}
                  {p.injury_description ? `: ${p.injury_description}` : ''}
                  {p.is_ir_eligible ? '. Eligible for IR.' : ''}
                </div>
              )}

              <div className="facts">
                <div className="fact">
                  <span className="points">{points(p.season_points)}</span>
                  <span className="points-label">This season</span>
                </div>
                <div className="fact">
                  <span className="points">{p.season_games}</span>
                  <span className="points-label">Games</span>
                </div>
                <div className="fact">
                  <span className="points">{points(p.last_season_points)}</span>
                  <span className="points-label">Last season ({p.last_season_games} GP)</span>
                </div>
              </div>

              {actions ? actions(p) : <PlayerActions player={p} onDone={onClose} />}

              <h2>Recent games</h2>
              <Loaded live={log}>
                {(games) => <GameLog games={games} isGoalie={p.position_group === 'G'} teamName={league.teamName} />}
              </Loaded>
            </>
          )
        }
      </Loaded>

      <div className="sheet-actions">
        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Sheet>
  )
}
