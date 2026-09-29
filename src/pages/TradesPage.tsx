import { LEAGUE } from '@shared/league.config.ts'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Confirm } from '../components/Sheet.tsx'
import Sheet from '../components/Sheet.tsx'
import { Avatar, Empty, InjuryTag, Loaded, PositionTag } from '../components/ui.tsx'
import { fetchAllRosters, fetchTrades } from '../lib/api.ts'
import { formatDateTime, points, timeAgo, timeLeft } from '../lib/format.ts'
import { useAction, useNow } from '../lib/hooks.ts'
import { useLeague } from '../lib/league.tsx'
import { useLive } from '../lib/live.ts'
import { tradeProblem } from '../lib/rules.ts'
import { call } from '../lib/supabase.ts'
import type { RosterPlayer, Trade } from '../lib/types.ts'

const TRADE_TABLES = ['trades', 'trade_players', 'trade_vetoes']

// ---------------------------------------------------------------------------
// Proposing a trade
// ---------------------------------------------------------------------------

function PlayerChecklist({ title, players, chosen, onToggle }: {
  title: string
  players: RosterPlayer[]
  chosen: Set<number>
  onToggle: (playerId: number) => void
}) {
  return (
    <div className="card flush">
      <div className="card-head">
        <span>{title}</span>
        <span className="tally">{players.filter((p) => chosen.has(p.player_id)).length} chosen</span>
      </div>
      {players.length === 0 && <p className="muted fine" style={{ padding: '12px 16px', margin: 0 }}>No players to trade.</p>}
      {players.map((player) => {
        // A roster spot that isn't permanent can't change hands.
        const locked = player.slot === 'ir' ? 'On IR' : player.is_ir_replacement ? 'Temporary' : null
        return (
          <label key={player.player_id} className="pick-row" style={{ textTransform: 'none', letterSpacing: 0, margin: 0, opacity: locked ? 0.5 : 1 }}>
            <input
              type="checkbox"
              disabled={locked !== null}
              checked={chosen.has(player.player_id)}
              onChange={() => onToggle(player.player_id)}
            />
            <Avatar name={player.full_name} src={player.headshot_url} />
            <span className="grow">
              <span className="player-name" style={{ color: 'var(--ice)' }}>
                <span className="truncate">{player.full_name}</span>
                <InjuryTag status={player.injury_status} />
                {locked && <span className="tag">{locked}</span>}
              </span>
              <span className="player-meta">
                <PositionTag group={player.position_group} position={player.position} />
                {player.nhl_team} · {points(player.season_points)} pts
              </span>
            </span>
          </label>
        )
      })}
    </div>
  )
}

function TradeBuilder({ initialTeam, rosters, onClose }: {
  initialTeam: string | null
  rosters: RosterPlayer[]
  onClose: () => void
}) {
  const league = useLeague()
  const { run, busy } = useAction()
  const others = league.teams.filter((team) => team.id !== league.myTeamId)

  const [partner, setPartner] = useState(
    initialTeam && others.some((team) => team.id === initialTeam) ? initialTeam : (others[0]?.id ?? ''),
  )
  const [give, setGive] = useState<Set<number>>(new Set())
  const [receive, setReceive] = useState<Set<number>>(new Set())
  const [message, setMessage] = useState('')

  const byGroup = (a: RosterPlayer, b: RosterPlayer) =>
    'FDG'.indexOf(a.position_group) - 'FDG'.indexOf(b.position_group) || a.full_name.localeCompare(b.full_name)
  const mine = rosters.filter((p) => p.team_id === league.myTeamId).sort(byGroup)
  const theirs = rosters.filter((p) => p.team_id === partner).sort(byGroup)

  const toggle = (set: Set<number>, update: (next: Set<number>) => void) => (playerId: number) => {
    const next = new Set(set)
    if (!next.delete(playerId)) next.add(playerId)
    update(next)
  }

  const giving = mine.filter((p) => give.has(p.player_id))
  const receiving = theirs.filter((p) => receive.has(p.player_id))
  const problem = tradeProblem(
    { name: league.teamName(league.myTeamId), roster: mine },
    { name: league.teamName(partner), roster: theirs },
    giving,
    receiving,
  )

  const propose = async () => {
    const sent = await run(
      () =>
        call('propose_trade', {
          p_receiving_team_id: partner,
          p_give_player_ids: [...give],
          p_receive_player_ids: [...receive],
          p_message: message,
        }),
      `Offer sent to ${league.teamName(partner)}.`,
    )
    if (sent) onClose()
  }

  return (
    <Sheet title="Propose a trade" onClose={onClose}>
      <h3>Propose a trade</h3>
      <p className="muted fine">
        Both rosters have to stay within {LEAGUE.roster.F} F, {LEAGUE.roster.D} D and {LEAGUE.roster.G} G, so trade
        like for like. Once accepted, the other owners have {LEAGUE.windows.tradeVetoHours} hours to veto.
      </p>

      <div className="stack">
        <div>
          <label htmlFor="partner">Trade with</label>
          <select
            id="partner"
            value={partner}
            onChange={(e) => {
              setPartner(e.target.value)
              setReceive(new Set())
            }}
          >
            {others.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>

        <PlayerChecklist title="You give" players={mine} chosen={give} onToggle={toggle(give, setGive)} />
        <PlayerChecklist
          title={`You get from ${league.teamName(partner)}`}
          players={theirs}
          chosen={receive}
          onToggle={toggle(receive, setReceive)}
        />

        <div>
          <label htmlFor="message">Message (optional)</label>
          <input id="message" value={message} maxLength={200} onChange={(e) => setMessage(e.target.value)} />
        </div>

        {problem && give.size + receive.size > 0 && <div className="notice warn">{problem}</div>}
      </div>

      <div className="sheet-actions">
        <button type="button" className="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" disabled={busy || problem !== null} onClick={propose}>
          {busy ? 'Sending…' : 'Send offer'}
        </button>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// One trade
// ---------------------------------------------------------------------------

function statusLine(trade: Trade, now: number, teamName: (id: string | null) => string) {
  switch (trade.status) {
    case 'proposed':
      return `Waiting for ${trade.receiving_team_name} to answer. Offered ${timeAgo(trade.created_at, now)}.`
    case 'accepted':
      return trade.veto_deadline && new Date(trade.veto_deadline).getTime() > now
        ? `Agreed. Goes through in ${timeLeft(trade.veto_deadline, now)} unless another owner vetoes.`
        : 'Agreed. The veto window has closed, so it goes through at the next check (every 15 minutes).'
    case 'completed':
      return `Completed ${formatDateTime(trade.processed_at ?? trade.created_at)}.`
    case 'rejected':
      return `${trade.receiving_team_name} said no.`
    case 'withdrawn':
      return `${trade.proposing_team_name} withdrew the offer.`
    case 'vetoed':
      return trade.vetoed_by_team_id ? `Vetoed by ${teamName(trade.vetoed_by_team_id)}.` : 'Cancelled by the commissioner.'
    case 'failed':
      return 'Cancelled: a roster changed and the trade no longer worked.'
  }
}

function TradeCard({ trade }: { trade: Trade }) {
  const league = useLeague()
  const { run, busy } = useAction()
  const now = useNow(30_000)
  const [asking, setAsking] = useState<'accept' | 'reject' | 'withdraw' | 'veto' | null>(null)

  const me = league.myTeamId
  const involved = me === trade.proposing_team_id || me === trade.receiving_team_id
  const open = trade.status === 'proposed' || trade.status === 'accepted'
  const vetoOpen =
    trade.status === 'accepted' && trade.veto_deadline !== null && new Date(trade.veto_deadline).getTime() > now

  const side = (teamId: string, teamName: string) => {
    // A team gets the players that come from the other team.
    const players = trade.players.filter((player) => player.from_team_id !== teamId)
    return (
      <div className="swap-side">
        <div className="who">{teamName}{teamId === me ? ' (you)' : ''} gets</div>
        <ul>
          {players.length === 0 && <li className="muted">Nothing</li>}
          {players.map((player) => (
            <li key={player.player_id}>
              <PositionTag group={player.position_group} position={player.position} />
              <span className="truncate">{player.full_name}</span>
              <span className="dim fine">{player.nhl_team}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const confirmed = async (action: () => Promise<unknown>, success: string) => {
    if (await run(action, success)) setAsking(null)
  }

  return (
    <div className="card stack" style={{ opacity: open ? 1 : 0.75 }}>
      <div className="swap">
        {side(trade.proposing_team_id, trade.proposing_team_name)}
        {side(trade.receiving_team_id, trade.receiving_team_name)}
      </div>

      {trade.message && <p className="fine" style={{ margin: 0 }}>“{trade.message}”</p>}
      <p className="fine muted" style={{ margin: 0 }}>{statusLine(trade, now, league.teamName)}</p>

      {trade.status === 'proposed' && me === trade.receiving_team_id && (
        <div className="row">
          <button type="button" className="ghost grow" disabled={busy} onClick={() => setAsking('reject')}>
            Reject
          </button>
          <button type="button" className="grow" disabled={busy} onClick={() => setAsking('accept')}>
            Accept
          </button>
        </div>
      )}
      {trade.status === 'proposed' && me === trade.proposing_team_id && (
        <button type="button" className="ghost" disabled={busy} onClick={() => setAsking('withdraw')}>
          Withdraw offer
        </button>
      )}
      {vetoOpen && me !== null && !involved && (
        <button type="button" className="danger" disabled={busy} onClick={() => setAsking('veto')}>
          Veto this trade
        </button>
      )}

      {asking === 'accept' && (
        <Confirm title="Accept this trade?" confirmLabel="Accept" busy={busy}
          onCancel={() => setAsking(null)}
          onConfirm={() => confirmed(() => call('respond_to_trade', { p_trade_id: trade.id, p_accept: true }), 'Trade accepted.')}>
          <p>
            The players move in {LEAGUE.windows.tradeVetoHours} hours, unless one of the other owners vetoes it
            before then.
          </p>
        </Confirm>
      )}
      {asking === 'reject' && (
        <Confirm title="Reject this offer?" confirmLabel="Reject" tone="hot" busy={busy}
          onCancel={() => setAsking(null)}
          onConfirm={() => confirmed(() => call('respond_to_trade', { p_trade_id: trade.id, p_accept: false }), 'Offer rejected.')} />
      )}
      {asking === 'withdraw' && (
        <Confirm title="Withdraw your offer?" confirmLabel="Withdraw" busy={busy}
          onCancel={() => setAsking(null)}
          onConfirm={() => confirmed(() => call('withdraw_trade', { p_trade_id: trade.id }), 'Offer withdrawn.')} />
      )}
      {asking === 'veto' && (
        <Confirm title="Veto this trade?" confirmLabel="Veto" tone="hot" busy={busy}
          onCancel={() => setAsking(null)}
          onConfirm={() => confirmed(() => call('veto_trade', { p_trade_id: trade.id }), 'Trade vetoed.')}>
          <p>
            One veto cancels the trade for good, and everyone will see that it was you. Save it for a trade that's
            unfair to the league.
          </p>
        </Confirm>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

export default function TradesPage() {
  const league = useLeague()
  const [params, setParams] = useSearchParams()
  const withTeam = params.get('with')
  const [building, setBuilding] = useState(withTeam !== null)

  const trades = useLive(() => fetchTrades(), [], TRADE_TABLES)
  const rosters = useLive(fetchAllRosters, [], ['roster_entries', 'player_injuries'], { paused: !building })

  const groups = useMemo(() => {
    const all = trades.data ?? []
    const me = league.myTeamId
    return {
      answer: all.filter((t) => t.status === 'proposed' && t.receiving_team_id === me),
      sent: all.filter((t) => t.status === 'proposed' && t.receiving_team_id !== me),
      pending: all.filter((t) => t.status === 'accepted'),
      done: all.filter((t) => t.status !== 'proposed' && t.status !== 'accepted'),
    }
  }, [trades.data, league.myTeamId])

  const closeBuilder = () => {
    setBuilding(false)
    if (withTeam) setParams({}, { replace: true })
  }

  return (
    <section>
      <h1>Trades</h1>

      {!league.seasonOpen ? (
        <div className="notice" style={{ marginBottom: 12 }}>Trading opens when the draft is complete.</div>
      ) : (
        league.myTeamId && (
          <button type="button" className="wide" style={{ marginBottom: 14 }} onClick={() => setBuilding(true)}>
            Propose a trade
          </button>
        )
      )}

      <Loaded live={trades}>
        {() => (
          <>
            {groups.answer.length > 0 && (
              <>
                <h2>Needs your answer</h2>
                {groups.answer.map((trade) => <TradeCard key={trade.id} trade={trade} />)}
              </>
            )}
            {groups.pending.length > 0 && (
              <>
                <h2>In the veto window</h2>
                {groups.pending.map((trade) => <TradeCard key={trade.id} trade={trade} />)}
              </>
            )}
            {groups.sent.length > 0 && (
              <>
                <h2>Waiting for an answer</h2>
                {groups.sent.map((trade) => <TradeCard key={trade.id} trade={trade} />)}
              </>
            )}
            {groups.done.length > 0 && (
              <>
                <h2>Earlier</h2>
                {groups.done.map((trade) => <TradeCard key={trade.id} trade={trade} />)}
              </>
            )}
            {(trades.data ?? []).length === 0 && (
              <div className="card">
                <Empty title="No trades yet">Offers, answers and vetoes all show up here.</Empty>
              </div>
            )}
          </>
        )}
      </Loaded>

      {building &&
        (rosters.data ? (
          <TradeBuilder initialTeam={withTeam} rosters={rosters.data} onClose={closeBuilder} />
        ) : (
          <Sheet title="Propose a trade" onClose={closeBuilder}>
            <Loaded live={rosters}>{() => null}</Loaded>
          </Sheet>
        ))}
    </section>
  )
}
