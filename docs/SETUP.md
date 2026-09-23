# Setup

One-time setup for the league. Everything here is on free tiers.

## 1. Create the Supabase project

1. Go to <https://supabase.com>, sign in (GitHub login is easiest), and click **New project**.
2. Organization: your personal org on the **Free** plan.
3. Name: `inigo-insurance-nhl-fantasy`. Region: the one closest to the league.
4. Database password: generate one and save it in your password manager. You need it for `supabase link` and for the backup job in Phase 10.
5. Wait about 2 minutes for the project to finish provisioning.

## 2. Copy the public keys

In the project, open **Project Settings → API Keys** (or the **Connect** button at the top) and note:

- **Project URL**, e.g. `https://abcdefghijkl.supabase.co`. The part before `.supabase.co` is the **project ref**.
- **anon / publishable key.** This key is public and safe to put in the browser.

Never copy the **service_role / secret** key anywhere in this repo. It only ever goes into Edge Function secrets (Phase 2+).

## 3. Create the database tables

Pick one option.

**Option A: Supabase CLI (recommended, and needed later for Edge Functions)**

```bash
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push
```

**Option B: SQL editor.** Open **SQL Editor** in the dashboard. Paste and run each file in `supabase/migrations/` in filename order.

After either option, **Table Editor** should list 20 tables, each marked with RLS enabled.

## 4. Configure sign-in

In **Authentication**:

1. **Sign In / Providers → Email**: make sure it's enabled.
2. **Sign In / Providers**: turn **off** "Allow new users to sign up". Only the 4 accounts you create below can log in.
3. **URL Configuration**:
   - Site URL: `https://jacksonmeier.github.io/inigo-insurance-nhl-fantasy/`
   - Redirect URLs: add `https://jacksonmeier.github.io/inigo-insurance-nhl-fantasy/` and `http://localhost:5173/`
4. **Users → Add user → Create new user**, once per league member. Enter their email, set any random password (they won't use it), and tick **Auto Confirm User**.

> **Email delivery caveat:** Supabase's built-in email sender is for testing. It's limited to a few emails per hour, and it may only deliver to members of your Supabase organization. If the friends' magic links don't arrive, pick one fix:
> - Invite them to your Supabase organization (**Organization settings → Team**).
> - Connect a free SMTP sender under **Authentication → Emails → SMTP Settings**, e.g. a Gmail app password.
> - Switch the app to email + password sign-in.

## 5. Create the teams and set the commissioner

In **SQL Editor**, edit the names and emails below, then run:

```sql
insert into public.teams (name, owner_id)
select t.name, u.id
from (values
  ('Team One',   'you@example.com'),
  ('Team Two',   'friend1@example.com'),
  ('Team Three', 'friend2@example.com'),
  ('Team Four',  'friend3@example.com')
) as t(name, email)
join auth.users u on lower(u.email) = lower(t.email);

update public.league_settings
set commissioner_id = (select id from auth.users where lower(email) = lower('you@example.com'));

select name from public.teams;  -- should list 4 teams
```

## 6. Run it locally

```bash
cp .env.example .env.local   # then paste in the URL and anon key
npm install
npm run dev                  # http://localhost:5173
npm test                     # database security tests (no Supabase needed)
```

## 7. Deploy to GitHub Pages

1. Open the GitHub repo **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.
2. Open **Settings → Secrets and variables → Actions → Variables** and add two repository variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Push to `main`. The **Deploy to GitHub Pages** workflow lints, tests, builds, and publishes to <https://jacksonmeier.github.io/inigo-insurance-nhl-fantasy/>.
