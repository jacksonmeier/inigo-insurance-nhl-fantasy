// Fantasy scoring values. Change points here and nowhere else.
// Shared by the Edge Functions (Deno) and the frontend (Vite), so keep this
// file free of imports and runtime-specific code.

export const SCORING = {
  skater: {
    goal: 3,
    assist: 2,
    powerPlayPoint: 1, // on top of the goal/assist points
    shorthandedPoint: 1, // on top of the goal/assist points
    shotOnGoal: 0.3,
    hit: 0.2,
    blockedShot: 0.3,
  },
  goalie: {
    win: 4,
    save: 0.2,
    goalAgainst: -1,
    shutout: 3,
  },
} as const;

// The shape without the exact values, so tests can try other values.
export type ScoringConfig = {
  skater: Record<keyof typeof SCORING.skater, number>;
  goalie: Record<keyof typeof SCORING.goalie, number>;
};
