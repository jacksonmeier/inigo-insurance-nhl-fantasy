// Free agency and waivers.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  activity, alertsFor, backdateRosters, COMMISH, createLeague, D, expectError, F, G, OWNERS, runDraft,
  scoreGame, STRANGER, TEAMS, type League,
} from './helpers.ts'

let league: League

type Waiver = { player_id: number; status: string; hours_left: number | null; awarded_team_id: string | null }

const waivers = () =>
  league.query<Waiver>(
    `select player_id::int as player_id, status, awarded_team_id,
            round(extract(epoch from expires_at - created_at) / 3600)::int as hours_left
     from public.waivers order by created_at, player_id`,
  )

const closeWaiverWindows = () =>
  league.query(`update public.waivers set expires_at = now() - interval '1 minute' where status = 'open'`)

const ids = async (team: 'a' | 'b' | 'c' | 'd') => (await league.roster(team)).map((r) => r.player_id)

beforeEach(async () => {
  league = await createLeague()
  await runDraft(league)
  await backdateRosters(league)
})

describe('adding a free agent', () => {
  it('needs an open slot at that position', async () => {
    await expectError(league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13) }), /No open F slot. Drop a F first/)
    await expectError(league.rpc(OWNERS.a, 'add_player', { p_player_id: G(5) }), /No open G slot/)
  })

  it('works as an add and drop in one move', async () => {
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13), p_drop_player_id: F(9) })

    expect(await ids('a')).toEqual([F(1), F(8), F(13), D(4), D(5), G(4)])
    expect(await waivers()).toEqual([{ player_id: F(9), status: 'open', hours_left: 24, awarded_team_id: null }])
    expect(await activity(league, 'add')).toEqual([
      { type: 'add', summary: 'Team A added Forward F13 (L, EDM) and dropped Forward F9 (C, EDM)' },
    ])
  })

  it('must drop the same position to make room', async () => {
    await expectError(
      league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13), p_drop_player_id: D(4) }),
      /No open F slot/,
    )
    // Nothing happened: the drop was rolled back with the failed add.
    expect(await ids('a')).toEqual([F(1), F(8), F(9), D(4), D(5), G(4)])
    expect(await waivers()).toEqual([])
  })

  it('can fill a slot left open by an earlier drop', async () => {
    await league.rpc(OWNERS.a, 'drop_player', { p_player_id: D(5) })
    expect(await ids('a')).toEqual([F(1), F(8), F(9), D(4), G(4)])

    await league.rpc(OWNERS.a, 'add_player', { p_player_id: D(9) })
    expect(await ids('a')).toEqual([F(1), F(8), F(9), D(4), D(9), G(4)])
  })

  it('is first come, first served', async () => {
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13), p_drop_player_id: F(9) })
    await expectError(
      league.rpc(OWNERS.b, 'add_player', { p_player_id: F(13), p_drop_player_id: F(10) }),
      /Forward F13 \(L, EDM\) is already on a roster/,
    )
    expect(await ids('b')).toEqual([F(2), F(7), F(10), D(3), D(6), G(3)])
  })

  it('refuses a player who is on waivers', async () => {
    await league.rpc(OWNERS.a, 'drop_player', { p_player_id: F(9) })
    await expectError(
      league.rpc(OWNERS.b, 'add_player', { p_player_id: F(9), p_drop_player_id: F(10) }),
      /is on waivers. Place a claim instead/,
    )
  })

  it('only works on your own roster', async () => {
    await expectError(
      league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13), p_drop_player_id: F(2) }),
      /Forward F2 \(R, EDM\) is not on that roster/,
    )
    await expectError(league.rpc(OWNERS.a, 'drop_player', { p_player_id: F(2) }), /is not on that roster/)
    await expectError(league.rpc(STRANGER, 'add_player', { p_player_id: F(13) }), /don't have a team/)
    await expectError(league.rpc(null, 'add_player', { p_player_id: F(13) }), /permission denied/)
  })
})

describe('waivers', () => {
  beforeEach(async () => {
    // Standings: A 10, B 20, C 30, D 40. So A is lowest and has first call.
    await scoreGame(league, [
      { player: F(1), points: 10 }, { player: F(2), points: 20 },
      { player: F(3), points: 30 }, { player: F(4), points: 40 },
    ])
    await league.rpc(OWNERS.d, 'drop_player', { p_player_id: F(12) })
  })

  it('go to the claimant lowest on the leaderboard', async () => {
    await league.rpc(OWNERS.c, 'claim_waiver', { p_player_id: F(12), p_drop_player_id: F(11) })
    await league.rpc(OWNERS.b, 'claim_waiver', { p_player_id: F(12), p_drop_player_id: F(10) })

    // Nothing happens until the window closes.
    expect(await league.service('process_windows')).toEqual({ ir: 0, trades: 0, waivers: 0 })
    expect(await ids('b')).toContain(F(10))

    await closeWaiverWindows()
    expect(await league.service('process_windows')).toEqual({ ir: 0, trades: 0, waivers: 1 })

    expect(await ids('b')).toEqual([F(2), F(7), F(12), D(3), D(6), G(3)])
    expect(await ids('c')).toContain(F(11))

    // The player B dropped to make room starts his own 24 hours on waivers.
    expect(await waivers()).toMatchObject([
      { player_id: F(12), status: 'awarded', awarded_team_id: TEAMS.b },
      { player_id: F(10), status: 'open', hours_left: 24, awarded_team_id: null },
    ])
    expect(await activity(league, 'waiver_claim')).toEqual([
      {
        type: 'waiver_claim',
        summary: 'Team B claimed Forward F12 (C, EDM) off waivers and dropped Forward F10 (L, EDM)',
      },
    ])
    expect(await alertsFor(league, 'b')).toEqual([
      { type: 'waiver_processed', message: "Your claim on Forward F12 (C, EDM) won. He's on your roster." },
    ])
    expect(await alertsFor(league, 'c')).toEqual([
      { type: 'waiver_processed', message: 'Your claim on Forward F12 (C, EDM) lost to Team B.' },
    ])
  })

  it('break a tie in the standings by who claimed first', async () => {
    await league.query(`delete from public.player_game_points where true`)
    await league.rpc(OWNERS.c, 'claim_waiver', { p_player_id: F(12), p_drop_player_id: F(11) })
    await league.rpc(OWNERS.a, 'claim_waiver', { p_player_id: F(12), p_drop_player_id: F(9) })
    await closeWaiverWindows()
    await league.service('process_windows')
    expect(await ids('c')).toContain(F(12))
    expect(await ids('a')).not.toContain(F(12))
  })

  it('skip a claim that no longer fits and move to the next one', async () => {
    await league.rpc(OWNERS.a, 'claim_waiver', { p_player_id: F(12), p_drop_player_id: F(9) })
    await league.rpc(OWNERS.b, 'claim_waiver', { p_player_id: F(12), p_drop_player_id: F(10) })

    // Before the window closes, A swaps F9 for someone else. A's claim names a
    // player who's gone, and A's forwards are full.
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13), p_drop_player_id: F(9) })

    await closeWaiverWindows()
    await league.service('process_windows')

    expect(await ids('a')).toEqual([F(1), F(8), F(13), D(4), D(5), G(4)])
    expect(await ids('b')).toContain(F(12))
    expect((await alertsFor(league, 'a'))[0].message).toMatch(/couldn't be processed because your roster had no room/)

    const claims = await league.query<{ team_id: string; status: string }>(
      `select c.team_id, c.status from public.waiver_claims c
       join public.waivers w on w.id = c.waiver_id where w.player_id = $1 order by c.created_at`,
      [F(12)],
    )
    expect(claims).toEqual([
      { team_id: TEAMS.a, status: 'invalid' },
      { team_id: TEAMS.b, status: 'won' },
    ])
  })

  it('clear to free agency when nobody claims', async () => {
    await closeWaiverWindows()
    await league.service('process_windows')
    expect((await waivers())[0]).toMatchObject({ player_id: F(12), status: 'cleared' })

    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(12), p_drop_player_id: F(9) })
    expect(await ids('a')).toContain(F(12))
  })

  it('need room on the roster, or a player to drop', async () => {
    await expectError(
      league.rpc(OWNERS.a, 'claim_waiver', { p_player_id: F(12) }),
      /No open F slot. Choose a F to drop if your claim wins/,
    )
    await expectError(
      league.rpc(OWNERS.a, 'claim_waiver', { p_player_id: F(12), p_drop_player_id: D(4) }),
      /No open F slot/,
    )
    await expectError(
      league.rpc(OWNERS.a, 'claim_waiver', { p_player_id: F(12), p_drop_player_id: F(2) }),
      /is not on your active roster/,
    )
    await expectError(league.rpc(OWNERS.a, 'claim_waiver', { p_player_id: F(13) }), /is not on waivers/)

    // Team D dropped him, so D has the open slot and may claim him back.
    await league.rpc(OWNERS.d, 'claim_waiver', { p_player_id: F(12) })
  })

  it('cannot be claimed after the window has closed', async () => {
    await closeWaiverWindows()
    await expectError(
      league.rpc(OWNERS.a, 'claim_waiver', { p_player_id: F(12), p_drop_player_id: F(9) }),
      /waiver window for Forward F12 \(C, EDM\) has closed/,
    )
  })

  it('let an owner change or withdraw a claim', async () => {
    await league.rpc(OWNERS.a, 'claim_waiver', { p_player_id: F(12), p_drop_player_id: F(9) })
    await league.rpc(OWNERS.a, 'claim_waiver', { p_player_id: F(12), p_drop_player_id: F(8) })
    const claims = await league.query<{ drop_player_id: number }>(
      `select drop_player_id::int as drop_player_id from public.waiver_claims`,
    )
    expect(claims).toEqual([{ drop_player_id: F(8) }])

    await league.rpc(OWNERS.a, 'withdraw_waiver_claim', { p_player_id: F(12) })
    await expectError(league.rpc(OWNERS.a, 'withdraw_waiver_claim', { p_player_id: F(12) }), /don't have a pending claim/)

    await closeWaiverWindows()
    await league.service('process_windows')
    expect(await ids('a')).toEqual([F(1), F(8), F(9), D(4), D(5), G(4)])
    expect((await waivers())[0].status).toBe('cleared')
  })

  it('keep claims private until they are processed', async () => {
    await league.rpc(OWNERS.b, 'claim_waiver', { p_player_id: F(12), p_drop_player_id: F(10) })
    const count = async (uid: string) =>
      (await league.queryAs(uid, `select 1 from public.waiver_claims`)).length
    expect(await count(OWNERS.b)).toBe(1)
    expect(await count(OWNERS.c)).toBe(0)
    expect(await count(COMMISH)).toBe(1)
  })
})

describe('processing', () => {
  it('can only be run by the scheduler or the commissioner', async () => {
    await expectError(league.rpc(OWNERS.b, 'process_windows'), /permission denied/)
    await expectError(league.rpc(OWNERS.b, 'commish_process_now'), /Only the commissioner/)
    expect(await league.rpc(COMMISH, 'commish_process_now')).toEqual({ ir: 0, trades: 0, waivers: 0 })
  })
})
