import { LEAGUE } from '@shared/league.config.ts'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth.tsx'

const tabs = [
  { to: '/', label: 'Standings', end: true },
  { to: '/team', label: 'My team', end: false },
  { to: '/players', label: 'Players', end: false },
  { to: '/trades', label: 'Trades', end: false },
  { to: '/activity', label: 'Activity', end: false },
]

export default function Layout() {
  const { isCommissioner, signOut } = useAuth()

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">{LEAGUE.name}</span>
        <nav className="topbar-links">
          <NavLink to="/draft">Draft</NavLink>
          {isCommissioner && <NavLink to="/commissioner">Commish</NavLink>}
          <button type="button" className="link-button" onClick={signOut}>
            Sign out
          </button>
        </nav>
      </header>

      <main className="content">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Main">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
