import { LEAGUE } from '@shared/league.config.ts'
import { Link } from 'react-router-dom'
import Points from '../components/Points.tsx'
import { Avatar, Empty, Loaded } from '../components/ui.tsx'
import { fetchStandings, fetchTodaysGames, fetchWeekScorers } from '../lib/api.ts'
import { gameStatus, isFinal, isLive, points, signed } from '../lib/format.ts'
import { useLeague } from '../lib/league.tsx'
import { useLive } from '../lib/live.ts'
import { teamOnClock } from '../lib/rules.ts'
import type { Game, Standing, WeekScorer } from '../lib/types.ts'

const SCORES = ['player_game_points', 'point_adjustments', 'roster_entries', 'teams']

function DraftBanner() {
  const league = useLeague()
  const draft = league.draft
  if (league.seasonOpen) return null

  const onClock = draft?.status === 'in_progress' ? teamOnClock(draft.draft_order, draft.current_pick) : null
  const mine = onClock !== null && onClock === league.myTeamId

  let headline = 'The draft is coming up'
  let detail = 'The draft order will be posted in the draft room.'
  if (draft?.status === 'not_started' && draft.draft_order.length > 0) {
    detail = `The order is set: ${draft.draft_order.map((id) => league.teamName(id)).join(', ')}.`
  } else if (draft?.status === 'in_progress') {
    headline = mine ? "You're on the clock" : 'The draft is under way'
    detail = mine ? 'Make your pick.' : `${league.teamName(onClock)} is on the clock, pick ${draft.current_pick}.`
  } else if (draft?.status === 'paused') {
    headline = 'The draft is paused'
    detail = `Pick ${draft.current_pick} is next when it resumes.`
  }

  return (
    <div className="card spotlight">
      <div className="eyebrow">Draft</div>
      <h3>{headline}</h3>
      <p className="muted" style={{ margin: '6px 0 14px' }}>{detail}</p>
      <Link to="/draft" className={mine ? 'button hot wide' : 'button wide'}>
        Go to the draft room
      </Link>
    </div>
  )
}

function Games({ games }: { games: Game[] }) {
  if (games.length === 0) return null
  const live = games.filter((game) => isLive(game.game_state)).length

  return (
    <>
      <h2>
        Tonight{live > 0 && <span className="tag live" style={{ marginLeft: 10, verticalAlign: 'middle' }}>{live} live</span>}
      </h2>
      <div className="games">
        {games.map((game) => {
          const started = isLive(game.game_state) || isFinal(game.game_state)
          return (
            <div key={game.id} className={isLive(game.game_state) ? 'game live' : 'game'}>
              <div className="side">
                <span>{game.away_team}</span>
                <b>{started ? (game.away_score ?? 0) : ''}</b>
              </div>
              <div className="side">
                <span>{game.home_team}</span>
                <b>{started ? (game.home_score ?? 0) : ''}</b>
              </div>
              <div className="when">{gameStatus(game)}</div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function TopScorer({ scorers }: { scorers: WeekScorer[] }) {
  const [top, ...rest] = scorers
  if (!top) return null

  return (
    <div className="card spotlight">
      <div className="eyebrow">Top scorer this week</div>
      <div className="row" style={{ gap: 14 }}>
        <Avatar name={top.full_name} src={top.headshot_url} large />
        <div className="grow">
          <h3>{top.full_name}</h3>
          <div className="muted fine" style={{ marginTop: 4 }}>
            {top.position} · {top.nhl_team} · for {top.team_name}
          </div>
          <div className="muted fine">
            {top.games} {top.games === 1 ? 'game' : 'games'}, {top.goals} {top.goals === 1 ? 'goal' : 'goals'}
          </div>
        </div>
        <Points value={Number(top.points)} size="big" label="Points" />
      </div>
      {rest.length > 0 && (
        <p className="fine muted" style={{ margin: '12px 0 0' }}>
          Next: {rest.map((s) => `${s.full_name} ${points(s.points)} (${s.team_name})`).join(', ')}
        </p>
      )}
    </div>
  )
}

function Table({ standings }: { standings: Standing[] }) {
  const league = useLeague()
  const scored = standings.some((team) => Number(team.total_points) !== 0)

  if (standings.length === 0) {
    return <Empty title="No teams yet">The commissioner adds the {LEAGUE.teamCount} teams during setup.</Empty>
  }

  return (
    <div className="card flush">
      {standings.map((team, i) => (
        <Link
          key={team.team_id}
          to={team.team_id === league.myTeamId ? '/team' : `/team/${team.team_id}`}
          className={scored && team.rank === 1 ? 'standing leader' : 'standing'}
          style={{ ['--i' as string]: i }}
        >
          {scored && <span className="place">{team.rank}</span>}
          <span className="grow">
            <span className="team-name">
              <span className="truncate">{team.name}</span>
              {team.team_id === league.myTeamId && <span className="tag you">You</span>}
            </span>
            <span className="player-meta">
              <span className={Number(team.today_points) > 0 ? 'up' : undefined}>
                Today {signed(team.today_points)}
              </span>
              <span>
                {team.total_goals} {team.total_goals === 1 ? 'goal' : 'goals'}
              </span>
            </span>
          </span>
          <Points value={Number(team.total_points)} size="big" />
        </Link>
      ))}
    </div>
  )
}

export default function LeaderboardPage() {
  const league = useLeague()
  const standings = useLive(fetchStandings, [], SCORES)
  const scorers = useLive(() => fetchWeekScorers(3), [], SCORES)
  const games = useLive(fetchTodaysGames, [], ['games'])

  return (
    <section>
      <DraftBanner />

      <h1>Standings</h1>
      <Loaded live={standings}>{(rows) => <Table standings={rows} />}</Loaded>
      {league.seasonOpen && (
        <p className="fine dim">Ties are broken by goals scored by a team's players while on its roster.</p>
      )}

      {scorers.data && <TopScorer scorers={scorers.data} />}
      {games.data && <Games games={games.data} />}
    </section>
  )
}
