import { LEAGUE } from '@shared/league.config.ts'
import { useState, type FormEvent } from 'react'
import { friendlyMessage, supabase } from '../lib/supabase.ts'

type Mode = 'password' | 'link'

export default function LoginPage({ initialError }: { initialError: string | null }) {
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'working' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(initialError)

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setStatus('working')
    setError(null)

    if (mode === 'password') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      setStatus('idle')
      if (error) {
        setError(
          /invalid login credentials/i.test(error.message)
            ? "That email and password don't match. Check with the commissioner."
            : friendlyMessage(error.message),
        )
      }
      return
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        // Only the league's members exist as users (created by the
        // commissioner). Strangers can't sign up.
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
      },
    })
    if (error) {
      setStatus('idle')
      setError(
        /signups not allowed/i.test(error.message)
          ? "That email isn't in the league. Ask the commissioner to add you."
          : friendlyMessage(error.message),
      )
    } else {
      setStatus('sent')
    }
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setStatus('idle')
  }

  return (
    <main className="centered">
      <div className="marquee">
        <i className="lamp" style={{ display: 'block' }} />
        <h1>{LEAGUE.name}</h1>
        <p>Fantasy hockey</p>
      </div>

      {status === 'sent' ? (
        <div className="card stack">
          <p>
            Check <strong>{email}</strong> for a sign-in link. You can close this tab.
          </p>
          <button type="button" className="ghost" onClick={() => switchMode('password')}>
            Back
          </button>
        </div>
      ) : (
        <form className="card stack" onSubmit={signIn}>
          <div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {mode === 'password' && (
            <div>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}

          <button type="submit" disabled={status === 'working'}>
            {status === 'working' ? 'One moment…' : mode === 'password' ? 'Sign in' : 'Email me a sign-in link'}
          </button>

          <button
            type="button"
            className="link-button fine"
            onClick={() => switchMode(mode === 'password' ? 'link' : 'password')}
          >
            {mode === 'password' ? 'Email me a sign-in link instead' : 'Sign in with a password instead'}
          </button>
        </form>
      )}
    </main>
  )
}
