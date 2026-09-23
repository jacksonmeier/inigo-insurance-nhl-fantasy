import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.ts'

type TeamRow = { id: string; name: string }

// Phase 1: lists the teams straight from the database, which proves the app
// can reach Supabase and that read access works. Live totals come in Phase 8.
export default function LeaderboardPage() {
  const [teams, setTeams] = useState<TeamRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('teams')
      .select('id, name')
      .order('name')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setTeams(data)
      })
  }, [])

  return (
    <section>
      <h1>Standings</h1>
      {error && <div className="card error">Couldn't load teams: {error}</div>}
      {!teams && !error && <p className="muted">Loading…</p>}
      {teams && (
        <ol className="card list">
          {teams.map((team, i) => (
            <li key={team.id} className="list-row">
              <span className="rank">{i + 1}</span>
              <span className="grow">{team.name}</span>
              <span className="points">0.0</span>
            </li>
          ))}
          {teams.length === 0 && <li className="list-row muted">No teams yet.</li>}
        </ol>
      )}
      <p className="muted small">Live scoring arrives in Phase 4. Teams are listed alphabetically until then.</p>
    </section>
  )
}
