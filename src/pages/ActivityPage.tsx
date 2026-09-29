import { useState, type ComponentType, type SVGProps } from 'react'
import { CheckIcon, CrossIcon, MinusIcon, PickIcon, PlusIcon, TradesIcon, WhistleIcon } from '../components/Icons.tsx'
import { Chips, Empty, Loaded } from '../components/ui.tsx'
import { ACTIVITY_PAGE_SIZE, fetchActivity } from '../lib/api.ts'
import { formatDateTime, timeAgo } from '../lib/format.ts'
import { useNow } from '../lib/hooks.ts'
import { useLive } from '../lib/live.ts'
import type { TransactionType } from '../lib/types.ts'

type Filter = 'all' | 'moves' | 'trades' | 'draft' | 'commissioner'

const FILTERS: Record<Filter, TransactionType[] | undefined> = {
  all: undefined,
  moves: ['add', 'drop', 'waiver_claim', 'ir_place', 'ir_activate', 'ir_keep_replacement'],
  trades: ['trade', 'trade_veto'],
  draft: ['draft_pick'],
  commissioner: ['commissioner'],
}

const ICONS: Record<TransactionType, ComponentType<SVGProps<SVGSVGElement>>> = {
  draft_pick: PickIcon,
  add: PlusIcon,
  drop: MinusIcon,
  waiver_claim: PlusIcon,
  trade: TradesIcon,
  trade_veto: MinusIcon,
  ir_place: CrossIcon,
  ir_activate: CheckIcon,
  ir_keep_replacement: CheckIcon,
  commissioner: WhistleIcon,
}

export default function ActivityPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [limit, setLimit] = useState(ACTIVITY_PAGE_SIZE)
  const now = useNow(60_000)

  const feed = useLive(() => fetchActivity({ types: FILTERS[filter], limit }), [filter, limit], ['transactions'])

  return (
    <section>
      <h1>League activity</h1>

      <div style={{ marginBottom: 12 }}>
        <Chips<Filter>
          label="Show"
          value={filter}
          onChange={(next) => {
            setFilter(next)
            setLimit(ACTIVITY_PAGE_SIZE)
          }}
          options={[
            { value: 'all', label: 'Everything' },
            { value: 'moves', label: 'Roster moves' },
            { value: 'trades', label: 'Trades' },
            { value: 'draft', label: 'Draft' },
            { value: 'commissioner', label: 'Commissioner' },
          ]}
        />
      </div>

      <Loaded live={feed}>
        {(items) => (
          <div className="card flush">
            {items.length === 0 && (
              <Empty title="Nothing yet">Every pick, add, drop, trade, IR move and commissioner action lands here.</Empty>
            )}
            {items.map((item) => {
              const Icon = ICONS[item.type] ?? CheckIcon
              return (
                <div key={item.id} className={item.details.undone ? 'feed-item undone' : 'feed-item'}>
                  <span className={`feed-icon kind-${item.type}`}>
                    <Icon />
                  </span>
                  <div className="grow">
                    <div className="feed-text">{item.summary}</div>
                    <div className="feed-time" title={formatDateTime(item.created_at)}>
                      {timeAgo(item.created_at, now)}
                      {item.details.undone ? ' · undone' : ''}
                    </div>
                  </div>
                </div>
              )
            })}
            {items.length >= limit && (
              <div style={{ padding: 12 }}>
                <button type="button" className="ghost wide" onClick={() => setLimit((n) => n + ACTIVITY_PAGE_SIZE)}>
                  Show more
                </button>
              </div>
            )}
          </div>
        )}
      </Loaded>
    </section>
  )
}
