// League rules and settings. Shared by the Edge Functions (Deno) and the
// frontend (Vite), so keep this file free of imports and runtime-specific code.

export type PositionGroup = 'F' | 'D' | 'G';
export type NhlPosition = 'C' | 'L' | 'R' | 'D' | 'G';

export const LEAGUE = {
  name: 'Inigo Insurance',
  teamCount: 4,

  // Active roster: every one of these players scores. No bench.
  roster: { F: 3, D: 2, G: 1 } satisfies Record<PositionGroup, number>,
  irSlots: 1,

  draft: {
    rounds: 6,
    defaultPickSeconds: 120,
  },

  // Length of each 24-hour window, in hours.
  windows: {
    waiverHours: 24,
    tradeVetoHours: 24,
    irReturnDecisionHours: 24,
  },

  // ESPN injury statuses that make a player IR-eligible. Day-To-Day is not.
  irEligibleStatuses: ['Out', 'Injured Reserve'],

  // NHL gameType values that count. 2 = regular season (1 = preseason, 3 = playoffs).
  scoringGameTypes: [2],
} as const;

export const ACTIVE_ROSTER_SIZE = Object.values(LEAGUE.roster).reduce((a, b) => a + b, 0);

export function positionGroup(position: NhlPosition): PositionGroup {
  if (position === 'D') return 'D';
  if (position === 'G') return 'G';
  return 'F';
}
