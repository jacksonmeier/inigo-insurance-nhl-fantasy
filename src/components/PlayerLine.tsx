import type { ReactNode } from 'react'
import type { PlayerBasics } from '../lib/types.ts'
import { Avatar, InjuryTag, PositionTag } from './ui.tsx'

type Props = {
  player: PlayerBasics & { sweater_number?: number | null }
  injury?: { status: string | null; description?: string | null }
  /** Extra tags after the name, e.g. "Temp" for an IR replacement. */
  tags?: ReactNode
  /** The second line. Defaults to position, team and number. */
  meta?: ReactNode
  /** An optional third line, e.g. tonight's stats. */
  detail?: ReactNode
  /** Points, a button, or both. */
  right?: ReactNode
  /** Opens the player's details. */
  onOpen?: () => void
}

/** One player in a list: face, name, a line of detail, and something on the right. */
export default function PlayerLine({ player, injury, tags, meta, detail, right, onOpen }: Props) {
  const details = (
    <>
      <Avatar name={player.full_name} src={player.headshot_url} />
      <span className="grow">
        <span className="player-name">
          <span className="truncate">{player.full_name}</span>
          <InjuryTag status={injury?.status} title={injury?.description} />
          {tags}
        </span>
        <span className="player-meta">
          <PositionTag group={player.position_group} position={player.position} />
          <span>{player.nhl_team ?? 'No NHL team'}</span>
          {player.sweater_number != null && <span className="dim">#{player.sweater_number}</span>}
          {meta}
        </span>
        {detail && <span className="player-detail">{detail}</span>}
      </span>
    </>
  )

  return (
    <div className="list-row">
      {onOpen ? (
        <button
          type="button"
          className="list-row grow"
          style={{ padding: 0, minHeight: 0, border: 0 }}
          onClick={onOpen}
          aria-label={`${player.full_name} details`}
        >
          {details}
        </button>
      ) : (
        <span className="row grow" style={{ gap: 12 }}>{details}</span>
      )}
      {right}
    </div>
  )
}
