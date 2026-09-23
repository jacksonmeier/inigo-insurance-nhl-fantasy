import { LEAGUE } from '@shared/league.config.ts'
import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase.ts'

export default function LoginPage({ initialError }: { initialError: string | null }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(initialError)

  async function sendLink(e: FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        // Only the 4 league members exist as users (created by the
        // commissioner in the Supabase dashboard). Strangers can't sign up.
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
      },
    })
    if (error) {
      setStatus('idle')
      setError(
        /signups not allowed/i.test(error.message)
          ? "That email isn't in the league. Ask the commissioner to add you."
          : error.message,
      )
    } else {
      setStatus('sent')
    }
  }

  return (
    <main className="centered">
      <h1>{LEAGUE.name}</h1>
      <p className="muted">Fantasy hockey</p>

      {status === 'sent' ? (
        <div className="card">
          <p>
            Check <strong>{email}</strong> for a sign-in link. You can close this tab.
          </p>
        </div>
      ) : (
        <form className="card stack" onSubmit={sendLink}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
          </button>
        </form>
      )}

      {error && <div className="card error">{error}</div>}
    </main>
  )
}
