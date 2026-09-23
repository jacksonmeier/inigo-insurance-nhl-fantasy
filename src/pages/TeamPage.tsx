import { LEAGUE } from '@shared/league.config.ts'
import { useParams } from 'react-router-dom'
import ComingSoon from '../components/ComingSoon.tsx'
import { useAuth } from '../lib/auth.tsx'

export default function TeamPage() {
  const { teamId } = useParams()
  const { team } = useAuth()
  const isMine = !teamId || teamId === team?.id

  return (
    <ComingSoon title={isMine ? (team?.name ?? 'My team') : 'Team'} phase={8}>
      <p>
        Roster: {LEAGUE.roster.F} F, {LEAGUE.roster.D} D, {LEAGUE.roster.G} G, plus {LEAGUE.irSlots} IR
        slot.
      </p>
    </ComingSoon>
  )
}
