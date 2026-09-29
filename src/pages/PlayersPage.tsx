import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PlayerActions from '../components/PlayerActions.tsx'
import PlayerLine from '../components/PlayerLine.tsx'
import PlayerSheet from '../components/PlayerSheet.tsx'
import { Chips, Empty, Loaded } from '../components/ui.tsx'
import { fetchPlayers, fetchWaivers, PLAYERS_PAGE_SIZE, type PlayerSort } from '../lib/api.ts'
import { points, timeLeft } from '../lib/format.ts'
import { useDebounced, useNow } from '../lib/hooks.ts'
import { useLeague } from '../lib/league.tsx'
import { useLive } from '../lib/live.ts'
import { describeNeeds, openSlots } from '../lib/rules.ts'
import type { Availability, PoolPlayer, PositionGroup } from '../lib/types.ts'

type Show = 'available' | Availability | null

const POOL_TABLES = ['roster_entries', 'waivers', 'waiver_claims', 'player_injuries', 'player_game_points', 'players']

const isGroup = (value: string | null): value is PositionGroup => value === 'F' || value === 'D' || value === 'G'

export default function PlayersPage() {
  const league = useLeague()
  const [params, setParams] = useSearchParams()
  const group = isGroup(params.get('group')) ? (params.get('group') as PositionGroup) : null

  const [search, setSearch] = useState('')
  const [show, setShow] = useState<Show>('available')
  // Before any games are played, last season is the only thing to go on.
  const [sort, setSort] = useState<PlayerSort | null>(null)
  const [limit, setLimit] = useState(PLAYERS_PAGE_SIZE)
  const [open, setOpen] = useState<number | null>(null)
  const term = useDebounced(search)
  const now = useNow(30_000)

  const waivers = useLive(fetchWaivers, [], ['waivers'])
  const probe = useLive(() => fetchPlayers({ sort: 'season', limit: 1 }), [], ['player_game_points'])
  const seasonStarted = Number(probe.data?.[0]?.season_points ?? 0) > 0
  const sortBy: PlayerSort = sort ?? (seasonStarted ? 'season' : 'last_season')

  const players = useLive(
    () => fetchPlayers({ search: term, group, availability: show, sort: sortBy, limit }),
    [term, group, show, sortBy, limit],
    POOL_TABLES,
  )

  const setGroup = (next: PositionGroup | null) => {
    setLimit(PLAYERS_PAGE_SIZE)
    setParams(next ? { group: next } : {}, { replace: true })
  }

  const needs = league.myTeamId && league.seasonOpen ? describeNeeds(openSlots(league.myRoster)) : null

  const status = (player: PoolPlayer) => {
    if (player.fantasy_team_id) {
      return <span className="truncate">{league.teamName(player.fantasy_team_id)}{player.roster_slot === 'ir' ? ' (IR)' : ''}</span>
    }
    if (player.waiver_expires_at) return <span>Waivers, {timeLeft(player.waiver_expires_at, now)} left</span>
    return null
  }

  return (
    <section>
      <h1>Players</h1>

      {!league.seasonOpen && (
        <div className="notice" style={{ marginBottom: 12 }}>
          Free agency opens when the draft is complete. Until then you can look around.
        </div>
      )}
      {needs && (
        <div className="notice good" style={{ marginBottom: 12 }}>
          You have open spots: {needs}. An open spot scores nothing.
        </div>
      )}
      {(waivers.data?.length ?? 0) > 0 && show !== 'waivers' && (
        <button type="button" className="notice wide link-button" style={{ marginBottom: 12, textDecoration: 'none' }}
          onClick={() => setShow('waivers')}>
          {waivers.data!.length} {waivers.data!.length === 1 ? 'player is' : 'players are'} on waivers. Tap to see.
        </button>
      )}

      <div className="stack" style={{ marginBottom: 12 }}>
        <input
          type="search"
          placeholder="Search by name"
          aria-label="Search by name"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setLimit(PLAYERS_PAGE_SIZE)
          }}
        />
        <Chips
          label="Position"
          value={group}
          onChange={setGroup}
          options={[
            { value: null, label: 'All positions' },
            { value: 'F', label: 'Forwards' },
            { value: 'D', label: 'Defense' },
            { value: 'G', label: 'Goalies' },
          ]}
        />
        <Chips<Exclude<Show, null> | 'all'>
          label="Availability"
          value={show ?? 'all'}
          onChange={(next) => {
            setShow(next === 'all' ? null : next)
            setLimit(PLAYERS_PAGE_SIZE)
          }}
          options={[
            { value: 'available', label: 'Available' },
            { value: 'waivers', label: 'Waivers' },
            { value: 'rostered', label: 'On a team' },
            { value: 'all', label: 'Everyone' },
          ]}
        />
        <Chips<PlayerSort>
          label="Sort"
          value={sortBy}
          onChange={setSort}
          options={[
            { value: 'season', label: 'This season' },
            { value: 'last_season', label: 'Last season' },
            { value: 'name', label: 'Name' },
          ]}
        />
      </div>

      <Loaded live={players}>
        {(list) => (
          <div className="card flush">
            <div className="card-head">
              <span>{list.length >= limit ? `Top ${list.length}` : `${list.length} ${list.length === 1 ? 'player' : 'players'}`}</span>
              <span>{sortBy === 'last_season' ? 'Last season' : 'Points'}</span>
            </div>
            {list.length === 0 && <Empty title="Nobody found">Try a different name or filter.</Empty>}
            {list.map((player) => (
              <PlayerLine
                key={player.id}
                player={player}
                injury={{ status: player.injury_status, description: player.injury_description }}
                meta={status(player)}
                onOpen={() => setOpen(player.id)}
                right={
                  <>
                    <span className="stat-col">
                      <span className="points">
                        {points(sortBy === 'last_season' ? player.last_season_points : player.season_points)}
                      </span>
                      <span className="points-label">
                        {sortBy === 'last_season' ? player.last_season_games : player.season_games} GP
                      </span>
                    </span>
                    <PlayerActions player={player} compact />
                  </>
                }
              />
            ))}
            {list.length >= limit && (
              <div style={{ padding: 12 }}>
                <button type="button" className="ghost wide" onClick={() => setLimit((n) => n + PLAYERS_PAGE_SIZE)}>
                  Show more
                </button>
              </div>
            )}
          </div>
        )}
      </Loaded>

      {open !== null && <PlayerSheet playerId={open} onClose={() => setOpen(null)} />}
    </section>
  )
}
