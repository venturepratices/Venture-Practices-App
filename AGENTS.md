<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Docs map

[`README.md`](./README.md) — setup, running, and deploying this app. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the load-bearing patterns (permissions, soft-delete, notifications, multi-tenancy) worth understanding before making non-trivial changes. This file is the running log of *why* things were built the way they were, feature by feature, plus what's still planned — read it when you need the history behind a decision.

# Notifications

`src/lib/notify.ts`'s `notify()` writes an in-app `Notification` row and — unless `slack: false` — DMs the recipient personally on Slack via `src/lib/slack.ts`, which needs `SLACK_BOT_TOKEN` (a Slack App's Bot Token, scopes `chat:write` + `users:read.email` + `groups:write` + `chat:write.public`). Each `TeamMember`'s Slack account is resolved by matching their email, or from a manually-set `TeamMember.slackUserId` (editable in the Team admin UI) which always wins and also caches the auto-resolved result. Unmapped recipients or an unset `SLACK_BOT_TOKEN` mean in-app-only, no error.

Separately, `notifyChannel()` (also in `notify.ts`) posts ONE team-facing summary of a headline event (workflow stage-started/completed, task overdue, asset approved/changes-requested) to a shared Slack channel — that event's `Client.slackChannelId` (a private channel auto-created on first use by `ensureClientChannel`, or manually set on the client's Info page) if there's a client involved, else the general `SLACK_INTERNAL_CHANNEL_ID` channel. Channel membership mirrors the app's own per-client access rules (`src/lib/permissions.ts`) via `syncTeamMemberClientChannels`/`removeTeamMemberFromAllClientChannels`, called from every team-member create/update/delete action — someone who can't see a client in the app isn't in its Slack channel either. Always call `notifyChannel()` ONCE per event, separately from the per-recipient `notify()` loop — never inside it, or the channel gets one post per recipient instead of one per event.

`NEXT_PUBLIC_APP_URL` is the base for the "Open in app" links inside Slack messages (`src/lib/notification-links.ts`). See `.env.example` for all of this. Every call site should pass a `linkPath` when it has enough context to build one.

A daily morning digest (`src/app/api/cron/daily-briefing/route.ts`, weekdays only) posts one headline summary per client to that client's Slack channel (due/overdue/completed-since-yesterday/needs-a-decision) and DMs each team member their own cross-client slice, both linking to a real report page (`src/app/(app)/clients/[clientId]/briefing`, `src/app/(app)/my-briefing`) rather than trying to render a page inside Slack — Slack's mrkdwn/Block Kit can't do that. `src/lib/daily-briefing.ts` holds the shared aggregation queries both the cron and the report pages read from. Anyone/anything with nothing to report that day is skipped silently — no "all clear" noise.
