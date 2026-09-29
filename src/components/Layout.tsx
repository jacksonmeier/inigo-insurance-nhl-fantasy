import { LEAGUE } from '@shared/league.config.ts'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { fetchTodaysGames } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { isLive } from '../lib/format.ts'
import { useLeague } from '../lib/league.tsx'
import { useConnected, useLive } from '../lib/live.ts'
import { teamOnClock } from '../lib/rules.ts'
import { ActivityIcon, BellIcon, PlayersIcon, StandingsIcon, TeamIcon, TradesIcon, UserIcon, WhistleIcon } from './Icons.tsx'

const tabs = [
  { to: '/', label: 'Standings', end: true, Icon: StandingsIcon },
  { to: '/team', label: 'My team', end: false, Icon: TeamIcon },
  { to: '/players', label: 'Players', end: false, Icon: PlayersIcon },
  { to: '/trades', label: 'Trades', end: false, Icon: TradesIcon },
  { to: '/activity', label: 'Activity', end: false, Icon: ActivityIcon },
]

export default function Layout() {
  const { isCommissioner } = useAuth()
  const league = useLeague()
  const connected = useConnected()
  // Once the season is on, the spot the draft used goes to tonight's games.
  const games = useLive(fetchTodaysGames, [], ['games'], { paused: !league.seasonOpen })
  const liveNow = (games.data ?? []).some((game) => isLive(game.game_state))

  const draft = league.draft
  const drafting = draft?.status === 'in_progress' || draft?.status === 'paused'
  const myPick =
    draft?.status === 'in_progress' &&
    league.myTeamId !== null &&
    teamOnClock(draft.draft_order, draft.current_pick) === league.myTeamId

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <i className={connected ? 'lamp' : 'lamp off'} title={connected ? 'Live' : 'Reconnecting'} />
          <span>{LEAGUE.name}</span>
        </Link>

        {league.seasonOpen ? (
          <NavLink
            to="/tonight"
            className={({ isActive }) => `topbar-link ${isActive ? 'active' : ''}`}
            aria-label={liveNow ? 'Tonight, games live now' : 'Tonight'}
          >
            {liveNow && <i className="live-dot" />}
            Tonight
          </NavLink>
        ) : (
          <NavLink to="/draft" className={({ isActive }) => `topbar-link ${myPick ? 'urgent' : isActive ? 'active' : ''}`}>
            {myPick ? 'Your pick' : draft?.status === 'paused' ? 'Draft: paused' : drafting ? 'Draft: live' : 'Draft'}
          </NavLink>
        )}
        {isCommissioner && (
          <NavLink to="/commissioner" className="icon-button button ghost" style={{ border: 0 }} aria-label="Commissioner tools">
            <WhistleIcon />
          </NavLink>
        )}
        <NavLink to="/alerts" className="icon-button button ghost" style={{ border: 0 }} aria-label={`Alerts, ${league.unreadAlerts} unread`}>
          <BellIcon />
          {league.unreadAlerts > 0 && <span className="count">{league.unreadAlerts}</span>}
        </NavLink>
        <NavLink to="/account" className="icon-button button ghost" style={{ border: 0 }} aria-label="Account">
          <UserIcon />
        </NavLink>
      </header>

      {!connected && league.ready && (
        <p className="offline" role="status">
          Reconnecting to live updates…
        </p>
      )}

      <main className="content">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Main">
        {tabs.map(({ to, label, end, Icon }) => (
          <NavLink key={to} to={to} end={end}>
            <Icon />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
