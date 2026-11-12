# Pipedrive Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy Ben's and Robert's Pipedrive data (people, organizations, deals, leads, activities, notes, files) into Sales Command Center from an admin-only screen, safe to re-run, so they log in and find everything where they expect it.

**Architecture:** A read-only Pipedrive client feeds pure mapper functions; an import engine upserts rows keyed on `pipedriveId`, one time-boxed chunk per request, with its progress saved in a `SalesImportRun` row so it can resume. An admin page drives it (practice run, real run, final run) and shows a plain-words report. The token lives only in the `PIPEDRIVE_API_TOKEN` environment variable.

**Tech Stack:** Next.js 16 App Router, Prisma 7 on Neon, zod 4, vitest (Prisma mocked), Vercel Blob (private store), Tailwind + shadcn.

**Spec:** `Sales Module Handoff/sales-module-spec.md` section 10 (Migration from Pipedrive) and section 16 (Pipedrive Familiarity). Where this plan differs, this plan wins and says why:
- The spec lists Pipedrive API v1 paths. Pipedrive has moved activities, deals, persons, organizations, pipelines and stages to API v2 and put the v1 versions out of support (changelog notice, 2026-07-29). This plan uses v2 for those and v1 only where no v2 exists (notes, files, leads, dealFields, users, activityTypes). The implementer must read the live docs at developers.pipedrive.com for each endpoint before coding and build test fixtures from the documented response shapes.
- The spec runs a one-time script. DJ is not a developer and production's database address must not be pasted anywhere, so the import runs inside the app, admin only.

## Global Constraints

- Money is integer cents (`Math.round(value * 100)`), capped at `MAX_DEAL_CENTS` (1_000_000_000). Never floats.
- Read-only toward Pipedrive: the client exposes only GET. No write call exists anywhere in the code.
- The token comes only from `process.env.PIPEDRIVE_API_TOKEN`. It is never stored in the database, never logged, never put in an error message, never returned to the browser. The page may say only whether it is set, and its last 4 characters.
- The import writes rows with Prisma directly. It never calls the deal, lead or activity server actions, so no rule fires (no-show, territory hold), no lead assignment runs, and no Slack message or notification is sent.
- Audit: imported deals and leads get one history row each through `recordSalesAuditMany` with `{ system: "import" }`. Other tables are covered by the run summary.
- Additive migrations only. No DROP, no data rewrite, no change to existing columns.
- Admin only (`requireSalesUser()` then `actor.isAdmin`). Non-admins get a 404 on the page and 403 on the routes. Robert must still see no Sales anywhere: `npm run check:sales-secrecy` must pass.
- Idempotent: matching is by `pipedriveId`. A re-run writes a row only when a mapped field differs. A run marked final locks all later live runs.
- Pipedrive stays the boss until cutover: a later run replaces app edits to imported rows. The page says so in plain words.
- Copy: plain words, no em dashes, no jargon. Every screen works at 375px wide, in light and dark.
- Owners: a Pipedrive user maps to a team member by email, or by the saved override in `SalesImportUserMap`. No match falls back to the admin who started the run and adds an issue.
- Not copied (listed in the report as "not copied"): emails, call logs, products on deals, labels, Smart Docs, Projects, Campaigns. Emails come with the Gmail project.
- Verification commands: `npx vitest run <file>`, `npx tsc --noEmit`, `npm run lint`, `npm run check:sales-secrecy`, `npm run build:ci`.

## Review Focus

1. A deal with value null, 0, negative, non-USD currency, or above `MAX_DEAL_CENTS`: imports with a safe value and an issue, never crashes the run.
2. A person with no name, several emails or phones, or an organization with no address: imports with the primary values, never blank-named.
3. An activity with no due date, a date but no time, a type outside the six (Call, Meeting, Task, Deadline, Email, Lunch), or done without a done time.
4. A deal or activity owned by a Pipedrive user with no matching team member, or no matching Sales member: falls back to the starter and shows in the report; a deactivated Pipedrive user who still matches a Sales member by email maps to that member (their history stays theirs).
5. A run stopped mid-step and resumed, a double click on Start, and two admins starting at once: never two RUNNING runs, never duplicate rows.
6. Notes with HTML, scripts or more than `NOTE_MAX_CHARS` characters: stored as safe plain text, truncated with an issue.

## File Structure

- `prisma/schema.prisma` + new migration: `pipedriveId` on six models, `SalesImportRun`, `SalesImportUserMap`.
- `src/lib/sales/pipedrive/client.ts`: the read-only API client.
- `src/lib/sales/pipedrive/map.ts`: pure mappers, no Prisma, no network.
- `src/lib/sales/pipedrive/import.ts`: the engine (phases, resume, lock).
- `src/lib/sales/pipedrive/files.ts`: copy files into the private Blob store.
- `src/lib/sales/pipedrive/verify.ts`: counts and spot-check report.
- `src/app/api/sales/import/*`: admin routes (start, continue, status, users).
- `src/app/(app)/sales/settings/import/page.tsx` + `src/components/sales/import-view.tsx`: the admin screen.
- `docs/sales-pipedrive-cutover.md`: plain-words cutover checklist.
- Tests mirror these paths under `tests/lib/sales/pipedrive/` and `tests/api/sales/` (follow the folder the existing Sales tests use).

---

### Task 1: Schema, `pipedriveId` columns and the run table

**Files:**
- Modify: `prisma/schema.prisma` (Sales section, near line 1900-2100)
- Create: `prisma/migrations/20261112000001_sales_pipedrive_import/migration.sql`
- Test: `tests/lib/sales/pipedrive/schema.test.ts`

**Interfaces:**
- Produces: `pipedriveId Int? @unique` on `SalesOrganization`, `SalesPerson`, `SalesActivity`, `SalesNote`, `SalesFile`, and `pipedriveId String? @unique` on `SalesLead` (Pipedrive lead ids are UUID strings; SalesDeal already has its Int one). Enums `SalesImportMode { DRY_RUN LIVE }` and `SalesImportStatus { RUNNING DONE FAILED }`. Model `SalesImportRun { id, mode, isFinal Boolean @default(false), status, phase String, cursor Json?, counts Json, issues Json, startedById String, startedAt, updatedAt, finishedAt? }` (plain string for `startedById`, no relation). Model `SalesImportUserMap { pipedriveUserId Int @id, memberId String, createdAt, updatedAt }` (plain string `memberId`).

- [ ] **Step 1: Write the failing test** `schema.test.ts` reads `prisma/schema.prisma` and the new migration file as text and asserts: each of the six models declares `pipedriveId Int? @unique`; both new models exist; the migration contains no `DROP` and no `UPDATE`/`DELETE`; the migration contains a partial unique index that allows only one `RUNNING` row (`WHERE "status" = 'RUNNING'`).
- [ ] **Step 2: Run it, expect FAIL** (`npx vitest run tests/lib/sales/pipedrive/schema.test.ts`).
- [ ] **Step 3: Edit the schema, then write the migration SQL by hand** in the style of the existing Sales migrations (add columns, unique indexes, enums, the two tables, and the raw partial unique index `SalesImportRun_one_running` on `((1)) WHERE "status" = 'RUNNING'`). Run `npx prisma validate` and `npx prisma generate`.
- [ ] **Step 4: Run the test, expect PASS.** Also run `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(sales): schema for the Pipedrive import`.

---

### Task 2: Read-only Pipedrive client

**Files:**
- Create: `src/lib/sales/pipedrive/client.ts`
- Test: `tests/lib/sales/pipedrive/client.test.ts`

**Interfaces:**
- Produces:
  - `class PipedriveError extends Error { status: number }`. The message never contains the token or a URL query.
  - `type PipedriveClient = { pages<T>(path: string, opts?: { style?: "cursor" | "offset"; params?: Record<string, string | number>; limit?: number }): AsyncGenerator<T[], void, void>; download(path: string): Promise<{ bytes: Uint8Array; contentType: string }> }`
  - `createPipedriveClient(opts: { token: string; baseUrl?: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }): PipedriveClient`
  - `pipedriveTokenInfo(env: NodeJS.ProcessEnv): { set: boolean; last4: string | null }`

- [ ] **Step 1: Write failing tests** with a fake `fetchImpl`: (a) cursor style follows `additional_data.next_cursor` until null and yields each page; (b) offset style follows `additional_data.pagination.more_items_in_collection` and `next_start`; (c) a 429 with `Retry-After: 2` calls `sleep(2000)` and retries, then succeeds; three 5xx in a row throws `PipedriveError`; (d) every request uses method GET (assert on the fake); (e) a thrown error's message does not contain the token string or `api_token`; (f) `pipedriveTokenInfo({ PIPEDRIVE_API_TOKEN: "abcd1234" })` returns `{ set: true, last4: "1234" }` and an unset or blank value returns `{ set: false, last4: null }`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the client. Send the token in the `x-api-token` header, never in the URL. Default `baseUrl` is `https://api.pipedrive.com`. Retry at most 4 times with exponential backoff, honoring `Retry-After`. Verify header and pagination shapes against the live docs first.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(sales): read-only Pipedrive client`.

---

### Task 3: Pure mappers

**Files:**
- Create: `src/lib/sales/pipedrive/map.ts`
- Test: `tests/lib/sales/pipedrive/map.test.ts`

**Interfaces:**
- Consumes: `emailKey`, `phoneKey`, `nameKey` from `src/lib/sales/contact-keys.ts`; `MAX_DEAL_CENTS`, `NOTE_MAX_CHARS`, `TITLE_MAX`, `SUBJECT_MAX`, `ACTIVITY_TYPES` from `src/lib/sales/constants.ts`.
- Produces (all pure, all return `{ value, issues: string[] }` or a plain object plus `issues`):
  - `centsFromValue(value: number | null | undefined, currency: string | null | undefined): { cents: number; issues: string[] }`: null, NaN or negative gives 0 plus an issue; non-USD keeps the number, adds an issue naming the currency; above the cap clamps to the cap plus an issue.
  - `mapActivityType(typeKey: string | null | undefined): { type: SalesActivityType; issues: string[] }`: the six known keys map directly (case-insensitive); anything else becomes `TASK` plus an issue.
  - `mapActivityTiming(a: { due_date?: string | null; due_time?: string | null; marked_as_done_time?: string | null; done?: boolean }, fallback: Date): { dueAt: Date; hasTime: boolean; doneAt: Date | null; issues: string[] }`: no due date uses `fallback` plus an issue; a date with no time sets `hasTime: false`; done with no done time uses `fallback`.
  - `htmlToPlainText(html: string | null | undefined): { text: string; issues: string[] }`: drops all tags and scripts, keeps line breaks for `<br>`, `<p>`, `<li>`, decodes common entities, truncates to `NOTE_MAX_CHARS` plus an issue.
  - `primaryOf(list: { value: string; primary?: boolean }[] | null | undefined): string | null`.
  - `mapPerson`, `mapOrganization`, `mapDeal`, `mapLead`, `mapActivity`, `mapNote`: each takes the documented Pipedrive record and returns the app's create fields without ids it cannot know yet (owner, stage and link ids are resolved by the engine), plus `issues`. A person with no name becomes the email, else the phone, else "Unnamed contact" plus an issue. Titles and subjects are trimmed to their max lengths.
  - Won/lost: `mapDeal` returns `status` from Pipedrive's status (`open`, `won`, `lost`, `deleted`), `wonAt`, `lostAt`, `lostReason`, `stageEnteredAt` (Pipedrive `stage_change_time`, else `add_time`). A deleted deal returns `{ skip: true }`.

- [ ] **Step 1: Write failing tests**, one per rule above, with the documented field names in the fixtures: a 1234.5 USD value gives 123450; a EUR value flags; a 5,000,000,000 value clamps; a done activity without a done time; a date-only activity; an "Email" activity key; an unknown "Site visit" key; an HTML note with `<script>` and 60,000 characters; a person with two emails where the second is primary; a nameless person.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement the mappers** exactly to the signatures. No Prisma, no `Date.now()` (the fallback date is a parameter).
- [ ] **Step 4: Run, expect PASS.** Run `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(sales): Pipedrive record mappers`.

---

### Task 4: Import engine

**Files:**
- Create: `src/lib/sales/pipedrive/import.ts`
- Test: `tests/lib/sales/pipedrive/import.test.ts`

**Interfaces:**
- Consumes: `PipedriveClient` (Task 2), mappers (Task 3), `prisma`, `recordSalesAuditMany`, `personKeys`, `organizationKeys`.
- Produces:
  - `type ImportPhase = "users" | "structure" | "organizations" | "persons" | "deals" | "leads" | "activities" | "notes" | "files" | "done"` (this order).
  - `type ImportIssue = { phase: ImportPhase; pipedriveId: number | string | null; message: string }` (lead ids, and the `lead_id` on activities and notes, are UUID strings). Stored issues are grouped by phase and message as `{ phase, message, count, sampleIds: (number | string)[] }` (first 3 ids), capped at 200 groups, so one noisy kind (for example extra emails on a person) cannot crowd out the rest; `counts.issuesDropped` counts groups past the cap.
  - `startImportRun(args: { mode: "DRY_RUN" | "LIVE"; isFinal: boolean; startedById: string }): Promise<{ ok: true; runId: string } | { ok: false; message: string }>`: refuses when a RUNNING run exists that was updated in the last 5 minutes (the partial unique index is the guard; catch its error); a RUNNING run not updated for more than 5 minutes (a request that died) is marked FAILED first, so it can never block new runs forever (the page's "Keep going" button resumes a RUNNING run through `continueImportRun` instead); refuses LIVE or final when an earlier final run is DONE ("The import is locked. Pipedrive was switched off."), refuses `isFinal` with `DRY_RUN`.
  - `continueImportRun(args: { runId: string; client: PipedriveClient; deadline: Date; now: () => Date }): Promise<{ done: boolean; paused: boolean; phase: ImportPhase; counts: Record<string, number> }>`: works until `deadline`, saves `phase` and `cursor` after every page; a `PipedriveError` with status 429 (Pipedrive's rate limit, which can outlast the client's retries) saves the cursor and returns `done: false, paused: true` instead of throwing, any other `PipedriveError` marks the run FAILED with a plain-words issue; lists files with `limit: 100` (that endpoint's cap, others allow 500); returns `done: true` when the phase reaches `done` (then sets status DONE, `finishedAt`; sets nothing else).
  - `setUserMapping(args: { pipedriveUserId: number; memberId: string }): Promise<void>`; `loadUserMappings(): Promise<{ pipedriveUserId: number; name: string; email: string | null; memberId: string | null; memberName: string | null; auto: boolean }[]>` for the page.

Behavior to build (each is a test below):
- DRY_RUN reads everything and computes counts and issues but makes no write to any Sales table (only the run row is updated).
- `structure` matches Pipedrive pipelines to app pipelines and stages to app stages by `nameKey` of the name. A Pipedrive stage with no app match is created at the end of its pipeline (before won/lost stages) with probability from Pipedrive and an issue; a Pipedrive pipeline with no match is created as `kind: "SALES"` with an issue. Pipedrive deal fields match app custom fields by `nameKey` of the label; an unmatched deal field becomes a new `SalesCustomField` (`entity: DEAL`, TEXT unless Pipedrive says number/date/single option) with an issue. Values are saved as `SalesCustomFieldValue` strings. The mappers return option ids as text ("123", "123, 456"), so for single and multiple option fields this phase reads the field's options from Pipedrive and saves the option label (labels joined with ", "), and an unknown id is dropped with an issue.
- `organizations`, `persons`, `deals`, `leads`, `activities`, `notes` upsert by `pipedriveId`. Links resolve through the `pipedriveId` of the parent (organization, then person, then deal). A missing parent drops only the link and adds an issue; the row still imports. Contact keys are filled with `personKeys` / `organizationKeys`. `createdAt` is the Pipedrive `add_time`.
- A re-run updates a row only when a mapped field differs, and counts `unchanged`.
- An activity attached only to an organization attaches to that organization's first person if there is one, else it is skipped with an issue.
- The `files` phase is a no-op in this task (Task 7 fills it in); the phase still advances.
- Resuming in the middle of a phase needs the page position, which `client.pages` does not expose. Extend `src/lib/sales/pipedrive/client.ts` additively (tests in `client.test.ts`, `pages` unchanged and rebuilt on top): `type PageToken = { cursor: string } | { start: number }` and `pageBatches<T>(path, opts?: PagesOptions & { resumeAt?: PageToken }): AsyncGenerator<{ items: T[]; resumeAt: PageToken | null }>` (`resumeAt` is where the next page starts, null after the last page). The engine saves `resumeAt` in `SalesImportRun.cursor` after each page's rows are written, so a resume never re-reads finished pages and a big phase cannot livelock.
- DRY_RUN reports mapping issues, owner matching and stage/pipeline/custom-field matching (a missing app stage is reported as "would be created"), but does not check missing-parent links (nothing exists yet to link to). Counts use `${entity}.${seen|created|updated|unchanged|skipped}` keys.
- The report also carries `counts.activitiesAtMidnightUtc`: activities whose Pipedrive `due_time` is exactly `00:00` or `00:00:00`. A large number would mean date-only activities are being read as midnight (the mapper reads `00:00` as a real time; Pipedrive's docs do not settle it), and then `mapActivityTiming` gets changed in a follow-up.
- Keep decision logic pure and exported for tests (owner resolution, field diff, issue grouping, link resolution); the database writers stay thin.
- Never calls `rules.ts`, `no-show.ts`, `lead-assignment.ts`, notifications or Slack.

- [ ] **Step 1: Write failing tests** with `prisma` mocked and a fake client: dry run writes nothing; live run creates org, person, deal in dependency order with the right foreign keys; second run creates nothing and reports `unchanged`; a won deal keeps its stage and gets `status: "WON"`, `wonAt`; an unmapped owner falls back to the starter with an issue; a missing app stage is created with an issue; a second `startImportRun` while RUNNING returns `ok: false`; LIVE after a final DONE run returns `ok: false`; `continueImportRun` called with a deadline already passed saves the cursor and returns `done: false`, and the next call resumes at that cursor without repeating finished pages; an activity done with no done time imports; an activity on an organization with no people is skipped with an issue.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the engine to the signatures. One database transaction per page of rows (batches of 100). Audit rows for deals and leads in the same transaction. Keep each phase a small function so the file stays readable.
- [ ] **Step 4: Run, expect PASS**, then `npx tsc --noEmit` and `npm run lint`.
- [ ] **Step 5: Commit** `feat(sales): Pipedrive import engine`.

---

### Task 5: Check report (counts and spot checks)

**Files:**
- Create: `src/lib/sales/pipedrive/verify.ts`
- Test: `tests/lib/sales/pipedrive/verify.test.ts`

**Interfaces:**
- Consumes: `PipedriveClient`, `prisma`.
- Produces: `type CheckRow = { label: string; pipedrive: number; app: number; ok: boolean }`; `type SpotCheck = { title: string; valueCents: number; stage: string; owner: string; status: string; pipedriveId: number }`; `buildCheckReport(client: PipedriveClient, pickIndexes: (n: number) => number[]): Promise<{ rows: CheckRow[]; spot: SpotCheck[] }>`.
- Rows cover people, organizations, deals, leads, activities, notes. `ok` is true when `app` is within 1% of `pipedrive` (spec section 10.2), or equal when the count is under 100. Pipedrive counts exclude deleted deals. Spot check picks 5 imported deals through `pickIndexes` (injected so tests are deterministic).

- [ ] **Step 1: Write failing tests**: equal counts are ok; 1% under is ok; 3% under is not ok; under-100 counts must match exactly; spot check returns exactly 5 deals when 5 or more exist, else all of them.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(sales): Pipedrive import check report`.

---

### Task 6: Admin routes and screen

**Files:**
- Create: `src/app/api/sales/import/start/route.ts`, `continue/route.ts`, `status/route.ts`, `users/route.ts`
- Create: `src/app/(app)/sales/settings/import/page.tsx`, `src/components/sales/import-view.tsx`
- Modify: `src/components/sales/settings-view.tsx` (a "Copy from Pipedrive" link card, admin only)
- Create: `scratch/pipedrive-import-mockup.html` (a static mockup, written first)
- Test: `tests/api/sales/import-routes.test.ts`, `tests/lib/sales/pipedrive/import-view-render.test.ts`

**Interfaces:**
- Consumes: `startImportRun`, `continueImportRun`, `setUserMapping`, `loadUserMappings` (Task 4), `buildCheckReport` (Task 5), `createPipedriveClient`, `pipedriveTokenInfo` (Task 2), `requireSalesUser`, `requireSalesPage`.
- Produces routes (all admin only; follow an existing `src/app/api/sales/*` route for error handling, zod validation and rate limiting; export `maxDuration = 60`):
  - `POST /api/sales/import/start` body `{ mode: "DRY_RUN" | "LIVE" | "FINAL" }` returns `{ runId }`. `FINAL` is LIVE with `isFinal: true` and the route refuses it unless the body also carries `confirm: "LOCK"`.
  - `POST /api/sales/import/continue` body `{ runId }` runs one chunk with a deadline 45 seconds ahead and returns `{ done, paused, phase, counts }`. When `paused` is true the page says "Pipedrive asked us to slow down. Continuing in a minute." and calls `continue` again after 60 seconds.
  - `POST /api/sales/import/check` (admin, runs only against the latest LIVE run when it is DONE, never a practice run, because a practice run skips differently when it cannot check links; at most once a minute) runs `buildCheckReport(client, randomIndexes, skippedFromCounts)` where `skippedFromCounts` is the run's raw `counts["<entity>.skipped"]` values (subtract nothing), and saves `{ report, at }` under a `report` key in that run's `cursor` JSON (unused once DONE). The check walks every Pipedrive list, so it costs real API requests: it never runs on a status poll or page load.
  - `GET /api/sales/import/status` returns the latest run (mode, status, phase, counts, issues), the token info (`set`, `last4`), whether the import is locked, and the saved check report (with its time) if one exists. It makes no Pipedrive call.
  - `PUT /api/sales/import/users` body `{ pipedriveUserId: number, memberId: string }` saves an owner override (the member must pass `SALES_MEMBER_WHERE`).
- Page `/sales/settings/import` (admin only, others get `notFound()`), plain words, states:
  1. Token not set: three numbered steps to add `PIPEDRIVE_API_TOKEN` in Vercel (Settings, Environment Variables, Production, then redeploy) with one line saying why a token is needed and that it is never shown here.
  2. Ready: two buttons, "Practice run (saves nothing)" and "Copy for real". A short note: "Until you switch off Pipedrive, Pipedrive is the boss. Copying again replaces edits made here to copied records."
  3. Running: the current step in plain words ("Copying deals"), counts so far, and the page keeps calling `continue` until `done`. If the tab is closed, a "Keep going" button resumes the saved run.
  4. Done: the check table, the 5 spot-check deals ("compare these in Pipedrive"), the owner table with a team-member picker for any unmatched Pipedrive user, the issues list (grouped, first 50 shown with a count of the rest), and the "not copied" list.
  5. Final: a separate, clearly marked "Final copy and lock" button behind a typed confirmation word, with the sentence that this ends copying for good.
  6. Locked: read-only report and the lock date.
- [ ] **Step 1: Write the mockup** `scratch/pipedrive-import-mockup.html` showing the six states at 375px and desktop, light and dark. DJ's standing rule asks for a mockup before UI; he has pre-approved the build, so this is shown to him but is not a gate. Use the ui-ux-pro-max, impeccable and emil-design-eng skills for the screen.
- [ ] **Step 2: Write failing route tests**: a non-admin Sales user gets 403 on every route; a signed-out caller gets 401; `start` with `DRY_RUN` returns a run id; `start` while RUNNING returns 409 with the engine's message; the status response never contains the token or its first characters, only `last4`; `users` rejects a member who is not a Sales member.
- [ ] **Step 3: Write failing render tests** for the page states with fixed props (token not set shows the three steps and no buttons; locked shows no buttons; done with issues shows the count of the rest).
- [ ] **Step 4: Run, expect FAIL.**
- [ ] **Step 5: Implement the routes and the view.** The view is a client component that loops `continue`; it stores nothing in the browser. A route that returns `done: false` is the only reason the loop continues.
- [ ] **Step 6: Run the tests, `npx tsc --noEmit`, `npm run lint`, `npm run check:sales-secrecy`.** Then start the dev server, sign in as the admin test user, and click through every state at 375px and desktop, light and dark (click the buttons, do not only load the page).
- [ ] **Step 7: Commit** `feat(sales): admin screen for the Pipedrive copy`.

---

### Task 7: Copy files into the private Blob store

**Files:**
- Create: `src/lib/sales/pipedrive/files.ts`
- Modify: `src/lib/sales/pipedrive/import.ts` (the `files` phase calls it)
- Test: `tests/lib/sales/pipedrive/files.test.ts`

**Interfaces:**
- Consumes: `PipedriveClient.download`, `sniffFileType`, `cleanFileName`, `FILE_MAX_BYTES`, `FILE_PATH_PREFIX` from `src/lib/sales/files.ts` and `file-rules.ts`; `put` from `@vercel/blob` (private store, credentials read by the SDK only, as `files.ts` does).
- Produces: `copyPipedriveFile(args: { client: PipedriveClient; file: { id: number; name: string; dealId: number | null; leadId: string | null; size: number }; uploadedById: string; stageName: string | null }): Promise<{ ok: true } | { ok: false; reason: "too-big" | "unsupported-type" | "no-storage" | "download-failed" }>`.
- Pipedrive's docs are unclear about downloads (bytes or a redirect; files stored on an outside service may not download at all), so expect some `download-failed` results: each becomes an issue ("could not download, attach by hand") and never stops the run.
- A file over 4 MB or not PDF, Word, Excel, PNG or JPG is not copied: it is listed as an issue with the deal title and file name, so the team can attach it by hand. The name never goes into a log line or thrown error (match the existing `files.ts` rule). Daily upload quotas are not applied to imports. `finalConfirmedAt` is the Pipedrive add time. Re-runs skip files whose `pipedriveId` already exists.

- [ ] **Step 1: Write failing tests** with a fake client and a mocked `put`: a 1 MB PDF is stored and a row is written; a 5 MB file is not stored and returns `too-big`; a `.exe` returns `unsupported-type`; the same file twice stores once; no Blob credentials returns `no-storage` without a throw.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**, then wire the `files` phase in `import.ts` (DRY_RUN counts and checks types and sizes from the file list without downloading).
- [ ] **Step 4: Run, expect PASS**, then the full `npx vitest run`.
- [ ] **Step 5: Commit** `feat(sales): copy Pipedrive files into the private store`.

---

### Task 8: Cutover checklist and hand-off

**Files:**
- Create: `docs/sales-pipedrive-cutover.md`
- Modify: `SESSION_NOTES.md` (one short block: what shipped, what DJ does next)

- [ ] **Step 1: Write the checklist** in plain words, numbered, with who does each step: DJ adds `PIPEDRIVE_API_TOKEN` (a Pipedrive personal token, from Pipedrive's personal preferences, API tab) in Vercel Production and redeploys; practice run; read the report; fix owner mapping; real run; spot-check 5 deals side by side with Ben; 30-minute walkthrough with Ben and Robert; replace the HighLevel workflow "SMS Internal Alert - New Lead (from Pipedrive)" and the GHL to Pipedrive lead hand-off with the HighLevel webhook (Plan 3B, needs its own key-safety checklist and DJ's yes); final copy and lock; Pipedrive read-only for 2 weeks; cancel it; delete the token in Vercel and revoke it in Pipedrive. Add a "Rollback" section from spec 10.3. Add a "Good to know" section in plain words: re-running copies Pipedrive over the copied records, so edits made here to copied people, deals and leads are replaced; a deal or lead archived here comes back on the next copy; a person merged away here can get links again on the next copy; a value cleared in Pipedrive stays in the app; a converted lead is reset to Pipedrive's status.
- [ ] **Step 2: Rehearse on the dev database** (never production): with the local `.env` (dev Neon branch; confirm the host in `DATABASE_URL` is the dev one before doing anything), run `npx prisma migrate deploy`, then drive `startImportRun` and `continueImportRun` from a throwaway script under `scratch/` (not committed) with a stub Pipedrive client built from fixtures using ids from 9000000 up. Confirm what mocked tests cannot: a second start while RUNNING is refused through the real partial index, `updatedAt` passed to `updateMany` is kept, `createMany skipDuplicates` leaves no duplicates on a second run, a DRY_RUN leaves every Sales table empty, a resume continues after a forced stop. Then delete every row with those ids and the test runs.
- [ ] **Step 3: Run the full verification**: `npx vitest run`, `npx tsc --noEmit`, `npm run lint`, `npm run check:sales-secrecy`, `npm run build:ci`. All must exit 0.
- [ ] **Step 4: Commit** `docs(sales): Pipedrive cutover checklist`.
