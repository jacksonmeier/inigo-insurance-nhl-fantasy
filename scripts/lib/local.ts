// Helpers for the scripts that run the league on this computer: finding the
// local Supabase stack and talking to it with the service role key.
//
// The service role key is read from `supabase status` each time and never
// written to disk. To point a script at a hosted project instead, set
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { spawnSync } from 'node:child_process'
import { networkInterfaces } from 'node:os'

export const WEB_PORT = 5173

export type LocalStack = {
  apiUrl: string
  anonKey: string
  serviceRoleKey: string
  studioUrl: string
}

function supabase(args: string[], inherit = false) {
  return spawnSync('npx', ['supabase', ...args], {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  })
}

/** The running local stack, or null if it isn't running. */
export function localStack(): LocalStack | null {
  const result = supabase(['status', '-o', 'json'])
  if (result.status !== 0) return null

  try {
    const json = result.stdout.slice(result.stdout.indexOf('{'), result.stdout.lastIndexOf('}') + 1)
    const status = JSON.parse(json) as Record<string, string>
    if (!status.API_URL || !status.SERVICE_ROLE_KEY) return null
    return {
      apiUrl: status.API_URL,
      anonKey: status.ANON_KEY,
      serviceRoleKey: status.SERVICE_ROLE_KEY,
      studioUrl: status.STUDIO_URL,
    }
  } catch {
    return null
  }
}

/**
 * Restarts the container that runs the sync function, so it picks up the
 * current code and secrets. It caches what it loaded when it started.
 */
export function reloadFunctions() {
  const name = spawnSync('docker', ['ps', '--filter', 'name=supabase_edge_runtime_', '--format', '{{.Names}}'], {
    encoding: 'utf8',
  }).stdout.trim().split('\n')[0]
  if (name) spawnSync('docker', ['restart', name], { stdio: 'ignore' })
}

export function dockerIsRunning() {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
}

/** Starts the local stack if needed and brings the database up to date. */
export function startLocalStack(): LocalStack {
  let stack = localStack()

  if (!stack) {
    if (!dockerIsRunning()) {
      fail(
        "Docker isn't running. Open Docker Desktop, wait for it to say it's running, and try again.\n" +
          '  open -a Docker',
      )
    }
    console.log('Starting Supabase (the first time downloads about 6 GB, so give it a few minutes)...')
    if (supabase(['start'], true).status !== 0) fail("Supabase didn't start. See the messages above.")
    stack = localStack()
    if (!stack) fail("Supabase started but isn't reporting its status. Try: npx supabase status")
  }

  console.log('Checking for database changes...')
  if (supabase(['migration', 'up', '--local'], true).status !== 0) {
    fail("Couldn't apply the database migrations. See the messages above.")
  }
  return stack
}

export type Connection = { url: string; serviceRoleKey: string; isLocal: boolean }

export function connection(): Connection {
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url && serviceRoleKey) return { url, serviceRoleKey, isLocal: false }

  const stack = localStack()
  if (!stack) {
    fail("Supabase isn't running on this computer. Start it with: npm run setup")
  }
  return { url: stack.apiUrl, serviceRoleKey: stack.serviceRoleKey, isLocal: true }
}

export function serviceClient({ url, serviceRoleKey }: Pick<Connection, 'url' | 'serviceRoleKey'>): SupabaseClient {
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** This computer's addresses on the local network, for phones on the same Wi-Fi. */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((address) => address && address.family === 'IPv4' && !address.internal)
    .map((address) => address!.address)
}

export function fail(message: string): never {
  console.error(`\n${message}\n`)
  process.exit(1)
}
