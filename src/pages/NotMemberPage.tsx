import { useAuth } from '../lib/auth.tsx'

export default function NotMemberPage() {
  const { session, signOut } = useAuth()

  return (
    <main className="centered">
      <h1>Almost there</h1>
      <div className="card stack">
        <p>
          You're signed in as <strong>{session?.user.email}</strong>, but this account isn't linked
          to a team yet. Ask the commissioner to set up your team.
        </p>
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </div>
    </main>
  )
}
