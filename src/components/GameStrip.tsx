import { gameStatus, isFinal, isLive } from '../lib/format.ts'
import type { Game } from '../lib/types.ts'

/** Today's NHL games, side by side, with scores once they start. */
export default function GameStrip({ games }: { games: Game[] }) {
  return (
    <div className="games">
      {games.map((game) => {
        const started = isLive(game.game_state) || isFinal(game.game_state)
        return (
          <div key={game.id} className={isLive(game.game_state) ? 'game live' : 'game'}>
            <div className="side">
              <span>{game.away_team}</span>
              <b>{started ? (game.away_score ?? 0) : ''}</b>
            </div>
            <div className="side">
              <span>{game.home_team}</span>
              <b>{started ? (game.home_score ?? 0) : ''}</b>
            </div>
            <div className="when">{gameStatus(game)}</div>
          </div>
        )
      })}
    </div>
  )
}
