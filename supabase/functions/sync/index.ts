// The "sync" Edge Function: the only place that talks to the NHL and ESPN.
// Browsers never call those APIs directly.
//
// POST { "job": "players" | "schedule" | "live" | "finals" | "injuries" | "setup" }
//      { "job": "game", "gameId": 2026020001 }
//
// Two kinds of caller are allowed:
//   * the database's scheduled jobs, which send the CRON_SECRET;
//   * the commissioner, signed in, from the Commissioner page.
//
// JWT verification is off for this function in supabase/config.toml because
// the scheduler has no JWT. The checks below are the only gate.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { JOBS, runJob, type JobName } from '../_shared/sync.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Supabase provides the current API keys as JSON ({"default": "sb_secret_..."})
// alongside the legacy JWT keys, which it's retiring. Prefer the current ones.
function apiKey(current: string, legacy: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(current) ?? '{}') as Record<string, unknown>
    if (typeof keys.default === 'string' && keys.default) return keys.default
  } catch {
    // Not set, or not JSON: use the legacy key.
  }
  return Deno.env.get(legacy) ?? ''
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = apiKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
const ANON_KEY = apiKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

// Compare every character so the time taken doesn't leak how much matched.
function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}

async function isAllowed(request: Request): Promise<boolean> {
  const secret = request.headers.get('x-cron-secret')
  if (secret && CRON_SECRET && sameSecret(secret, CRON_SECRET)) return true

  const authorization = request.headers.get('Authorization')
  if (!authorization) return false

  // Ask the database, as the caller, whether the caller is the commissioner.
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await asCaller.rpc('is_commissioner')
  return !error && data === true
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  if (!(await isAllowed(request))) return json({ error: 'Only the commissioner can run a sync.' }, 403)

  let body: { job?: string; gameId?: number }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Send a JSON body with a "job".' }, 400)
  }

  const job = body.job as JobName
  if (!JOBS.includes(job)) return json({ error: `Unknown job. Use one of: ${JOBS.join(', ')}.` }, 400)

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const results = await runJob(db, job, { gameId: body.gameId })
    return json({ ok: results.every((result) => result.ok), results })
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
