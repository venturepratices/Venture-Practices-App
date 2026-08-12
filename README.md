# Venture Practices — Agency Platform

Internal project-management + client-portal app for Venture Practices. Replaces a Google
Sheets + Apps Script workflow that couldn't handle concurrent edits or real data volume.
Every client, task, campaign, project, note, credential, and asset lives as one row in a
real Postgres database — agency-wide, per-client, and per-person views are just filtered
queries over that same data, not separate copies.

Live app: deployed on Vercel, auto-deploys from `master`.

For **why** things are built the way they are — feature history, decisions made along the
way, and everything still planned — see [`AGENTS.md`](./AGENTS.md). This README is the
practical "how do I run/deploy this" doc; [`ARCHITECTURE.md`](./ARCHITECTURE.md) covers the
load-bearing patterns worth understanding before making non-trivial changes.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), TypeScript, React 19 |
| Database | PostgreSQL on [Neon](https://neon.tech) — separate `production` and `development` branches |
| ORM | Prisma 7, custom `prisma-client` generator (output at `src/generated/prisma`, gitignored) |
| Auth | Auth.js v5, Credentials provider, JWT sessions |
| UI | Tailwind CSS v4 + [Base UI](https://base-ui.com) primitives (shadcn-style, not Radix) |
| File storage | Vercel Blob (two stores: archive/backups, and asset uploads) |
| Hosting | Vercel — every push to `master` auto-deploys |
| Integrations | Slack (notifications), HighLevel/LeadConnector (conversations + calls), Google Calendar (team availability), Sentry (error tracking), Anthropic API (meeting transcript summaries) |

## Getting started

**1. Install dependencies**
```bash
npm install
```

**2. Set up environment variables**

Copy `.env.example` to `.env` and fill in real values. At minimum for local dev you need:
`DATABASE_URL` (point this at the **development** Neon branch, never production — see the
comment in `.env.example`), `AUTH_SECRET`, `AUTH_TRUST_HOST="true"`. Everything else in
`.env.example` is an optional integration — the app runs fine without them, just with that
feature silently disabled (a documented convention, see [`ARCHITECTURE.md`](./ARCHITECTURE.md)).

**3. Apply the database schema**
```bash
npx prisma generate
npx prisma migrate deploy
```
This project uses **hand-authored migrations** (no `prisma migrate dev` — every migration
under `prisma/migrations/` is written by hand as plain SQL, reviewed before it ever touches
the real database). `migrate deploy` just applies whatever's already there.

**4. Seed the first login**
```bash
npx prisma db seed
```
Creates the first admin account. Check `prisma/seed.ts` for the credentials.

**5. Run the dev server**
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

> **Gotcha:** after any schema change, `prisma generate` regenerates the client, but a
> `next dev` process that was already running keeps the *old* generated client in memory.
> Restart the dev server after every migration, or you'll see confusing "unknown field"
> errors on a field that clearly exists in `schema.prisma`.

## Common commands

```bash
npm run dev        # start the dev server (Turbopack)
npm run build      # prisma generate && prisma migrate deploy && next build
npm run start      # run a production build locally
npm run lint       # ESLint
npx tsc --noEmit   # typecheck without emitting
npx prisma studio  # browse the database in a GUI
```

## Deployment

Every push to `master` triggers a Vercel deploy. The build script
(`prisma generate && prisma migrate deploy && next build`) means **migrations run
automatically on every deploy** — there's no separate manual migration step for production.
This was a real bug once (a migration silently never ran in production because the build
script only did `prisma generate`) — don't remove `migrate deploy` from that script.

Environment variables are split by Vercel environment: **Production** points at the real
Neon `production` branch; **Preview** and **Development** point at the `development` branch.
Never point Production's `DATABASE_URL` anywhere but the real branch, and never point local
`.env` or Preview at production — see the comment block at the top of `.env.example`.

Six cron jobs run on Vercel's scheduler (`vercel.json`): daily database backup, HighLevel
data pruning, asset/task due-soon notifications, monthly storage-usage check, and daily
Google Calendar sync. All are authenticated via a shared `CRON_SECRET` bearer token.

## Project structure

```
prisma/
  schema.prisma          # the single source of truth for the data model
  migrations/             # hand-authored SQL migrations, one folder per change
  seed.ts                  # creates the first admin account
src/
  app/
    (app)/                 # the main authenticated app shell (sidebar + topbar)
      clients/[clientId]/    # every per-client tab: tasks, notes, assets, orders, etc.
      dashboard/, tasks/, my-tasks/, team/, activity/, archive/, settings/
    api/                     # every backend route — one folder per resource
    portal/                   # the separate client-facing portal (ClientUser login)
    review/[token]/            # tokenized guest asset-review links (no login needed)
    login/, change-password/
  components/                 # React components, organized to mirror the feature they belong to
  lib/                         # business logic, not tied to any one route
    actions/                    # Next.js Server Actions (form submissions)
    validations/                  # Zod schemas, shared between client forms and server routes
    permissions.ts, permission-catalog.ts   # the access-control system
    archive.ts                                # the soft-delete/restore pattern
    notify.ts, slack.ts, notification-links.ts   # the notification system
  generated/prisma/            # generated Prisma client — gitignored, regenerated on install
```

## Contributing conventions

- **Migrations are hand-written SQL**, not generated interactively. Write the `.sql` file,
  run `prisma migrate deploy` locally, then `prisma generate` and restart the dev server.
- **Optional integrations degrade silently.** If an env var for Slack/Sentry/Blob/etc. is
  unset, that feature just logs a warning and no-ops — it never throws or blocks a request.
  Follow this pattern for any new optional integration.
- **Soft-delete over hard-delete.** Tasks, Campaigns, Projects, Client Notes, and Meeting
  Notes all archive-then-delete rather than truly deleting — see `src/lib/archive.ts` and
  [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the pattern to follow for any new deletable model.
- **Never commit real secrets.** `.env` is gitignored; `.env.example` documents every
  variable's purpose and where to get it, with no real values.
