import { LEAGUE } from '@shared/league.config.ts'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PauseIcon, PlayIcon, UndoIcon } from '../components/Icons.tsx'
import PlayerLine from '../components/PlayerLine.tsx'
import PlayerSheet from '../components/PlayerSheet.tsx'
import { Confirm } from '../components/Sheet.tsx'
import { Chips, Empty, ErrorNotice, Loaded, PositionTag, Spinner } from '../components/ui.tsx'
import { fetchDraft, fetchDraftBoard, fetchPlayers, PLAYERS_PAGE_SIZE } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { clock, GROUP_NAMES, points } from '../lib/format.ts'
import { useAction, useDebounced, useNow, useServerOffset } from '../lib/hooks.ts'
import { useLeague } from '../lib/league.tsx'
import { useLive } from '../lib/live.ts'
import { describeNeeds, GROUPS, picksUntil, roundOf, teamOnClock, totalPicks, type Needs } from '../lib/rules.ts'
import { call } from '../lib/supabase.ts'
import type { Draft, DraftPick, PoolPlayer, PositionGroup } from '../lib/types.ts'

type View = 'players' | 'board' | 'teams'

const TIMER_CHOICES: { seconds: number | null; label: string }[] = [
  { seconds: null, label: 'No timer' },
  { seconds: 30, label: '30 seconds' },
  { seconds: 60, label: '1 minute' },
  { seconds: 90, label: '90 seconds' },
  { seconds: 120, label: '2 minutes' },
  { seconds: 180, label: '3 minutes' },
  { seconds: 300, label: '5 minutes' },
]

function needsOf(picks: DraftPick[], teamId: string | null): Needs {
  const needs = { ...LEAGUE.roster } as Needs
  for (const pick of picks) {
    if (pick.team_id === teamId) needs[pick.position_group] = Math.max(0, needs[pick.position_group] - 1)
  }
  return needs
}

// ---------------------------------------------------------------------------
// The clock: who's up and how long they have
// ---------------------------------------------------------------------------

function DraftClock({ draft, board, secondsLeft }: { draft: Draft; board: DraftPick[]; secondsLeft: number | null }) {
  const league = useLeague()
  const order = draft.draft_order
  const onClock = teamOnClock(order, draft.current_pick)
  const mine = onClock !== null && onClock === league.myTeamId
  const myNeeds = describeNeeds(needsOf(board, league.myTeamId))
  const until = league.myTeamId ? picksUntil(order, draft.current_pick, league.myTeamId) : null
  const paused = draft.status === 'paused'

  return (
    <div className={mine && !paused ? 'clock mine' : 'clock'} aria-live="polite">
      <div className="row between">
        <div className="grow">
          <div className="label">
            Round {roundOf(draft.current_pick, order.length)} · Pick {draft.current_pick} of {totalPicks(order.length)}
          </div>
          <div className="who truncate">{mine ? 'Your pick' : league.teamName(onClock)}</div>
        </div>
        {paused ? (
          <span className="timer">Paused</span>
        ) : secondsLeft !== null ? (
          secondsLeft > 0 ? (
            <span className={secondsLeft <= 15 ? 'timer low' : 'timer'}>{clock(secondsLeft)}</span>
          ) : (
            <span className="label">Time's up. Picking…</span>
          )
        ) : null}
      </div>

      {league.myTeamId && (
        <div className="needs fine muted">
          {myNeeds ? <span>You still need {myNeeds}.</span> : <span>Your roster is full.</span>}
          {!mine && until !== null && until > 0 && (
            <span>
              You pick in {until} {until === 1 ? 'pick' : 'picks'}.
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Available players
// ---------------------------------------------------------------------------

function AvailablePlayers({ draft, board, canPickFor }: {
  draft: Draft | null
  board: DraftPick[]
  /** The team the viewer may pick for right now, if any. */
  canPickFor: string | null
}) {
  const league = useLeague()
  const { run, busy } = useAction()
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState<PositionGroup | null>(null)
  const [limit, setLimit] = useState(PLAYERS_PAGE_SIZE)
  const [open, setOpen] = useState<number | null>(null)
  const [choice, setChoice] = useState<PoolPlayer | null>(null)
  const term = useDebounced(search)

  const players = useLive(
    () => fetchPlayers({ search: term, group, availability: 'free_agent', sort: 'last_season', limit }),
    [term, group, limit],
    ['draft_picks', 'roster_entries', 'players', 'player_season_stats'],
  )

  const needs = needsOf(board, canPickFor)
  const pickingForOther = canPickFor !== null && canPickFor !== league.myTeamId

  const draftButton = (player: PoolPlayer, wide = false) => {
    if (!canPickFor) return null
    if (needs[player.position_group] === 0) return <span className="tag">{player.position_group} full</span>
    return (
      <button type="button" className={wide ? 'hot wide' : 'hot small'} onClick={() => setChoice(player)}>
        Draft
      </button>
    )
  }

  const confirmPick = async () => {
    if (!choice) return
    const done = await run(
      () => call('draft_pick', { p_player_id: choice.id }),
      `${choice.full_name} drafted.`,
    )
    if (done) {
      setChoice(null)
      setOpen(null)
      setSearch('')
    }
  }

  return (
    <>
      <div className="stack" style={{ marginBottom: 12 }}>
        <input
          type="search"
          placeholder="Search players"
          aria-label="Search players"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setLimit(PLAYERS_PAGE_SIZE)
          }}
        />
        <Chips
          label="Position"
          value={group}
          onChange={(next) => {
            setGroup(next)
            setLimit(PLAYERS_PAGE_SIZE)
          }}
          options={[
            { value: null, label: 'All' },
            { value: 'F', label: `Forwards${canPickFor ? ` (need ${needs.F})` : ''}` },
            { value: 'D', label: `Defense${canPickFor ? ` (need ${needs.D})` : ''}` },
            { value: 'G', label: `Goalies${canPickFor ? ` (need ${needs.G})` : ''}` },
          ]}
        />
        {pickingForOther && (
          <div className="notice warn">
            As commissioner you can pick for {league.teamName(canPickFor)}, who is on the clock.
          </div>
        )}
      </div>

      <Loaded live={players}>
        {(list) => (
          <div className="card flush">
            <div className="card-head">
              <span>Best available</span>
              <span>Last season</span>
            </div>
            {list.length === 0 && <Empty title="Nobody found">Try a different name or position.</Empty>}
            {list.map((player) => (
              <PlayerLine
                key={player.id}
                player={player}
                injury={{ status: player.injury_status, description: player.injury_description }}
                onOpen={() => setOpen(player.id)}
                right={
                  <>
                    <span className="stat-col">
                      <span className="points">{points(player.last_season_points)}</span>
                      <span className="points-label">{player.last_season_games} GP</span>
                    </span>
                    {draftButton(player)}
                  </>
                }
              />
            ))}
            {list.length >= limit && (
              <div style={{ padding: 12 }}>
                <button type="button" className="ghost wide" onClick={() => setLimit((n) => n + PLAYERS_PAGE_SIZE)}>
                  Show more
                </button>
              </div>
            )}
          </div>
        )}
      </Loaded>

      {open !== null && (
        <PlayerSheet
          playerId={open}
          onClose={() => setOpen(null)}
          actions={(player) =>
            draft?.status === 'complete' ? null : player.availability === 'free_agent' ? draftButton(player, true) : (
              <div className="notice">Already drafted.</div>
            )
          }
        />
      )}

      {choice && (
        <Confirm
          title={`Draft ${choice.full_name}?`}
          confirmLabel="Draft"
          tone="hot"
          busy={busy}
          onCancel={() => setChoice(null)}
          onConfirm={confirmPick}
        >
          <p>
            {choice.position} · {choice.nhl_team ?? 'No NHL team'} · {points(choice.last_season_points)} points last
            season.
            {choice.injury_status ? ` Listed as ${choice.injury_status}.` : ''}
          </p>
          {pickingForOther && <p>You're picking for {league.teamName(canPickFor)}.</p>}
        </Confirm>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// The board and the rosters
// ---------------------------------------------------------------------------

function Board({ draft, board }: { draft: Draft; board: DraftPick[] }) {
  const league = useLeague()
  const order = draft.draft_order
  const byNumber = new Map(board.map((pick) => [pick.pick_number, pick]))
  const rounds = Array.from({ length: LEAGUE.draft.rounds }, (_, i) => i + 1)
  const running = draft.status === 'in_progress' || draft.status === 'paused'

  return (
    <div className="board" style={{ ['--teams' as string]: order.length }}>
      <span />
      {order.map((teamId) => (
        <div key={teamId} className="head">
          {league.teamName(teamId)}
        </div>
      ))}

      {rounds.map((round) => (
        <div key={round} style={{ display: 'contents' }}>
          <div className="round">{round}</div>
          {order.map((teamId, column) => {
            // Even rounds run right to left.
            const position = round % 2 === 1 ? column + 1 : order.length - column
            const number = (round - 1) * order.length + position
            const pick = byNumber.get(number)

            if (!pick) {
              const onClock = running && number === draft.current_pick
              return (
                <div key={teamId} className={onClock ? 'cell empty-cell on-clock' : 'cell empty-cell'}>
                  <div className="num">{number}</div>
                  {onClock && <div className="name">On the clock</div>}
                </div>
              )
            }
            return (
              <div key={teamId} className={`cell pos-${pick.position_group}`}>
                <div className="num">
                  {number} · {pick.position}
                  {pick.is_auto_pick ? ' · auto' : ''}
                </div>
                <div className="name">{pick.full_name}</div>
                <div className="dim">{pick.nhl_team}</div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function Rosters({ draft, board }: { draft: Draft; board: DraftPick[] }) {
  const league = useLeague()

  return (
    <>
      {draft.draft_order.map((teamId) => {
        const picks = board.filter((pick) => pick.team_id === teamId)
        return (
          <div key={teamId} className="card flush">
            <div className="card-head">
              <span>
                {league.teamName(teamId)}
                {teamId === league.myTeamId && <span className="tag you" style={{ marginLeft: 8 }}>You</span>}
              </span>
              <span className="tally">
                {picks.length} / {LEAGUE.draft.rounds}
              </span>
            </div>
            {GROUPS.map((group) => {
              const mine = picks.filter((pick) => pick.position_group === group)
              const open = Math.max(0, LEAGUE.roster[group] - mine.length)
              return (
                <div key={group}>
                  {mine.map((pick) => (
                    <PlayerLine
                      key={pick.player_id}
                      player={pick}
                      right={<span className="fine dim nowrap">Pick {pick.pick_number}</span>}
                    />
                  ))}
                  {Array.from({ length: open }, (_, i) => (
                    <div key={i} className="slot-open">
                      <span className="row">
                        <PositionTag group={group} />
                        Open {GROUP_NAMES[group].toLowerCase().replace(/s$/, '')} spot
                      </span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// Before the draft: the order
// ---------------------------------------------------------------------------

function DraftOrder({ draft }: { draft: Draft | null }) {
  const league = useLeague()
  const { isCommissioner } = useAuth()
  const { run, busy } = useAction()
  const order = draft?.draft_order ?? []

  const move = (index: number, by: number) => {
    const next = [...order]
    const [team] = next.splice(index, 1)
    next.splice(index + by, 0, team)
    void run(() => call('draft_set_order', { p_order: next }))
  }

  if (order.length === 0) {
    return (
      <div className="card">
        <Empty title="No draft order yet">
          {isCommissioner
            ? 'Draw the order below. Everyone will see it here.'
            : 'The commissioner will draw the order before the draft.'}
        </Empty>
      </div>
    )
  }

  return (
    <div className="card flush">
      <div className="card-head">
        <span>Draft order</span>
        <span>Round 1</span>
      </div>
      <ol className="order">
        {order.map((teamId, index) => (
          <li key={teamId}>
            <span className="grow truncate">
              {league.teamName(teamId)}
              {teamId === league.myTeamId && <span className="tag you" style={{ marginLeft: 8 }}>You</span>}
            </span>
            {isCommissioner && (
              <span className="row" style={{ gap: 4 }}>
                <button
                  type="button" className="small quiet" aria-label={`Move ${league.teamName(teamId)} up`}
                  disabled={busy || index === 0} onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button" className="small quiet" aria-label={`Move ${league.teamName(teamId)} down`}
                  disabled={busy || index === order.length - 1} onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="fine muted" style={{ padding: '10px 16px', margin: 0, borderTop: '1px solid var(--line)' }}>
        It's a snake draft: round 2 runs in reverse, round 3 forwards again, and so on for {LEAGUE.draft.rounds}{' '}
        rounds. Everyone finishes with {LEAGUE.roster.F} forwards, {LEAGUE.roster.D} defense and {LEAGUE.roster.G}{' '}
        goalie.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Commissioner controls
// ---------------------------------------------------------------------------

function CommissionerControls({ draft, lastPick }: { draft: Draft | null; lastPick: DraftPick | undefined }) {
  const league = useLeague()
  const { run, busy } = useAction()
  const [asking, setAsking] = useState<'start' | 'undo' | 'reset' | null>(null)
  const status = draft?.status ?? 'not_started'
  const hasOrder = Boolean(draft?.draft_order.length)

  const confirmed = async (action: () => Promise<unknown>, success: string) => {
    if (await run(action, success)) setAsking(null)
  }

  return (
    <div className="card stack">
      <div className="eyebrow" style={{ margin: 0 }}>Commissioner</div>

      {/* What's needed mid-draft stays one tap away. */}
      <div className="row wrap">
        {status === 'not_started' && (
          <>
            <button type="button" className="ghost grow" disabled={busy}
              onClick={() => run(() => call('draft_randomize_order'), 'Draft order drawn.')}>
              {hasOrder ? 'Redraw order' : 'Draw the order'}
            </button>
            <button type="button" className="hot grow" disabled={busy || !hasOrder} onClick={() => setAsking('start')}>
              <PlayIcon width={18} height={18} /> Start
            </button>
          </>
        )}
        {status === 'in_progress' && (
          <button type="button" className="grow" disabled={busy}
            onClick={() => run(() => call('draft_pause'), 'Draft paused.')}>
            <PauseIcon width={18} height={18} /> Pause
          </button>
        )}
        {status === 'paused' && (
          <button type="button" className="hot grow" disabled={busy}
            onClick={() => run(() => call('draft_resume'), 'Draft resumed.')}>
            <PlayIcon width={18} height={18} /> Resume
          </button>
        )}
        {lastPick && (
          <button type="button" className="ghost grow" disabled={busy} onClick={() => setAsking('undo')}>
            <UndoIcon width={18} height={18} /> Undo pick {lastPick.pick_number}
          </button>
        )}
      </div>

      {draft && (
        <details>
          <summary className="muted fine" style={{ cursor: 'pointer', padding: '4px 0' }}>
            Timer and reset
          </summary>
          <div className="stack" style={{ marginTop: 10 }}>
            {status !== 'complete' && (
              <div>
                <label htmlFor="timer">Time per pick</label>
                <select
                  id="timer"
                  disabled={busy}
                  value={draft.pick_seconds ?? ''}
                  onChange={(e) => {
                    const seconds = e.target.value === '' ? null : Number(e.target.value)
                    // The generated types don't know the timer can be switched off with null.
                    void run(() => call('draft_set_timer', { p_seconds: seconds as number }), 'Timer updated.')
                  }}
                >
                  {TIMER_CHOICES.map((choice) => (
                    <option key={choice.label} value={choice.seconds ?? ''}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                <p className="fine muted" style={{ margin: '6px 0 0' }}>
                  When time runs out, the best available player who fits the roster is picked automatically.
                  {status === 'in_progress' && ' Changing this restarts the current clock.'}
                </p>
              </div>
            )}
            {status !== 'not_started' && (
              <button type="button" className="danger" disabled={busy} onClick={() => setAsking('reset')}>
                Reset the draft
              </button>
            )}
          </div>
        </details>
      )}

      {asking === 'start' && (
        <Confirm title="Start the draft?" confirmLabel="Start" tone="hot" busy={busy}
          onCancel={() => setAsking(null)}
          onConfirm={() => confirmed(() => call('draft_start'), 'The draft has started.')}>
          <p>
            {league.teamName(draft?.draft_order[0])} picks first
            {draft?.pick_seconds ? `, with ${clock(draft.pick_seconds)} on the clock` : ', with no timer'}. Make sure
            everyone is in the draft room.
          </p>
        </Confirm>
      )}
      {asking === 'undo' && lastPick && (
        <Confirm title="Undo the last pick?" confirmLabel="Undo" tone="hot" busy={busy}
          onCancel={() => setAsking(null)}
          onConfirm={() => confirmed(() => call('draft_undo_last_pick'), 'Pick undone.')}>
          <p>
            Pick {lastPick.pick_number}: {lastPick.team_name} took {lastPick.full_name}. He goes back in the pool
            and {lastPick.team_name} is on the clock again.
          </p>
        </Confirm>
      )}
      {asking === 'reset' && (
        <Confirm title="Reset the whole draft?" confirmLabel="Reset" tone="hot" busy={busy}
          onCancel={() => setAsking(null)}
          onConfirm={() => confirmed(() => call('draft_reset'), 'Draft reset.')}>
          <p>
            Every pick is erased and all rosters are emptied. The draft order is kept. Use this after a practice
            draft. It can't be undone.
          </p>
        </Confirm>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

export default function DraftPage() {
  const league = useLeague()
  const { isCommissioner } = useAuth()
  const [view, setView] = useState<View>('players')
  const offset = useServerOffset()
  const now = useNow(250)

  // Polled as well as live: a missed update here would stall the whole draft.
  const draftLive = useLive(fetchDraft, [], ['drafts', 'draft_picks'], { pollMs: 3000 })
  const boardLive = useLive(fetchDraftBoard, [], ['draft_picks', 'drafts'], { pollMs: 5000 })

  const draft = draftLive.data ?? null
  const board = useMemo(() => boardLive.data ?? [], [boardLive.data])
  const lastPick = board.at(-1)

  const running = draft?.status === 'in_progress'
  const onClock = draft && running ? teamOnClock(draft.draft_order, draft.current_pick) : null
  const myPick = onClock !== null && onClock === league.myTeamId
  const canPickFor = onClock !== null && (myPick || isCommissioner) ? onClock : null

  const secondsLeft =
    running && draft.pick_deadline ? (new Date(draft.pick_deadline).getTime() - (now + offset)) / 1000 : null

  // When the clock runs out, ask the database to make the pick. Every open
  // draft room does this, and the database makes sure only one pick happens.
  // This must not depend on the ticking countdown itself, or each tick would
  // cancel the request before it was sent.
  const expired = secondsLeft !== null && secondsLeft <= 0
  const currentPick = draft?.current_pick
  const refreshDraft = draftLive.refresh
  const refreshBoard = boardLive.refresh
  useEffect(() => {
    if (!expired) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>

    const attempt = async () => {
      try {
        await call('draft_auto_pick')
      } catch {
        // Offline, or the pick was refused. The refresh shows where things stand.
      }
      if (stopped) return
      await Promise.all([refreshDraft(), refreshBoard()])
      // Still here means the pick hasn't moved on yet (another room may be
      // making it, or this device's clock runs fast). Ask again shortly.
      if (!stopped) timer = setTimeout(attempt, 2000 + Math.random() * 1000)
    }

    // A short random wait so four phones don't all ask at the same instant.
    timer = setTimeout(attempt, 150 + Math.random() * 850)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [expired, currentPick, refreshDraft, refreshBoard])

  // Make it hard to miss your turn.
  useEffect(() => {
    if (!myPick) return
    const title = document.title
    document.title = 'Your pick!'
    navigator.vibrate?.([200, 100, 200])
    return () => {
      document.title = title
    }
  }, [myPick, draft?.current_pick])

  if (draftLive.data === undefined) {
    return draftLive.error ? <ErrorNotice message={draftLive.error} onRetry={draftLive.refresh} /> : <Spinner />
  }

  const started = draft !== null && draft.status !== 'not_started'

  return (
    <section>
      {draft && (draft.status === 'in_progress' || draft.status === 'paused') ? (
        <DraftClock draft={draft} board={board} secondsLeft={secondsLeft} />
      ) : (
        <h1>Draft room</h1>
      )}

      {draftLive.error && <ErrorNotice message={draftLive.error} onRetry={draftLive.refresh} />}

      {draft?.status === 'complete' && (
        <div className="notice good" style={{ marginBottom: 12 }}>
          The draft is complete. Free agency is open. <Link to="/team">See your team</Link>
        </div>
      )}
      {draft?.status === 'paused' && (
        <div className="notice warn" style={{ marginBottom: 12 }}>
          The commissioner paused the draft. The clock starts again when it resumes.
        </div>
      )}
      {!started && (
        <div className="notice" style={{ marginBottom: 12 }}>
          {isCommissioner
            ? 'When everyone is here, start the draft below.'
            : 'Waiting for the commissioner to start the draft. This page updates by itself.'}
        </div>
      )}

      {started && lastPick && draft?.status !== 'complete' && (
        <div className="announce" key={lastPick.pick_number}>
          <PositionTag group={lastPick.position_group} position={lastPick.position} />
          <span className="grow">
            Pick {lastPick.pick_number}: <strong>{lastPick.team_name}</strong> took{' '}
            <strong>{lastPick.full_name}</strong>
            {lastPick.is_auto_pick ? ' (auto-pick)' : ''}
          </span>
        </div>
      )}

      {!started && <DraftOrder draft={draft} />}
      {isCommissioner && <CommissionerControls draft={draft} lastPick={lastPick} />}

      <div className="tabs" role="tablist" aria-label="Draft views">
        {(
          [
            ['players', draft?.status === 'complete' ? 'Undrafted' : 'Players'],
            ['board', 'Board'],
            ['teams', 'Teams'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </div>

      {view === 'players' && <AvailablePlayers draft={draft} board={board} canPickFor={canPickFor} />}
      {view === 'board' &&
        (draft && draft.draft_order.length > 0 ? (
          <Board draft={draft} board={board} />
        ) : (
          <Empty title="No board yet">It appears once the draft order is drawn.</Empty>
        ))}
      {view === 'teams' &&
        (draft && draft.draft_order.length > 0 ? (
          <Rosters draft={draft} board={board} />
        ) : (
          <Empty title="No teams yet">They appear once the draft order is drawn.</Empty>
        ))}

    </section>
  )
}
