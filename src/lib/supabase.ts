import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

// Only the public URL and anon key ever reach the browser. Everything
// privileged happens in Edge Functions or security-definer SQL functions.
export const supabase = createClient(url || 'http://localhost', anonKey || 'missing', {
  auth: {
    // Implicit flow returns the session in the URL hash, so a magic link works
    // even when a phone opens it in a different browser than the one that
    // requested it. main.tsx consumes the hash before the hash router starts.
    flowType: 'implicit',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
