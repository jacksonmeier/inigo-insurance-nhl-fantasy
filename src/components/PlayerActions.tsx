// The moves an owner can make with a player, given where he is right now:
// add, claim, drop, move to IR, bring back from IR. Each asks first.

import { LEAGUE } from '@shared/league.config.ts'
import { useState } from 'react'
import { GROUP_NOUN, timeLeft } from '../lib/format.ts'
import { useAction, useNow } from '../lib/hooks.ts'
import { useLeague } from '../lib/league.tsx'
import { hasOpenIrSlot, openSlots } from '../lib/rules.ts'
import { call } from '../lib/supabase.ts'
import type { PositionGroup } from '../lib/types.ts'
import DropPicker from './DropPicker.tsx'
import { Confirm } from './Sheet.tsx'

export type ActionPlayer = {
  id: number
  full_name: string
  position_group: PositionGroup
  fantasy_team_id: string | null
  roster_slot: 'active' | 'ir' | null
  is_ir_replacement: boolean
  waiver_id: string | null
  waiver_expires_at: string | null
  is_ir_eligible: boolean
}

type Step = 'add' | 'add-drop' | 'claim' | 'claim-drop' | 'drop' | 'ir' | 'activate' | 'keep' | 'withdraw' | null

export default function PlayerActions({ player, compact, onDone }: {
  player: ActionPlayer
  /** One small button, for a list row. */
  compact?: boolean
  onDone?: () => void
}) {
  const league = useLeague()
  const { run, busy } = useAction()
  const [step, setStep] = useState<Step>(null)
  const now = useNow(30_000)

  if (!league.myTeamId || !league.seasonOpen) return null

  const name = player.full_name
  const group = player.position_group
  const mine = player.fantasy_team_id === league.myTeamId
  const open = openSlots(league.myRoster)[group]
  const size = compact ? 'small' : 'wide'

  const stint = league.irStints.find((s) => s.team_id === league.myTeamId && s.ir_player_id === player.id)
  // An open slot that exists only because a player is on IR makes the next
  // add his temporary replacement.
  const covering = league.irStints.filter(
    (s) => s.team_id === league.myTeamId && s.position_group === group && s.replacement_player_id === null,
  )
  const asReplacementFor = open > 0 && open <= covering.length ? covering[0] : null

  const claim = league.myClaims.find((c) => c.waiver_id === player.waiver_id)
  const hours = LEAGUE.windows.waiverHours

  const finish = async (action: () => Promise<unknown>, success: string) => {
    if (await run(action, success)) {
      setStep(null)
      onDone?.()
    }
  }

  const close = () => setStep(null)

  let buttons = null

  if (mine && player.roster_slot === 'ir') {
    // Activating is the main thing to do once he's healthy. Before that it's
    // there, but it isn't what the owner is here for.
    const healthy = Boolean(stint?.decision_deadline) || stint?.still_out === false
    buttons = (
      <>
        <button type="button" className={healthy ? size : `ghost ${size}`} onClick={() => setStep('activate')}>
          Activate
        </button>
        {!compact && stint?.replacement_player_id != null && (
          <button type="button" className={`ghost ${size}`} onClick={() => setStep('keep')}>
            Keep {stint.replacement_player_name}
          </button>
        )}
        {!compact && (
          <button type="button" className={`danger ${size}`} onClick={() => setStep('drop')}>
            Drop
          </button>
        )}
      </>
    )
  } else if (mine) {
    const canIr = player.is_ir_eligible && !player.is_ir_replacement && hasOpenIrSlot(league.myRoster)
    buttons = (
      <>
        {canIr && (
          <button type="button" className={compact ? 'small hot' : 'wide'} onClick={() => setStep('ir')}>
            Move to IR
          </button>
        )}
        {(!compact || !canIr) && (
          <button type="button" className={`danger ${size}`} onClick={() => setStep('drop')}>
            Drop
          </button>
        )}
      </>
    )
  } else if (player.fantasy_team_id) {
    return null
  } else if (player.waiver_id) {
    buttons = claim ? (
      <button type="button" className={`ghost ${size}`} onClick={() => setStep('withdraw')}>
        {compact ? 'Claimed' : 'Withdraw claim'}
      </button>
    ) : (
      <button type="button" className={`quiet ${size}`} onClick={() => setStep(open > 0 ? 'claim' : 'claim-drop')}>
        Claim
      </button>
    )
  } else {
    buttons = (
      <button type="button" className={size} onClick={() => setStep(open > 0 ? 'add' : 'add-drop')}>
        Add
      </button>
    )
  }

  const windowCloses = player.waiver_expires_at ? timeLeft(player.waiver_expires_at, now) : null

  return (
    <>
      {compact ? buttons : <div className="stack">{buttons}</div>}

      {step === 'add' && (
        <Confirm
          title={`Add ${name}?`}
          confirmLabel="Add"
          busy={busy}
          onCancel={close}
          onConfirm={() => finish(() => call('add_player', { p_player_id: player.id }), `${name} is on your team.`)}
        >
          {asReplacementFor ? (
            <p>
              He'll fill in for {asReplacementFor.ir_player_name} while he's on IR. When{' '}
              {asReplacementFor.ir_player_name} comes back you choose which of them to keep.
            </p>
          ) : (
            <p>He takes your open {GROUP_NOUN[group]} spot and starts scoring from his next game.</p>
          )}
        </Confirm>
      )}

      {step === 'add-drop' && (
        <DropPicker
          title={`Add ${name}`}
          explain={`Your ${GROUP_NOUN[group]} spots are full. Choose who to drop. He'll go on waivers for ${hours} hours.`}
          group={group}
          roster={league.myRoster}
          confirmLabel="Add and drop"
          busy={busy}
          onCancel={close}
          onPick={(dropId) =>
            finish(
              () => call('add_player', { p_player_id: player.id, p_drop_player_id: dropId }),
              `${name} is on your team.`,
            )
          }
        />
      )}

      {step === 'claim' && (
        <Confirm
          title={`Claim ${name}?`}
          confirmLabel="Place claim"
          busy={busy}
          onCancel={close}
          onConfirm={() => finish(() => call('claim_waiver', { p_player_id: player.id }), 'Claim placed.')}
        >
          <p>
            The waiver window closes in {windowCloses}. If more than one owner claims him, he goes to whoever is
            lowest in the standings.
          </p>
        </Confirm>
      )}

      {step === 'claim-drop' && (
        <DropPicker
          title={`Claim ${name}`}
          explain={`The window closes in ${windowCloses}. Choose who to drop if your claim wins. Nothing changes until then.`}
          group={group}
          roster={league.myRoster}
          confirmLabel="Place claim"
          busy={busy}
          onCancel={close}
          onPick={(dropId) =>
            finish(() => call('claim_waiver', { p_player_id: player.id, p_drop_player_id: dropId }), 'Claim placed.')
          }
        />
      )}

      {step === 'withdraw' && (
        <Confirm
          title={`Withdraw your claim on ${name}?`}
          confirmLabel="Withdraw"
          busy={busy}
          onCancel={close}
          onConfirm={() =>
            finish(() => call('withdraw_waiver_claim', { p_player_id: player.id }), 'Claim withdrawn.')
          }
        />
      )}

      {step === 'drop' && (
        <Confirm
          title={`Drop ${name}?`}
          confirmLabel="Drop"
          tone="hot"
          busy={busy}
          onCancel={close}
          onConfirm={() => finish(() => call('drop_player', { p_player_id: player.id }), `${name} was dropped.`)}
        >
          <p>
            He goes on waivers for {hours} hours, where any owner can claim him.
            {stint?.replacement_player_id != null && ` ${stint.replacement_player_name} stays on your team for good.`}
            {player.is_ir_replacement && ' You can add another replacement afterwards.'}
          </p>
        </Confirm>
      )}

      {step === 'ir' && (
        <Confirm
          title={`Move ${name} to IR?`}
          confirmLabel="Move to IR"
          busy={busy}
          onCancel={close}
          onConfirm={() => finish(() => call('place_on_ir', { p_player_id: player.id }), `${name} is on IR.`)}
        >
          <p>
            He earns no points on IR. His spot opens up for a temporary replacement: add any free agent{' '}
            {GROUP_NOUN[group]}.
          </p>
        </Confirm>
      )}

      {step === 'activate' && (
        <Confirm
          title={`Activate ${name}?`}
          confirmLabel="Activate"
          busy={busy}
          onCancel={close}
          onConfirm={() =>
            finish(() => call('activate_from_ir', { p_player_id: player.id }), `${name} is back on your roster.`)
          }
        >
          <p>
            {stint?.replacement_player_id != null
              ? `${stint.replacement_player_name} will be released to free agency.`
              : 'He goes back into his open spot.'}
            {stint?.still_out && ' ESPN still lists him as out, so he may not play yet.'}
          </p>
        </Confirm>
      )}

      {step === 'keep' && stint && (
        <Confirm
          title={`Keep ${stint.replacement_player_name}?`}
          confirmLabel="Keep him"
          busy={busy}
          onCancel={close}
          onConfirm={() =>
            finish(
              () => call('keep_ir_replacement', { p_player_id: player.id }),
              `${stint.replacement_player_name} is yours for good.`,
            )
          }
        >
          <p>
            {name} will be dropped and goes on waivers for {hours} hours.
          </p>
        </Confirm>
      )}
    </>
  )
}
