import { useState } from 'react'
import { GROUP_NOUN, points } from '../lib/format.ts'
import type { PositionGroup, RosterPlayer } from '../lib/types.ts'
import Sheet from './Sheet.tsx'
import { Avatar, InjuryTag } from './ui.tsx'

/** Asks which player to drop to make room at a position. */
export default function DropPicker({ title, explain, group, roster, confirmLabel, busy, onPick, onCancel }: {
  title: string
  explain: string
  group: PositionGroup
  roster: RosterPlayer[]
  confirmLabel: string
  busy: boolean
  onPick: (dropPlayerId: number) => void
  onCancel: () => void
}) {
  const candidates = roster.filter((player) => player.slot === 'active' && player.position_group === group)
  const [chosen, setChosen] = useState<number | null>(candidates.length === 1 ? candidates[0].player_id : null)

  return (
    <Sheet title={title} onClose={onCancel}>
      <h3>{title}</h3>
      <p className="muted">{explain}</p>

      <div className="card flush" role="radiogroup" aria-label={`Choose a ${GROUP_NOUN[group]} to drop`}>
        {candidates.map((player) => (
          <label key={player.player_id} className="pick-row" style={{ textTransform: 'none', letterSpacing: 0, margin: 0 }}>
            <input
              type="radio"
              name="drop"
              checked={chosen === player.player_id}
              onChange={() => setChosen(player.player_id)}
            />
            <Avatar name={player.full_name} src={player.headshot_url} />
            <span className="grow">
              <span className="player-name" style={{ color: 'var(--ice)' }}>
                <span className="truncate">{player.full_name}</span>
                <InjuryTag status={player.injury_status} />
                {player.is_ir_replacement && <span className="tag">Temp</span>}
              </span>
              <span className="player-meta">
                {player.position} · {player.nhl_team ?? 'No NHL team'} · {points(player.season_points)} pts
              </span>
            </span>
          </label>
        ))}
      </div>

      <div className="sheet-actions">
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" disabled={chosen === null || busy} onClick={() => chosen !== null && onPick(chosen)}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Sheet>
  )
}
