import type { ReactNode } from 'react'

export default function ComingSoon({ title, phase, children }: {
  title: string
  phase: number
  children?: ReactNode
}) {
  return (
    <section>
      <h1>{title}</h1>
      <div className="card muted">
        <p>Coming in Phase {phase}.</p>
        {children}
      </div>
    </section>
  )
}
