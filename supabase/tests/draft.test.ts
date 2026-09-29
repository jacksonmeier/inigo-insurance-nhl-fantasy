// The draft: snake order, turn-taking, roster limits, the pick clock, and the
// commissioner's pause, resume, undo and reset.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  COMMISH, createLeague, D, expectError, F, fillerPicks, G, OWNERS, runDraft, snakeTeam, STRANGER, TEAMS,
  type League, type TeamKey,
} from './helpers.ts'

type Draft = {
  status: string
  current_pick: number
  pick_seconds: number | null
  seconds_left: number | null
  paused_seconds_remaining: number | null
  draft_order: string[]
}

let league: League

const draft = async () =>
  (
    await league.query<Draft>(
      `select status, current_pick, pick_seconds, paused_seconds_remaining, draft_order,
              extract(epoch from pick_deadline - now())::float as seconds_left
       from public.drafts`,
    )
  )[0]

const ORDER: TeamKey[] = ['a', 'b', 'c', 'd']

async function startDraft(seconds: number | null = 120) {
  await league.rpc(COMMISH, 'draft_set_order', { p_order: ORDER.map((k) => TEAMS[k]) })
  await league.rpc(COMMISH, 'draft_set_timer', { p_seconds: seconds })
  await league.rpc(COMMISH, 'draft_start')
}

const expireClock = () =>
  league.query(`update public.drafts set pick_deadline = now() - interval '1 second' where true`)

beforeEach(async () => {
  league = await createLeague()
})

describe('draft order', () => {
  it('snakes: even rounds run in reverse', async () => {
    const rows = await league.query<{ pick: number; team: string }>(
      `select pick, private.draft_team_on_clock($1::uuid[], pick) as team from generate_series(1, 24) pick`,
      [`{${ORDER.map((k) => TEAMS[k]).join(',')}}`],
    )
    const expected = ['a', 'b', 'c', 'd', 'd', 'c', 'b', 'a', 'a', 'b', 'c', 'd'] as const
    expect(rows.slice(0, 12).map((r) => r.team)).toEqual(expected.map((k) => TEAMS[k]))
    for (const row of rows) expect(row.team).toBe(TEAMS[snakeTeam(ORDER, row.pick)])
  })

  it('is drawn at random by the commissioner and lists every team once', async () => {
    await league.rpc(COMMISH, 'draft_randomize_order')
    const { draft_order, status, pick_seconds } = await draft()
    expect(status).toBe('not_started')
    expect(pick_seconds).toBe(120)
    expect([...draft_order].sort()).toEqual(Object.values(TEAMS).sort())

    const log = await league.query<{ summary: string }>(`select summary from public.transactions`)
    expect(log[0].summary).toMatch(/^Draft order drawn at random: /)
  })

  it('can only be set by the commissioner', async () => {
    await expectError(league.rpc(OWNERS.b, 'draft_randomize_order'), /Only the commissioner/)
    await expectError(league.rpc(STRANGER, 'draft_randomize_order'), /Only the commissioner/)
    await expectError(league.rpc(null, 'draft_randomize_order'), /permission denied/)
  })

  it('rejects an order that misses a team or repeats one', async () => {
    await expectError(
      league.rpc(COMMISH, 'draft_set_order', { p_order: [TEAMS.a, TEAMS.b, TEAMS.c] }),
      /each of the 4 teams exactly once/,
    )
    await expectError(
      league.rpc(COMMISH, 'draft_set_order', { p_order: [TEAMS.a, TEAMS.b, TEAMS.c, TEAMS.c] }),
      /each of the 4 teams exactly once/,
    )
  })

  it('is locked once the draft starts', async () => {
    await startDraft()
    await expectError(league.rpc(COMMISH, 'draft_randomize_order'), /already started/)
  })
})

describe('starting the draft', () => {
  it('needs an order first', async () => {
    await expectError(league.rpc(COMMISH, 'draft_start'), /Draw the draft order first/)
  })

  it('needs players to draft', async () => {
    const empty = await createLeague({ players: false })
    await empty.rpc(COMMISH, 'draft_randomize_order')
    await expectError(empty.rpc(COMMISH, 'draft_start'), /Import NHL players/)
  })

  it('puts the first team on the clock', async () => {
    await startDraft()
    const d = await draft()
    expect(d.status).toBe('in_progress')
    expect(d.current_pick).toBe(1)
    expect(d.seconds_left).toBeGreaterThan(118)
    expect(d.seconds_left).toBeLessThanOrEqual(120)
  })
})

describe('making picks', () => {
  beforeEach(() => startDraft())

  it('only lets the team on the clock pick', async () => {
    await expectError(league.rpc(OWNERS.b, 'draft_pick', { p_player_id: F(1) }), /not your pick. Team A is on the clock/)
    await expectError(league.rpc(STRANGER, 'draft_pick', { p_player_id: F(1) }), /Only league members/)

    await league.rpc(OWNERS.a, 'draft_pick', { p_player_id: F(1) })
    expect((await draft()).current_pick).toBe(2)
    expect(await league.roster('a')).toEqual([
      { player_id: F(1), slot: 'active', is_ir_replacement: false, group: 'F' },
    ])
  })

  it('lets the commissioner pick for whoever is on the clock', async () => {
    await league.rpc(OWNERS.a, 'draft_pick', { p_player_id: F(1) })
    await league.rpc(COMMISH, 'draft_pick', { p_player_id: F(2) }) // Team B's pick
    expect((await league.roster('b')).map((r) => r.player_id)).toEqual([F(2)])
  })

  it('rejects a player who is already taken', async () => {
    await league.rpc(OWNERS.a, 'draft_pick', { p_player_id: F(1) })
    await expectError(league.rpc(OWNERS.b, 'draft_pick', { p_player_id: F(1) }), /already been drafted/)
    expect((await draft()).current_pick).toBe(2)
  })

  it('rejects an unknown player', async () => {
    await expectError(league.rpc(OWNERS.a, 'draft_pick', { p_player_id: 999999 }), /Unknown player/)
  })

  it('enforces the roster limits: 3 F, 2 D, 1 G', async () => {
    // Team A picks at 1, 8, 9, 16, 17 and 24. The others take legal picks in between.
    const filler = fillerPicks()
    const pickFor = async (pick: number, playerId: number) =>
      league.rpc(OWNERS[snakeTeam(ORDER, pick)], 'draft_pick', { p_player_id: playerId })
    const fillUntil = async (pick: number) => {
      for (let n = (await draft()).current_pick; n < pick; n++) await pickFor(n, filler(snakeTeam(ORDER, n)))
    }

    await pickFor(1, G(1))
    await fillUntil(8)
    await expectError(pickFor(8, G(2)), /Team A already has all 1 of its G spots filled/)
    await pickFor(8, D(1))
    await pickFor(9, D(2))
    await fillUntil(16)
    await expectError(pickFor(16, D(3)), /Team A already has all 2 of its D spots filled/)
    await pickFor(16, F(1))
    await pickFor(17, F(2))
    await fillUntil(24)
    await expectError(pickFor(24, D(4)), /already has all 2 of its D spots/)
    await pickFor(24, F(3))

    expect((await draft()).status).toBe('complete')
    for (const team of ORDER) {
      expect((await league.roster(team)).map((r) => r.group).sort(), team).toEqual(['D', 'D', 'F', 'F', 'F', 'G'])
    }
  })

  it('logs every pick to the activity feed', async () => {
    await league.rpc(OWNERS.a, 'draft_pick', { p_player_id: F(1) })
    const log = await league.query<{ type: string; summary: string; team_id: string }>(
      `select type, summary, team_id from public.transactions where type = 'draft_pick'`,
    )
    expect(log).toEqual([
      { type: 'draft_pick', team_id: TEAMS.a, summary: 'Round 1, pick 1: Team A selected Forward F1 (L, EDM)' },
    ])
  })
})

describe('a whole draft', () => {
  it('gives every team exactly 3 F, 2 D and 1 G, then opens free agency', async () => {
    await runDraft(league)

    const d = await draft()
    expect(d.status).toBe('complete')
    expect(d.seconds_left).toBeNull()

    expect((await league.roster('a')).map((r) => r.player_id)).toEqual([F(1), F(8), F(9), D(4), D(5), G(4)])
    expect((await league.roster('d')).map((r) => r.player_id)).toEqual([F(4), F(5), F(12), D(1), D(8), G(1)])
    for (const team of ORDER) {
      expect((await league.roster(team)).map((r) => r.group).sort(), team).toEqual(['D', 'D', 'F', 'F', 'F', 'G'])
    }

    const picks = await league.query<{ pick_number: number; round: number; team_id: string }>(
      `select pick_number, round, team_id from public.draft_picks order by pick_number`,
    )
    expect(picks).toHaveLength(24)
    expect(picks[4]).toEqual({ pick_number: 5, round: 2, team_id: TEAMS.d })

    await expectError(league.rpc(OWNERS.a, 'draft_pick', { p_player_id: F(20) }), /isn't running/)
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(20), p_drop_player_id: F(1) })
  })

  it('keeps free agency closed until it finishes', async () => {
    await startDraft()
    await league.rpc(OWNERS.a, 'draft_pick', { p_player_id: F(1) })
    await expectError(league.rpc(OWNERS.a, 'add_player', { p_player_id: F(20) }), /once the draft is complete/)
    await expectError(league.rpc(OWNERS.a, 'drop_player', { p_player_id: F(1) }), /once the draft is complete/)
  })
})

describe('the pick clock', () => {
  it('does nothing while there is time left', async () => {
    await startDraft()
    expect(await league.rpc(OWNERS.c, 'draft_auto_pick')).toBe(false)
    expect((await draft()).current_pick).toBe(1)
  })

  it('auto-picks the best available player when time runs out', async () => {
    await startDraft()
    await league.rpc(OWNERS.a, 'draft_pick', { p_player_id: F(1) })
    await expireClock()

    // Any open draft room can trigger it, not just the team on the clock.
    expect(await league.rpc(OWNERS.d, 'draft_auto_pick')).toBe(true)

    expect((await league.roster('b')).map((r) => r.player_id)).toEqual([F(2)])
    const d = await draft()
    expect(d.current_pick).toBe(3)
    expect(d.seconds_left).toBeGreaterThan(118)

    const [pick] = await league.query<{ is_auto_pick: boolean; picked_by: string | null }>(
      `select is_auto_pick, picked_by from public.draft_picks where pick_number = 2`,
    )
    expect(pick).toEqual({ is_auto_pick: true, picked_by: null })

    // A second room firing at the same moment must not skip the next team.
    expect(await league.rpc(OWNERS.a, 'draft_auto_pick')).toBe(false)
    expect((await draft()).current_pick).toBe(3)
  })

  it('only auto-picks positions the team still needs', async () => {
    await startDraft()
    // Team A takes forwards with picks 1, 8 and 9. The others take legal picks.
    const filler = fillerPicks()
    const forwards = [F(1), F(2), F(3)]
    for (let pick = 1; pick <= 15; pick++) {
      const team = snakeTeam(ORDER, pick)
      await league.rpc(OWNERS[team], 'draft_pick', { p_player_id: team === 'a' ? forwards.shift()! : filler(team) })
    }

    // Pick 16 is Team A's. F4 is the best player left, but A is full at F.
    await expireClock()
    expect(await league.rpc(OWNERS.b, 'draft_auto_pick')).toBe(true)
    expect((await league.roster('a')).map((r) => r.player_id)).toEqual([F(1), F(2), F(3), D(1)])
  })

  it('passes over an injured player while anyone healthy is left', async () => {
    await league.service('ingest_injuries', {
      p_rows: [
        { espn_athlete_id: 'e1', espn_name: 'F1', player_id: F(1), match_confidence: 'high', status: 'Out' },
        { espn_athlete_id: 'e2', espn_name: 'F2', player_id: F(2), match_confidence: 'high', status: 'Day-To-Day' },
      ],
    })
    await startDraft()
    await expireClock()
    await league.rpc(OWNERS.b, 'draft_auto_pick')

    // F1 is the best player but he's out. F2 is only day-to-day, so he's fine.
    expect((await league.roster('a')).map((r) => r.player_id)).toEqual([F(2)])
    // An owner can still choose the injured player themselves.
    await league.rpc(OWNERS.b, 'draft_pick', { p_player_id: F(1) })
  })

  it('still accepts a pick made just after time ran out', async () => {
    await startDraft()
    await expireClock()
    await league.rpc(OWNERS.a, 'draft_pick', { p_player_id: F(5) })
    expect((await league.roster('a')).map((r) => r.player_id)).toEqual([F(5)])
    expect(await league.rpc(OWNERS.a, 'draft_auto_pick')).toBe(false)
  })

  it('can be turned off', async () => {
    await startDraft(null)
    const d = await draft()
    expect(d.pick_seconds).toBeNull()
    expect(d.seconds_left).toBeNull()
    expect(await league.rpc(OWNERS.a, 'draft_auto_pick')).toBe(false)
  })

  it('restarts with the new length when the commissioner changes it mid-draft', async () => {
    await startDraft(120)
    await league.rpc(COMMISH, 'draft_set_timer', { p_seconds: 300 })
    expect((await draft()).seconds_left).toBeGreaterThan(298)
    await expectError(league.rpc(COMMISH, 'draft_set_timer', { p_seconds: 5 }), /between 10 seconds and 24 hours/)
    await expectError(league.rpc(OWNERS.b, 'draft_set_timer', { p_seconds: 60 }), /Only the commissioner/)
  })
})

describe('pause and resume', () => {
  beforeEach(() => startDraft())

  it('stops the clock and blocks picks while paused', async () => {
    await league.query(`update public.drafts set pick_deadline = now() + interval '47 seconds' where true`)
    await league.rpc(COMMISH, 'draft_pause')

    let d = await draft()
    expect(d.status).toBe('paused')
    expect(d.seconds_left).toBeNull()
    expect(d.paused_seconds_remaining).toBe(47)

    await expectError(league.rpc(OWNERS.a, 'draft_pick', { p_player_id: F(1) }), /draft is paused/)
    expect(await league.rpc(OWNERS.a, 'draft_auto_pick')).toBe(false)

    await league.rpc(COMMISH, 'draft_resume')
    d = await draft()
    expect(d.status).toBe('in_progress')
    expect(d.seconds_left).toBeGreaterThan(45)
    expect(d.seconds_left).toBeLessThanOrEqual(47)

    await league.rpc(OWNERS.a, 'draft_pick', { p_player_id: F(1) })
  })

  it('is for the commissioner only', async () => {
    await expectError(league.rpc(OWNERS.b, 'draft_pause'), /Only the commissioner/)
    await league.rpc(COMMISH, 'draft_pause')
    await expectError(league.rpc(OWNERS.b, 'draft_resume'), /Only the commissioner/)
    await expectError(league.rpc(COMMISH, 'draft_pause'), /isn't running/)
  })
})

describe('undo', () => {
  beforeEach(() => startDraft())

  it('takes back the last pick and puts that team on the clock again', async () => {
    await league.rpc(OWNERS.a, 'draft_pick', { p_player_id: F(1) })
    await league.rpc(OWNERS.b, 'draft_pick', { p_player_id: F(2) })

    await league.rpc(COMMISH, 'draft_undo_last_pick')

    const d = await draft()
    expect(d.current_pick).toBe(2)
    expect(d.status).toBe('in_progress')
    expect(d.seconds_left).toBeGreaterThan(118)
    expect(await league.roster('b')).toEqual([])
    expect((await league.roster('a')).map((r) => r.player_id)).toEqual([F(1)])

    // The player is back in the pool and Team B picks again.
    await league.rpc(OWNERS.b, 'draft_pick', { p_player_id: F(2) })
    expect((await draft()).current_pick).toBe(3)

    const log = await league.query<{ summary: string }>(
      `select summary from public.transactions where type = 'commissioner' and details ->> 'action' = 'draft_undo'`,
    )
    expect(log).toEqual([{ summary: 'Commissioner undid pick 2: Team B selecting Forward F2 (R, EDM)' }])
  })

  it('reopens a finished draft', async () => {
    const fresh = await createLeague()
    await runDraft(fresh)
    await fresh.rpc(COMMISH, 'draft_undo_last_pick')
    const [d] = await fresh.query<Draft>(`select status, current_pick from public.drafts`)
    expect(d).toMatchObject({ status: 'in_progress', current_pick: 24 })
    expect((await fresh.roster('a')).map((r) => r.player_id)).toEqual([F(1), F(8), F(9), D(4), D(5)])
  })

  it('stays paused if the draft was paused', async () => {
    await league.rpc(OWNERS.a, 'draft_pick', { p_player_id: F(1) })
    await league.rpc(COMMISH, 'draft_pause')
    await league.rpc(COMMISH, 'draft_undo_last_pick')
    const d = await draft()
    expect(d).toMatchObject({ status: 'paused', current_pick: 1, paused_seconds_remaining: 120 })
  })

  it('has nothing to undo before the first pick, and is commissioner-only', async () => {
    await expectError(league.rpc(COMMISH, 'draft_undo_last_pick'), /no picks to undo/)
    await league.rpc(OWNERS.a, 'draft_pick', { p_player_id: F(1) })
    await expectError(league.rpc(OWNERS.b, 'draft_undo_last_pick'), /Only the commissioner/)
  })
})

describe('reset', () => {
  it('wipes a practice draft so the real one can start clean', async () => {
    await runDraft(league)
    await league.rpc(COMMISH, 'draft_reset')

    const d = await draft()
    expect(d).toMatchObject({ status: 'not_started', current_pick: 1 })
    expect(await league.query(`select 1 from public.draft_picks`)).toEqual([])
    expect(await league.query(`select 1 from public.roster_entries`)).toEqual([])
    expect(await league.query(`select 1 from public.transactions where type = 'draft_pick'`)).toEqual([])

    await league.rpc(COMMISH, 'draft_randomize_order')
    await league.rpc(COMMISH, 'draft_start')
    expect((await draft()).status).toBe('in_progress')
  })

  it('is refused once rosters have changed', async () => {
    await runDraft(league)
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(20), p_drop_player_id: F(1) })
    await expectError(league.rpc(COMMISH, 'draft_reset'), /Rosters have changed since the draft/)
    await expectError(league.rpc(OWNERS.b, 'draft_reset'), /Only the commissioner/)
  })
})
