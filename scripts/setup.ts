// Sets up the league on this computer. Safe to run again at any time: it
// only fills in what's missing and never touches rosters, picks or points.
//
//   npm run setup
//
// With SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET set, it sets up
// a hosted Supabase project instead (steps 3 to 5). See docs/SETUP.md.
//
// What it does:
//   1. Starts the local Supabase stack (needs Docker Desktop running) and
//      applies any new database migrations.
//   2. Writes .env.local so the web app can find it.
//   3. Creates a sign-in and a team for each person in league.local.json.
//      The first run creates that file with placeholder emails and random
//      passwords. Edit it and run this again to change them.
//   4. Turns on the scheduled jobs (live scoring, injuries, waivers...).
//   5. Imports NHL players, the schedule and the injury list.

import type { SupabaseClient, User } from '@supabase/supabase-js'
import { spawnSync } from 'node:child_process'
import { randomBytes, randomInt } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { LEAGUE } from '../supabase/functions/_shared/league.config.ts'
import { runJob } from '../supabase/functions/_shared/sync.ts'
import {
  fail, lanAddresses, localStack, reloadFunctions, serviceClient, startLocalStack, WEB_PORT,
} from './lib/local.ts'
import { decideTeamName } from './lib/teams.ts'

const LEAGUE_FILE = 'league.local.json'
const FUNCTIONS_ENV = 'supabase/functions/.env'
// How the database container reaches the API gateway container.
const FUNCTIONS_URL_FROM_DATABASE = 'http://api.supabase.internal:8000/functions/v1'

type Member = { slot: number; email: string; team: string; password: string }
type LeagueFile = { commissioner: number; members: Member[] }

const skipImport = process.argv.includes('--skip-import')

// ---------------------------------------------------------------------------
// league.local.json
// ---------------------------------------------------------------------------

const WORDS = ['puck', 'crease', 'slapshot', 'zamboni', 'faceoff', 'breakaway', 'hattrick', 'topshelf']

const newPassword = () => `${WORDS[randomInt(WORDS.length)]}-${randomInt(1000, 10000)}`

function gitEmail(): string | null {
  const result = spawnSync('git', ['config', 'user.email'], { encoding: 'utf8' })
  const email = result.stdout?.trim()
  return result.status === 0 && email?.includes('@') ? email : null
}

function readLeagueFile(): { league: LeagueFile; created: boolean } {
  if (existsSync(LEAGUE_FILE)) {
    const league = JSON.parse(readFileSync(LEAGUE_FILE, 'utf8')) as LeagueFile
    const problems = checkLeagueFile(league)
    if (problems.length > 0) fail(`${LEAGUE_FILE} needs fixing:\n  - ${problems.join('\n  - ')}`)
    return { league, created: false }
  }

  const league: LeagueFile = {
    commissioner: 1,
    members: Array.from({ length: LEAGUE.teamCount }, (_, i) => ({
      slot: i + 1,
      email: i === 0 ? (gitEmail() ?? 'commissioner@example.com') : `friend${i}@example.com`,
      team: `Team ${i + 1}`,
      password: newPassword(),
    })),
  }
  writeFileSync(LEAGUE_FILE, `${JSON.stringify(league, null, 2)}\n`)
  return { league, created: true }
}

function checkLeagueFile(league: LeagueFile): string[] {
  const problems: string[] = []
  const members = league.members ?? []

  if (members.length !== LEAGUE.teamCount) problems.push(`It needs exactly ${LEAGUE.teamCount} members.`)
  if (new Set(members.map((m) => m.slot)).size !== members.length) problems.push('Each member needs a different slot number.')
  if (new Set(members.map((m) => m.email?.toLowerCase())).size !== members.length) problems.push('Each member needs a different email.')
  if (!members.some((m) => m.slot === league.commissioner)) problems.push('"commissioner" must be one of the slot numbers.')

  for (const member of members) {
    if (!member.email?.includes('@')) problems.push(`Slot ${member.slot}: the email looks wrong.`)
    if (!member.team?.trim() || member.team.length > 40) problems.push(`Slot ${member.slot}: the team name must be 1 to 40 characters.`)
    if ((member.password ?? '').length < 6) problems.push(`Slot ${member.slot}: the password must be at least 6 characters.`)
  }
  return problems
}

// ---------------------------------------------------------------------------
// Accounts and teams
// ---------------------------------------------------------------------------

type Answer = { data: unknown; error: { message: string } | null }

async function ensure<A extends Answer>(what: string, promise: PromiseLike<A>): Promise<A['data']> {
  const { data, error } = await promise
  if (error) fail(`Couldn't ${what}: ${error.message}`)
  return data
}

async function setUpMembers(db: SupabaseClient, league: LeagueFile) {
  const listed = await ensure('list the accounts', db.auth.admin.listUsers({ perPage: 200 }))
  const users: User[] = listed.users
  const changes: string[] = []

  for (const member of league.members) {
    const email = member.email.trim().toLowerCase()
    // The slot number is what ties a person to their team, so changing an
    // email in the file updates the account instead of making a second one.
    let user: User | undefined =
      users.find((u) => u.app_metadata?.league_slot === member.slot) ?? users.find((u) => u.email === email)

    if (!user) {
      const created = await ensure(
        `create the account for ${email}`,
        db.auth.admin.createUser({
          email,
          password: member.password,
          email_confirm: true,
          app_metadata: { league_slot: member.slot },
        }),
      )
      user = created.user as User
      changes.push(`Created the account for ${email}.`)
    } else {
      await ensure(
        `update the account for ${email}`,
        db.auth.admin.updateUserById(user.id, {
          email,
          password: member.password,
          email_confirm: true,
          app_metadata: { ...user.app_metadata, league_slot: member.slot },
        }),
      )
      if (user.email !== email) changes.push(`Changed slot ${member.slot}'s email to ${email}.`)
    }

    const team = await ensure(
      'look up the teams',
      db.from('teams').select('id, name').eq('owner_id', user.id).maybeSingle(),
    )
    if (!team) {
      await ensure(
        `create ${member.team}`,
        db.from('teams').insert({ name: member.team.trim(), owner_id: user.id }),
      )
      changes.push(`Created ${member.team}.`)
    } else {
      const decision = decideTeamName(team.name, member.team)
      if (decision === 'rename') {
        await ensure(
          `rename ${team.name}`,
          db.from('teams').update({ name: member.team.trim() }).eq('id', team.id),
        )
        changes.push(`Renamed ${team.name} to ${member.team.trim()}.`)
      } else if (decision === 'keep' && member.team.trim() !== team.name && !/^Team \d+$/.test(member.team.trim())) {
        changes.push(
          `Left "${team.name}" alone (the file says "${member.team.trim()}"). ` +
            'Once a team has a real name, its owner renames it in the app.',
        )
      }
    }

    if (member.slot === league.commissioner) {
      await ensure(
        'set the commissioner',
        db.from('league_settings').update({ commissioner_id: user.id }).eq('id', true),
      )
    }
  }
  return changes
}

// ---------------------------------------------------------------------------
// Scheduled jobs
// ---------------------------------------------------------------------------

function cronSecret(): { secret: string; created: boolean } {
  if (existsSync(FUNCTIONS_ENV)) {
    const match = readFileSync(FUNCTIONS_ENV, 'utf8').match(/^CRON_SECRET=(.+)$/m)
    if (match) return { secret: match[1].trim(), created: false }
  }
  const secret = randomBytes(24).toString('hex')
  const existing = existsSync(FUNCTIONS_ENV) ? readFileSync(FUNCTIONS_ENV, 'utf8') : ''
  writeFileSync(
    FUNCTIONS_ENV,
    `${existing}# Proves to the sync function that a request came from the database's scheduler.\nCRON_SECRET=${secret}\n`,
  )
  return { secret, created: true }
}

// ---------------------------------------------------------------------------

const hosted =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? { url: process.env.SUPABASE_URL.replace(/\/$/, ''), serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY }
    : null

let db: SupabaseClient
let functionsUrl: string
let secret: string

if (hosted) {
  console.log(`Setting up ${LEAGUE.name} at ${hosted.url}.\n`)
  secret = process.env.CRON_SECRET ?? ''
  if (secret.length < 16) {
    fail('Set CRON_SECRET to the same value you gave the sync function (at least 16 characters).')
  }
  functionsUrl = `${hosted.url}/functions/v1`
  db = serviceClient(hosted)
} else {
  console.log(`Setting up ${LEAGUE.name} on this computer.\n`)

  let stack = startLocalStack()

  const local = cronSecret()
  secret = local.secret
  if (local.created) {
    // The function only reads its secrets when the stack starts.
    console.log('Restarting Supabase to turn on the scheduled jobs...')
    spawnSync('npx', ['supabase', 'stop'], { stdio: 'ignore' })
    if (spawnSync('npx', ['supabase', 'start'], { stdio: 'inherit' }).status !== 0) {
      fail("Supabase didn't restart. See the messages above.")
    }
    stack = localStack() ?? fail("Supabase restarted but isn't reporting its status.")
  } else {
    reloadFunctions()
  }

  // The app reaches Supabase through the web server (see vite.config.ts), so
  // one address works from this computer and from phones on the same Wi-Fi.
  writeFileSync(
    '.env.local',
    [
      '# Written by `npm run setup`. Both values are public.',
      'VITE_SUPABASE_URL=/supabase-api',
      `VITE_SUPABASE_ANON_KEY=${stack.anonKey}`,
      '',
    ].join('\n'),
  )

  functionsUrl = FUNCTIONS_URL_FROM_DATABASE
  db = serviceClient({ url: stack.apiUrl, serviceRoleKey: stack.serviceRoleKey })
}

const { league, created: leagueFileCreated } = readLeagueFile()
const changes = await setUpMembers(db, league)
for (const change of changes) console.log(`  ${change}`)

await ensure(
  'turn on the scheduled jobs',
  db.rpc('set_cron_config', { p_functions_url: functionsUrl, p_cron_secret: secret }),
)

if (skipImport) {
  await ensure('save the league rules', db.rpc('push_config', { p_config: LEAGUE }))
} else {
  console.log('\nImporting from the NHL and ESPN (about a minute)...')
  const results = await runJob(db, 'setup')
  for (const result of results) {
    console.log(`${result.ok ? '  ok  ' : ' FAIL '} ${result.job}: ${result.message}`)
  }
  if (results.some((result) => !result.ok)) {
    console.log('\nSomething failed to import. Check your internet connection and run `npm run setup` again.')
  }
}

const commissioner = league.members.find((m) => m.slot === league.commissioner)!

if (hosted) {
  console.log(`
Ready. Sign-ins are in ${LEAGUE_FILE}. The commissioner is ${commissioner.email}.`)
} else {
  const addresses = lanAddresses()
  console.log(`
Ready.

  Start the app:    npm start
  On this computer: http://localhost:${WEB_PORT}
  On your phones:   ${addresses.length > 0 ? addresses.map((a) => `http://${a}:${WEB_PORT}`).join('  or  ') : '(connect to Wi-Fi first)'}
                    (everyone on the same Wi-Fi as this computer)

  Sign-ins are in ${LEAGUE_FILE}. The commissioner is ${commissioner.email}.`)
}

if (leagueFileCreated || league.members.some((m) => /@example\.com$/.test(m.email))) {
  console.log(`
  ${LEAGUE_FILE} still has placeholder emails. Put in the real ones
  whenever you like and run \`npm run setup\` again. Teams, picks and points
  are kept. Team names in the file replace "Team 1", "Team 2" and so on; after
  that, owners rename their own team in the app.`)
}
console.log('')
