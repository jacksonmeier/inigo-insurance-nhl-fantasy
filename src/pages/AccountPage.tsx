import { LEAGUE } from '@shared/league.config.ts'
import { SCORING } from '@shared/scoring.config.ts'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { renameTeam } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useAction } from '../lib/hooks.ts'
import { friendlyMessage, supabase } from '../lib/supabase.ts'

const signedValue = (value: number) => (value > 0 ? `+${value}` : `${value}`)

const SKATER_RULES: [string, number][] = [
  ['Goal', SCORING.skater.goal],
  ['Assist', SCORING.skater.assist],
  ['Power play point (bonus)', SCORING.skater.powerPlayPoint],
  ['Shorthanded point (bonus)', SCORING.skater.shorthandedPoint],
  ['Shot on goal', SCORING.skater.shotOnGoal],
  ['Hit', SCORING.skater.hit],
  ['Blocked shot', SCORING.skater.blockedShot],
]

const GOALIE_RULES: [string, number][] = [
  ['Win', SCORING.goalie.win],
  ['Save', SCORING.goalie.save],
  ['Goal against', SCORING.goalie.goalAgainst],
  ['Shutout', SCORING.goalie.shutout],
]

function TeamName() {
  const { team, reloadTeam } = useAuth()
  const { run, busy } = useAction()
  const [name, setName] = useState(team?.name ?? '')

  if (!team) return null

  const save = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await renameTeam(team.id, name.trim())
      await reloadTeam()
    }, 'Team renamed.')
  }

  return (
    <form className="card stack" onSubmit={save}>
      <div>
        <label htmlFor="team-name">Team name</label>
        <input id="team-name" value={name} maxLength={40} required onChange={(e) => setName(e.target.value)} />
      </div>
      <button type="submit" className="ghost" disabled={busy || name.trim() === team.name || name.trim() === ''}>
        Save name
      </button>
    </form>
  )
}

function Password() {
  const { run, busy } = useAction()
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const mismatch = again !== '' && password !== again

  const save = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw new Error(friendlyMessage(error.message))
      setPassword('')
      setAgain('')
    }, 'Password changed.')
  }

  return (
    <form className="card stack" onSubmit={save}>
      <div>
        <label htmlFor="new-password">New password</label>
        <input id="new-password" type="password" autoComplete="new-password" minLength={6} required
          value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div>
        <label htmlFor="new-password-again">And again</label>
        <input id="new-password-again" type="password" autoComplete="new-password" minLength={6} required
          value={again} onChange={(e) => setAgain(e.target.value)} />
      </div>
      {mismatch && <div className="notice warn">Those don't match yet.</div>}
      <button type="submit" className="ghost" disabled={busy || mismatch || password.length < 6}>
        Change password
      </button>
    </form>
  )
}

function Rules({ title, rules }: { title: string; rules: [string, number][] }) {
  return (
    <div className="card flush">
      <div className="card-head">
        <span>{title}</span>
        <span>Points</span>
      </div>
      {rules.map(([stat, value]) => (
        <div key={stat} className="list-row" style={{ minHeight: 44 }}>
          <span className="grow">{stat}</span>
          <span className={value < 0 ? 'points down' : 'points'}>{signedValue(value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function AccountPage() {
  const { session, isCommissioner, signOut } = useAuth()

  return (
    <section>
      <h1>Account</h1>
      <p className="muted">
        Signed in as <strong style={{ color: 'var(--ice)' }}>{session?.user.email}</strong>
        {isCommissioner ? ', the commissioner.' : '.'}
      </p>

      <TeamName />
      <Password />

      <div className="stack" style={{ marginBottom: 12 }}>
        <Link to="/draft" className="button ghost">Draft room and results</Link>
        <button type="button" className="danger" onClick={signOut}>
          Sign out
        </button>
      </div>

      <h2>How scoring works</h2>
      <Rules title="Skaters" rules={SKATER_RULES} />
      <Rules title="Goalies" rules={GOALIE_RULES} />
      <p className="fine muted">
        Rosters are {LEAGUE.roster.F} forwards, {LEAGUE.roster.D} defense and {LEAGUE.roster.G} goalie, plus{' '}
        {LEAGUE.irSlots} IR slot. Everyone on the active roster scores, regular season only. A player's points go to
        the team that had him when the puck dropped. Dropped players sit on waivers for{' '}
        {LEAGUE.windows.waiverHours} hours; accepted trades wait {LEAGUE.windows.tradeVetoHours} hours for a veto.
      </p>
    </section>
  )
}
