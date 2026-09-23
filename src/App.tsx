import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import Layout from './components/Layout.tsx'
import { useAuth } from './lib/auth.tsx'
import { isSupabaseConfigured } from './lib/supabase.ts'
import ActivityPage from './pages/ActivityPage.tsx'
import CommissionerPage from './pages/CommissionerPage.tsx'
import DraftPage from './pages/DraftPage.tsx'
import LeaderboardPage from './pages/LeaderboardPage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import NotMemberPage from './pages/NotMemberPage.tsx'
import PlayersPage from './pages/PlayersPage.tsx'
import TeamPage from './pages/TeamPage.tsx'
import TradesPage from './pages/TradesPage.tsx'

// Hash routing (#/team/...) so deep links work on GitHub Pages without
// server-side rewrites.
const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <LeaderboardPage /> },
      { path: 'team', element: <TeamPage /> },
      { path: 'team/:teamId', element: <TeamPage /> },
      { path: 'players', element: <PlayersPage /> },
      { path: 'draft', element: <DraftPage /> },
      { path: 'trades', element: <TradesPage /> },
      { path: 'activity', element: <ActivityPage /> },
      { path: 'commissioner', element: <CommissionerPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function App({ authError }: { authError: string | null }) {
  const { session, team, isCommissioner } = useAuth()

  if (!isSupabaseConfigured) {
    return (
      <main className="centered">
        <h1>Not configured</h1>
        <p>
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see{' '}
          <code>.env.example</code>) and restart.
        </p>
      </main>
    )
  }

  if (session === undefined || (session && team === undefined)) {
    return <main className="centered muted">Loading…</main>
  }

  if (!session) return <LoginPage initialError={authError} />
  if (!team && !isCommissioner) return <NotMemberPage />

  return <RouterProvider router={router} />
}
