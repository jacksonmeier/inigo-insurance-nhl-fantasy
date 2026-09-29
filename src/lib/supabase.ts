import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types.ts'

const configuredUrl = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(configuredUrl && anonKey)

// A URL starting with "/" means Supabase is reached through this site's own
// server (see vite.config.ts), which is how the league runs on one computer
// for phones on the same Wi-Fi. Each device fills in the address it used.
const url = configuredUrl?.startsWith('/') ? `${window.location.origin}${configuredUrl}` : configuredUrl

// Only the public URL and anon key ever reach the browser. Everything
// privileged happens in Edge Functions or security-definer SQL functions.
export const supabase = createClient<Database>(url || 'http://localhost', anonKey || 'missing', {
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

export type RpcName = keyof Database['public']['Functions']
export type RpcArgs<Name extends RpcName> = Database['public']['Functions'][Name]['Args']
export type RpcReturns<Name extends RpcName> = Database['public']['Functions'][Name]['Returns']

/**
 * Calls a database function and returns its result. Throws an Error carrying
 * the database's own message, which the rule functions write for people to
 * read ("No open F slot. Drop a F first.").
 */
export async function call<Name extends RpcName>(
  name: Name,
  ...args: RpcArgs<Name> extends Record<string, never> | undefined ? [] : [RpcArgs<Name>]
): Promise<RpcReturns<Name>> {
  // supabase-js types rpc() per function; this wrapper has already checked
  // the arguments against the same generated types.
  const { data, error } = await supabase.rpc(name as never, args[0] as never)
  if (error) throw new Error(friendlyMessage(error.message))
  return data as RpcReturns<Name>
}

export function friendlyMessage(message: string) {
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Can't reach the league right now. Check your connection and try again."
  }
  if (/jwt expired|invalid jwt/i.test(message)) return 'Your sign-in expired. Sign in again.'
  return message
}
