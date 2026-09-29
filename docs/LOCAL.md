# Running the league on your own computer

> **The league moved online on 2026-09-28**, right after the draft: <https://jacksonmeier.github.io/inigo-insurance-nhl-fantasy/>. The copy in this laptop's Docker is a snapshot from that moment. Changes made to it don't reach the real league, so don't point anyone at it. Use this guide to try changes on a separate copy.

The whole league can run on one laptop: the database, sign-in, live updates and the scheduled jobs all run in Docker, and the app is served to every phone on the same Wi-Fi. Nothing is hosted and nothing costs money.

Use this to run the draft and the season from home. To put the league online instead, so it works from anywhere, see [SETUP.md](SETUP.md).

## What you need

- [Docker Desktop](https://www.docker.com/products/docker-desktop/), running.
- Node 22 or newer.
- About 6 GB of disk for the first start, when Docker downloads Supabase.

## First time

```bash
npm install
```

```bash
npm run setup
```

Setup takes a few minutes. It starts Supabase, creates a sign-in and a team for each of the 4 owners, turns on the scheduled jobs, and imports NHL players, the schedule and the injury list.

It also creates `league.local.json` with placeholder emails, team names and random passwords. Open it, put in the real emails and team names, change the passwords if you like, and run `npm run setup` again. The slot numbers tie each person to their team, so edit the other fields and leave `slot` alone. Git ignores this file.

A team name from the file replaces a placeholder ("Team 1", "Team 2"...). Once a team has a real name, setup leaves it alone, and the owner renames it in the app under the person icon. That way re-running setup never undoes a name someone chose.

Running setup again is always safe. It never touches rosters, picks or points.

## Every time

```bash
npm start
```

This starts Supabase if it isn't running, takes a backup, and serves the app. It prints two addresses:

- `http://localhost:5173` for the laptop itself.
- `http://<the laptop's address>:5173` for phones on the same Wi-Fi.

Leave the terminal window open. On a Mac the laptop is kept awake while it runs. Keep it plugged in.

Each owner signs in with the email and password from `league.local.json`, and can change their password and team name under the person icon.

## Draft day

1. Run `npm start` and sign in as the commissioner.
2. Send everyone the phone address and their sign-in. Have them open the **Draft** room.
3. In the draft room, **Draw the order**. Redraw, or use the arrows to set an order you've already agreed on.
4. Under **Timer and reset**, choose the time per pick. The default is 2 minutes.
5. When everyone is in, press **Start**.

During the draft, as commissioner you can:

- **Pause** and **Resume**. The clock stops and picks are blocked while paused.
- **Undo** the last pick, as many times as needed. The player goes back in the pool and that team is on the clock again.
- **Pick for whoever is on the clock**, if someone's phone dies.
- Change the timer. The current pick's clock restarts.

When the clock runs out, the best available player who fits that team's roster is picked automatically, ranked by last season's fantasy points. Players listed as Out or on Injured Reserve are passed over while anyone healthy is left. If it picks someone the owner didn't want, undo it and let them choose.

### Practice first

Run a practice draft on your own: start it, pick for each team as commissioner or let the clock run out, then use **Timer and reset → Reset the draft**. Reset erases every pick and empties the rosters, and keeps the draft order. It's only possible while rosters are exactly what the draft produced, so it can't wipe a season by accident.

### Phones can't connect

- **Same Wi-Fi.** The phone must be on the same network as the laptop. Guest networks often block devices from reaching each other; use the main one, or a phone hotspot that the laptop and the other phones all join.
- **The Mac's firewall.** The first time, macOS may ask whether `node` can accept incoming connections. Allow it. To check later: System Settings → Network → Firewall.
- **The address changed.** The laptop's address can change when it reconnects to Wi-Fi. `npm start` prints the current one.
- **Type `http://`.** Some phones try `https://` by default, which won't connect.

## Backups

Everything lives in a Docker volume on this computer. `npm start` takes a backup every time, and you can take one whenever you like:

```bash
npm run backup
```

Backups go to `backups/`, which git ignores. The last 30 are kept. Take one right after the draft.

Stopping Supabase or restarting the computer keeps the data. These do not:

| Command | What it destroys |
|---|---|
| `npx supabase db reset` | Everything. The database is rebuilt empty. |
| `npx supabase stop --no-backup` | Everything. The volume is deleted. |
| Deleting Docker's volumes or reinstalling Docker | Everything. |

### Restoring a backup

```bash
npm run restore -- backups/league-YYYY-MM-DDTHH-MM-SS.sql --yes
```

This replaces everything in the local league with the backup. It takes a backup of what's there first, in case the restore was a mistake.

## The scheduled jobs

They run inside the local database, exactly as they will when hosted, for as long as Supabase is running:

| Job | When |
|---|---|
| Live scoring | Every 30 seconds while games are on |
| Waivers, trade vetoes and IR decisions | Every 15 minutes |
| Injuries | Hourly on game days, and once more before the first puck drop |
| Final stats and corrections | Nightly |
| Players and schedule | Daily |

The commissioner page shows when each last ran and has a button to run it now. From a terminal:

```bash
npm run sync -- players
```

The jobs are `players`, `schedule`, `injuries`, `live`, `finals`, and `setup` (players, schedule and injuries together).

If the laptop is off during a game, nothing is lost. The nightly job re-imports the last two days of games, and you can run `npm run sync -- finals` yourself.

## Friends who aren't on your Wi-Fi

The local setup isn't safe to put on the internet. A local Supabase stack uses signing keys that are the same on every computer and are published in Supabase's documentation, so anyone who could reach it could read and change everything. That doesn't matter on your own Wi-Fi. It rules out tunnels and port forwarding.

For owners in other places, host the league: [SETUP.md](SETUP.md). The hosted project has its own secret keys.

## Moving to the hosted version later

The draft and everything after it can move from the laptop to a hosted Supabase project. This was done on 2026-09-28; the steps are here in case it's ever needed again.

1. Follow [SETUP.md](SETUP.md) up to and including "Create the database tables", and stop before creating users. The accounts come across in the backup.
2. Take a backup: `npm run backup`.
3. Wrap the backup so it loads in one go. The new database already has a default settings row, which the backup's row replaces:

   ```bash
   { echo 'begin; delete from public.league_settings;'; cat backups/league-YYYY-MM-DDTHH-MM-SS.sql; echo 'commit;'; } > load.sql
   ```

4. Load it. This goes through your `supabase login`, so it needs neither `psql` nor the database password:

   ```bash
   npx supabase db query --linked -f load.sql
   ```

   Then delete `load.sql`. It contains everyone's sign-in details.

5. Carry on with SETUP.md from "Deploy the sync function".

Owners keep their teams, emails and passwords.

## Useful addresses

| | |
|---|---|
| The app | <http://localhost:5173> |
| Supabase Studio (browse the database) | <http://127.0.0.1:54323> |
| Emails the app would have sent (sign-in links) | <http://127.0.0.1:54324> |

## Stopping

Ctrl+C stops the app. Supabase keeps running in Docker, which is what keeps the scheduled jobs going. To stop that too:

```bash
npx supabase stop
```
