// Applies the real migrations to an in-memory Postgres and checks the security
// rules. The anon key is public, so these rules are the only thing standing
// between the internet and the league's data.

import { PGlite, type Transaction } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')

const OWNER_A = '00000000-0000-0000-0000-00000000000a'
const OWNER_B = '00000000-0000-0000-0000-00000000000b'
const STRANGER = '00000000-0000-0000-0000-00000000000c'
const COMMISH = '00000000-0000-0000-0000-00000000000d' // commissioner with no team
const TEAM_A = '10000000-0000-0000-0000-00000000000a'
const TEAM_B = '10000000-0000-0000-0000-00000000000b'

let db: PGlite
let publicTables: string[]

/** Run SQL as a browser client would: anon when uid is null, else a signed-in user. */
function as<T>(uid: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`)
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ''])
    return fn(tx)
  })
}

const count = async (uid: string | null, table: string) =>
  as(uid, async (tx) => (await tx.query(`select * from public.${table}`)).rows.length)

beforeAll(async () => {
  db = await PGlite.create({ extensions: { btree_gist } })
  await db.exec(readFileSync(join(root, 'tests/supabase-stubs.sql'), 'utf8'))

  const migrationsDir = join(root, 'migrations')
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'))
  }

  publicTables = (
    await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' order by 1`)
  ).rows.map((r) => r.tablename)

  // Seed as the database owner (what an Edge Function with the service role would do).
  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNER_A}', 'a@example.com'), ('${OWNER_B}', 'b@example.com'),
      ('${STRANGER}', 'stranger@example.com'), ('${COMMISH}', 'commish@example.com');
    update public.league_settings set commissioner_id = '${COMMISH}';
    insert into public.teams (id, name, owner_id) values
      ('${TEAM_A}', 'Team A', '${OWNER_A}'), ('${TEAM_B}', 'Team B', '${OWNER_B}');
    insert into public.players (id, first_name, last_name, position, nhl_team)
      values (8478402, 'Connor', 'McDavid', 'C', 'EDM');
    insert into public.games (id, season, game_type, game_date, start_time_utc, home_team, away_team)
      values (2026020001, 20262027, 2, '2026-10-07', '2026-10-07T23:00:00Z', 'EDM', 'CGY');
    insert into public.player_game_stats (game_id, player_id, nhl_team, goals, assists)
      values (2026020001, 8478402, 'EDM', 1, 2);
    insert into public.player_game_points (game_id, player_id, team_id, points, goals)
      values (2026020001, 8478402, '${TEAM_A}', 7, 1);
    insert into public.alerts (team_id, type, message) values
      ('${TEAM_A}', 'general', 'for A'), ('${TEAM_B}', 'general', 'for B');
  `)
})

describe('migrations', () => {
  it('enable row-level security on every public table', async () => {
    const { rows } = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)
    expect(rows.map((r) => r.relname)).toEqual([])
  })

  it('stop a player from being on two rosters at once', async () => {
    await db.exec(`
      insert into public.roster_entries (team_id, player_id, slot, reason, start_at)
      values ('${TEAM_A}', 8478402, 'active', 'draft', '2026-10-01')`)
    await expect(
      db.exec(`
        insert into public.roster_entries (team_id, player_id, slot, reason, start_at)
        values ('${TEAM_B}', 8478402, 'active', 'free_agent', '2026-10-05')`),
    ).rejects.toThrow(/roster_entries_no_overlap/)
  })
})

describe('signed-out visitors (anon key only)', () => {
  it('cannot read any table', async () => {
    for (const table of publicTables) {
      await expect(count(null, table), table).rejects.toThrow(/permission denied/)
    }
  })
})

describe('signed-in users who are not in the league', () => {
  it('see nothing', async () => {
    for (const table of publicTables) {
      expect(await count(STRANGER, table), table).toBe(0)
    }
  })
})

describe('league members', () => {
  it('can read league data', async () => {
    expect(await count(OWNER_A, 'teams')).toBe(2)
    expect(await count(OWNER_B, 'player_game_points')).toBe(1)
    expect(await count(COMMISH, 'teams')).toBe(2)
  })

  it('cannot insert, update or delete game data directly', async () => {
    for (const table of publicTables) {
      await expect(
        as(OWNER_A, (tx) => tx.query(`delete from public.${table}`)),
        `delete ${table}`,
      ).rejects.toThrow(/permission denied/)
    }
    await expect(
      as(OWNER_A, (tx) =>
        tx.query(`update public.player_game_points set points = 999 where team_id = '${TEAM_A}'`),
      ),
    ).rejects.toThrow(/permission denied/)
    await expect(
      as(OWNER_A, (tx) =>
        tx.query(`insert into public.point_adjustments (team_id, points, reason) values ('${TEAM_A}', 50, 'x')`),
      ),
    ).rejects.toThrow(/permission denied/)
  })

  it('can rename only their own team', async () => {
    const own = await as(OWNER_A, (tx) =>
      tx.query(`update public.teams set name = 'Renamed A' where id = '${TEAM_A}' returning id`),
    )
    expect(own.rows).toHaveLength(1)

    const other = await as(OWNER_A, (tx) =>
      tx.query(`update public.teams set name = 'Hacked' where id = '${TEAM_B}' returning id`),
    )
    expect(other.rows).toHaveLength(0)

    await expect(
      as(OWNER_A, (tx) => tx.query(`update public.teams set owner_id = '${OWNER_B}' where id = '${TEAM_A}'`)),
    ).rejects.toThrow(/permission denied/)
  })

  it('see only their own alerts and can mark them read', async () => {
    const mine = await as(OWNER_A, (tx) => tx.query<{ message: string }>(`select message from public.alerts`))
    expect(mine.rows.map((r) => r.message)).toEqual(['for A'])

    const marked = await as(OWNER_A, (tx) => tx.query(`update public.alerts set read_at = now() returning id`))
    expect(marked.rows).toHaveLength(1)

    expect(await count(COMMISH, 'alerts')).toBe(2)
  })
})
