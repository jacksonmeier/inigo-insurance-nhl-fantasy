// Deciding whether setup should rename a team to match league.local.json.

/** The names setup gives teams before anyone has chosen one: "Team 1", "Team 2"... */
export const isPlaceholderName = (name: string) => /^Team \d+$/.test(name.trim())

export type NameDecision = 'same' | 'rename' | 'keep'

/**
 * A team is renamed from the file only while it still has its placeholder
 * name. Once it has a real name, that name was chosen by someone (here or by
 * the owner in the app), and setup leaves it alone.
 */
export function decideTeamName(current: string, wanted: string): NameDecision {
  const next = wanted.trim()
  if (next === current) return 'same'
  if (isPlaceholderName(next)) return 'keep'
  return isPlaceholderName(current) ? 'rename' : 'keep'
}
