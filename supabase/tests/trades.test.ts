// Trades: propose, accept, the veto window, and what happens when it closes.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  activity, alertsFor, backdateRosters, COMMISH, createLeague, D, expectError, F, G, OWNERS, runDraft,
  scoreGame, standings, STRANGER, TEAMS, type League, type TeamKey,
} from './helpers.ts'

let league: League

type Trade = { status: string; veto_hours: number | null }

const trade = async (id: string) =>
  (
    await league.query<Trade>(
      `select status, round(extract(epoch from veto_deadline - responded_at) / 3600)::int as veto_hours
       from public.trades where id = $1`,
      [id],
    )
  )[0]

const ids = async (team: TeamKey) => (await league.roster(team)).map((r) => r.player_id)

const closeVetoWindows = () =>
  league.query(`update public.trades set veto_deadline = now() - interval '1 minute' where status = 'accepted'`)

/** Team A offers F1 to Team B for F2. */
const propose = (give = [F(1)], receive = [F(2)], to: TeamKey = 'b') =>
  league.rpc<string>(OWNERS.a, 'propose_trade', {
    p_receiving_team_id: TEAMS[to],
    p_give_player_ids: give,
    p_receive_player_ids: receive,
    p_message: 'Deal?',
  })

beforeEach(async () => {
  league = await createLeague()
  await runDraft(league)
  await backdateRosters(league)
})

describe('proposing a trade', () => {
  it('alerts the other owner', async () => {
    const id = await propose()
    expect(await trade(id)).toEqual({ status: 'proposed', veto_hours: null })
    expect(await alertsFor(league, 'b')).toEqual([
      {
        type: 'trade_response_needed',
        message:
          'Team A proposed a trade: Team A gets Forward F2 (R, EDM); Team B gets Forward F1 (L, EDM).',
      },
    ])
    // Rosters don't change yet.
    expect(await ids('a')).toContain(F(1))
  })

  it('must leave both rosters valid', async () => {
    await expectError(propose([F(1)], [D(3)]), /Team A would have too many D \(3, limit 2\)/)
    await expectError(propose([F(1)], [F(2), F(7)]), /Team A would have too many F \(4, limit 3\)/)
    await expectError(propose([], []), /needs at least one player/)
    // Two for two across positions is fine.
    await propose([F(1), D(4)], [F(2), D(3)])
    expect(await league.query(`select 1 from public.trades`)).toHaveLength(1)
  })

  it('only involves players the two teams actually have', async () => {
    await expectError(propose([F(2)], [F(7)]), /Forward F2 \(R, EDM\) is no longer on Team A/)
    await expectError(propose([F(1)], [F(3)]), /Forward F3 \(C, EDM\) is no longer on Team B/)
    await expectError(propose([F(1)], [F(13)]), /is no longer on Team B/)
  })

  it('needs another team', async () => {
    await expectError(propose([F(1)], [F(8)], 'a'), /Choose another team/)
    await expectError(
      league.rpc(STRANGER, 'propose_trade', {
        p_receiving_team_id: TEAMS.b, p_give_player_ids: [F(1)], p_receive_player_ids: [F(2)],
      }),
      /don't have a team/,
    )
  })

  it('can be withdrawn until it is answered', async () => {
    const id = await propose()
    await expectError(league.rpc(OWNERS.b, 'withdraw_trade', { p_trade_id: id }), /isn't yours to withdraw/)
    await league.rpc(OWNERS.a, 'withdraw_trade', { p_trade_id: id })
    expect((await trade(id)).status).toBe('withdrawn')
    await expectError(league.rpc(OWNERS.b, 'respond_to_trade', { p_trade_id: id, p_accept: true }), /no longer open/)
  })
})

describe('answering a trade', () => {
  it('is up to the owner it was offered to', async () => {
    const id = await propose()
    await expectError(league.rpc(OWNERS.c, 'respond_to_trade', { p_trade_id: id, p_accept: true }), /isn't yours to answer/)
    await expectError(league.rpc(OWNERS.a, 'respond_to_trade', { p_trade_id: id, p_accept: true }), /isn't yours to answer/)
  })

  it('can be rejected', async () => {
    const id = await propose()
    await league.rpc(OWNERS.b, 'respond_to_trade', { p_trade_id: id, p_accept: false })
    expect((await trade(id)).status).toBe('rejected')
    expect(await alertsFor(league, 'a')).toEqual([
      { type: 'trade_update', message: 'Team B rejected your trade offer.' },
    ])
    expect(await activity(league, 'trade')).toEqual([])
  })

  it('starts a 24-hour veto window when accepted', async () => {
    const id = await propose()
    await league.rpc(OWNERS.b, 'respond_to_trade', { p_trade_id: id, p_accept: true })

    expect(await trade(id)).toEqual({ status: 'accepted', veto_hours: 24 })
    expect(await ids('a')).toContain(F(1)) // not yet

    expect((await alertsFor(league, 'c'))[0]).toEqual({
      type: 'trade_update',
      message:
        'Trade pending: Team A gets Forward F2 (R, EDM); Team B gets Forward F1 (L, EDM). You can veto it during the veto window.',
    })
    expect(await alertsFor(league, 'd')).toHaveLength(1)
    expect((await activity(league, 'trade'))[0].summary).toMatch(/^Trade agreed: Team A gets Forward F2/)
  })

  it('is refused if the trade stopped being valid while it sat there', async () => {
    const id = await propose()
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13), p_drop_player_id: F(1) })
    await expectError(
      league.rpc(OWNERS.b, 'respond_to_trade', { p_trade_id: id, p_accept: true }),
      /can't go through as offered: Forward F1 \(L, EDM\) is no longer on Team A/,
    )
  })
})

describe('the veto window', () => {
  let id: string

  beforeEach(async () => {
    id = await propose()
    await league.rpc(OWNERS.b, 'respond_to_trade', { p_trade_id: id, p_accept: true })
  })

  it('lets any owner outside the trade cancel it', async () => {
    await league.rpc(OWNERS.c, 'veto_trade', { p_trade_id: id })

    expect((await trade(id)).status).toBe('vetoed')
    expect(await activity(league, 'trade_veto')).toEqual([
      {
        type: 'trade_veto',
        summary: 'Team C vetoed the trade: Team A gets Forward F2 (R, EDM); Team B gets Forward F1 (L, EDM)',
      },
    ])
    expect((await alertsFor(league, 'a')).at(-1)?.message).toBe('Team C vetoed your trade with Team B.')
    expect((await alertsFor(league, 'b')).at(-1)?.message).toBe('Team C vetoed your trade with Team A.')

    await closeVetoWindows()
    await league.service('process_windows')
    expect(await ids('a')).toContain(F(1))
  })

  it('does not let the owners in the trade veto it', async () => {
    await expectError(league.rpc(OWNERS.a, 'veto_trade', { p_trade_id: id }), /can't veto your own trade/)
    await expectError(league.rpc(OWNERS.b, 'veto_trade', { p_trade_id: id }), /can't veto your own trade/)
  })

  it('closes after 24 hours', async () => {
    await closeVetoWindows()
    await expectError(league.rpc(OWNERS.c, 'veto_trade', { p_trade_id: id }), /veto window for that trade isn't open/)
  })

  it('does nothing until the window closes, then swaps the players', async () => {
    expect(await league.service('process_windows')).toEqual({ ir: 0, trades: 0, waivers: 0 })
    expect((await trade(id)).status).toBe('accepted')

    await closeVetoWindows()
    expect(await league.service('process_windows')).toEqual({ ir: 0, trades: 1, waivers: 0 })

    expect((await trade(id)).status).toBe('completed')
    expect(await ids('a')).toEqual([F(2), F(8), F(9), D(4), D(5), G(4)])
    expect(await ids('b')).toEqual([F(1), F(7), F(10), D(3), D(6), G(3)])
    // Traded players don't pass through waivers.
    expect(await league.query(`select 1 from public.waivers`)).toEqual([])
    expect((await activity(league, 'trade')).at(-1)?.summary).toBe(
      'Trade completed: Team A gets Forward F2 (R, EDM); Team B gets Forward F1 (L, EDM)',
    )
  })

  it('credits points to whoever had the player when the puck dropped', async () => {
    await scoreGame(league, [{ player: F(1), points: 10, goals: 1 }], `now() - interval '2 hours'`)
    await closeVetoWindows()
    await league.service('process_windows')
    // Move the trade into the past so a later game falls after it.
    await league.query(
      `update public.roster_entries set end_at = now() - interval '1 hour'
       where player_id in (${F(1)}, ${F(2)}) and end_at is not null`,
    )
    await league.query(
      `update public.roster_entries set start_at = now() - interval '1 hour'
       where player_id in (${F(1)}, ${F(2)}) and end_at is null`,
    )
    await scoreGame(league, [{ player: F(1), points: 7, goals: 2 }], `now() - interval '10 minutes'`)

    const table = await standings(league)
    expect(table.find((t) => t.name === 'Team A')).toMatchObject({ total_points: '10.00', total_goals: 1 })
    expect(table.find((t) => t.name === 'Team B')).toMatchObject({ total_points: '7.00', total_goals: 2 })
  })

  it('cancels the trade if a player left in the meantime', async () => {
    await league.rpc(OWNERS.b, 'add_player', { p_player_id: F(13), p_drop_player_id: F(2) })
    await closeVetoWindows()
    await league.service('process_windows')

    expect((await trade(id)).status).toBe('failed')
    expect(await ids('a')).toContain(F(1))
    expect((await alertsFor(league, 'a')).at(-1)?.message).toBe(
      'Your trade was cancelled. Forward F2 (R, EDM) is no longer on Team B.',
    )
  })
})

describe('players who cannot be traded', () => {
  beforeEach(async () => {
    await league.service('ingest_injuries', {
      p_rows: [{
        espn_athlete_id: 'e1', espn_name: 'Forward F1', espn_team: 'EDM', espn_position: 'LW',
        player_id: F(1), match_confidence: 'high', status: 'Out', description: 'Upper body',
      }],
    })
    await league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(1) })
  })

  it('include a player on IR', async () => {
    await expectError(propose([F(1)], [F(2)]), /Forward F1 \(L, EDM\) is on IR and can't be traded/)
  })

  it('include a temporary IR replacement', async () => {
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13) })
    await expectError(propose([F(13)], [F(2)]), /is a temporary IR replacement and can't be traded/)
  })

  it('and a trade cannot take the spot being held for a player on IR', async () => {
    // A has 2 active F plus one on IR with no replacement. Taking a third F
    // without giving one back would leave nowhere for F1 to return to.
    await expectError(propose([D(4)], [F(2)]), /Team A would have too many F \(4, limit 3\)/)
    await propose([F(8)], [F(2)])
  })
})

describe('the commissioner', () => {
  it('can push an accepted trade through early', async () => {
    const id = await propose()
    await expectError(
      league.rpc(COMMISH, 'commish_force_trade', { p_trade_id: id, p_execute: true }),
      /Both owners have to agree/,
    )
    await league.rpc(OWNERS.b, 'respond_to_trade', { p_trade_id: id, p_accept: true })
    await expectError(
      league.rpc(OWNERS.c, 'commish_force_trade', { p_trade_id: id, p_execute: true }),
      /Only the commissioner/,
    )

    expect(await league.rpc(COMMISH, 'commish_force_trade', { p_trade_id: id, p_execute: true })).toBe('completed')
    expect(await ids('b')).toContain(F(1))
    expect((await activity(league, 'commissioner')).at(-1)?.summary).toMatch(
      /^Commissioner: pushed a trade through early: Team A gets Forward F2/,
    )
  })

  it('can cancel a pending trade', async () => {
    const id = await propose([G(4)], [G(3)])
    expect(await league.rpc(COMMISH, 'commish_force_trade', { p_trade_id: id, p_execute: false })).toBe('cancelled')
    expect((await trade(id)).status).toBe('vetoed')
    await expectError(
      league.rpc(COMMISH, 'commish_force_trade', { p_trade_id: id, p_execute: false }),
      /already settled/,
    )
  })
})
