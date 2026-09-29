import { LEAGUE } from '@shared/league.config.ts'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PlayerActions from '../components/PlayerActions.tsx'
import PlayerLine from '../components/PlayerLine.tsx'
import PlayerSheet from '../components/PlayerSheet.tsx'
import Points from '../components/Points.tsx'
import { Empty, Loaded, PositionTag } from '../components/ui.tsx'
import { fetchActivity, fetchRoster, fetchStandings } from '../lib/api.ts'
import { gameTime, GROUP_NAMES, GROUP_NOUN, isLive, periodLabel, points, signed, timeAgo, timeLeft } from '../lib/format.ts'
import { useNow } from '../lib/hooks.ts'
import { useLeague } from '../lib/league.tsx'
import { useLive } from '../lib/live.ts'
import { GROUPS, hasOpenIrSlot } from '../lib/rules.ts'
import type { IrStint, RosterPlayer } from '../lib/types.ts'

const ROSTER_TABLES = ['roster_entries', 'player_game_points', 'player_injuries', 'games', 'ir_stints']

function nextGame(player: RosterPlayer) {
  if (!player.nhl_team) return 'Not on an NHL team'
  if (!player.next_game_start) return 'No games scheduled'

  const home = player.next_game_home === player.nhl_team
  const versus = `${home ? 'vs' : '@'} ${home ? player.next_game_away : player.next_game_home}`
  if (isLive(player.next_game_state)) return `${versus} · ${periodLabel(player.next_game_period)}`
  return `${versus} · ${gameTime(player.next_game_start)}`
}

function asActionPlayer(player: RosterPlayer) {
  return {
    id: player.player_id,
    full_name: player.full_name,
    position_group: player.position_group,
    fantasy_team_id: player.team_id,
    roster_slot: player.slot,
    is_ir_replacement: player.is_ir_replacement,
    waiver_id: null,
    waiver_expires_at: null,
    is_ir_eligible: player.is_ir_eligible,
  }
}

function RosterRow({ player, isMine, onOpen }: { player: RosterPlayer; isMine: boolean; onOpen: () => void }) {
  const league = useLeague()
  const playing = isLive(player.next_game_state)
  const onIr = player.slot === 'ir'
  const canGoOnIr =
    isMine && league.seasonOpen && player.is_ir_eligible && !onIr && !player.is_ir_replacement &&
    hasOpenIrSlot(league.myRoster)

  return (
    <>
      <PlayerLine
        player={player}
        injury={{ status: player.injury_status, description: player.injury_description }}
        tags={
          <>
            {player.is_ir_replacement && <span className="tag" title="Temporary replacement for a player on IR">Temp</span>}
            {playing && <span className="tag live">Live</span>}
          </>
        }
        meta={
          <span>
            {onIr
              ? 'Earns no points on IR'
              : player.today_not_counting
                ? 'Joined after puck drop. Tonight doesn\'t count.'
                : nextGame(player)}
          </span>
        }
        onOpen={onOpen}
        right={
          <>
            {!onIr && <Points value={Number(player.today_points)} showSign tone="auto" label="Today" />}
            <Points value={Number(player.team_points)} label="Season" />
          </>
        }
      />
      {canGoOnIr && (
        <div className="row-action">
          <span className="fine">
            Listed as {player.injury_status}. He scores nothing while he's out.
          </span>
          <PlayerActions player={asActionPlayer(player)} compact />
        </div>
      )}
    </>
  )
}

function IrSlot({ roster, stints, isMine, onOpen }: {
  roster: RosterPlayer[]
  stints: IrStint[]
  isMine: boolean
  onOpen: (playerId: number) => void
}) {
  const now = useNow(30_000)
  const onIr = roster.filter((player) => player.slot === 'ir')

  return (
    <div className="card flush">
      <div className="card-head">
        <span>Injured reserve</span>
        <span className="tally">
          {onIr.length} / {LEAGUE.irSlots}
        </span>
      </div>

      {onIr.length === 0 && (
        <p className="muted fine" style={{ padding: '14px 16px', margin: 0 }}>
          Empty. A player listed as Out or on Injured Reserve can be moved here, which opens his spot for a
          temporary replacement.
        </p>
      )}

      {onIr.map((player) => {
        const stint = stints.find((s) => s.ir_player_id === player.player_id)
        return (
          <div key={player.player_id}>
            <RosterRow player={player} isMine={false} onOpen={() => onOpen(player.player_id)} />
            <div style={{ padding: '0 16px 14px' }} className="stack">
              {stint?.decision_deadline ? (
                <div className="notice warn">
                  He's no longer listed as out. {isMine ? 'Decide' : 'The owner has to decide'} within{' '}
                  <strong>{timeLeft(stint.decision_deadline, now)}</strong>, or he's activated automatically
                  {stint.replacement_player_name ? ` and ${stint.replacement_player_name} is released` : ''}.
                </div>
              ) : (
                <div className="fine muted">
                  {stint?.replacement_player_name
                    ? `${stint.replacement_player_name} is filling in.`
                    : `No replacement yet. ${isMine ? `Add any free agent ${GROUP_NOUN[player.position_group]}.` : ''}`}
                </div>
              )}
              {isMine && !stint?.replacement_player_id && !stint?.decision_deadline && (
                <Link to={`/players?group=${player.position_group}`} className="button">
                  Find a replacement
                </Link>
              )}
              {isMine && <PlayerActions player={asActionPlayer(player)} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function TeamPage() {
  const { teamId: teamParam } = useParams()
  const league = useLeague()
  const [open, setOpen] = useState<number | null>(null)

  const teamId = teamParam ?? league.myTeamId
  const isMine = teamId !== null && teamId === league.myTeamId

  const roster = useLive(() => (teamId ? fetchRoster(teamId) : Promise.resolve([])), [teamId], ROSTER_TABLES)
  const standings = useLive(fetchStandings, [], ['player_game_points', 'point_adjustments', 'roster_entries', 'teams'])
  const moves = useLive(
    () => (teamId ? fetchActivity({ teamId, limit: 8 }) : Promise.resolve([])),
    [teamId],
    ['transactions'],
  )

  if (!teamId) {
    return (
      <section>
        <h1>My team</h1>
        <Empty title="No team">You're the commissioner but don't own a team. Pick a team from the standings.</Empty>
      </section>
    )
  }

  const standing = standings.data?.find((row) => row.team_id === teamId)
  const stints = league.irStints.filter((stint) => stint.team_id === teamId)

  return (
    <section>
      <div className="hero">
        <div className="grow">
          <h1>{standing?.name ?? league.teamName(teamId)}</h1>
          <div className="sub">
            {standing && Number(standing.total_points) !== 0 ? `${ordinal(standing.rank)} place · ` : ''}
            {standing ? `Today ${signed(standing.today_points)}` : ''}
            {standing && Number(standing.adjustment_points) !== 0
              ? ` · ${signed(standing.adjustment_points)} adjusted`
              : ''}
          </div>
        </div>
        {standing && <Points value={Number(standing.total_points)} size="huge" />}
      </div>

      {!isMine && league.myTeamId && league.seasonOpen && (
        <Link to={`/trades?with=${teamId}`} className="button ghost wide" style={{ marginBottom: 12 }}>
          Propose a trade
        </Link>
      )}

      <Loaded live={roster}>
        {(players) => {
          if (players.length === 0 && !league.seasonOpen) {
            return (
              <div className="card">
                <Empty title="No players yet">
                  Rosters fill up in the draft: {LEAGUE.roster.F} forwards, {LEAGUE.roster.D} defense and{' '}
                  {LEAGUE.roster.G} goalie.
                </Empty>
                <Link to="/draft" className="button wide">
                  Go to the draft room
                </Link>
              </div>
            )
          }

          return (
            <>
              {GROUPS.map((group) => {
                const active = players
                  .filter((player) => player.slot === 'active' && player.position_group === group)
                  .sort((a, b) => Number(b.team_points) - Number(a.team_points) || a.full_name.localeCompare(b.full_name))
                const openSlots = Math.max(0, LEAGUE.roster[group] - active.length)

                return (
                  <div key={group} className="card flush">
                    <div className="card-head">
                      <span>{GROUP_NAMES[group]}</span>
                      <span className="tally">
                        {active.length} / {LEAGUE.roster[group]}
                      </span>
                    </div>
                    {active.map((player) => (
                      <RosterRow
                        key={player.player_id}
                        player={player}
                        isMine={isMine}
                        onOpen={() => setOpen(player.player_id)}
                      />
                    ))}
                    {Array.from({ length: openSlots }, (_, i) => (
                      <div key={i} className="slot-open">
                        <span className="row">
                          <PositionTag group={group} />
                          Open spot, scoring nothing
                        </span>
                        {isMine && league.seasonOpen && (
                          <Link to={`/players?group=${group}`} className="button small">
                            Add
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })}

              <IrSlot roster={players} stints={stints} isMine={isMine} onOpen={setOpen} />
            </>
          )
        }}
      </Loaded>

      <h2>Recent moves</h2>
      <Loaded live={moves}>
        {(items) =>
          items.length === 0 ? (
            <p className="muted">Nothing yet.</p>
          ) : (
            <div className="card flush">
              {items.map((item) => (
                <div key={item.id} className={item.details.undone ? 'feed-item undone' : 'feed-item'}>
                  <div className="grow">
                    <div className="feed-text">{item.summary}</div>
                    <div className="feed-time">{timeAgo(item.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </Loaded>

      {isMine && (
        <p className="fine dim">
          Season points are what each player has scored for this team. Tap a player for his game log.
          {' '}Total this season by your current players: {points(
            (roster.data ?? []).reduce((sum, player) => sum + Number(player.team_points), 0),
          )}.
        </p>
      )}

      {open !== null && <PlayerSheet playerId={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

function ordinal(n: number) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suffix}`
}
