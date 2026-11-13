# Bots Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin-only screen at `/sales/settings/bots` where DJ can make, change, rotate, turn off and delete bot keys (first one: Muse), backed by a plain-words permission catalogue and the small safety gaps closed.

**Architecture:** `src/lib/sales/bot-scopes.ts` stays import-free and becomes the permission catalogue (key, label, description, area, risk) plus labelled role presets; every route validates against it. The existing admin routes gain key expiry, a delete, per-person and total caps, and a read-only activity route. One server module loads the screen; a pure view-model module holds every decision the screen makes; the client view renders it.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7 (mocked in tests), zod 4, Tailwind + shadcn/Base UI, vitest.

**Spec:** the task brief from the controller (2026-11-13) plus `.superpowers/sdd/2026-11-07-sales-plan-3b-security/key-safety-procedures-DRAFT.md` sections (c) and (f) in the main checkout.

## Global Constraints

- Admin only: routes use `requireAdmin()`, writes keep `assertSameOrigin`; the page calls `requireSalesPage()` then `notFound()` for non-admins.
- The full key appears only in the create and rotate responses. Never in list, update, delete, activity or status responses, never in browser storage, the URL, a toast, or the page after the reveal closes.
- No scope for deleting, exporting or changing settings, ever.
- Limits: 60 calls a minute, 2,000 a day. Keys last 90 days at most. At most 2 bots per person, 10 in total.
- Plain words, no em or en dashes, ASCII source. 375px wide, light and dark, 44px touch targets, `aria-live` for status, `aria-busy` while saving. No new dependencies.
- No key is created, no database is touched, no migration is run, no dev server, no push.

## Review Focus

1. Create succeeds but the reveal fails to render: the screen must still say a key was made and offer Rotate, never silently lose it (Task 4, render test of the "reveal lost" message).
2. Clipboard write rejected (no permission, insecure context): select-all fallback, key still visible (Task 4, pure helper `copyOutcomeText`).
3. A bot whose stored scopes include a string no longer in the catalogue: summaries skip it, never crash (Task 3, `permissionSummary` test).
4. A bot that has never been used, or used yesterday only: "Never used" and "0 of 2,000 calls today" (Task 3, `callsTodayText` and the server module reading only today's UTC row).
5. Deleting a bot that another admin already deleted: plain 404 message, list refreshes (Task 2, DELETE 404 test).

---

### Task 1: Permission catalogue

**Files:** Modify `src/lib/sales/bot-scopes.ts`, `src/lib/sales/bot-admin.ts`. Test: `tests/lib/sales/bot-scopes.test.ts`.

**Interfaces (produces):**
- `BOT_SCOPE_AREAS: readonly { key: "sales"; label: string }[]`
- `BOT_SCOPE_CATALOGUE: Record<BotScope, { key; label; description; area; risk: "low" | "medium" | "higher" }>`
- `BOT_SCOPE_LIST` (catalogue in standard order), `isCatalogueScope(value: string): value is BotScope`
- `BOT_ROLE_OPTIONS: readonly { key: BotRole; label: "Read only" | "Helper" | "Rep"; description; scopes: BotScope[] }[]`
- `BOT_RISK_LABELS`, `BOT_KEY_MAX_DAYS = 90`, `BOT_CAPS = { perPerson: 2, total: 10 }`

- [ ] RED: tests that the catalogue has no key or label matching delete, export, settings; every preset scope is catalogued; every entry has label, description, area from `BOT_SCOPE_AREAS`, and a valid risk; roles are labelled "Read only", "Helper", "Rep".
- [ ] GREEN, then make `createBotSchema` and `updateBotSchema` strict objects that validate scopes with the catalogue.
- [ ] Commit `feat(sales): permission catalogue for bot keys`.

### Task 2: Route gaps and activity route

**Files:** additive migration `prisma/migrations/20261113000001_bot_token_expiry/migration.sql` (`expiresAt` column), `prisma/schema.prisma`, `src/lib/sales/bot-tokens.ts`, `src/lib/sales/bot-admin.ts`, `src/app/api/sales/bots/route.ts`, `src/app/api/sales/bots/[botId]/route.ts` (add DELETE), new `src/app/api/sales/bots/[botId]/activity/route.ts`, new `src/lib/sales/bots-screen.ts`. Tests: `tests/lib/sales/bot-routes.test.ts` (extend), `tests/api/sales/bots-activity-route.test.ts`, `tests/lib/sales/bot-tokens.test.ts` (extend).

**Interfaces (produces):**
- Create accepts `expiresInDays` (1 to 90, default 90); create and rotate set `expiresAt`. `authenticateBot` refuses an expired key (401 "This bot key has expired.").
- Create refuses a third bot for one person and an eleventh bot overall (400, plain words).
- `DELETE /api/sales/bots/[botId]`: admin, same origin, history row `deleted`, 404 when gone.
- `GET /api/sales/bots/[botId]/activity` -> `{ activity: BotActivityItem[] }` (last 20 history rows with `botTokenId`, newest first).
- `loadBotsScreen(now?)` -> `BotsScreenData` and `loadBotActivity(botId)` in `bots-screen.ts`.

- [ ] RED: 401/403 on every route, delete removes and logs, caps, expiry, activity shape, a distinctive fake secret never appears in list, update, delete, activity or screen data.
- [ ] GREEN. Commit `feat(sales): admin routes for bot activity`.

### Task 3: View model

**Files:** new `src/lib/sales/bots-view-model.ts` (imports only `bot-scopes.ts`). Test: `tests/lib/sales/bots-view-model.test.ts`.

**Interfaces (produces):** `roleLabel(scopes)`, `permissionSummary(scopes)`, `pipelinesText(keys, pipelines)`, `callsTodayText(n)`, `lastUsedText(iso, now)`, `expiryText(iso, now)`, `describeActivity(item)`, `draftFromBot`, `emptyDraft`, `draftBody(draft, mode)`, `draftError(draft)`, `copyOutcomeText(ok)`, `scopesByArea()`.

- [ ] RED, GREEN, commit together with Task 4.

### Task 4: Screen

**Files:** `src/app/(app)/sales/settings/bots/page.tsx`, `src/components/sales/bots-view.tsx`, `src/components/sales/bot-editor.tsx`, `src/components/sales/bot-key-reveal.tsx`, `src/lib/sales/api-client.ts` (bot requests), `src/components/sales/settings-view.tsx` (link card). Tests: `tests/lib/sales/bots-view-render.test.ts`, `tests/lib/sales/bots-page-gate.test.ts`, settings view test stays green.

- [ ] Mockup `scratch/bots-mockup.html` first (uncommitted).
- [ ] RED render tests: empty state, list row content, guardrails card text, connect panel with header format and no key, reveal box with copy and "I have saved it", reveal-lost message, non-admin gets 404.
- [ ] GREEN. Commit `feat(sales): bots screen`.

### Task 5: Verification

- [ ] `npx tsc --noEmit`, `npx eslint src tests`, guard tests, `npx vitest run`, `npm run build:ci`, `npm run check:sales-secrecy`. Report to `.superpowers/sdd/2026-11-13-bots-screen/report.md`.

---

## Addendum (2026-11-13): DJ's safety bar

DJ asked for the app to be "bullet proof". Every item of key-safety (f) for bot keys is now in scope, plus expiry warnings, auto-off and admin-only in-app alerts. New tasks, each RED then GREEN then commit:

- **Task 2a (schema):** one additive migration `20261113000001_bot_key_safety`: on `BotToken` add `expiresAt`, `allPipelines` (false = only the listed pipelines, so an empty list means none), `ownDealsOnly` (default true), `mustRotate`, `lastUsedIp`, `knownIps`, `offReason`, `offAt`, `expiryWarnedAt`; new `BotCallLog` table (key, when, method, path, scope, result status, IP, user agent); new `NotificationType` value `BOT_ALERT`.
- **Task 2b (key check):** `authenticateBot` refuses expired, off, must-rotate and person-without-Sales keys with the one "Invalid bot key." message; a `SALES_BOTS_ENABLED` switch (off unless set to "true") pauses every key; writes a `BotCallLog` row for every call by a known key (unknown keys write nothing and are slowed per IP in memory); records the IP, alerts admins in-app on first use from a new IP and on use of a switched-off key; turns the bot off and alerts after 5 per-minute limit hits or 20 refused permission checks in one UTC day.
- **Task 2c (admin routes):** password re-check on create, rotate and turn-on; in-app alert to every admin on those; per-person and total caps; expiry chosen per bot (1 to 90 days, default 90); `allPipelines` and `ownDealsOnly` fields; DELETE; activity route; turn-on refused while `mustRotate`.
- **Task 2d (Sales routes):** `requireSalesActor(request, scope | null)` in every Sales route (null = bots never allowed), with a guard test that fails if a Sales route calls `requireSalesUser` directly; bots limited to their pipelines, the person's own deals by default, and a daily cap of rows read.
- **Task 2e (lifecycle):** offboarding turns off a person's bots when their Sales access goes; restore marks keys `mustRotate`; a daily cron trims `BotCallLog` to 90 days and warns admins 7 days before a key expires.
- **Task 2f (general (f) items still missing):** safe security headers, Sentry scrubbing of keys and Authorization headers, `docs/credentials.md` register (no keys in it), a test that fails if a bot key shape appears in tracked files.
