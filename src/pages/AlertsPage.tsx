import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Empty } from '../components/ui.tsx'
import { markAlertsRead } from '../lib/api.ts'
import { formatDateTime, timeAgo } from '../lib/format.ts'
import { useNow } from '../lib/hooks.ts'
import { useLeague } from '../lib/league.tsx'
import type { Alert, AlertType } from '../lib/types.ts'

const WHERE: Record<AlertType, { to: string; label: string } | null> = {
  ir_eligible: { to: '/team', label: 'Go to my team' },
  ir_player_healthy: { to: '/team', label: 'Decide on my team page' },
  trade_response_needed: { to: '/trades', label: 'See the offer' },
  trade_update: { to: '/trades', label: 'See trades' },
  waiver_processed: { to: '/team', label: 'Go to my team' },
  watchlist: { to: '/players?show=watching', label: 'See my watchlist' },
  general: null,
}

export default function AlertsPage() {
  const league = useLeague()
  const now = useNow(60_000)
  const { alerts, refreshAlerts } = league

  // Reading the page is what marks alerts read. The short wait leaves the new
  // ones highlighted long enough to notice.
  const unread = alerts.filter((alert) => !alert.read_at).map((alert) => alert.id).join(',')
  useEffect(() => {
    if (!unread) return
    const timer = setTimeout(() => {
      markAlertsRead(unread.split(',').map(Number)).then(refreshAlerts, () => {})
    }, 2500)
    return () => clearTimeout(timer)
  }, [unread, refreshAlerts])

  if (!league.myTeamId) {
    return (
      <section>
        <h1>Alerts</h1>
        <Empty title="No alerts">Alerts go to team owners.</Empty>
      </section>
    )
  }

  return (
    <section>
      <h1>Alerts</h1>
      <div className="card flush">
        {alerts.length === 0 && (
          <Empty title="All quiet">
            You'll hear about injuries to your players, trade offers and waiver results here.
          </Empty>
        )}
        {alerts.map((alert: Alert) => {
          const where = WHERE[alert.type]
          return (
            <div key={alert.id} className={alert.read_at ? 'feed-item' : 'feed-item unread'}>
              <div className="grow">
                <div className="feed-text">{alert.message}</div>
                <div className="feed-time" title={formatDateTime(alert.created_at)}>
                  {timeAgo(alert.created_at, now)}
                  {where && (
                    <>
                      {' · '}
                      <Link to={where.to}>{where.label}</Link>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
