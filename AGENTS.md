<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Notifications

`src/lib/notify.ts`'s `notify()` writes an in-app `Notification` row and — unless `slack: false` — DMs the recipient personally on Slack (never a shared channel) via `src/lib/slack.ts`, which needs `SLACK_BOT_TOKEN` (a Slack App's Bot Token, scopes `chat:write` + `users:read.email`). Each `TeamMember`'s Slack account is resolved by matching their email, or from a manually-set `TeamMember.slackUserId` (editable in the Team admin UI) which always wins and also caches the auto-resolved result. Unmapped recipients or an unset `SLACK_BOT_TOKEN` mean in-app-only, no error. `NEXT_PUBLIC_APP_URL` is the base for the "Open in app" links inside Slack messages (`src/lib/notification-links.ts`). See `.env.example` for all of this. Every call site should pass a `linkPath` when it has enough context to build one.
