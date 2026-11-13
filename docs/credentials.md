# Key register

One row per key, token or webhook secret the app uses or hands out. **Never write a key here**, only facts about it. Rules: `.superpowers/sdd/2026-11-07-sales-plan-3b-security/key-safety-procedures-DRAFT.md` (DJ approved 2026-11-07).

| Name | Service | What it can do | Where it is stored | Owner | Created | Expires | How to cancel it |
|---|---|---|---|---|---|---|---|
| (none yet) | | | | | | | |

## Bot keys (Sales Command Center, Bots screen)

- Made only on the Bots screen (`/sales/settings/bots`), by an admin who types their password again.
- Paused for everyone until `SALES_BOTS_ENABLED` is set to `true` in Vercel (Production only). Unset or anything else: every bot key is refused and none can be made.
- The app stores only a fingerprint (hash) and the last 4 characters. The full key is shown once.
- Lives 90 days at most. Admins get an in-app note 7 days before.
- Cancel: the Off switch on the Bots screen (works at once), or Delete.

## Hosting firewall rule to add (Vercel, Firewall, Rate Limit)

- `/api/sales/*` with an `Authorization` header: about 60 a minute per IP.
- The app also slows down an address after 20 bad keys in 10 minutes, but only within one server copy, so the firewall rule is the real wall.

## Log

One line per event: date, what happened, what was done.
