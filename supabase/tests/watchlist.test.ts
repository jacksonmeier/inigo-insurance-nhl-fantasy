// Watchlists: private to each team, and a heads-up when a watched player
// becomes available.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  alertsFor, backdateRosters, COMMISH, createLeague, D, expectError, F, OWNERS, runDraft, STRANGER, TEAMS,
  type League, type TeamKey,
} from './helpers.ts'

let league: League

const watch = (team: TeamKey, player: number) => league.rpc(OWNERS[team], 'watch_player', { p_player_id: player })

const watched = async (team: TeamKey) =>
  (await league.queryAs<{ player_id: number }>(
    OWNERS[team],
    `select player_id::int as player_id from public.watchlist order by player_id`,
  )).map((row) => row.player_id)

const heardAbout = async (team: TeamKey) =>
  (await alertsFor(league, team)).filter((alert) => alert.type === 'watchlist').map((alert) => alert.message)

const closeWaiverWindows = () =>
  league.query(`update public.waivers set expires_at = now() - interval '1 minute' where status = 'open'`)

beforeEach(async () => {
  league = await createLeague()
  await runDraft(league)
  await backdateRosters(league)
})

describe('a watchlist', () => {
  it('belongs to one team, and only that team can see it', async () => {
    await watch('a', F(13))
    await watch('a', F(2)) // on Team B's roster
    await watch('a', F(13)) // a second time changes nothing
    await watch('b', F(14))

    expect(await watched('a')).toEqual([F(2), F(13)])
    expect(await watched('b')).toEqual([F(14)])
    expect(await watched('c')).toEqual([])
    expect(await league.queryAs(STRANGER, `select * from public.watchlist`)).toEqual([])
    await expectError(league.queryAs(null, `select * from public.watchlist`), /permission denied/)
  })

  it('changes only through the watch functions', async () => {
    await expectError(
      league.queryAs(OWNERS.a, `insert into public.watchlist (team_id, player_id) values ($1, $2)`, [TEAMS.b, F(13)]),
      /permission denied/,
    )
    await watch('b', F(13))
    await expectError(league.queryAs(OWNERS.a, `delete from public.watchlist`), /permission denied/)
    expect(await watched('b')).toEqual([F(13)])
  })

  it('refuses your own players, unknown players, and people without a team', async () => {
    await expectError(watch('a', F(1)), /Forward F1 \(L, EDM\) is already on your team/)
    await expectError(watch('a', 999), /Unknown player/)
    await expectError(league.rpc(STRANGER, 'watch_player', { p_player_id: F(13) }), /don't have a team/)
    await expectError(league.rpc(null, 'watch_player', { p_player_id: F(13) }), /permission denied/)
  })

  it('lets a player go', async () => {
    await watch('a', F(13))
    await league.rpc(OWNERS.a, 'unwatch_player', { p_player_id: F(13) })
    await league.rpc(OWNERS.a, 'unwatch_player', { p_player_id: F(13) })
    expect(await watched('a')).toEqual([])
  })

  it('loses a player once the team gets him, and only that team', async () => {
    await watch('a', F(13))
    await watch('b', F(13))
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13), p_drop_player_id: F(1) })

    expect(await watched('a')).toEqual([])
    expect(await watched('b')).toEqual([F(13)])
  })
})

describe('owners watching a player hear about it', () => {
  it('when he is dropped onto waivers', async () => {
    await watch('a', F(2))
    await watch('c', F(2))
    await league.rpc(OWNERS.b, 'drop_player', { p_player_id: F(2) })

    expect(await heardAbout('a')).toEqual([
      "Team B dropped Forward F2 (R, EDM), who's on your watchlist. He's on waivers, so you can put in a claim.",
    ])
    expect(await heardAbout('c')).toHaveLength(1)
    expect(await heardAbout('b')).toEqual([])
    expect(await heardAbout('d')).toEqual([])
  })

  it('when he clears waivers, but not when another owner claims him', async () => {
    await watch('a', F(2))
    await watch('a', F(7))
    await league.rpc(OWNERS.b, 'drop_player', { p_player_id: F(2) })
    await league.rpc(OWNERS.b, 'drop_player', { p_player_id: F(7) })
    await league.rpc(OWNERS.c, 'claim_waiver', { p_player_id: F(7), p_drop_player_id: F(3) })
    await closeWaiverWindows()
    await league.service('process_windows')

    expect(await heardAbout('a')).toEqual([
      "Team B dropped Forward F2 (R, EDM), who's on your watchlist. He's on waivers, so you can put in a claim.",
      "Team B dropped Forward F7 (L, EDM), who's on your watchlist. He's on waivers, so you can put in a claim.",
      "Forward F2 (R, EDM), who's on your watchlist, cleared waivers. He's a free agent, so the first owner to add him gets him.",
    ])
  })

  it('when he is released straight to free agency', async () => {
    // Team B's temporary IR replacement is released when the injured player comes back.
    await league.service('ingest_injuries', {
      p_rows: [{
        espn_athlete_id: 'e2', espn_name: 'Forward F2', espn_team: 'EDM', espn_position: 'RW',
        player_id: F(2), match_confidence: 'high', status: 'Out', description: 'Upper body',
      }],
    })
    await league.rpc(OWNERS.b, 'place_on_ir', { p_player_id: F(2) })
    await league.rpc(OWNERS.b, 'add_player', { p_player_id: F(13) })
    await watch('a', F(13))
    await league.rpc(OWNERS.b, 'activate_from_ir', { p_player_id: F(2) })

    // And the commissioner can take a player off a roster without waivers.
    await watch('d', D(3))
    await league.rpc(COMMISH, 'commish_remove_from_roster', { p_player_id: D(3), p_to_waivers: false })

    expect(await heardAbout('a')).toEqual([
      "Team B released Forward F13 (L, EDM), who's on your watchlist. He's a free agent, so the first owner to add him gets him.",
    ])
    expect(await heardAbout('d')).toEqual([
      "Team B released Defender D3 (D, TOR), who's on your watchlist. He's a free agent, so the first owner to add him gets him.",
    ])
  })

  it('but not when he only changes teams or roster spots', async () => {
    await watch('c', F(1))
    await watch('c', F(2))
    const id = await league.rpc<string>(OWNERS.a, 'propose_trade', {
      p_receiving_team_id: TEAMS.b, p_give_player_ids: [F(1)], p_receive_player_ids: [F(2)],
    })
    await league.rpc(OWNERS.b, 'respond_to_trade', { p_trade_id: id, p_accept: true })
    await league.query(`update public.trades set veto_deadline = now() - interval '1 minute'`)
    await league.service('process_windows')

    await league.service('ingest_injuries', {
      p_rows: [{
        espn_athlete_id: 'e1', espn_name: 'Forward F1', espn_team: 'EDM', espn_position: 'LW',
        player_id: F(1), match_confidence: 'high', status: 'Out', description: 'Upper body',
      }],
    })
    await league.rpc(OWNERS.b, 'place_on_ir', { p_player_id: F(1) })
    await league.rpc(OWNERS.b, 'activate_from_ir', { p_player_id: F(1) })

    expect(await heardAbout('c')).toEqual([])
    expect(await watched('c')).toEqual([F(1), F(2)])
  })
})
