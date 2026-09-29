import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { startRealtime, stopRealtime } from './live.ts'
import { supabase } from './supabase.ts'

export type MyTeam = { id: string; name: string }

type AuthState = {
  /** undefined while the initial session is loading */
  session: Session | null | undefined
  /** undefined while loading; null when signed in but not linked to a team */
  team: MyTeam | null | undefined
  isCommissioner: boolean
  /** Reloads the team, e.g. after it's renamed. */
  reloadTeam: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

type Membership = { userId: string; team: MyTeam | null; isCommissioner: boolean }

async function loadMembership(userId: string): Promise<Membership> {
  const [teamRes, commRes] = await Promise.all([
    supabase.from('teams').select('id, name').eq('owner_id', userId).maybeSingle(),
    supabase.rpc('is_commissioner'),
  ])
  return { userId, team: teamRes.data ?? null, isCommissioner: commRes.data === true }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [membership, setMembership] = useState<Membership | null>(null)
  const userId = session?.user.id

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      // A saved sign-in can outlive its account, e.g. after the league was
      // restored from a backup. Ask the server, and start over if it's gone.
      if (data.session) {
        const { error } = await supabase.auth.getUser()
        const gone = error && error.status !== undefined && error.status >= 400 && error.status < 500
        if (gone) {
          await supabase.auth.signOut({ scope: 'local' })
          setSession(null)
          return
        }
      }
      setSession(data.session)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  // Look up the signed-in user's team once per user (not on every token refresh).
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    loadMembership(userId).then((next) => {
      if (!cancelled) setMembership(next)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  // Live updates only flow while someone is signed in.
  useEffect(() => {
    if (!userId) return
    startRealtime()
    return stopRealtime
  }, [userId])

  const reloadTeam = useCallback(async () => {
    if (userId) setMembership(await loadMembership(userId))
  }, [userId])

  const current = membership && membership.userId === userId ? membership : null
  const team = session === undefined ? undefined : !userId ? null : current ? current.team : undefined
  const isCommissioner = current?.isCommissioner ?? false

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, team, isCommissioner, reloadTeam, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// oxlint-disable-next-line react/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
