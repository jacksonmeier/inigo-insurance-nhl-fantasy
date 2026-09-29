# Decisions the spec left open

The spec says to ask before making product decisions it doesn't cover. These were made to get the league running for the draft. Each is a small change if the league wants it another way; the place to change it is listed.

## Draft

| Decision | Where |
|---|---|
| When the pick clock runs out, the best available player who fits the roster is picked automatically, ranked by last season's fantasy points. Players listed as Out or on Injured Reserve are passed over while anyone healthy is left. | `draft_auto_pick` in `supabase/migrations/20260926000200_draft.sql` |
| The clock is driven by the open draft rooms: whichever phone sees it hit zero asks the database to make the pick, and the database makes sure it happens once. If nobody has the draft room open, the draft waits. | `src/pages/DraftPage.tsx` |
| The commissioner can pick for whoever is on the clock, and can set the draft order by hand as well as drawing it at random. | same migration |
| The commissioner can reset the whole draft, but only while rosters are exactly what the draft produced. | `draft_reset` |

## Scoring

| Decision | Where |
|---|---|
| A game's points go to the team that had the player in an active slot **at puck drop**. Add a player after his game has started and that game doesn't count for you. Drop him mid-game and it still counts. | `private.team_at` in `20260926000000_league_config.sql` |
| Goalies score only the four goalie stats. A goalie's assist earns nothing. | `supabase/functions/_shared/boxscore.ts` |
| A shutout needs the whole game: the goalie allowed nothing and no other goalie played for his team. It's awarded when the game ends, and it counts in a 1-0 shootout loss, as the NHL credits it. | same file |
| A player who dressed but had no ice time didn't play, and gets no line for the game. | same file |
| "Today" rolls over at 6 AM Eastern, so late West Coast games still count as tonight. The week runs Monday to Sunday. | `public.fantasy_today` |

## Rosters, free agency and waivers

| Decision | Where |
|---|---|
| A roster is valid when no position has more active players than allowed. It may be short: an open spot just scores nothing. That's what lets an owner drop first and add later. | `private.do_add` in `20260926000100_roster_moves.sql` |
| Waiver claims are private to the owner who made them (and the commissioner) until the waiver is processed. | `20260926000000_league_config.sql` |
| If claimants are tied in the standings (as before the first game), the earliest claim wins. | `private.process_waiver` |
| Any owner can claim a player on waivers, including the one who dropped him. | `claim_waiver` |
| A claim that no longer fits when the window closes (no room, or the player to drop is gone) is skipped and the next claim is considered. | `private.process_waiver` |

## Injured reserve

| Decision | Where |
|---|---|
| The first free agent added into a spot vacated by a player on IR is his temporary replacement. There's no separate "add replacement" step. | `private.do_add` |
| An owner can activate a player from IR, or drop him, at any time, not only once he's healthy. | `20260926000400_injured_reserve.sql` |
| If ESPN lists the player as out again during his 24-hour return window, the window is called off and he stays on IR. | `ingest_injuries` in `20260926000500_data_ingest.sql` |
| A suspended player is not IR-eligible. The spec names Out and Injured Reserve only. | `irEligibleStatuses` in `league.config.ts` |
| If ESPN returns an empty injury list, it's treated as a failed fetch and ignored. Otherwise every player on IR would be declared healthy at once. | `ingest_injuries` |

## Trades

| Decision | Where |
|---|---|
| One veto from an owner outside the trade cancels it. | `veto_trade` in `20260926000300_trades.sql` |
| Players on IR and temporary IR replacements can't be traded. | `private.trade_problem` |
| A trade can't fill the spot being held for a player on IR. | same function |
| A trade is checked again when the veto window closes. If it no longer works (a player was dropped in the meantime), it's cancelled and both owners are told why. | `private.execute_trade` |

## Players

| Decision | Where |
|---|---|
| The NHL leaves injured players off its roster lists. Last season's regulars (10 or more games) who are missing from every roster are looked up one by one and kept if they're still with an NHL team. | `syncPlayers` in `supabase/functions/_shared/sync.ts` |
| Before the season has any games, players are ranked by last season's fantasy points under this league's scoring. | `player_season_stats` |

## Signing in

| Decision | Where |
|---|---|
| Owners can sign in with a password as well as an emailed link. Emailed links need an email service; passwords work anywhere, including on a laptop with no email. | `src/pages/LoginPage.tsx` |

## Counter-offers, season history, Tonight, player info, watchlist

Added after the draft. These were built to the one-line descriptions picked from a list, so the details below were decided without asking.

| Decision | Where |
|---|---|
| A counter-offer closes the offer it answers (it shows as countered) and goes back the other way as a new offer. That one can be accepted, rejected, withdrawn, or countered again. | `counter_trade` in `supabase/migrations/20260928000000_trade_counters.sql` |
| Countering with exactly the trade you were offered is refused: accept it instead. | same |
| Offers and counter-offers stay out of the activity feed, as offers always have. Only agreed trades are listed. | same |
| The race chart adds the commissioner's point adjustments on the day they were made, so each line ends at the team's standings total. | `team_daily_points` in `20260928000200_history_tonight_player_info.sql` |
| Nightly and weekly winners count points from games only, not adjustments. A tie counts as a win for every team in it, and a night where nobody scored more than zero has no winner. | `src/lib/history.ts` |
| Weeks run Monday to Sunday, the same as the week's top scorer. | same |
| Each team keeps the same chart colour all season: colours follow the team, not its place. | `teamColors` in `src/lib/history.ts` |
| Once the draft is complete, the top-bar button that went to the draft room goes to Tonight instead, with a red dot while games are live. The draft room is still reachable from Account. | `src/components/Layout.tsx` |
| A player dropped after puck drop stays on his old team's Tonight list for that night, because his points still count there. A player added after puck drop is listed on his new team, marked as not counting. | `tonight_lines` |
| "Games in the next 7 days" counts games from today through the next six days that haven't started. A game in progress doesn't count, since a player added now wouldn't score in it. | `src/pages/PlayersPage.tsx`, `src/components/PlayerSheet.tsx` |
| Each team's watchlist is private. Other owners and the commissioner can't see it. | `20260928000100_watchlist.sql` |
| Owners watching a player are alerted when he's dropped onto waivers, clears waivers, or is released straight to free agency (a temporary IR replacement let go, or a commissioner removal). Not when he's claimed, traded, or moved on or off IR. | same |
| You can't watch your own players, and a player leaves your watchlist once your team gets him. | same |
