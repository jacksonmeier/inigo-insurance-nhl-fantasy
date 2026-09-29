import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { StarIcon } from '../components/Icons.tsx'
import PlayerActions from '../components/PlayerActions.tsx'
import PlayerLine from '../components/PlayerLine.tsx'
import PlayerSheet from '../components/PlayerSheet.tsx'
import { Chips, Empty, Loaded } from '../components/ui.tsx'
import { fetchPlayers, fetchWaivers, fetchWeekAhead, PLAYERS_PAGE_SIZE, type PlayerSort } from '../lib/api.ts'
import { isLive, points, timeLeft } from '../lib/format.ts'
import { useDebounced, useNow } from '../lib/hooks.ts'
import { useLeague } from '../lib/league.tsx'
import { useLive } from '../lib/live.ts'
import { describeNeeds, openSlots } from '../lib/rules.ts'
import type { Availability, PoolPlayer, PositionGroup } from '../lib/types.ts'

type Show = 'available' | Availability | 'watching' | null

const SHOWS: Exclude<Show, null>[] = ['available', 'waivers', 'rostered', 'free_agent', 'watching']
const isShow = (value: string | null): value is Exclude<Show, null> => SHOWS.includes(value as Exclude<Show, null>)

const POOL_TABLES = ['roster_entries', 'waivers', 'waiver_claims', 'player_injuries', 'player_game_points', 'players']

const isGroup = (value: string | null): value is PositionGroup => value === 'F' || value === 'D' || value === 'G'

export default function PlayersPage() {
  const league = useLeague()
  const [params, setParams] = useSearchParams()
  const group = isGroup(params.get('group')) ? (params.get('group') as PositionGroup) : null

  const [search, setSearch] = useState('')
  // A link can ask for a list, e.g. an alert about the watchlist.
  const [show, setShow] = useState<Show>(() => {
    const asked = params.get('show')
    return isShow(asked) ? asked : 'available'
  })
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

  const watchIds = useMemo(() => [...league.watchlist].sort((a, b) => a - b), [league.watchlist])
  const players = useLive(
    () =>
      show === 'watching'
        ? fetchPlayers({ search: term, group, ids: watchIds, sort: sortBy, limit })
        : fetchPlayers({ search: term, group, availability: show, sort: sortBy, limit }),
    [term, group, show, sortBy, limit, watchIds.join(',')],
    POOL_TABLES,
  )

  // Games each NHL team has left in the next week, for choosing between free agents.
  const week = useLive(fetchWeekAhead, [], ['games'])
  const weekGames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const game of week.data ?? []) {
      if (isLive(game.game_state)) continue
      for (const team of [game.home_team, game.away_team]) counts.set(team, (counts.get(team) ?? 0) + 1)
    }
    return counts
  }, [week.data])

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

  const gamesAhead = (player: PoolPlayer) => {
    if (!player.nhl_team || !week.data) return null
    const count = weekGames.get(player.nhl_team) ?? 0
    return <span className="dim">{count} {count === 1 ? 'game' : 'games'} in 7 days</span>
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
            ...(league.myTeamId ? [{ value: 'watching' as const, label: 'Watching' }] : []),
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
            {list.length === 0 &&
              (show === 'watching' && watchIds.length === 0 ? (
                <Empty title="Nobody on your watchlist">
                  Tap the star on a player's page to watch him. You'll get an alert when he becomes available.
                </Empty>
              ) : (
                <Empty title="Nobody found">Try a different name or filter.</Empty>
              ))}
            {list.map((player) => (
              <PlayerLine
                key={player.id}
                player={player}
                injury={{ status: player.injury_status, description: player.injury_description }}
                tags={
                  league.watchlist.has(player.id) && (
                    <span className="watch-mark" title="On your watchlist">
                      <StarIcon filled />
                    </span>
                  )
                }
                meta={
                  <>
                    {status(player)}
                    {gamesAhead(player)}
                  </>
                }
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
