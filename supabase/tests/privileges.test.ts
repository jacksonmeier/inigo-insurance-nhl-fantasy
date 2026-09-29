// Who is allowed to call what, and that the database's copy of the league
// config matches the config file.

import { beforeAll, describe, expect, it } from 'vitest'
import { LEAGUE } from '../functions/_shared/league.config.ts'
import { createLeague, expectError, OWNERS, STRANGER, type League } from './helpers.ts'

let league: League

type Fn = { name: string; args: string; signature: string }

let functions: Fn[]

const canExecute = async (role: string, signature: string) =>
  (await league.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [role, signature]))[0].ok

beforeAll(async () => {
  league = await createLeague()
  functions = await league.query<Fn>(`
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, p.oid::regprocedure::text as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f'
    order by 1`)
})

// Written by the sync function and the scheduler, never by a browser.
const SERVICE_ONLY = [
  'push_config', 'record_sync', 'ingest_players', 'ingest_season_stats', 'ingest_schedule', 'ingest_game',
  'ingest_injuries', 'reattribute_points', 'games_to_poll', 'games_to_finalize', 'sync_context', 'process_windows',
  'set_cron_config',
]

describe('function privileges', () => {
  it('give signed-out visitors nothing', async () => {
    const open = []
    for (const fn of functions) {
      if ((await canExecute('anon', fn.signature)) || (await canExecute('public', fn.signature))) open.push(fn.signature)
    }
    expect(open).toEqual([])
  })

  it('keep internal and service functions away from signed-in users', async () => {
    const open = []
    for (const fn of functions) {
      const isInternal = fn.signature.startsWith('private.') || SERVICE_ONLY.includes(fn.name)
      if (isInternal && (await canExecute('authenticated', fn.signature))) open.push(fn.signature)
    }
    expect(open).toEqual([])
  })

  it('let the service role run the sync functions', async () => {
    for (const name of SERVICE_ONLY) {
      const fn = functions.find((f) => f.name === name && f.signature.startsWith(name))
      expect(fn, name).toBeDefined()
      expect(await canExecute('service_role', fn!.signature), name).toBe(true)
    }
  })

  it('make every commissioner function check for the commissioner', async () => {
    const commissionerOnly = functions.filter(
      (f) =>
        !f.signature.startsWith('private.') &&
        (f.name.startsWith('commish_') ||
          ['draft_randomize_order', 'draft_set_order', 'draft_set_timer', 'draft_start', 'draft_pause',
            'draft_resume', 'draft_undo_last_pick', 'draft_reset'].includes(f.name)),
    )
    expect(commissionerOnly.length).toBeGreaterThanOrEqual(17)

    for (const fn of commissionerOnly) {
      // Nulls are fine: the commissioner check comes before anything else.
      const args = fn.args ? fn.args.split(', ').map((arg) => `null::${arg.split(' ').slice(1).join(' ')}`) : []
      const call = `select ${fn.signature.split('(')[0]}(${args.join(', ')})`
      await expectError(league.queryAs(OWNERS.b, call), /Only the commissioner/)
      await expectError(league.queryAs(STRANGER, call), /Only the commissioner/)
    }
  })

  it('turn strangers away from every owner action', async () => {
    const ownerActions = [
      `public.add_player(101)`, `public.drop_player(101)`, `public.claim_waiver(101)`,
      `public.withdraw_waiver_claim(101)`, `public.place_on_ir(101)`, `public.activate_from_ir(101)`,
      `public.keep_ir_replacement(101)`, `public.draft_pick(101)`, `public.draft_auto_pick()`,
      `public.propose_trade(gen_random_uuid(), '{101}', '{102}')`,
      `public.respond_to_trade(gen_random_uuid(), true)`, `public.withdraw_trade(gen_random_uuid())`,
      `public.veto_trade(gen_random_uuid())`, `public.counter_trade(gen_random_uuid(), '{101}', '{102}')`,
      `public.watch_player(101)`, `public.unwatch_player(101)`,
    ]
    for (const call of ownerActions) {
      await expectError(league.queryAs(STRANGER, `select ${call}`), /don't have a team|Only league members/)
      await expectError(league.queryAs(null, `select ${call}`), /permission denied/)
    }
  })
})

describe('views', () => {
  let views: string[]

  beforeAll(async () => {
    views = (await league.query<{ viewname: string }>(
      `select viewname from pg_views where schemaname = 'public' order by 1`,
    )).map((row) => row.viewname)
  })

  it('all run with the caller\'s permissions, not the owner\'s', async () => {
    expect(views.length).toBeGreaterThanOrEqual(12)
    const unsafe = await league.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'
        and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false)`)
    expect(unsafe.map((row) => row.relname)).toEqual([])
  })

  it('show nothing to signed-out visitors or strangers', async () => {
    for (const view of views) {
      await expectError(league.queryAs(null, `select * from public.${view}`), /permission denied/)
      expect(await league.queryAs(STRANGER, `select * from public.${view}`), view).toEqual([])
    }
  })

  it('show league data to members', async () => {
    expect(await league.queryAs(OWNERS.c, `select 1 from public.team_standings`)).toHaveLength(4)
    expect(await league.queryAs(OWNERS.c, `select 1 from public.player_pool`)).toHaveLength(62)
  })
})

describe('league config', () => {
  it('in the database matches league.config.ts', async () => {
    const [{ config }] = await league.query<{ config: unknown }>(`select config from public.league_settings`)
    expect(config).toEqual(JSON.parse(JSON.stringify(LEAGUE)))
  })

  it('is updated by the sync function when the file changes', async () => {
    const changed = { ...LEAGUE, windows: { ...LEAGUE.windows, waiverHours: 48 } }
    await expectError(league.rpc(OWNERS.a, 'push_config', { p_config: changed }), /permission denied/)
    await expectError(league.service('push_config', { p_config: { nonsense: true } }), /doesn't look like the league config/)

    await league.service('push_config', { p_config: changed })
    const [{ hours }] = await league.query<{ hours: string }>(
      `select extract(epoch from private.window_length('waiverHours'))::int / 3600 as hours`,
    )
    expect(Number(hours)).toBe(48)
  })
})
