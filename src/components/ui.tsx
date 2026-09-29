// Small pieces used on every screen.

import { useState, type ReactNode } from 'react'
import { initials, injuryTag } from '../lib/format.ts'
import type { PositionGroup } from '../lib/types.ts'

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice error row between" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="small ghost" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  )
}

/** Loading, failed, or ready: the three states of anything fetched. */
export function Loaded<T>({ live, children }: {
  live: { data: T | undefined; error: string | null; refresh: () => void }
  children: (data: T) => ReactNode
}) {
  if (live.data === undefined) {
    return live.error ? <ErrorNotice message={live.error} onRetry={live.refresh} /> : <Spinner />
  }
  return (
    <>
      {live.error && <ErrorNotice message={live.error} onRetry={live.refresh} />}
      {children(live.data)}
    </>
  )
}

export function PositionTag({ group, position }: { group: PositionGroup; position?: string }) {
  return <span className={`tag pos-${group}`}>{position ?? group}</span>
}

export function InjuryTag({ status, title }: { status: string | null | undefined; title?: string | null }) {
  const tag = injuryTag(status)
  if (!tag) return null
  return (
    <span className={`tag ${tag.tone}`} title={title ?? status ?? undefined}>
      {tag.label}
    </span>
  )
}

export function Avatar({ name, src, large }: { name: string; src?: string | null; large?: boolean }) {
  const [broken, setBroken] = useState(false)
  return (
    <span className={large ? 'avatar large' : 'avatar'}>
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className="initials">{initials(name)}</span>
      )}
    </span>
  )
}

export type ChipOption<T> = { value: T; label: string }

export function Chips<T extends string | null>({ options, value, onChange, label }: {
  options: ChipOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value ?? 'all'}
          type="button"
          className="chip"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
