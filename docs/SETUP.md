# Hosting the league

One-time setup to put the league online, so it works from anywhere. Everything here is on free tiers.

**This is done.** The league has been online since 2026-09-28:

- The app: <https://jacksonmeier.github.io/inigo-insurance-nhl-fantasy/>
- Supabase project: `inigo-insurance-nhl-fantasy`, ref `rlxqdonkaznusyqgqlya`, in the `boys-chel` organization.

The steps below are how it was set up, for doing it again (a new project, or after losing this one). For day-to-day changes, see "After a change" at the end.

To run the league on your own computer instead, with no accounts to create, see [LOCAL.md](LOCAL.md). If the league is already running there, read "Moving to the hosted version later" in that guide first: it changes step 6.

## 1. Create the Supabase project

1. Go to <https://supabase.com>, sign in (GitHub login is easiest), and click **New project**.
2. Organization: your personal org on the **Free** plan.
3. Name: `inigo-insurance-nhl-fantasy`. Region: the one closest to the league.
4. Database password: generate one and save it in your password manager. You need it for `supabase link` and for the weekly backup.
5. Wait about 2 minutes for the project to finish provisioning.

## 2. Copy the keys

In the project, open **Project Settings → API Keys** (or the **Connect** button at the top) and note:

- **Project URL**, e.g. `https://abcdefghijkl.supabase.co`. The part before `.supabase.co` is the **project ref**.
- **anon / publishable key.** This key is public and safe to put in the browser.
- **service_role / secret key.** This one can do anything. You'll use it once, from your own terminal, in step 6. Never put it in a file in this repo.

## 3. Create the database tables

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR-PROJECT-REF
```

```bash
npx supabase db push
```

Afterwards, **Table Editor** should list 22 tables, each marked with RLS enabled. **Integrations → Cron** should list 7 jobs starting with `league-`.

## 4. Configure sign-in

In **Authentication**:

1. **Sign In / Providers → Email**: make sure it's enabled.
2. **Sign In / Providers**: turn **off** "Allow new users to sign up". Only the 4 accounts created in step 6 can log in.
3. **URL Configuration**:
   - Site URL: `https://jacksonmeier.github.io/inigo-insurance-nhl-fantasy/`
   - Redirect URLs: add `https://jacksonmeier.github.io/inigo-insurance-nhl-fantasy/` and `http://localhost:5173/`

Owners can sign in with a password or an emailed link. Passwords always work.

> **Emailed links:** Supabase's built-in email sender is for testing. It's limited to a few emails per hour, and it may only deliver to members of your Supabase organization. If the links don't arrive, connect a free SMTP sender under **Authentication → Emails → SMTP Settings** (a Gmail app password works), or have everyone use their password.

## 5. Deploy the sync function

The function fetches from the NHL and ESPN. The database's scheduler calls it, and proves who it is with a shared secret.

Make up the secret and keep it in your terminal for the next step:

```bash
export CRON_SECRET=$(openssl rand -hex 24)
```

```bash
npx supabase secrets set CRON_SECRET=$CRON_SECRET
```

```bash
npx supabase functions deploy sync
```

## 6. Create the accounts and teams, and import the NHL

`league.local.json` lists the 4 owners: email, team name and password. If you don't have one yet, run `npm run setup` once with Docker running to create it (see [LOCAL.md](LOCAL.md)), then edit it.

In the same terminal as step 5, so `CRON_SECRET` is still set:

```bash
export SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
```

```bash
export SUPABASE_SERVICE_ROLE_KEY=paste-the-service-role-key
```

```bash
npm run setup
```

This creates the sign-ins and teams, sets the commissioner, tells the scheduler where the sync function is, and imports players, the schedule and injuries. It's safe to run again.

Close that terminal when you're done, so the service role key doesn't linger in it.

**Moving a league that started on your laptop?** Load your backup into the hosted database before this step, as described in LOCAL.md. Setup then finds the accounts and teams already there and keeps the teams. It does set each account's email and password to the ones in `league.local.json`, so an owner who changed their password in the app gets the file's password back.

## 7. Run the app against the hosted project

```bash
cp .env.example .env.local
```

Paste the project URL and anon key into `.env.local`, then:

```bash
npm run dev
```

`npm run setup` for the local league overwrites `.env.local`. Keep a copy of the hosted values if you switch back and forth.

## 8. Deploy to GitHub Pages

1. Open the GitHub repo **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.
2. In `.github/workflows/deploy.yml`, the **Build** step sets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Put in the project URL and its **publishable** key (`sb_publishable_...`). Both are public, so they live in the workflow rather than in GitHub secrets.
3. Push to `main`. The **Deploy to GitHub Pages** workflow lints, tests, builds, and publishes to <https://jacksonmeier.github.io/inigo-insurance-nhl-fantasy/>.

## 9. Turn on weekly backups

Supabase's free plan has no backups. The **Weekly backup** workflow exports the database every Monday and keeps each export for 90 days. The repo is public, and so are its workflow artifacts, so the export is encrypted before it's uploaded.

Under **Settings → Secrets and variables → Actions → Secrets**, add:

- `SUPABASE_DB_URL`: the connection string from the Supabase dashboard (**Connect → Session pooler**), with your database password filled in.
- `BACKUP_PASSPHRASE`: any long passphrase. Save it in your password manager. Without it a backup can't be opened.

To open a backup, download the artifact from the workflow run and:

```bash
gpg --decrypt league.sql.gpg > league.sql
```

Until both secrets are set the workflow does nothing.

## After a change

| You changed | Run |
|---|---|
| A scoring value or league rule in `supabase/functions/_shared/*.config.ts` | `npx supabase functions deploy sync`, then push to `main` |
| Anything in `supabase/functions/` | `npx supabase functions deploy sync` |
| A file in `supabase/migrations/` | `npx supabase db push` |
| Anything in `src/` | Push to `main` |

## In the offseason

Supabase pauses a free project after about a week with too little database activity, and emails a warning first. During the season the scheduled jobs and the owners keep it active. If it's paused when you come back:

1. Open the project in the Supabase dashboard and click **Restore project**. It takes a few minutes.
2. Sign in to the app and check the Commissioner page. Each sync job shows when it last ran; run **Players** and **Schedule** once.

A paused project can be restored for up to a year. After that, that's what the weekly backups are for: create a new project, follow this guide to step 3, load the latest backup (see "Moving to the hosted version later" in [LOCAL.md](LOCAL.md)), and carry on from step 5.

For a new season, update `season` in the `league_settings` table (for example `20272028`), then run **Players** and **Schedule** from the Commissioner page.
