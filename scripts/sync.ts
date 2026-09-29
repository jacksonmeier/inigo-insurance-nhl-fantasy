// Runs a sync job from the terminal, against the local database by default.
//
//   npm run sync -- players      NHL rosters and last season's totals
//   npm run sync -- schedule     the regular season schedule
//   npm run sync -- injuries     ESPN's injury list
//   npm run sync -- live         games in progress right now
//   npm run sync -- finals       the last two days of games, re-checked
//   npm run sync -- setup        players, schedule and injuries
//   npm run sync -- game 2026020001
//
// This is the same code the scheduled Edge Function runs.

import { JOBS, runJob, type JobName } from '../supabase/functions/_shared/sync.ts'
import { connection, fail, serviceClient } from './lib/local.ts'

const [job, gameId] = process.argv.slice(2)

if (!JOBS.includes(job as JobName)) {
  fail(`Which job? One of: ${JOBS.join(', ')}.\n  npm run sync -- players`)
}

const target = connection()
console.log(`Running "${job}" against ${target.isLocal ? 'the local database' : target.url}...`)

const results = await runJob(serviceClient(target), job as JobName, {
  gameId: gameId ? Number(gameId) : undefined,
})

for (const result of results) {
  console.log(`${result.ok ? '  ok  ' : ' FAIL '} ${result.job}: ${result.message}`)
}
process.exit(results.every((result) => result.ok) ? 0 : 1)
