<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Notifications

`src/lib/notify.ts`'s `notify()` writes an in-app `Notification` row and best-effort posts to Slack. Slack requires `SLACK_WEBHOOK_URL` (Slack workspace → Apps → Incoming Webhooks) — unset means in-app-only, no error. `NEXT_PUBLIC_APP_URL` is the base for the "Open in app" links inside Slack messages (`src/lib/notification-links.ts`). See `.env.example` for both. Every call site should pass a `linkPath` when it has enough context to build one.
