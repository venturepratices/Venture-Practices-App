# Key register

One row per key, token or webhook secret the app uses or hands out. **Never write a key here**, only facts about it. Rules: `.superpowers/sdd/2026-11-07-sales-plan-3b-security/key-safety-procedures-DRAFT.md` (DJ approved 2026-11-07).

| Name | Service | What it can do | Where it is stored | Owner | Created | Expires | How to cancel it |
|---|---|---|---|---|---|---|---|
| `WEBHOOK_INBOUND_SECRET` (and `WEBHOOK_INBOUND_SECRET_NEXT` while it is being changed) | HighLevel to the app | Adds new leads to the Sales Leads Inbox. Nothing else: it cannot read anything and cannot change an owner, stage or status | Vercel, Production only, Sensitive; and in the header of the HighLevel workflow step | DJ | Not made yet (fill in the day DJ makes it) | 90 days at most. Calendar reminder 7 days before | Delete the variable in Vercel and redeploy (the link is off at once), then delete the workflow step in HighLevel |

## HighLevel lead link (Sales Command Center, `/api/webhooks/leads/intake`)

- Guide with every step: `docs/sales-highlevel-lead-link.md`.
- Off until `WEBHOOK_INBOUND_SECRET` (or `WEBHOOK_INBOUND_SECRET_NEXT`) is set in Vercel. With neither set, every call gets 503.
- The secret travels in the `x-shared-secret` header, never in the address. Only a workflow that cannot set a header may send it as `customData.secret` in the body.
- A wrong header secret is refused before the body is read. Refused calls write nothing and log nothing.
- It only makes leads. It saves no copy of the request, sends no message anywhere, and never edits an existing person, practice, owner, stage or status.
- Limits: 60 leads in 10 minutes and 300 in a day. Past either, calls get 429 and every admin gets an in-app note (at most one an hour per limit).
- Changing the secret: use the second secret so there is no gap (steps in the guide).
- Cancel: delete the variable, redeploy.

## Bot keys (Revenue Team, Bots screen)

- Made only on the Bots screen (`/sales/settings/bots`), by an admin who types their password again.
- Paused for everyone until `SALES_BOTS_ENABLED` is set to `true` in Vercel (Production only). Unset or anything else: every bot key is refused and none can be made.
- While paused, a bot call gets 403 "Bot keys are paused." on purpose (not the 401 invalid-key answer). It says only that keys are paused, never whether a key is real.
- A turned-off or expired key does a little more work than an unknown one (one lookup, a capped log row, one alert a day). Unknown keys write nothing.
- The app stores only a fingerprint (hash) and the last 4 characters. The full key is shown once.
- Lives 90 days at most. Admins get an in-app note 7 days before.
- Cancel: the Off switch on the Bots screen (works at once), or Delete.

## Hosting firewall rule to add (Vercel, Firewall, Rate Limit)

- `/api/sales/*` with an `Authorization` header: about 60 a minute per IP.
- `/api/webhooks/*`: about 60 a minute per IP.
- The app also slows down an address after 20 bad keys in 10 minutes, but only within one server copy, so the firewall rule is the real wall.

## Log

One line per event: date, what happened, what was done.
