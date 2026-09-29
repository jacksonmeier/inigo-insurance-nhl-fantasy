import { STAT_LABELS } from '@shared/scoring.ts'
import type { ReactNode } from 'react'
import { fetchGameLog, fetchPlayer, fetchSeasonTotals, fetchTeamSchedule } from '../lib/api.ts'
import { formatGameDate, formatGameDay, formatTime, isLive, periodLabel, points, timeLeft } from '../lib/format.ts'
import { useAction, useNow } from '../lib/hooks.ts'
import { useLeague } from '../lib/league.tsx'
import { useLive } from '../lib/live.ts'
import { call } from '../lib/supabase.ts'
import type { GameLogRow, PoolPlayer, SeasonTotals, UpcomingGame } from '../lib/types.ts'
import { StarIcon } from './Icons.tsx'
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

/** Adds the player to the owner's watchlist, or takes him off. */
function WatchButton({ player }: { player: PoolPlayer }) {
  const league = useLeague()
  const { run, busy } = useAction()
  if (!league.myTeamId || player.fantasy_team_id === league.myTeamId) return null

  const watching = league.watchlist.has(player.id)
  const heads = player.fantasy_team_id
    ? " You'll get an alert if he's dropped."
    : player.waiver_id
      ? " You'll get an alert if he clears waivers."
      : ''

  return (
    <button
      type="button"
      className={watching ? 'icon-button watch on' : 'icon-button watch'}
      aria-pressed={watching}
      aria-label={watching ? `Stop watching ${player.full_name}` : `Watch ${player.full_name}`}
      title={watching ? 'On your watchlist' : 'Add to your watchlist'}
      disabled={busy}
      onClick={() =>
        run(
          () => call(watching ? 'unwatch_player' : 'watch_player', { p_player_id: player.id }),
          watching ? `${player.full_name} is off your watchlist.` : `Watching ${player.full_name}.${heads}`,
        )
      }
    >
      <StarIcon filled={watching} />
    </button>
  )
}

/** His team's next few games, and how many fall in the coming week. */
function Schedule({ team }: { team: string }) {
  const games = useLive(() => fetchTeamSchedule(team, 8), [team], ['games'])

  const opponent = (game: UpcomingGame) =>
    game.home_team === team ? `vs ${game.away_team}` : `@ ${game.home_team}`
  // The day is in the first column, so only the time here.
  const when = (game: UpcomingGame) =>
    isLive(game.game_state) ? `Live · ${periodLabel(game.period)}` : formatTime(game.start_time_utc)

  return (
    <>
      <h2>Coming up</h2>
      <Loaded live={games}>
        {(list) => {
          if (list.length === 0) return <p className="muted">No games left in the regular season.</p>
          const week = list.filter((game) => game.days_away < 7 && !isLive(game.game_state)).length
          return (
            <>
              <p className="fine muted" style={{ margin: '0 4px 8px' }}>
                {week} {week === 1 ? 'game' : 'games'} in the next 7 days.
              </p>
              <div className="card flush" style={{ margin: 0 }}>
                {list.slice(0, 5).map((game) => (
                  <div key={game.id} className="list-row schedule-row">
                    <span className="grow">{game.days_away === 0 ? 'Today' : formatGameDay(game.game_date)}</span>
                    <span className="schedule-opponent">{opponent(game)}</span>
                    <span className={isLive(game.game_state) ? 'schedule-time down' : 'schedule-time muted'}>
                      {when(game)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )
        }}
      </Loaded>
    </>
  )
}

type StatRow = [label: string, value: (totals: SeasonTotals) => string | number]

const SKATER_STATS: StatRow[] = [
  ['Games', (t) => t.games_played],
  ['Goals', (t) => t.goals],
  ['Assists', (t) => t.assists],
  ['Points', (t) => t.goals + t.assists],
  ['Power play points', (t) => t.power_play_points],
  ['Shorthanded points', (t) => t.shorthanded_points],
  ['Shots on goal', (t) => t.shots],
  ['Hits', (t) => t.hits],
  ['Blocked shots', (t) => t.blocked_shots],
]

const GOALIE_STATS: StatRow[] = [
  ['Games', (t) => t.games_played],
  ['Wins', (t) => t.wins],
  ['Saves', (t) => t.saves],
  ['Goals against', (t) => t.goals_against],
  ['Save percentage', (t) =>
    t.saves + t.goals_against > 0 ? (t.saves / (t.saves + t.goals_against)).toFixed(3).replace(/^0/, '') : '-'],
  ['Shutouts', (t) => t.shutouts],
]

/** This season's totals beside last season's. */
function SeasonStats({ player, season }: { player: PoolPlayer; season: number }) {
  const totals = useLive(() => fetchSeasonTotals(player.id, season), [player.id, season], ['player_game_points'])
  const rows = player.position_group === 'G' ? GOALIE_STATS : SKATER_STATS

  return (
    <>
      <h2>Season stats</h2>
      <Loaded live={totals}>
        {({ current, last }) =>
          !current && !last ? (
            <p className="muted">No NHL games yet.</p>
          ) : (
            <table className="season-stats">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">Stat</span></th>
                  <th scope="col">This season</th>
                  <th scope="col">Last season</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{current ? value(current) : '-'}</td>
                    <td>{last ? value(last) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Loaded>
    </>
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
                <WatchButton player={p} />
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

              {p.nhl_team && <Schedule team={p.nhl_team} />}
              {league.season && <SeasonStats player={p} season={league.season} />}

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
