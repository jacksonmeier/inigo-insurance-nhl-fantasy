import { useState } from 'react'
import RaceChart, { RaceKey } from '../components/RaceChart.tsx'
import { Empty, Loaded } from '../components/ui.tsx'
import { formatGameDate, points } from '../lib/format.ts'
import { winCounts, type Result } from '../lib/history.ts'
import { useLeague } from '../lib/league.tsx'
import { describeRace, nightLabel, teamNames, useSeasonHistory } from '../lib/season.ts'

const NIGHTS_PAGE = 14

/** The other teams' points for a day or week, best first. */
function breakdown(result: Result, teamName: (id: string) => string) {
  return [...result.points]
    .filter(([id]) => !result.winners.includes(id))
    .sort((a, b) => b[1] - a[1])
    .map(([id, value]) => `${teamName(id)} ${points(value)}`)
    .join(' · ')
}

export default function HistoryPage() {
  const league = useLeague()
  const { live, today, season } = useSeasonHistory()
  const [nightsShown, setNightsShown] = useState(NIGHTS_PAGE)

  return (
    <section>
      <h1>Season</h1>

      <Loaded live={live}>
        {() => {
          if (!season || season.days.length === 0) {
            return (
              <div className="card">
                <Empty title="Nothing to show yet">
                  The race starts with the first game of the regular season.
                </Empty>
              </div>
            )
          }

          const weeksWon = winCounts(season.weeks)
          const nightsWon = winCounts(season.nights)
          const ranked = [...season.lines].sort((a, b) => (b.totals.at(-1) ?? 0) - (a.totals.at(-1) ?? 0))
          const nights = season.nights.filter((night) => night.final && night.winners.length > 0)

          return (
            <>
              <div className="card">
                <div className="eyebrow">The race</div>
                <p className="fine muted" style={{ marginBottom: 12 }}>
                  Each team's total at the end of every day. Touch the chart to see any day.
                </p>
                <RaceChart
                  days={season.days}
                  lines={season.lines}
                  height={250}
                  today={today}
                  label={`Season points by day. ${describeRace(season.lines)}`}
                />
              </div>

              <div className="card flush">
                <table className="season-table">
                  <thead>
                    <tr>
                      <th scope="col">Team</th>
                      <th scope="col">Points</th>
                      <th scope="col" title="Weeks won">Weeks</th>
                      <th scope="col" title="Nights won">Nights</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((line) => (
                      <tr key={line.teamId}>
                        <th scope="row">
                          <span className="row" style={{ gap: 8 }}>
                            <RaceKey color={line.color} />
                            <span>
                              {line.name}
                              {line.mine && <span className="tag you" style={{ marginLeft: 6 }}>You</span>}
                            </span>
                          </span>
                        </th>
                        <td className="total">{points(line.totals.at(-1))}</td>
                        <td>{weeksWon.get(line.teamId) ?? 0}</td>
                        <td>{nightsWon.get(line.teamId) ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="fine dim">
                Weeks run Monday to Sunday. Winners count points from games only, not the commissioner's
                adjustments, and a tie counts for everyone in it.
              </p>

              <h2>Weekly winners</h2>
              <div className="card flush">
                {season.weeks.map((week) => (
                  <div key={week.start} className="list-row result">
                    <div className="grow">
                      <div className="result-when">
                        {week.final ? `${formatGameDate(week.start)} – ${formatGameDate(week.end)}` : 'This week so far'}
                      </div>
                      <div className="fine muted">{breakdown(week, league.teamName)}</div>
                    </div>
                    <div className="result-winner">
                      {week.winners.length === 0 ? (
                        <span className="muted">No points</span>
                      ) : (
                        <>
                          <span className="fine muted">{week.final ? (week.winners.length > 1 ? 'Tied' : 'Won') : 'Leading'}</span>
                          <b>{teamNames(week.winners, league.teamName)}</b>
                          <span className="points">{points(week.best)}</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <h2>Nightly winners</h2>
              <div className="card flush">
                {nights.length === 0 && <Empty title="No finished nights yet">Tonight's winner shows up here tomorrow.</Empty>}
                {nights.slice(0, nightsShown).map((night) => (
                  <div key={night.start} className="list-row result">
                    <div className="grow">
                      <div className="result-when">{nightLabel(night.start, today)}</div>
                      <div className="fine muted">{breakdown(night, league.teamName)}</div>
                    </div>
                    <div className="result-winner">
                      <b>{teamNames(night.winners, league.teamName)}</b>
                      <span className="points">{points(night.best)}</span>
                    </div>
                  </div>
                ))}
                {nights.length > nightsShown && (
                  <div style={{ padding: 12 }}>
                    <button type="button" className="ghost wide" onClick={() => setNightsShown((n) => n + NIGHTS_PAGE)}>
                      Show more
                    </button>
                  </div>
                )}
              </div>
            </>
          )
        }}
      </Loaded>
    </section>
  )
}
