import { useEffect, useRef, useState } from 'react'
import { points, signed } from '../lib/format.ts'

/** A fantasy point total that lights up for a moment when it changes. */
export default function Points({ value, size, showSign, label, tone }: {
  value: number
  size?: 'big' | 'huge'
  showSign?: boolean
  label?: string
  tone?: 'auto'
}) {
  const previous = useRef(value)
  const [flash, setFlash] = useState(0)

  useEffect(() => {
    if (previous.current !== value) {
      previous.current = value
      setFlash((n) => n + 1)
    }
  }, [value])

  const classes = ['points', size, flash > 0 && 'flash', tone === 'auto' && value > 0 && 'up', tone === 'auto' && value < 0 && 'down']
    .filter(Boolean)
    .join(' ')

  return (
    <span className="stat-col">
      {/* The key restarts the animation on every change. */}
      <span key={flash} className={classes}>
        {showSign ? signed(value) : points(value)}
      </span>
      {label && <span className="points-label">{label}</span>}
    </span>
  )
}
