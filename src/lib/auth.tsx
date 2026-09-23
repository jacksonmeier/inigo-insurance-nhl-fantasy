import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'

export type MyTeam = { id: string; name: string }

type AuthState = {
  /** undefined while the initial session is loading */
  session: Session | null | undefined
  /** undefined while loading; null when signed in but not linked to a team */
  team: MyTeam | null | undefined
  isCommissioner: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [membership, setMembership] = useState<{
    userId: string
    team: MyTeam | null
    isCommissioner: boolean
  } | null>(null)
  const userId = session?.user.id

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  // Look up the signed-in user's team once per user (not on every token refresh).
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    Promise.all([
      supabase.from('teams').select('id, name').eq('owner_id', userId).maybeSingle(),
      supabase.rpc('is_commissioner'),
    ]).then(([teamRes, commRes]) => {
      if (!cancelled) {
        setMembership({ userId, team: teamRes.data ?? null, isCommissioner: commRes.data === true })
      }
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const current = membership && membership.userId === userId ? membership : null
  const team = session === undefined ? undefined : !userId ? null : current ? current.team : undefined
  const isCommissioner = current?.isCommissioner ?? false

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, team, isCommissioner, signOut }}>
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
