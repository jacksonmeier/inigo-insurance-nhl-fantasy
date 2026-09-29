// Injured reserve: eligibility, temporary replacements, and the 24-hour
// decision once the injured player is healthy again.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  activity, alertsFor, backdateRosters, COMMISH, createLeague, D, expectError, F, G, json, OWNERS, runDraft,
  scoreGame, standings, TEAMS, type League, type TeamKey,
} from './helpers.ts'

let league: League

type Injury = { player: number; status: string; espnId?: string; confidence?: string; name?: string }

/** What the sync function sends after reading ESPN: the whole current list. */
const espnReports = (injuries: Injury[]) =>
  league.service<Record<string, number>>('ingest_injuries', {
    p_rows: injuries.map((injury) => ({
      espn_athlete_id: injury.espnId ?? `espn-${injury.player}`,
      espn_name: injury.name ?? `Player ${injury.player}`,
      espn_team: 'EDM',
      espn_position: 'C',
      player_id: injury.player,
      match_confidence: injury.confidence ?? 'high',
      status: injury.status,
      description: 'Lower body',
    })),
  })

// ESPN always lists somebody. This player is nobody's, so he never matters.
const SOMEONE_ELSE: Injury = { player: F(30), status: 'Out' }

type Stint = {
  ir_player_id: number
  replacement_player_id: number | null
  resolution: string | null
  is_healthy: boolean
  hours_to_decide: number | null
}

const stints = () =>
  league.query<Stint>(
    `select ir_player_id::int as ir_player_id, replacement_player_id::int as replacement_player_id, resolution,
            healthy_at is not null as is_healthy,
            round(extract(epoch from decision_deadline - healthy_at) / 3600)::int as hours_to_decide
     from public.ir_stints order by placed_at`,
  )

const roster = async (team: TeamKey) =>
  (await league.roster(team)).map((r) => `${r.player_id}${r.slot === 'ir' ? ' IR' : ''}${r.is_ir_replacement ? ' temp' : ''}`)

/** Alerts about the return from IR, leaving out the earlier "he's injured" one. */
const returnAlerts = async (team: TeamKey) =>
  (await alertsFor(league, team)).filter((alert) => alert.type !== 'ir_eligible')

const closeDecisionWindows = () =>
  league.query(
    `update public.ir_stints set decision_deadline = now() - interval '1 minute' where decision_deadline is not null`,
  )

beforeEach(async () => {
  league = await createLeague()
  await runDraft(league)
  await backdateRosters(league)
})

describe('moving a player to IR', () => {
  it('needs ESPN to list him as Out or Injured Reserve', async () => {
    await expectError(
      league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(1) }),
      /isn't listed as Out or on Injured Reserve/,
    )

    await espnReports([{ player: F(1), status: 'Day-To-Day' }])
    await expectError(league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(1) }), /isn't listed as Out/)

    await espnReports([{ player: F(1), status: 'Out' }])
    await league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(1) })
    expect(await roster('a')).toEqual([`${F(8)}`, `${F(9)}`, `${D(4)}`, `${D(5)}`, `${G(4)}`, `${F(1)} IR`])

    await espnReports([{ player: F(1), status: 'Out' }, { player: D(3), status: 'Injured Reserve' }])
    await league.rpc(OWNERS.b, 'place_on_ir', { p_player_id: D(3) })
    expect(await activity(league, 'ir_place')).toEqual([
      { type: 'ir_place', summary: 'Team A placed Forward F1 (L, EDM) on IR (Out)' },
      { type: 'ir_place', summary: 'Team B placed Defender D3 (D, TOR) on IR (Injured Reserve)' },
    ])
  })

  it('is limited to one IR slot', async () => {
    await espnReports([{ player: F(1), status: 'Out' }, { player: F(8), status: 'Out' }])
    await league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(1) })
    await expectError(league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(8) }), /Your IR slot is full/)
    // The second injured player stays active, earning nothing, unless he's dropped.
    expect(await roster('a')).toContain(`${F(8)}`)
  })

  it('only works on your own players', async () => {
    await espnReports([{ player: F(2), status: 'Out' }])
    await expectError(league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(2) }), /is not on your roster/)
  })

  it('stops him earning points, while his replacement earns them', async () => {
    await espnReports([{ player: F(1), status: 'Out' }])
    await league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(1) })
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13) })
    // Pretend both moves happened two hours ago, before tonight's game.
    await league.query(
      `update public.roster_entries set end_at = now() - interval '2 hours'
       where end_at is not null and player_id = ${F(1)}`,
    )
    await league.query(
      `update public.roster_entries set start_at = now() - interval '2 hours'
       where end_at is null and player_id in (${F(1)}, ${F(13)})`,
    )

    await scoreGame(league, [{ player: F(1), points: 50 }, { player: F(13), points: 4 }, { player: F(8), points: 1 }])
    expect((await standings(league)).find((t) => t.name === 'Team A')?.total_points).toBe('5.00')
  })
})

describe('the temporary replacement', () => {
  beforeEach(async () => {
    await espnReports([{ player: F(1), status: 'Out' }])
    await league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(1) })
  })

  it('is a free agent of the same position group', async () => {
    await expectError(league.rpc(OWNERS.a, 'add_player', { p_player_id: D(9) }), /No open D slot/)

    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13) })
    expect(await roster('a')).toEqual([
      `${F(8)}`, `${F(9)}`, `${F(13)} temp`, `${D(4)}`, `${D(5)}`, `${G(4)}`, `${F(1)} IR`,
    ])
    expect((await stints())[0]).toMatchObject({ ir_player_id: F(1), replacement_player_id: F(13) })
    expect((await activity(league, 'add'))[0].summary).toBe(
      'Team A added Forward F13 (L, EDM) as a temporary IR replacement',
    )

    // Only one replacement per injured player.
    await expectError(league.rpc(OWNERS.a, 'add_player', { p_player_id: F(14) }), /No open F slot/)
  })

  it('can be swapped for a different one', async () => {
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13) })
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(14), p_drop_player_id: F(13) })

    expect(await roster('a')).toContain(`${F(14)} temp`)
    expect((await stints())[0].replacement_player_id).toBe(F(14))
    expect(await league.query(`select 1 from public.waivers where player_id = ${F(13)} and status = 'open'`)).toHaveLength(1)
  })

  it('is whoever fills the injured player\'s spot, not an ordinary open slot', async () => {
    // Two open F slots: one from a plain drop, one held for the injured F1.
    await league.rpc(OWNERS.a, 'drop_player', { p_player_id: F(9) })

    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13) })
    expect(await roster('a')).toContain(`${F(13)}`)

    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(14) })
    expect(await roster('a')).toContain(`${F(14)} temp`)
  })

  it('cannot go on IR himself', async () => {
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13) })
    await espnReports([{ player: F(1), status: 'Out' }, { player: F(13), status: 'Out' }])
    await expectError(league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(13) }), /temporary replacement. Drop him instead/)
  })
})

describe('when the injured player is healthy again', () => {
  beforeEach(async () => {
    await espnReports([{ player: F(1), status: 'Injured Reserve' }])
    await league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(1) })
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13) })
  })

  it('nothing changes while ESPN still lists him as out', async () => {
    expect(await espnReports([{ player: F(1), status: 'Out' }])).toMatchObject({ healthy: 0 })
    expect((await stints())[0]).toMatchObject({ is_healthy: false, hours_to_decide: null })
    expect(await returnAlerts('a')).toEqual([])
  })

  it('the owner is alerted and gets 24 hours, whether he drops off the list or is day-to-day', async () => {
    expect(await espnReports([{ player: F(1), status: 'Day-To-Day' }])).toMatchObject({ healthy: 1 })

    expect((await stints())[0]).toMatchObject({ is_healthy: true, hours_to_decide: 24 })
    expect(await returnAlerts('a')).toEqual([
      {
        type: 'ir_player_healthy',
        message:
          "Forward F1 (L, EDM) is no longer listed as out. Activate him, or keep Forward F13 (L, EDM) and drop him. If you do nothing he'll be activated automatically when the window closes.",
      },
    ])

    // Later syncs don't restart the clock or repeat the alert.
    await league.query(`update public.ir_stints set healthy_at = healthy_at - interval '3 hours', decision_deadline = decision_deadline - interval '3 hours' where true`)
    await espnReports([SOMEONE_ELSE])
    expect(await returnAlerts('a')).toHaveLength(1)
    expect((await stints())[0]).toMatchObject({ is_healthy: true, hours_to_decide: 24 })
  })

  it('activating him releases the replacement straight to free agency', async () => {
    await espnReports([SOMEONE_ELSE])
    await league.rpc(OWNERS.a, 'activate_from_ir', { p_player_id: F(1) })

    expect(await roster('a')).toEqual([`${F(1)}`, `${F(8)}`, `${F(9)}`, `${D(4)}`, `${D(5)}`, `${G(4)}`])
    expect((await stints())[0]).toMatchObject({ resolution: 'activated' })
    expect(await league.query(`select 1 from public.waivers`)).toEqual([])
    expect((await activity(league, 'ir_activate'))[0].summary).toBe(
      'Team A activated Forward F1 (L, EDM) from IR. Forward F13 (L, EDM) was released to free agency',
    )

    // No waiver wait: anyone can add the released replacement right away.
    await league.rpc(OWNERS.b, 'add_player', { p_player_id: F(13), p_drop_player_id: F(10) })
  })

  it('keeping the replacement drops the injured player to waivers', async () => {
    await espnReports([SOMEONE_ELSE])
    await league.rpc(OWNERS.a, 'keep_ir_replacement', { p_player_id: F(1) })

    expect(await roster('a')).toEqual([`${F(8)}`, `${F(9)}`, `${F(13)}`, `${D(4)}`, `${D(5)}`, `${G(4)}`])
    expect((await stints())[0]).toMatchObject({ resolution: 'kept_replacement' })
    expect(await league.query(`select 1 from public.waivers where player_id = ${F(1)} and status = 'open'`)).toHaveLength(1)
    expect((await activity(league, 'ir_keep_replacement'))[0].summary).toBe(
      'Team A kept Forward F13 (L, EDM) and dropped Forward F1 (L, EDM) from IR',
    )

    // The IR slot is free again.
    await espnReports([{ player: F(8), status: 'Out' }])
    await league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(8) })
  })

  it('doing nothing activates him automatically after 24 hours', async () => {
    await espnReports([SOMEONE_ELSE])

    expect(await league.service('process_windows')).toMatchObject({ ir: 0 })
    expect(await roster('a')).toContain(`${F(1)} IR`)

    await closeDecisionWindows()
    expect(await league.service('process_windows')).toMatchObject({ ir: 1 })

    expect(await roster('a')).toEqual([`${F(1)}`, `${F(8)}`, `${F(9)}`, `${D(4)}`, `${D(5)}`, `${G(4)}`])
    expect((await stints())[0]).toMatchObject({ resolution: 'auto_activated' })
    expect((await activity(league, 'ir_activate'))[0].summary).toBe(
      'Forward F1 (L, EDM) was activated from IR automatically for Team A. Forward F13 (L, EDM) was released to free agency',
    )
  })

  it('the window is called off if he is listed as out again', async () => {
    await espnReports([SOMEONE_ELSE])
    expect(await espnReports([{ player: F(1), status: 'Out' }])).toMatchObject({ relapsed: 1 })

    expect((await stints())[0]).toMatchObject({ is_healthy: false, hours_to_decide: null })
    expect((await alertsFor(league, 'a')).at(-1)).toEqual({
      type: 'general',
      message: 'Forward F1 (L, EDM) is listed as out again, so he stays on IR.',
    })
    await closeDecisionWindows()
    expect(await league.service('process_windows')).toMatchObject({ ir: 0 })
  })

  it('the owner can also decide early, or just drop him', async () => {
    await league.rpc(OWNERS.a, 'drop_player', { p_player_id: F(1) })
    expect(await roster('a')).toEqual([`${F(8)}`, `${F(9)}`, `${F(13)}`, `${D(4)}`, `${D(5)}`, `${G(4)}`])
    expect((await stints())[0]).toMatchObject({ resolution: 'dropped' })
  })

  it('only the owner can decide', async () => {
    await expectError(league.rpc(OWNERS.b, 'activate_from_ir', { p_player_id: F(1) }), /is not on your IR/)
    await expectError(league.rpc(OWNERS.b, 'keep_ir_replacement', { p_player_id: F(1) }), /is not on your IR/)
  })
})

describe('with no replacement', () => {
  beforeEach(async () => {
    await espnReports([{ player: G(4), status: 'Out' }])
    await league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: G(4) })
  })

  it('activating just moves him back', async () => {
    await league.rpc(OWNERS.a, 'activate_from_ir', { p_player_id: G(4) })
    expect(await roster('a')).toEqual([`${F(1)}`, `${F(8)}`, `${F(9)}`, `${D(4)}`, `${D(5)}`, `${G(4)}`])
  })

  it('there is nobody to keep', async () => {
    await expectError(
      league.rpc(OWNERS.a, 'keep_ir_replacement', { p_player_id: G(4) }),
      /no replacement to keep. Drop Goalie G4 \(G, BOS\) instead/,
    )
  })
})

describe('alerts for newly injured players', () => {
  it('go to the owner once, when the player becomes IR-eligible', async () => {
    await espnReports([{ player: F(2), status: 'Day-To-Day' }, { player: F(13), status: 'Out' }])
    expect(await alertsFor(league, 'b')).toEqual([])

    expect(await espnReports([{ player: F(2), status: 'Out' }])).toMatchObject({ newly_eligible: 1 })
    expect(await alertsFor(league, 'b')).toEqual([
      { type: 'ir_eligible', message: 'Forward F2 (R, EDM) is listed as Out. You can move him to IR.' },
    ])

    await espnReports([{ player: F(2), status: 'Out' }])
    expect(await alertsFor(league, 'b')).toHaveLength(1)
  })

  it('are private to that owner', async () => {
    await espnReports([{ player: F(2), status: 'Out' }])
    const seenBy = async (uid: string) => (await league.queryAs(uid, `select 1 from public.alerts`)).length
    expect(await seenBy(OWNERS.b)).toBe(1)
    expect(await seenBy(OWNERS.c)).toBe(0)
  })
})

describe('the injury feed', () => {
  it('is never replaced by an empty list', async () => {
    await espnReports([{ player: F(1), status: 'Out' }])
    await league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(1) })

    await expectError(league.service('ingest_injuries', { p_rows: json([]) }), /Refusing to clear the injury list/)
    expect((await stints())[0].is_healthy).toBe(false)
  })

  it('cannot be written from the browser', async () => {
    await expectError(
      league.rpc(OWNERS.a, 'ingest_injuries', { p_rows: [{ espn_athlete_id: 'x', status: 'Out', player_id: F(2) }] }),
      /permission denied/,
    )
  })

  it('keeps players it could not match, flagged for the commissioner', async () => {
    const result = await league.service<Record<string, number>>('ingest_injuries', {
      p_rows: [
        { espn_athlete_id: 'e-1', espn_name: 'Forward F1', player_id: F(1), match_confidence: 'high', status: 'Out' },
        { espn_athlete_id: 'e-2', espn_name: 'Fwd F2', player_id: F(2), match_confidence: 'low', status: 'Out' },
        { espn_athlete_id: 'e-3', espn_name: 'Mystery Man', player_id: null, match_confidence: 'unmatched', status: 'Out' },
      ],
    })
    expect(result).toMatchObject({ injuries: 3, unmatched: 1, low_confidence: 1 })
  })

  it('never overwrites a match the commissioner made by hand', async () => {
    const rows = [
      { espn_athlete_id: 'e-3', espn_name: 'Mystery Man', player_id: null, match_confidence: 'unmatched', status: 'Out' },
    ]
    await league.service('ingest_injuries', { p_rows: rows })
    await expectError(league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(1) }), /isn't listed as Out/)

    await expectError(
      league.rpc(OWNERS.b, 'commish_map_espn_player', { p_espn_athlete_id: 'e-3', p_player_id: F(1) }),
      /Only the commissioner/,
    )
    await league.rpc(COMMISH, 'commish_map_espn_player', { p_espn_athlete_id: 'e-3', p_player_id: F(1) })

    // Fixed straight away, and still fixed after the next sync guesses again.
    await league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(1) })
    await league.service('ingest_injuries', { p_rows: [{ ...rows[0], player_id: F(2), match_confidence: 'low' }] })

    const map = await league.query(`select player_id::int as player_id, match_confidence from public.espn_player_map`)
    expect(map).toEqual([{ player_id: F(1), match_confidence: 'manual' }])
    expect((await stints())[0].is_healthy).toBe(false)
    expect((await activity(league, 'commissioner')).at(-1)?.summary).toBe(
      "Commissioner: matched ESPN's Mystery Man to Forward F1 (L, EDM)",
    )
  })
})

describe('the commissioner', () => {
  it('can put a player on IR when the injury feed is wrong', async () => {
    await expectError(league.rpc(OWNERS.b, 'commish_place_on_ir', { p_player_id: F(2) }), /Only the commissioner/)
    await league.rpc(COMMISH, 'commish_place_on_ir', { p_player_id: F(2), p_note: 'Out for the season per the team' })
    expect(await roster('b')).toContain(`${F(2)} IR`)
  })

  it('can settle a stuck IR stint either way', async () => {
    await espnReports([{ player: F(1), status: 'Out' }])
    await league.rpc(OWNERS.a, 'place_on_ir', { p_player_id: F(1) })
    await league.rpc(OWNERS.a, 'add_player', { p_player_id: F(13) })
    const [{ id }] = await league.query<{ id: string }>(`select id from public.ir_stints`)

    await expectError(league.rpc(OWNERS.b, 'commish_force_ir', { p_stint_id: id, p_action: 'activate' }), /Only the commissioner/)
    await league.rpc(COMMISH, 'commish_force_ir', { p_stint_id: id, p_action: 'keep_replacement' })

    expect(await roster('a')).toContain(`${F(13)}`)
    expect((await stints())[0].resolution).toBe('commissioner')
    await expectError(
      league.rpc(COMMISH, 'commish_force_ir', { p_stint_id: id, p_action: 'activate' }),
      /already resolved/,
    )
    expect(TEAMS.a).toBeTruthy()
  })
})
