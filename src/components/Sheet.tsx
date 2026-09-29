import { useEffect, useRef, type ReactNode } from 'react'

/** A panel that slides up from the bottom of the screen, over everything. */
export default function Sheet({ title, onClose, children }: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)

    // Stop the page behind from scrolling while the sheet is open.
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus({ preventScroll: true })

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  return (
    <div
      className="backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}>
        {children}
      </div>
    </div>
  )
}

/** Asks before doing something that can't be taken back. */
export function Confirm({ title, children, confirmLabel, tone = 'primary', busy, onConfirm, onCancel }: {
  title: string
  children?: ReactNode
  confirmLabel: string
  tone?: 'primary' | 'hot'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Sheet title={title} onClose={onCancel}>
      <h3>{title}</h3>
      {children && <div className="muted">{children}</div>}
      <div className="sheet-actions">
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={tone === 'hot' ? 'hot' : undefined} onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Sheet>
  )
}
