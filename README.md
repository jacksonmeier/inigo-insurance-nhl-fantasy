# Inigo Insurance: NHL Fantasy

A private, season-long fantasy hockey league for 4 friends, with live scoring from the NHL's public stats API. It runs entirely on free tiers: GitHub Pages hosts the frontend and Supabase is the backend.

- Product spec: [SPEC.md](SPEC.md)
- One-time setup: [docs/SETUP.md](docs/SETUP.md)

## Layout

| Path | What's there |
|---|---|
| `src/` | Vite + React + TypeScript frontend (hash routing, mobile-first) |
| `supabase/migrations/` | Database schema and row-level security |
| `supabase/functions/_shared/` | `league.config.ts` and `scoring.config.ts`: every league rule and scoring value, shared by the frontend and Edge Functions |
| `supabase/functions/` | Edge Functions for NHL and ESPN data (Phase 2+) |
| `supabase/tests/` | Tests that apply the migrations to an in-memory Postgres and check the security rules |
| `.github/workflows/deploy.yml` | Lint, test, build and deploy to GitHub Pages on every push to `main` |

## Security model

The Supabase URL and anon key are public; they're in the browser bundle. Row-level security is what protects the data:

- Signed-out visitors, and signed-in accounts that aren't linked to a team, can't read anything.
- League members can read everything except other teams' alerts.
- From the browser, members can only rename their own team and mark their own alerts read.
- Stats, points and all roster moves are written server-side only. Edge Functions use the service role key, which is stored only as an Edge Function secret.

## Commands

```bash
npm run dev      # local dev server
npm test         # tests
npm run lint
npm run build
```
