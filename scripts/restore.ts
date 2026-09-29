// Puts the local league back the way it was in a backup.
//
//   npm run restore -- backups/league-2026-09-27T12-00-00.sql --yes
//
// This replaces everything in the local database. It takes a backup of what's
// there first, in case the restore was a mistake.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fail, localStack, startLocalStack } from './lib/local.ts'

const args = process.argv.slice(2)
const file = args.find((arg) => !arg.startsWith('--'))
const confirmed = args.includes('--yes')

if (!file || !existsSync(file)) {
  fail('Which backup? For example:\n  npm run restore -- backups/league-2026-09-27T12-00-00.sql --yes')
}
if (!confirmed) {
  fail(
    `This replaces everything in the local league with ${file}.\n` +
      'A backup of what\'s there now is taken first. To go ahead, add --yes:\n' +
      `  npm run restore -- ${file} --yes`,
  )
}

const run = (command: string, commandArgs: string[], input?: string) =>
  spawnSync(command, commandArgs, { input, encoding: 'utf8', stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] })

if (!localStack()) startLocalStack()

console.log('Backing up the league as it is now...')
if (run('npx', ['tsx', 'scripts/backup.ts']).status !== 0) fail("Couldn't take a backup first, so nothing was changed.")

console.log('\nRebuilding an empty database...')
if (run('npx', ['supabase', 'db', 'reset', '--local']).status !== 0) fail("Couldn't rebuild the database.")

const container = spawnSync('docker', ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}'], {
  encoding: 'utf8',
}).stdout.trim().split('\n')[0]
if (!container) fail("Can't find the database container.")

const psql = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1']

// The rebuilt database starts with the league's settings row, which the
// backup also has.
console.log('Loading the backup...')
const loaded = run('docker', psql, `truncate public.league_settings;\n${readFileSync(file, 'utf8')}`)
if (loaded.status !== 0) fail('The backup didn\'t load cleanly. See the message above.')

console.log('\nTurning the scheduled jobs back on...')
if (run('npx', ['tsx', 'scripts/setup.ts', '--skip-import']).status !== 0) {
  fail('The data is restored, but setup failed. Run: npm run setup -- --skip-import')
}
