// How numbers, times and game states are shown.

const dayAndTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dateOnly = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const dateAndTime = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})

/** Fantasy points, always to one decimal: 12.4, 0.0, -0.2. */
export function points(value: number | null | undefined) {
  const n = Number(value ?? 0)
  // Avoid "-0.0" for something like -0.04.
  const rounded = Math.round(n * 10) / 10
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(1)
}

/** With a sign, for gains and losses: +3.2, -1.0. */
export function signed(value: number | null | undefined) {
  const text = points(value)
  return text.startsWith('-') ? text : `+${text}`
}

/** Seconds as a countdown: 2:00, 0:09. */
export function clock(totalSeconds: number) {
  const seconds = Math.max(0, Math.ceil(totalSeconds))
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  }
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** How long until a deadline: "23h 14m", "9m", "under a minute". */
export function timeLeft(deadline: string | Date, now: number = Date.now()) {
  const ms = new Date(deadline).getTime() - now
  if (ms <= 0) return 'any minute now'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function timeAgo(when: string | Date, now: number = Date.now()) {
  const date = new Date(when)
  const seconds = Math.floor((now - date.getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return dateOnly.format(date)
}

export const formatDateTime = (when: string | Date) => dateAndTime.format(new Date(when))
export const formatTime = (when: string | Date) => timeOnly.format(new Date(when))

/** A game date (YYYY-MM-DD) without shifting it across time zones. */
export function formatGameDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return dateOnly.format(new Date(year, month - 1, day))
}

const weekdayAndDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const monthOnly = new Intl.DateTimeFormat(undefined, { month: 'short' })

/** A game date with its weekday: "Tue, Oct 14". */
export function formatGameDay(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return weekdayAndDate.format(new Date(year, month - 1, day))
}

/** The month of a game date: "Oct". */
export function formatGameMonth(date: string) {
  const [year, month] = date.split('-').map(Number)
  return monthOnly.format(new Date(year, month - 1, 1))
}

const isToday = (date: Date, now: Date) => date.toDateString() === now.toDateString()

/** When a game starts: "7:00 PM" today, "Tue 7:00 PM" otherwise. */
export function gameTime(start: string | Date, now: Date = new Date()) {
  const date = new Date(start)
  return isToday(date, now) ? timeOnly.format(date) : dayAndTime.format(date)
}

export const isLive = (state: string | null | undefined) => state === 'LIVE' || state === 'CRIT'
export const isFinal = (state: string | null | undefined) => state === 'FINAL' || state === 'OFF'

export function periodLabel(period: number | null | undefined) {
  if (!period) return 'Live'
  if (period <= 3) return `P${period}`
  if (period === 4) return 'OT'
  return 'SO'
}

/** Where a game stands: "P2", "Final", "7:00 PM", "Postponed". */
export function gameStatus(game: { game_state: string; period: number | null; start_time_utc: string; schedule_state?: string }) {
  if (game.schedule_state && game.schedule_state !== 'OK') return 'Postponed'
  if (isLive(game.game_state)) return periodLabel(game.period)
  if (isFinal(game.game_state)) return game.period && game.period > 3 ? `Final/${periodLabel(game.period)}` : 'Final'
  return gameTime(game.start_time_utc)
}

/** A short label for ESPN's injury status. */
export function injuryTag(status: string | null | undefined): { label: string; tone: 'out' | 'dtd' } | null {
  if (!status) return null
  const s = status.toLowerCase()
  if (s === 'injured reserve') return { label: 'IR', tone: 'out' }
  if (s === 'out') return { label: 'Out', tone: 'out' }
  if (s === 'day-to-day') return { label: 'DTD', tone: 'dtd' }
  if (s === 'suspension') return { label: 'Susp', tone: 'dtd' }
  return { label: status, tone: 'dtd' }
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

export const GROUP_NAMES = { F: 'Forwards', D: 'Defense', G: 'Goalie' } as const
export const GROUP_NOUN = { F: 'forward', D: 'defenseman', G: 'goalie' } as const
