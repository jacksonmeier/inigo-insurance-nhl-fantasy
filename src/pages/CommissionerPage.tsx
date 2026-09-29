import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { RefreshIcon } from '../components/Icons.tsx'
import { Confirm } from '../components/Sheet.tsx'
import { Empty, Loaded, PositionTag } from '../components/ui.tsx'
import {
  fetchEspnIssues, fetchPlayers, fetchRoster, fetchSyncStatus, fetchTrades, fetchWaivers, runSync,
  type SyncJob,
} from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { timeAgo, timeLeft } from '../lib/format.ts'
import { useAction, useDebounced, useNow } from '../lib/hooks.ts'
import { useLeague } from '../lib/league.tsx'
import { useLive } from '../lib/live.ts'
import { call } from '../lib/supabase.ts'
import type { EspnIssue, PoolPlayer } from '../lib/types.ts'

// ---------------------------------------------------------------------------
// NHL and ESPN data
// ---------------------------------------------------------------------------

const JOBS: { job: SyncJob; name: string; what: string; schedule: string }[] = [
  { job: 'players', name: 'Players', what: 'NHL rosters and last season\'s totals', schedule: 'Daily' },
  { job: 'schedule', name: 'Schedule', what: 'The regular season schedule', schedule: 'Daily' },
  { job: 'injuries', name: 'Injuries', what: 'ESPN\'s injury list', schedule: 'Hourly on game days' },
  { job: 'live', name: 'Live scoring', what: 'Games in progress', schedule: 'Every 30 seconds during games' },
  { job: 'finals', name: 'Final stats', what: 'The last two days, re-checked for corrections', schedule: 'Nightly' },
]

function Data() {
  const { run, busy } = useAction()
  const [running, setRunning] = useState<SyncJob | null>(null)
  const now = useNow(30_000)
  const status = useLive(fetchSyncStatus, [], ['sync_status'])

  const sync = async (job: SyncJob) => {
    setRunning(job)
    await run(async () => {
      const results = await runSync(job)
      const failed = results.find((result) => !result.ok)
      if (failed) throw new Error(`${failed.job}: ${failed.message}`)
      await status.refresh()
    }, 'Done.')
    setRunning(null)
  }

  return (
    <div className="card flush">
      <div className="card-head">
        <span>NHL and ESPN data</span>
      </div>
      {JOBS.map(({ job, name, what, schedule }) => {
        const last = status.data?.find((row) => row.job === job)
        return (
          <div key={job} className="list-row" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <div className="player-name">
                {name}
                {last?.status === 'error' && <span className="tag out">Failed</span>}
              </div>
              <div className="fine muted">{what}. {schedule}.</div>
              <div className={last?.status === 'error' ? 'fine down' : 'fine dim'}>
                {last ? `${timeAgo(last.last_run_at, now)}: ${last.message ?? ''}` : 'Never run'}
              </div>
            </div>
            <button type="button" className="small quiet" disabled={busy} onClick={() => sync(job)}
              aria-label={`Run ${name} now`}>
              <RefreshIcon width={16} height={16} />
              {running === job ? 'Running' : 'Run'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Things waiting on a 24-hour window
// ---------------------------------------------------------------------------

function Waiting() {
  const league = useLeague()
  const { run, busy } = useAction()
  const now = useNow(30_000)
  const waivers = useLive(fetchWaivers, [], ['waivers'])
  const trades = useLive(() => fetchTrades(), [], ['trades', 'trade_players'])

  const openTrades = (trades.data ?? []).filter((t) => t.status === 'accepted' || t.status === 'proposed')
  const nothing = (waivers.data?.length ?? 0) + openTrades.length + league.irStints.length === 0

  return (
    <div className="card flush">
      <div className="card-head">
        <span>Waiting on the clock</span>
        <button type="button" className="small quiet" disabled={busy}
          onClick={() => run(async () => {
            const done = await call('commish_process_now')
            const counts = done as { ir: number; trades: number; waivers: number }
            if (counts.ir + counts.trades + counts.waivers === 0) throw new Error('Nothing is due yet.')
          }, 'Processed what was due.')}>
          Process what's due
        </button>
      </div>

      {nothing && <p className="muted fine" style={{ padding: '14px 16px', margin: 0 }}>No waivers, trades or IR stints are open.</p>}

      {(waivers.data ?? []).map((waiver) => (
        <div key={waiver.waiver_id} className="list-row">
          <div className="grow">
            <div className="player-name">{waiver.full_name}</div>
            <div className="fine muted">
              On waivers, dropped by {waiver.dropped_by_team_name}. {timeLeft(waiver.expires_at, now)} left.
            </div>
          </div>
          <button type="button" className="small quiet" disabled={busy}
            onClick={() => run(() => call('commish_force_waiver', { p_waiver_id: waiver.waiver_id }), 'Waiver resolved.')}>
            Resolve now
          </button>
        </div>
      ))}

      {openTrades.map((trade) => (
        <div key={trade.id} className="list-row">
          <div className="grow">
            <div className="player-name">{trade.proposing_team_name} and {trade.receiving_team_name}</div>
            <div className="fine muted">
              {trade.players.map((p) => p.full_name).join(', ')}.{' '}
              {trade.status === 'accepted' && trade.veto_deadline
                ? `Veto window: ${timeLeft(trade.veto_deadline, now)} left.`
                : 'Not answered yet.'}
            </div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {trade.status === 'accepted' && (
              <button type="button" className="small quiet" disabled={busy}
                onClick={() => run(() => call('commish_force_trade', { p_trade_id: trade.id, p_execute: true }), 'Trade pushed through.')}>
                Push through
              </button>
            )}
            <button type="button" className="small danger" disabled={busy}
              onClick={() => run(() => call('commish_force_trade', { p_trade_id: trade.id, p_execute: false }), 'Trade cancelled.')}>
              Cancel
            </button>
          </div>
        </div>
      ))}

      {league.irStints.map((stint) => (
        <div key={stint.stint_id} className="list-row">
          <div className="grow">
            <div className="player-name">{stint.ir_player_name}</div>
            <div className="fine muted">
              On IR for {stint.team_name}
              {stint.replacement_player_name ? `, replaced by ${stint.replacement_player_name}` : ''}.{' '}
              {stint.decision_deadline ? `Decision due in ${timeLeft(stint.decision_deadline, now)}.` : stint.still_out ? 'Still out.' : ''}
            </div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <button type="button" className="small quiet" disabled={busy}
              onClick={() => run(() => call('commish_force_ir', { p_stint_id: stint.stint_id, p_action: 'activate' }), 'Activated.')}>
              Activate
            </button>
            {stint.replacement_player_id !== null && (
              <button type="button" className="small quiet" disabled={busy}
                onClick={() => run(() => call('commish_force_ir', { p_stint_id: stint.stint_id, p_action: 'keep_replacement' }), 'Replacement kept.')}>
                Keep replacement
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Finding a player
// ---------------------------------------------------------------------------

function PlayerSearch({ label, onPick, action }: {
  label: string
  action: string
  onPick: (player: PoolPlayer) => void
}) {
  const league = useLeague()
  const [search, setSearch] = useState('')
  const term = useDebounced(search)
  const results = useLive(
    () => (term.trim().length < 2 ? Promise.resolve([]) : fetchPlayers({ search: term, sort: 'last_season', limit: 6 })),
    [term],
    [],
  )

  return (
    <div>
      <label>
        {label}
        <input type="search" placeholder="Type a name" value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ marginTop: 5 }} />
      </label>
      {(results.data ?? []).length > 0 && (
        <div className="card flush" style={{ marginTop: 8 }}>
          {results.data!.map((player) => (
            <div key={player.id} className="list-row" style={{ minHeight: 50 }}>
              <div className="grow">
                <div className="player-name">{player.full_name}</div>
                <div className="player-meta">
                  <PositionTag group={player.position_group} position={player.position} />
                  {player.nhl_team ?? 'No NHL team'} ·{' '}
                  {player.fantasy_team_id ? league.teamName(player.fantasy_team_id) : 'Free agent'}
                </div>
              </div>
              <button type="button" className="small quiet" onClick={() => { onPick(player); setSearch('') }}>
                {action}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Roster corrections
// ---------------------------------------------------------------------------

function RosterFix() {
  const league = useLeague()
  const { run, busy } = useAction()
  const [teamId, setTeamId] = useState(league.teams[0]?.id ?? '')
  const [when, setWhen] = useState('')
  const [note, setNote] = useState('')
  const [removing, setRemoving] = useState<{ id: number; name: string } | null>(null)

  const roster = useLive(() => (teamId ? fetchRoster(teamId) : Promise.resolve([])), [teamId], ['roster_entries'])

  // datetime-local has no time zone; the browser's is the one the commissioner means.
  const effective = when ? new Date(when).toISOString() : undefined

  return (
    <div className="card stack">
      <p className="fine muted" style={{ margin: 0 }}>
        Adds and removes players directly, skipping free agency and waivers. Roster limits still apply. Set a
        time in the past to move points from games already played.
      </p>
      <div className="field-grid two">
        <div>
          <label htmlFor="fix-team">Team</label>
          <select id="fix-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            {league.teams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="fix-when">Effective from (optional)</label>
          <input id="fix-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor="fix-note">Reason (shown in the activity feed)</label>
        <input id="fix-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </div>

      <Loaded live={roster}>
        {(players) => (
          <div className="card flush" style={{ margin: 0 }}>
            {players.length === 0 && <p className="muted fine" style={{ padding: '12px 16px', margin: 0 }}>No players.</p>}
            {players.map((player) => (
              <div key={player.player_id} className="list-row" style={{ minHeight: 50 }}>
                <div className="grow">
                  <div className="player-name">
                    {player.full_name}
                    {player.slot === 'ir' && <span className="tag out">IR</span>}
                    {player.is_ir_replacement && <span className="tag">Temp</span>}
                  </div>
                  <div className="player-meta">
                    <PositionTag group={player.position_group} position={player.position} />
                    {player.nhl_team}
                  </div>
                </div>
                {player.slot === 'active' && !player.is_ir_replacement && (
                  <button type="button" className="small quiet" disabled={busy}
                    onClick={() => run(() => call('commish_place_on_ir', { p_player_id: player.player_id, p_note: note }), 'Moved to IR.')}>
                    To IR
                  </button>
                )}
                <button type="button" className="small danger" disabled={busy}
                  onClick={() => setRemoving({ id: player.player_id, name: player.full_name })}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </Loaded>

      <PlayerSearch
        label={`Add a player to ${league.teamName(teamId)}`}
        action="Add"
        onPick={(player) =>
          run(
            () => call('commish_add_to_roster', {
              p_team_id: teamId, p_player_id: player.id, p_effective_at: effective, p_note: note,
            }),
            `${player.full_name} added to ${league.teamName(teamId)}.`,
          )
        }
      />

      {removing && (
        <Confirm title={`Remove ${removing.name}?`} confirmLabel="Remove" tone="hot" busy={busy}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const done = await run(
              () => call('commish_remove_from_roster', {
                p_player_id: removing.id, p_to_waivers: false, p_effective_at: effective, p_note: note,
              }),
              `${removing.name} removed.`,
            )
            if (done) setRemoving(null)
          }}>
          <p>He becomes a free agent straight away, with no waiver period.</p>
        </Confirm>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Point corrections
// ---------------------------------------------------------------------------

function PointFix() {
  const league = useLeague()
  const { run, busy } = useAction()
  const [teamId, setTeamId] = useState(league.teams[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [goals, setGoals] = useState('')
  const [reason, setReason] = useState('')

  const save = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await call('commish_adjust_points', {
        p_team_id: teamId,
        p_points: Number(amount || 0),
        p_goals: Number(goals || 0),
        p_reason: reason,
      })
      setAmount('')
      setGoals('')
      setReason('')
    }, 'Adjustment saved.')
  }

  return (
    <form className="card stack" onSubmit={save}>
      <p className="fine muted" style={{ margin: 0 }}>
        Adds to or takes away from a team's total. Use a minus sign to take points away. It's kept separate from
        game scoring, so it survives stat corrections.
      </p>
      <div>
        <label htmlFor="adjust-team">Team</label>
        <select id="adjust-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          {league.teams.map((team) => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>
      </div>
      <div className="field-grid two">
        <div>
          <label htmlFor="adjust-points">Points</label>
          <input id="adjust-points" type="number" step="0.1" inputMode="decimal" placeholder="-2.5"
            value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label htmlFor="adjust-goals">Goals (tiebreaker)</label>
          <input id="adjust-goals" type="number" step="1" inputMode="numeric" placeholder="0"
            value={goals} onChange={(e) => setGoals(e.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor="adjust-reason">Reason (shown in the activity feed)</label>
        <input id="adjust-reason" required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <button type="submit" className="ghost" disabled={busy || reason.trim() === '' || (!Number(amount) && !Number(goals))}>
        Save adjustment
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// ESPN player matching
// ---------------------------------------------------------------------------

function Matching() {
  const { run, busy } = useAction()
  const issues = useLive(fetchEspnIssues, [], ['player_injuries', 'espn_player_map'])
  const [fixing, setFixing] = useState<EspnIssue | null>(null)

  const link = (issue: EspnIssue, playerId: number | null, done: string) =>
    run(async () => {
      // The generated types don't know a link can be cleared with null.
      await call('commish_map_espn_player', { p_espn_athlete_id: issue.espn_athlete_id, p_player_id: playerId as number })
      await issues.refresh()
      setFixing(null)
    }, done)

  return (
    <Loaded live={issues}>
      {(list) => (
        <div className="card flush">
          <div className="card-head">
            <span>Injured players to match</span>
            <span className="tally">{list.length}</span>
          </div>
          <p className="fine muted" style={{ padding: '12px 16px', margin: 0, borderBottom: '1px solid var(--line)' }}>
            ESPN and the NHL use different player ids, so injuries are matched by name. These couldn't be matched
            with confidence. Most are minor-leaguers nobody will roster and can be left alone. Match anyone who's
            on a fantasy team or might be.
          </p>
          {list.length === 0 && <Empty title="All matched" />}
          {list.map((issue) => (
            <div key={issue.espn_athlete_id}>
              <div className="list-row" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="player-name">
                    {issue.espn_name}
                    <span className="tag out">{issue.status}</span>
                  </div>
                  <div className="fine muted">
                    ESPN: {issue.espn_position ?? '?'} · {issue.espn_team ?? '?'}.{' '}
                    {issue.matched_name
                      ? `Best guess: ${issue.matched_name} (${issue.matched_position}, ${issue.matched_team ?? 'no team'}).`
                      : 'No match found.'}
                  </div>
                </div>
                <div className="stack" style={{ gap: 6 }}>
                  {issue.player_id !== null && (
                    <button type="button" className="small quiet" disabled={busy}
                      onClick={() => link(issue, issue.player_id, 'Match confirmed.')}>
                      That's him
                    </button>
                  )}
                  <button type="button" className="small quiet" disabled={busy}
                    onClick={() => setFixing(fixing?.espn_athlete_id === issue.espn_athlete_id ? null : issue)}>
                    {fixing?.espn_athlete_id === issue.espn_athlete_id ? 'Close' : 'Find him'}
                  </button>
                </div>
              </div>
              {fixing?.espn_athlete_id === issue.espn_athlete_id && (
                <div style={{ padding: '0 16px 14px' }}>
                  <PlayerSearch
                    label={`Who is ${issue.espn_name}?`}
                    action="Match"
                    onPick={(player) => link(issue, player.id, `Matched to ${player.full_name}.`)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Loaded>
  )
}

// ---------------------------------------------------------------------------

export default function CommissionerPage() {
  const { isCommissioner } = useAuth()
  if (!isCommissioner) return <Navigate to="/" replace />

  return (
    <section>
      <h1>Commissioner</h1>
      <p className="muted">
        Everything you do here is recorded in the <Link to="/activity">activity feed</Link> for the whole league
        to see. To run the draft, go to the <Link to="/draft">draft room</Link>.
      </p>

      <Data />
      <Waiting />

      <h2>Fix a roster</h2>
      <RosterFix />

      <h2>Adjust a point total</h2>
      <PointFix />

      <h2>Injuries</h2>
      <Matching />
    </section>
  )
}
