# Session Notes — set-aside / unfinished / parked work

This file is a running "don't lose track of this" list, kept up to date across
sessions (and refreshed before any context compaction) so nothing here gets
silently dropped. It is NOT a feature spec — see the Claude Code plan file for
full build history and detailed designs. This is just the punch list.

Last updated: 2026-08-14 (evening)

## Waiting on the user (do these first when picking this back up)

- **Click "Create channel" for Journey Smiles and LandMark Dental** in the live
  app: Settings → Notifications → Connections → CLIENT CHANNELS. Shipped in
  commit `b015eac`; needs a Vercel deploy to land first. These are the two real
  clients (plus "Ben Shaver- Test 7/26", a test client, which can be ignored)
  that predate the Slack wiring, so `ensureClientChannel` never fired for them.
  - **The button's render is verified; the actual create click is NOT yet
    exercised end-to-end.** Deliberately not clicked locally: local `.env`
    points at the *dev* Neon branch but `SLACK_BOT_TOKEN` points at the *real*
    Slack workspace, so clicking here would create the real channel and store
    its id in the dev database — leaving production still showing "Not created
    yet" and then failing with `name_taken` on the real click. If the
    production click errors, the message appears inline under the row.
- **Archive the 5 test Slack channels** (workspace-visible, so the user's call):
  `client-test-client---dj`, `client-test-client-bug-fix`,
  `client-test-dental-client`, `client-zztest-slack-channel-verify`,
  `client-ben-shaver--test-726`. Note `Test Dental Client` is still an Active
  *client* in production, so confirm before treating it as disposable. Faster
  for the user to do in Slack directly — the bot token lacks `channels:read`
  and `groups:read`, so channel ids can't be looked up by name from code.
- **The `/team` production Sentry error** (`JAVASCRIPT-NEXTJS-2`, 2026-08-12,
  `venture-practices.sentry.io/issues/7668169804`) — the message is redacted by
  Next.js in production builds and the Sentry dashboard needs a login. Paste
  the details from the dashboard to unblock. May already be fixed by the ~15
  commits since.

## Decided this session (don't re-litigate)

- **Slack channel naming stays as-is** (`client-journey-smiles` etc.). Slack
  forbids capital letters in channel names — that's a platform rule, not an app
  choice, so matching the app's capitalization is impossible in the name
  itself. Keeping the `client-` prefix keeps all 16 existing channels
  consistent; no renaming.
- **Per-client Slack channels stay private** (`is_private: true`) by design, so
  channel visibility mirrors the app's own per-client permission model. The
  padlock icon is intentional. Making them public would let the whole workspace
  read any client's activity.

## Paused mid-build

- **Rich Calls tab (HighLevel)** — Slices A–E, explicitly paused by the user.
  - Slice A (capture call-specific fields from the HighLevel payload) is
    blocked on pulling one real `[HL-DEBUG] full raw Call/Voicemail message:`
    log line from Vercel Runtime Logs, to confirm HighLevel's actual field
    shapes before building the schema/normalizer against them.
  - Slices B (tracking-number attribution), C (recording/voicemail playback
    proxy route), D (contact-level utm/campaign attribution), E (rich Calls
    UI + filters) all sit behind Slice A.

## Known rough edges (worth fixing, nobody's blocked)

- **`npm run build` runs out of memory on this machine** — needs
  `NODE_OPTIONS="--max-old-space-size=6144"`, which is NOT baked into
  `package.json`'s build script or `vercel.json`. Every build has to type it by
  hand, and if Vercel's container ever hits the same ceiling a deploy could
  fail even though it built fine locally. Worth fixing for real.
- **The dev server caches the Prisma client at import time.** After any schema
  change + `prisma generate`, the running `next dev` still throws
  `PrismaClientValidationError: Unknown field 'X' for select statement`. Fix is
  restarting the dev server, not changing code. This has bitten the project
  repeatedly and has fired to Sentry as a false alarm more than once — it's now
  encoded as a known false alarm in the Sentry auto-fix routine.

## Parked ideas (not started, no commitment)

- **Viktor AI Slack VA** (viktor.com) — Ben's idea, a conversational Slack
  bot that pulls data from this app and reports back in-channel. Blocked on
  Ben answering whether its service account may see HighLevel
  conversation/call content (a materially bigger exposure than task/notes
  data). A task/notes-only version could be built without that answer, but
  hasn't been started.
- From the 2026-07-13 team meeting, still just ideas: Fathom auto-attach to
  meeting notes, onboarding task templates.

## Standing user instructions (apply every session, not just once)

- Always prototype UI in a throwaway HTML mockup and get it approved before
  writing real UI code — even for "just build this" requests.
- Explain technical things in plain English with non-technical analogies —
  standing rule, not case-by-case.
- Check in with the user before starting a large multi-file effort, so they
  can `/compact` first if they want to.
- **Never log in on the user's behalf** or enter a password into any field,
  even when asked directly. Verify no-login surfaces with a throwaway
  `/review-*` route instead (`src/proxy.ts`'s matcher excludes any path
  starting with `review`) — and always delete it before committing.
- **Local development points at the dev Neon branch, production at the real
  one** (the July Phase B split). A local Prisma query reads DEV data, not what
  the team actually uses — don't work around that separation, and don't report
  local query results as if they described production.
- **Before an auto-compact happens, refresh this file** with whatever is
  currently set aside/unfinished, and make sure paused/parked work survives
  the compaction rather than silently dropping out of context.

## Recently shipped (context for "what's next" conversations)

- **Admin "Create channel" button** for clients with no Slack channel —
  commit `b015eac`, pushed. New `POST /api/admin/notifications/client-channel`
  (`requireAdmin`, 422 if `SLACK_BOT_TOKEN` unset, 404 on a deleted client) and
  a per-row button in the Connections tab that only renders while the channel
  is missing. Closes the long-standing gap where `ensureClientChannel` only
  ever fired from `createClientAction` — `updateClientAction` does not call it,
  so re-saving a client never backfilled one. See "Waiting on the user" above.

- **Self-service notification settings + admin Slack connections dashboard** —
  commit `5f68af2`, pushed. Closes what this file previously listed as the big
  "confirmed gap." `TeamMember.notificationPreferences Json?` plus a new
  category axis (`src/lib/notification-preferences.ts`) mapping all 21
  `NotificationType` values into 6 user-mutable buckets (tasks, projects,
  directMail, assets, orders, briefing) — the severity tier controls *how*
  delivery happens, the category controls *whether* the person wants it at all.
  `notify()` now loads the recipient before creating the row and early-returns
  on a muted category; the Ambient digest cron skips anyone with Slack or the
  digest switched off, leaving their items undigested so re-enabling catches up.
  Reachable from a new slider icon in the topbar → `/settings/notifications`.

- **Rich text editor: inline link popover** replacing `window.prompt()` —
  commit `3972fe6`, pushed. Found via a real Sentry report: some embedded
  browser environments block `prompt()` outright, so the "Add link" button did
  nothing. New `src/components/ui/link-popover.tsx` matches the existing
  color-picker popover pattern.

- **Sentry auto-fix routine** — a scheduled Claude task (Routines tab, id
  `sentry-error-check`, config at
  `C:\Users\EG PRO SHOP\.claude\scheduled-tasks\sentry-error-check\SKILL.md`,
  outside the repo so it won't show in git) runs every 4 hours at :17. Searches
  Gmail for Sentry alerts, triages them, fixes confirmed real bugs on an
  `autofix/<slug>` branch (tsc + build must pass), returns to `master`, and
  reports. Hard-blocked from `git push`, committing to master, deploying,
  migrations, and login — the user ships a fix by saying
  "publish autofix/<slug>". The user checks the Routines tab manually;
  notifications only reach an open session.
