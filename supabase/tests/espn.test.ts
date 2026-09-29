// Reading ESPN's injury list and matching its players to the NHL's.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nhlTeamFromEspn, parseInjuries, type EspnInjuredPlayer } from '../functions/_shared/espn.ts'
import { LEAGUE } from '../functions/_shared/league.config.ts'
import { matchPlayer, normalizeName, type NhlPlayerRef } from '../functions/_shared/matching.ts'

// A trimmed copy of a real response from ESPN.
const response = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/espn-injuries.json'), 'utf8'))

describe('parseInjuries', () => {
  const injuries = parseInjuries(response)
  const find = (name: string) => injuries.find((i) => i.name === name) as EspnInjuredPlayer

  it('reads each injured player', () => {
    expect(injuries).toHaveLength(8)
    expect(find('Jonathan Huberdeau')).toEqual({
      espnAthleteId: '2562606', name: 'Jonathan Huberdeau', firstName: 'Jonathan', lastName: 'Huberdeau',
      team: 'CGY', position: 'LW', status: 'Injured Reserve',
      description: 'Hip, expected back 2026-10-08', updatedAt: expect.any(String),
    })
  })

  it('translates ESPN team abbreviations to the NHL ones', () => {
    expect(find('Dominic James').team).toBe('TBL')
    expect(find('Joel Edmundson').team).toBe('LAK')
    expect(find('Seamus Casey').team).toBe('NJD')
    expect(find('Alex Barre-Boulet').team).toBe('SJS')
    expect(nhlTeamFromEspn('UTAH')).toBe('UTA')
    expect(nhlTeamFromEspn('EDM')).toBe('EDM')
    expect(nhlTeamFromEspn(undefined)).toBeNull()
  })

  it('reports statuses exactly as the league config names them', () => {
    const statuses = new Set(injuries.map((i) => i.status))
    expect(statuses).toEqual(new Set(['Out', 'Injured Reserve', 'Day-To-Day', 'Suspension']))
    for (const eligible of LEAGUE.irEligibleStatuses) expect(statuses).toContain(eligible)
  })

  it('survives an empty or unexpected response', () => {
    expect(parseInjuries({})).toEqual([])
    expect(parseInjuries({ injuries: [{ injuries: [{ status: 'Out' }, { athlete: { displayName: 'No Id' }, status: 'Out' }] }] })).toEqual([])
  })
})

describe('normalizeName', () => {
  it('ignores accents, punctuation and suffixes', () => {
    expect(normalizeName('Tim Stützle')).toBe('tim stutzle')
    expect(normalizeName('J.T. Miller')).toBe('jt miller')
    expect(normalizeName("Ryan O'Reilly")).toBe('ryan oreilly')
    expect(normalizeName('Alex Barré-Boulet')).toBe('alex barre boulet')
    expect(normalizeName('Martin Fehérváry')).toBe('martin fehervary')
    expect(normalizeName('Josh  Morrissey Jr.')).toBe('josh morrissey')
  })
})

describe('matchPlayer', () => {
  const nhl = (id: number, first: string, last: string, position: NhlPlayerRef['position'], team: string | null): NhlPlayerRef => ({
    id, first_name: first, last_name: last, position, nhl_team: team,
  })
  const espn = (name: string, team: string | null, position: string | null): EspnInjuredPlayer => ({
    espnAthleteId: '1', name, firstName: name.split(' ')[0], lastName: name.split(' ').slice(1).join(' '),
    team, position, status: 'Out', description: null, updatedAt: null,
  })

  const players = [
    nhl(1, 'Connor', 'McDavid', 'C', 'EDM'),
    nhl(2, 'Sebastian', 'Aho', 'C', 'CAR'),
    nhl(3, 'Sebastian', 'Aho', 'D', 'PIT'),
    nhl(4, 'Tim', 'Stützle', 'C', 'OTT'),
    nhl(5, 'Matthew', 'Tkachuk', 'L', 'FLA'),
    nhl(6, 'Brady', 'Tkachuk', 'L', 'OTT'),
    nhl(7, 'Alex', 'Barré-Boulet', 'C', 'SJS'),
    nhl(8, 'Mitchell', 'Marner', 'R', 'VGK'),
    nhl(9, 'Elias', 'Pettersson', 'C', 'VAN'),
    nhl(10, 'Elias', 'Pettersson', 'D', 'VAN'),
  ]

  it('is confident about an exact name', () => {
    expect(matchPlayer(espn('Connor McDavid', 'EDM', 'C'), players)).toEqual({ playerId: 1, confidence: 'high' })
    expect(matchPlayer(espn('Tim Stutzle', 'OTT', 'C'), players)).toEqual({ playerId: 4, confidence: 'high' })
    expect(matchPlayer(espn('Alex Barre-Boulet', 'SJS', 'C'), players)).toEqual({ playerId: 7, confidence: 'high' })
  })

  it('stays confident when a traded player\'s team is out of date on one side', () => {
    expect(matchPlayer(espn('Connor McDavid', 'TOR', 'C'), players)).toEqual({ playerId: 1, confidence: 'high' })
  })

  it('tells apart players who share a name, by team and then position', () => {
    expect(matchPlayer(espn('Sebastian Aho', 'CAR', 'C'), players)).toEqual({ playerId: 2, confidence: 'high' })
    expect(matchPlayer(espn('Sebastian Aho', 'PIT', 'D'), players)).toEqual({ playerId: 3, confidence: 'high' })
    // Same team, so only the position separates them.
    expect(matchPlayer(espn('Elias Pettersson', 'VAN', 'D'), players)).toEqual({ playerId: 10, confidence: 'high' })
    expect(matchPlayer(espn('Elias Pettersson', 'VAN', 'C'), players)).toEqual({ playerId: 9, confidence: 'high' })
    // Nothing to go on: leave it to the commissioner.
    expect(matchPlayer(espn('Elias Pettersson', 'VAN', null), players)).toEqual({ playerId: null, confidence: 'unmatched' })
  })

  it('flags a nickname match for a second look', () => {
    expect(matchPlayer(espn('Matt Tkachuk', 'FLA', 'LW'), players)).toEqual({ playerId: 5, confidence: 'low' })
    expect(matchPlayer(espn('Mitch Marner', 'VGK', 'RW'), players)).toEqual({ playerId: 8, confidence: 'low' })
  })

  it('does not confuse brothers', () => {
    expect(matchPlayer(espn('Brady Tkachuk', 'OTT', 'LW'), players)).toEqual({ playerId: 6, confidence: 'high' })
    // Right last name, wrong team for either brother's nickname rule.
    expect(matchPlayer(espn('Keith Tkachuk', 'STL', 'LW'), players)).toEqual({ playerId: null, confidence: 'unmatched' })
  })

  it('doubts a same-name player at a different position on a different team', () => {
    expect(matchPlayer(espn('Connor McDavid', 'BOS', 'G'), players)).toEqual({ playerId: 1, confidence: 'low' })
  })

  it('gives up on someone it has never heard of', () => {
    expect(matchPlayer(espn('Wayne Gretzky', 'EDM', 'C'), players)).toEqual({ playerId: null, confidence: 'unmatched' })
  })
})
