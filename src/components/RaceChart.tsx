// The season race: every team's running total, day by day, one line each.
// Hover, drag a finger across it, or use the arrow keys to read the totals on
// any day.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatGameDate, formatGameDay, formatGameMonth, points, signed } from '../lib/format.ts'
import { addDays, dayNumber } from '../lib/history.ts'

export type RaceLine = {
  teamId: string
  name: string
  color: string
  /** Running total at the end of each day in `days`. */
  totals: number[]
  /** The viewer's team, drawn on top. */
  mine?: boolean
}

type Props = {
  days: string[]
  lines: RaceLine[]
  height: number
  /** What the chart shows, for screen readers. */
  label: string
  /** Marks today's totals as still counting. */
  today?: string
}

const PAD = { top: 10, bottom: 24, left: 34 }
const LABEL_GAP = 14
const CHAR_WIDTH = 6.4
const axisNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

/** Round steps for gridlines: at most about `count` of them across the span. */
function tickStep(span: number, count: number) {
  const power = 10 ** Math.floor(Math.log10(span / count))
  for (const factor of [1, 2, 2.5, 5, 10, 20]) {
    if (span / (factor * power) <= count + 0.5) return factor * power
  }
  return 20 * power
}

function truncate(text: string, chars: number) {
  return text.length <= chars ? text : `${text.slice(0, Math.max(1, chars - 1)).trimEnd()}…`
}

export function RaceKey({ color }: { color: string }) {
  return <i className="race-key" style={{ background: color }} aria-hidden="true" />
}

export default function RaceChart({ days, lines, height, label, today }: Props) {
  const wrapper = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number | null>(null)

  useLayoutEffect(() => {
    const element = wrapper.current
    if (!element) return
    const measure = () => setWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // A tap elsewhere puts away the readout a finger left behind.
  useEffect(() => {
    if (active === null) return
    const close = (event: globalThis.PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setActive(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [active])

  const layout = useMemo(() => {
    if (width === 0 || days.length === 0) return null

    // Room on the right for each team's name at the end of its line.
    const right = Math.round(Math.min(108, Math.max(62, width * 0.27)))
    const plotWidth = Math.max(40, width - PAD.left - right)
    const plotHeight = height - PAD.top - PAD.bottom

    // Every line starts from zero the day before the first game.
    const first = dayNumber(days[0]) - 1
    const last = dayNumber(days[days.length - 1])
    const x = (day: number) => PAD.left + ((day - first) / Math.max(1, last - first)) * plotWidth
    const xs = days.map((day) => x(dayNumber(day)))

    const values = lines.flatMap((line) => line.totals)
    const low = Math.min(0, ...values)
    const high = Math.max(low + 1, ...values)
    const top = high + (high - low) * 0.06
    const step = tickStep(top - low, height >= 200 ? 4 : 3)
    const ticks: number[] = []
    for (let tick = Math.ceil(low / step) * step; tick <= top; tick += step) ticks.push(Math.round(tick * 100) / 100)
    const y = (value: number) => PAD.top + plotHeight - ((value - low) / (top - low)) * plotHeight

    // Dates along the bottom: months across a long stretch, days across a short one.
    const dateLabels: { x: number; text: string; anchor: 'start' | 'middle' | 'end' }[] = []
    if (last - first > 45) {
      dateLabels.push({ x: x(first), text: formatGameMonth(addDays(days[0], -1)), anchor: 'start' })
      for (let month = addDays(days[0], -1); ; ) {
        const [year, m] = month.split('-').map(Number)
        month = `${m === 12 ? year + 1 : year}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`
        if (dayNumber(month) > last) break
        dateLabels.push({ x: x(dayNumber(month)), text: formatGameMonth(month), anchor: 'middle' })
      }
    } else {
      const picks = [...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])]
      for (const [n, i] of picks.entries()) {
        dateLabels.push({
          x: xs[i], text: formatGameDate(days[i]),
          anchor: picks.length > 1 && n === 0 ? 'start' : n === picks.length - 1 && n > 0 ? 'end' : 'middle',
        })
      }
    }
    const spaced = dateLabels.filter((label, i) => i === 0 || label.x - dateLabels[i - 1].x > 38)

    // Names at the ends of the lines, nudged apart where lines finish close
    // together, with a short leader back to the line.
    const endX = xs[xs.length - 1]
    const chars = Math.floor((right - 14) / CHAR_WIDTH)
    const ends = lines
      .map((line) => ({ line, at: y(line.totals[line.totals.length - 1] ?? 0) }))
      .sort((a, b) => a.at - b.at)
      .map((end) => ({ ...end, labelY: end.at }))
    for (let i = 1; i < ends.length; i++) ends[i].labelY = Math.max(ends[i].labelY, ends[i - 1].labelY + LABEL_GAP)
    const overflow = ends.length > 0 ? ends[ends.length - 1].labelY - (PAD.top + plotHeight) : 0
    if (overflow > 0) {
      for (let i = ends.length - 1; i >= 0; i--) {
        ends[i].labelY = i === ends.length - 1 ? ends[i].labelY - overflow : Math.min(ends[i].labelY, ends[i + 1].labelY - LABEL_GAP)
      }
    }

    const path = (line: RaceLine) =>
      `M${x(first).toFixed(1)},${y(0).toFixed(1)}`
      + line.totals.map((total, i) => `L${xs[i].toFixed(1)},${y(total).toFixed(1)}`).join('')

    return { plotWidth, plotHeight, xs, y, ticks, spaced, endX, chars, ends, path }
  }, [width, height, days, lines])

  const move = (index: number | null) => setActive(index === null ? null : Math.max(0, Math.min(days.length - 1, index)))

  const locate = (event: PointerEvent<HTMLDivElement>) => {
    if (!layout || !wrapper.current) return
    const px = event.clientX - wrapper.current.getBoundingClientRect().left
    let nearest = 0
    layout.xs.forEach((x, i) => {
      if (Math.abs(x - px) < Math.abs(layout.xs[nearest] - px)) nearest = i
    })
    setActive(nearest)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const lastIndex = days.length - 1
    const current = active ?? lastIndex
    const keys: Record<string, number | undefined> = {
      ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: lastIndex,
    }
    const next = keys[event.key]
    if (next !== undefined) {
      event.preventDefault()
      move(next)
    } else if (event.key === 'Escape') {
      setActive(null)
    }
  }

  // The viewer's line goes on top.
  const drawOrder = [...lines].sort((a, b) => Number(Boolean(a.mine)) - Number(Boolean(b.mine)))

  // The readout floats just above the chart, clear of the lines and of a
  // finger on the chart. It slides along with the crosshair and stays within
  // the chart's width: at the left edge it hangs to the right of the line, at
  // the right edge to the left, and in between by the same share.
  const readoutPlace = (index: number) => {
    if (!layout) return {}
    const x = layout.xs[index]
    const share = Math.min(1, Math.max(0, x / width))
    return { left: x, bottom: 'calc(100% + 8px)', transform: `translateX(${(-share * 100).toFixed(1)}%)` }
  }

  const readout = active !== null && layout ? (
    <div className="race-tip" style={readoutPlace(active)}>
      <div className="when">
        {formatGameDay(days[active])}
        {days[active] === today ? ' · so far' : ''}
      </div>
      {[...lines]
        .sort((a, b) => b.totals[active] - a.totals[active])
        .map((line) => (
          <div key={line.teamId} className="race-tip-row">
            <RaceKey color={line.color} />
            <b>{points(line.totals[active])}</b>
            <span className="grow truncate">{line.name}</span>
            <span className="dim">{signed(line.totals[active] - (active > 0 ? line.totals[active - 1] : 0))}</span>
          </div>
        ))}
    </div>
  ) : null

  return (
    <div
      ref={wrapper}
      className="race"
      style={{ height }}
      tabIndex={0}
      role="group"
      aria-roledescription="chart"
      aria-label={label}
      onPointerDown={locate}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse' || event.buttons > 0) locate(event)
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setActive(null)
      }}
      onKeyDown={onKeyDown}
      // A click focuses the chart too; keep the day it picked.
      onFocus={() => setActive((current) => current ?? days.length - 1)}
      onBlur={() => setActive(null)}
    >
      {layout && (
        <svg width={width} height={height} aria-hidden="true">
          {layout.ticks.map((tick) => (
            <g key={tick}>
              <line
                className={tick === 0 ? 'race-grid zero' : 'race-grid'}
                x1={PAD.left} x2={PAD.left + layout.plotWidth} y1={layout.y(tick)} y2={layout.y(tick)}
              />
              <text className="race-axis" x={PAD.left - 7} y={layout.y(tick)} dy="0.32em" textAnchor="end">
                {axisNumber.format(tick)}
              </text>
            </g>
          ))}
          {layout.spaced.map((label) => (
            <text key={`${label.text}${label.x}`} className="race-axis" x={label.x} y={height - 6} textAnchor={label.anchor}>
              {label.text}
            </text>
          ))}

          {active !== null && (
            <line
              className="race-crosshair"
              x1={layout.xs[active]} x2={layout.xs[active]} y1={PAD.top} y2={PAD.top + layout.plotHeight}
            />
          )}

          {drawOrder.map((line) => (
            <path key={line.teamId} className="race-line" d={layout.path(line)} style={{ stroke: line.color }} />
          ))}

          {layout.ends.map(({ line, at, labelY }) => (
            <g key={line.teamId}>
              {Math.abs(labelY - at) > 1.5 && (
                <line className="race-leader" x1={layout.endX + 6} y1={at} x2={layout.endX + 11} y2={labelY} />
              )}
              <text className="race-name" x={layout.endX + 13} y={labelY} dy="0.32em">
                {truncate(line.name, layout.chars)}
              </text>
            </g>
          ))}

          {(active === null ? [] : drawOrder).map((line) => (
            <circle
              key={line.teamId} className="race-dot" r={4}
              cx={layout.xs[active!]} cy={layout.y(line.totals[active!])} style={{ fill: line.color }}
            />
          ))}
          {drawOrder.map((line) => (
            <circle
              key={line.teamId} className="race-dot" r={4}
              cx={layout.endX} cy={layout.y(line.totals[line.totals.length - 1] ?? 0)} style={{ fill: line.color }}
            />
          ))}
        </svg>
      )}
      <div aria-live="polite">{readout}</div>
    </div>
  )
}
