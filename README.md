# Inigo Insurance: NHL Fantasy

A private, season-long fantasy hockey league for 4 friends, with live scoring from the NHL's public stats API. It runs entirely on free tiers: GitHub Pages hosts the frontend and Supabase is the backend. It can also run entirely on one laptop.

**The league: <https://jacksonmeier.github.io/inigo-insurance-nhl-fantasy/>**

- Product spec: [SPEC.md](SPEC.md)
- Run it on your own computer: [docs/LOCAL.md](docs/LOCAL.md)
- Host it online: [docs/SETUP.md](docs/SETUP.md)
- Decisions the spec left open: [docs/DECISIONS.md](docs/DECISIONS.md)

## Quick start

With Docker Desktop running:

```bash
npm install
```

```bash
npm run setup
```

```bash
npm start
```

Then open <http://localhost:5173>. Sign-ins are in `league.local.json`, which setup creates.

## Layout

| Path | What's there |
|---|---|
| `src/` | Vite + React + TypeScript frontend (hash routing, mobile-first) |
| `supabase/migrations/` | Database schema, row-level security, and the league's rules as SQL functions |
| `supabase/functions/_shared/` | `league.config.ts` and `scoring.config.ts` (every league rule and scoring value), the scoring engine, and the NHL and ESPN clients |
| `supabase/functions/sync/` | The Edge Function that imports from the NHL and ESPN, on a schedule |
| `supabase/tests/` | Tests that apply the migrations to an in-memory Postgres and check the rules and the security |
| `scripts/` | Setup, start, sync, backup and restore for running locally |
| `.github/workflows/` | Deploy to GitHub Pages on every push to `main`, and a weekly encrypted backup |

## How it fits together

**Rules live in the database.** Every action that changes the league (a draft pick, an add, a trade, an IR move) is one SQL function, so it either happens completely or not at all, and two owners tapping at the same moment can't leave a roster in an impossible state. The browser calls these functions; it can't write to the tables.

**Data comes in through one Edge Function.** `sync` fetches from the NHL and ESPN, calculates fantasy points, and hands the results to the database. Browsers never call those APIs. The database's scheduler calls `sync`; so can the commissioner, from the Commissioner page.

**Points follow roster history.** A player's points for a game go to the team that had him in an active slot when the puck dropped. Rosters are stored as a history of who had whom and when, so a trade or a drop never moves points that were already earned.

**Settings live in two files.** Change a scoring value in `scoring.config.ts` or a league rule in `league.config.ts`. The sync function copies the league rules into the database each time it runs, which is where the SQL functions read them.

## Security model

The Supabase URL and anon key are public; they're in the browser bundle. Row-level security is what protects the data:

- Signed-out visitors, and signed-in accounts that aren't linked to a team, can't read anything.
- League members can read everything except other teams' alerts and waiver claims.
- From the browser, members can only rename their own team, mark their own alerts read, and call the rule functions, each of which checks who's calling.
- Stats and points are written server-side only. The Edge Function uses the service role key, which is stored only as an Edge Function secret.

## Commands

```bash
npm start        # run the league on this computer
npm run setup    # set up (or update) the local league
npm run sync     # run a sync job: npm run sync -- players
npm run backup   # save the local league to backups/
npm run restore  # load a backup: npm run restore -- backups/<file> --yes
npm run dev      # dev server with hot reload
npm test         # tests
npm run lint
npm run build
```
