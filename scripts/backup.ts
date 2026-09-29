// Saves a copy of the local database's data to backups/ (which git ignores).
//
//   npm run backup
//
// The league lives in a Docker volume on this computer. `supabase stop` keeps
// it, but `supabase db reset` or deleting the volume wipes it, so `npm start`
// takes a backup every time. To restore one, see docs/LOCAL.md.

import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fail, localStack } from './lib/local.ts'

const KEEP = 30
const dir = 'backups'

if (!localStack()) fail("Supabase isn't running, so there's nothing to back up. Start it with: npm run setup")

mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const file = join(dir, `league-${stamp}.sql`)

// League data plus the sign-in accounts the teams belong to.
const result = spawnSync(
  'npx',
  ['supabase', 'db', 'dump', '--local', '--data-only', '--schema', 'public,auth', '-f', file],
  { stdio: ['ignore', 'ignore', 'inherit'] },
)
if (result.status !== 0) fail("The backup didn't work. See the message above.")

const size = Math.round(statSync(file).size / 1024)
console.log(`Backed up to ${file} (${size} KB).`)

const old = readdirSync(dir)
  .filter((name) => /^league-.*\.sql$/.test(name))
  .sort()
  .slice(0, -KEEP)
for (const name of old) unlinkSync(join(dir, name))
