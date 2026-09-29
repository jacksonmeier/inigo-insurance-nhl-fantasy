// Line icons, drawn on a 24 x 24 grid. They take the text colour.

import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Svg({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export const StandingsIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
    <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
  </Svg>
)

export const TeamIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 3 3 6l2 4 2-1v11h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0Z" />
  </Svg>
)

export const PlayersIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
)

export const TradesIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M7 4 3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7" />
  </Svg>
)

export const ActivityIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </Svg>
)

export const BellIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7 2.5 7h-17S6 15 6 9ZM10 20a2 2 0 0 0 4 0" />
  </Svg>
)

export const UserIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Svg>
)

export const WhistleIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="8" cy="14" r="5" />
    <path d="M12 11h9V8H8M15 8V5" />
  </Svg>
)

export const PlusIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const MinusIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M5 12h14" />
  </Svg>
)

export const CheckIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m5 12 5 5 9-10" />
  </Svg>
)

export const UndoIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
  </Svg>
)

export const PauseIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9 5v14M15 5v14" />
  </Svg>
)

export const PlayIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M7 5v14l12-7Z" />
  </Svg>
)

export const RefreshIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </Svg>
)

export const CrossIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M12 8v8M8 12h8" />
  </Svg>
)

export const PickIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  </Svg>
)
