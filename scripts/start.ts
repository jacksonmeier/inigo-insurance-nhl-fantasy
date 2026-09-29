// Runs the league on this computer for everyone on the same Wi-Fi.
//
//   npm start
//
// Starts Supabase if it isn't running, takes a backup, builds the app and
// serves it on port 5173. Leave it running. Stop it with Ctrl+C: the database
// keeps running in Docker, and everything is still there next time.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fail, lanAddresses, localStack, reloadFunctions, startLocalStack, WEB_PORT } from './lib/local.ts'

if (!existsSync('.env.local') || !existsSync('league.local.json')) {
  fail("The league hasn't been set up on this computer yet. Run: npm run setup")
}

if (!localStack()) startLocalStack()
reloadFunctions()

// A backup on every start means there's always a recent one.
spawnSync('npx', ['tsx', 'scripts/backup.ts'], { stdio: 'inherit' })

console.log('Building the app...')
if (spawnSync('npx', ['vite', 'build', '--logLevel', 'warn'], { stdio: 'inherit' }).status !== 0) {
  fail("The app didn't build. See the messages above.")
}

const addresses = lanAddresses()
console.log(`
The league is running.

  On this computer: http://localhost:${WEB_PORT}
  On your phones:   ${addresses.length > 0 ? addresses.map((a) => `http://${a}:${WEB_PORT}`).join('  or  ') : '(connect to Wi-Fi first)'}

  Keep this window open and the laptop plugged in. Press Ctrl+C to stop.
  If a phone can't connect, see "Phones can't connect" in docs/LOCAL.md.
`)

const server = spawn(
  'npx',
  ['vite', 'preview', '--host', '--port', String(WEB_PORT), '--strictPort', '--logLevel', 'warn'],
  { stdio: 'inherit' },
)

// A sleeping laptop takes the league down with it. On a Mac, keep it awake
// for as long as the server runs (the screen can still turn off).
const awake =
  process.platform === 'darwin' && server.pid
    ? spawn('caffeinate', ['-i', '-s', '-w', String(server.pid)], { stdio: 'ignore' })
    : null
awake?.on('error', () => {})

server.on('exit', (code) => {
  awake?.kill()
  process.exit(code ?? 0)
})
process.on('SIGINT', () => server.kill('SIGINT'))
process.on('SIGTERM', () => server.kill('SIGTERM'))
