# Architecture

This covers the patterns that repeat across the codebase and should be followed by any new
feature, not a feature-by-feature history (that's [`AGENTS.md`](./AGENTS.md)).

## Data model shape

`prisma/schema.prisma` is the single source of truth — 50+ models, all in one file. A few
shapes repeat throughout it:

- **`Client` is the hub.** Almost everything (`Task`, `Campaign`, `WorkflowInstance`,
  `ClientNote`, `Asset`, `ClientOrder`, ...) has a `clientId`. Most of those are nullable —
  `null` means "internal/agency work, not tied to any client," a deliberate first-class case,
  not an edge case to special-case around.
- **Snapshot-at-creation, not live references.** When a template spawns something real (a
  Workflow Template → a running `WorkflowInstance`, an Order Template → a `ClientOrder`), the
  template's shape is copied into a `Json` snapshot column on the instance at creation time.
  Editing the template later never retroactively changes anything already spawned. Look for
  `stagesSnapshot`, `customFieldValues`, `TemplateSnapshot` for examples.
- **Denormalized labels on archived/historical rows.** `ArchivedTask.clientName`,
  `ActivityLog.actorName`, `ArchivedCampaign.clientName` — plain string copies alongside (or
  instead of) a foreign key, so a historical record still reads correctly even after the
  Client/TeamMember it referenced is renamed or deleted.

## Auth & permissions

Two identity types, in separate tables: **`TeamMember`** (agency staff, full app) and
**`ClientUser`** (a client's own login, portal-only — `src/app/portal/**`). Auth.js v5
Credentials provider checks both; JWT session carries which one you are.

Access control is **capability-based, not role-based**, defined in
`src/lib/permission-catalog.ts` (`PERMISSION_GROUPS`) — a flat list of boolean flags like
`canDeleteTasks`, `canViewCredentials`, `canManageWorkflows`, each a real column on
`TeamMember`. `isAdmin` bypasses every check. Client-level access is a separate axis:
`allClientsAccess` (see everything) or a `ClientAccess` join table (see specific clients).

**The critical detail:** permissions are loaded fresh from the database on every request
(`src/lib/permissions.ts`, wrapped in React `cache()` to dedupe within one request) — never
baked into the JWT. This is deliberate: revoking someone's access takes effect on their very
next click, not "next time they log in." Every mutating route calls one of
`requireCapability()` / `requireClientAccess()` / `requireAdmin()` before touching the
database; every list query is scoped through `accessibleClientFilter()`. If you add a new
mutating route, gate it the same way — there is no middleware-level enforcement to fall back
on, each route is independently responsible.

## Soft-delete / archive pattern

Nothing user-deletable is ever a plain hard delete. `src/lib/archive.ts` holds one
`archiveX()` / `restoreArchivedX()` pair per archivable model (`Task`, `Campaign`,
`WorkflowInstance`, `ClientNote`, `MeetingNote`). Each `archiveX()`:

1. Reads the live row (and any child data worth preserving — comments, links, subtasks).
2. Writes a denormalized snapshot into a matching `ArchivedX` table, inside the same
   transaction as the delete.
3. Deletes the live row.

`restoreArchivedX()` reverses it — recreates a live row from the snapshot, then removes the
archive record. Archived rows show up on `/archive`, grouped into tabs, each with a
"Restore" button hitting a `POST /api/archived-x/[id]/restore` route.

`ArchivedTask` additionally mirrors to Vercel Blob as plain JSON (`src/lib/archive.ts`'s
`archiveTask()`) — a second, independent failure domain from Postgres, so task history
survives even a database-level incident. Other archived models don't need this; Task was the
first and highest-volume case when the pattern was designed.

**Adding a new deletable model:** add an `ArchivedX` model to the schema (denormalized
fields, `deletedAt`, `deletedById`), write `archiveX()`/`restoreArchivedX()` in `archive.ts`,
call `archiveX()` from the delete route instead of `prisma.x.delete()`, add a restore route,
and add a tab to `src/app/(app)/archive/page.tsx`.

## Notifications

`src/lib/notify.ts`'s `notify()` is the one function every feature calls when something
happens that a specific person should know about (assigned a task, mentioned, a status
changed, etc.). It always writes an in-app `Notification` row, and — unless `slack: false` —
also DMs that person on Slack (`src/lib/slack.ts`), resolved by matching their email to a
Slack account (or a manually-set override on their Team profile). Every call site should pass
a `linkPath` (an app-relative path) when it has enough context to build one — that becomes
the "Open in app" link in the Slack message and the click target on the in-app row.

Separately, `notifyChannel()` posts **one** team-facing summary of a headline event (a
workflow stage completing, a task going overdue, an asset getting approved) to a shared Slack
channel — the client's own private channel if one exists, or a general internal channel
otherwise. Always call `notifyChannel()` once per event, outside the per-recipient `notify()`
loop — never inside it, or the channel gets spammed once per recipient instead of once per
event.

## Optional integrations degrade silently

Every integration that depends on a third-party credential (Slack, Sentry, Vercel Blob,
HighLevel, Google Calendar, the Anthropic API) checks whether its env var is set before doing
anything, and if it's not, logs a warning and skips — it never throws and never blocks the
request that triggered it. This is why the app runs fine locally with a near-empty `.env`.
Follow this convention for any new external integration rather than making it a hard
dependency.

## Background jobs

Six Vercel Cron jobs (`vercel.json`, all under `src/app/api/cron/`), each authenticated by
checking `Authorization: Bearer <CRON_SECRET>` — no session, fail-closed if the header is
wrong or missing:

| Route | Schedule | Job |
|---|---|---|
| `backup` | daily 3am | full database snapshot to Vercel Blob |
| `highlevel-prune` | daily 4am | trim cached HighLevel conversation/call data to the retention window |
| `asset-due-soon` | daily 1pm | notify on assets approaching their due date |
| `task-due-soon` | daily 2pm | notify on tasks due soon or newly overdue |
| `storage-check` | monthly | check Neon/Blob usage, Slack-alert if it's getting close to a plan limit |
| `calendar-sync` | daily 6am | refresh everyone's connected Google Calendar free/busy cache |

## Multi-tenancy boundary: agency vs. client vs. guest

Three distinct trust levels, each with its own entry point:

- **Agency staff** (`TeamMember`) — the main app at `/`, gated by the capability system above.
- **Clients** (`ClientUser`) — a separate, much smaller portal at `/portal/**`. Read-mostly:
  view their own assets/campaigns/workflows, submit intake forms, approve/comment on assets.
  Scoped by `clientId` on the session, never sees another client's data.
- **Guests** (no login) — tokenized share links at `/review/[token]` for one-off asset
  approval by someone outside the org entirely. The token itself is the only credential;
  routes under `/review/` authenticate by looking up the token, not a session.

When building a new feature, decide up front which of these three it belongs to — don't
default everything into the main agency app.

## Environment separation

Local dev and Vercel Preview point at a Neon **development** branch; only Vercel's Production
environment variable points at the real **production** branch. This is enforced by
convention (documented in `.env.example`), not by code — there's no runtime check preventing
a misconfigured `DATABASE_URL` from pointing dev at production. Double-check this whenever
setting up a new environment.
