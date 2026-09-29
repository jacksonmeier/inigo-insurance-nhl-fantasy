import { describe, expect, it } from 'vitest'
import { decideTeamName, isPlaceholderName } from './teams.ts'

describe('team names from league.local.json', () => {
  it('knows a placeholder when it sees one', () => {
    expect(isPlaceholderName('Team 1')).toBe(true)
    expect(isPlaceholderName(' Team 12 ')).toBe(true)
    expect(isPlaceholderName('Team Canada')).toBe(false)
    expect(isPlaceholderName('Puck Dynasty')).toBe(false)
  })

  it('replace a placeholder with the name in the file', () => {
    expect(decideTeamName('Team 2', 'Puck Dynasty')).toBe('rename')
    expect(decideTeamName('Team 2', '  Puck Dynasty ')).toBe('rename')
  })

  it('do nothing when the name already matches', () => {
    expect(decideTeamName('Team 2', 'Team 2')).toBe('same')
    expect(decideTeamName('Puck Dynasty', 'Puck Dynasty')).toBe('same')
  })

  it('never overwrite a name someone chose', () => {
    // The owner renamed the team in the app; the file still has the old name.
    expect(decideTeamName('Ice Ice Baby', 'Puck Dynasty')).toBe('keep')
    // The file was never filled in.
    expect(decideTeamName('Ice Ice Baby', 'Team 2')).toBe('keep')
  })
})
