# Sales Command, Plan 3A: Leads, Contacts, Files, Dashboard and Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the parts of Sales Command that need no new key: the Leads Inbox with the lead panel, new lead and convert; Contacts (people and organizations, edit, duplicates, merge) and editable deal contacts; final-version deal files; the Sales dashboard with a forecast; Insights; Sales settings (lead assignment with Ruling 24, per-stage rotting days); saved views with a Stage filter.

**Architecture:** Same shape as Plan 2. Server modules in `src/lib/sales/` (read models return plain serializable objects; write services run one Prisma transaction that also writes the locked history row). Thin route handlers in `src/app/api/sales/` (`requireSalesUser`, `readJson` + `z.strictObject`, `requestMeta`). Pages in `src/app/(app)/sales/` gate themselves with `requireSalesPage()`; client views call the routes through `src/lib/sales/api-client.ts` and refresh with `refreshAfterWrite`. Lead and contact panels open from `?lead=` / `?person=` / `?organization=` and mount in the Sales layout beside the deal panel. Backend tasks (2 to 15) come first; UI tasks (17 to 27) start only after DJ approves Mockup v2.

**Tech Stack:** Next.js 16.2.12 App Router, React 19.2.4, Prisma 7 on Neon Postgres, zod 4, vitest 4 (node env, Prisma mocked), Tailwind 4 with the app's shadcn/Base UI components, `sonner` 2, lucide-react 1.23, `@vercel/blob` 2.6 (private store only). No new dependencies.

**Spec:** `Sales Module Handoff/sales-module-spec.md` (sections 2, 3.3, 3.7, 3.10, 4.1, 4.2, 4.5, 4.9, 7.6, 7.7, 7.9, 8.1, 9.1 matching, 16.1, 18.1, 18.3, 18.4, 18.9). Rulings (BINDING; the "Amendments after the completeness critic" A1 to A11 override R1 to R30 where they differ): `.superpowers/sdd/2026-11-07-sales-plan-3a-leads-contacts/research/controller-rulings-3a.md`. Research: `spec-3a.md`, `backend-3a.md`, `ui-3a.md`, `mockup-3a.md`, `rulings-3a.md`, `critic-3a.md` in the same folder. Look, layout and wording: `scratch/sales-mockup/sales-command-mockup.html` (approved v1) and `scratch/sales-mockup/sales-command-mockup-v2.html` (Mockup v2, approved at Task 16). House style and earlier decisions: `docs/superpowers/plans/2026-11-05-sales-plan-2-board.md`.

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing any page, layout or route handler (AGENTS.md: this Next.js differs from training data; heed deprecations): `01-app/01-getting-started/15-route-handlers.md` (route `params` is a Promise; `request.formData()`), `01-app/03-api-reference/03-file-conventions/page.md` (`searchParams` is a Promise), `route.md`, `dynamic-routes.md`, `error.md` (`unstable_retry`), `loading.md` ("Status Codes": `notFound()` after streaming starts is a soft 404), `04-functions/use-search-params.md`, `02-components/link.md` (`onNavigate`), and `02-guides/authentication.md` "Layouts and auth checks" (every page gates itself).
- Migrations: hand-written SQL in `prisma/migrations/<name>/migration.sql`, names start `20261107000001_` (Plan 3A has exactly one: `20261107000001_sales_leads_contacts`, Task 2), applied to the DEV database with `npx prisma migrate deploy`, then `npx prisma generate`. NEVER `migrate dev`, `migrate reset` or `db push`. Plain `@@index` only (no expression, partial or trigram index), so `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` stays empty. Plan 3A adds columns and indexes only, no models: `tests/lib/backup-coverage.test.ts` must keep passing, and new columns travel in the whole-row backup (`src/lib/backup.ts`) and restore (`scripts/restore-from-backup.ts`) unchanged.
- Sales is SECRET from one team member (Robert). Nothing posts to Slack, email or HighLevel, and nothing writes the shared activity log: no `notify()`, `notifyChannel()`, `logActivity()`, Slack call or `revalidatePath` of a shared page anywhere in Plan 3A code. Sales nav, pages and routes exist only for users with Sales access (admin or `canUseSales`); every page calls `requireSalesPage()` first and every route `requireSalesUser()` (settings routes `requireAdmin()`). Plan 3A routes are for signed-in people only; no bot reaches them. `src/components/layout/*` holds no Sales word, path or label (comments included).
- No new key or token of any kind (DJ's hard order, 2026-11-07): no Blob client upload tokens, no `handleUpload`, no new environment variable. Sales files use only the private Blob credential the SDK reads by itself (`BLOB_READ_WRITE_TOKEN`, or `BLOB_STORE_ID` through OIDC); never pass a `token` option and never touch `ASSETS_READ_WRITE_TOKEN` or the asset routes.
- No em dashes in any user-facing text (labels, errors, toasts, empty states, history lines). People in seeds, fixtures, tests and code comments: first name plus last initial (`Sarah K.`, `Ben S.`, `Robert O.`, `Dana Q.`, `Laura B.`, `Mark T.`), or `"<Name> Example"` where a full name is needed (`tests/lib/sales/name-examples-scan.test.ts`). Real contacts may hold full names (Decision 16). Money is integer cents. Dates use the app-time helpers in `src/lib/utils.ts` (`startOfDay`, `endOfDay`, `dateInputValue`, `addDaysToDateString`, `addMonthsToDateString`, `zonedDateTime`, `formatDate`); never `new Date("YYYY-MM-DD")`. A sentence that ends in a name ending with "." gets no second period (`endSentence`, Task 19).
- Every write to Sales data records its history row in the same transaction: `recordDealAudit` (entity `SalesDeal`), `recordLeadAudit` (entity `SalesLead`, Task 3) or `recordSalesAudit` directly (entities `SalesPerson`, `SalesOrganization`, `SalesStage`, `SalesSettings`), with `requestMeta(request)` from the route. Per-person preferences (default view, saved views) write none.
- CSRF: every POST, PATCH, PUT and DELETE handler under `src/app/api/sales/` runs `assertSameOrigin(request)` (inside `readJson`, or directly for DELETE and the multipart upload); a foreign `Origin` gets 403 `"Request blocked."` and changes nothing. `tests/lib/sales/http.test.ts`'s guard covers every new route file automatically.
- Write path, in this order: `requireSalesUser()` then the Origin check then a `z.strictObject` body (unknown keys 400) then visibility (not visible: 404) then the edit right (403) then one `prisma.$transaction` holding the change and its history rows. Leads: `findLeadForEdit` (404 `"Lead not found."`, 403 `"Only the lead owner or an admin can change this lead."`). Contacts: Decision 18 visibility (404 `"Contact not found."`), edit = contact owner or admin (403). Every lead owner change, archive and restore, convert, contact edit and merge uses the guarded write (`updateMany` with every value the decision read in `where`, the owner included; a miss re-reads, retries once, then 409), the pattern in `src/lib/sales/stage-moves.ts`. Plan 2's rule holds: every check that can refuse runs before the first write, because a returned refusal commits the transaction (`deals.ts:24-26`). Where a guarded write can only come after another write in the same try, its miss throws a private `Raced` error (the transaction rolls back) and the service retries once in a new transaction, then answers 409.
- Client code (`"use client"` components and the pure `*-client.ts` helpers) imports only types (`import type`) from modules that import `@/lib/prisma` or `@vercel/blob` (`settings.ts`, `contacts-edit.ts`, `files.ts`, `deal-panel.ts`, `deals.ts` and the other loaders); runtime values come only from client-safe modules (`constants.ts`, `format.ts`, `*-query.ts`, `*-client.ts`, `contact-keys.ts`, `contact-links.ts`, `file-rules.ts`, `panel-url.ts`). Only Task 28 builds, so a server import in a client file would surface at the very end.
- zod 4 (4.4.3 here) fills in a `.default()` even inside `.optional()`: `z.strictObject({ organization: ref.default(null).optional() }).parse({})` gives `{ organization: null }`. So `contactRefSchema` carries no default; create schemas add `.default(null)` themselves, and update and convert schemas use `contactRefSchema.optional()`, so a key left out stays out.
- Every screen works on phone (375px), tablet and PC: no horizontal page scroll; touch targets at least 40px (`pointer-coarse:min-h-10 pointer-coarse:min-w-10`); tables become stacked cards under 640px (the `deals-list.tsx` pattern); every scroller is also `relative` (`tests/lib/sales/scroll-containment-render.test.ts`, extended for every new view).
- Performance (Ben: fast with many users): lists select only shown columns and never a person's email or phone; every query is bounded (`take`) or paginated and filters on an indexed column (Task 2 adds the indexes); a page's independent queries run in one `Promise.all`. Constants: Plan 2's plus `LEADS_PAGE_SIZE = 50`, `CONTACTS_PAGE_SIZE = 50`, `DASHBOARD_LIST_ROWS = 8`, `RECENT_ACTIVITY_ROWS = 7`, `RECENT_FEED_SCAN = 50`, `RECENT_FEED_PAGES = 4`, `INSIGHTS_ROW_CAP = 5000`.
- Do not run the dev server or open a browser (the controller clicks through in Task 28). Do not dispatch subagents. Do not touch any database except the implementer of Task 2 running `npx prisma migrate deploy` and `npx prisma generate` against the dev database in `.env`.
- Tests in `tests/**/*.test.ts`, never touching a real DB: mock `@/lib/prisma` (canned rows from `vi.fn`, `$transaction: async (fn) => fn(tx)`, audits captured from `salesAuditLog.create`) and `@/lib/sales/access`'s `requireSalesUser` (or `@/lib/permissions`' `requireAdmin`), as `tests/lib/sales/deals.test.ts` and `settings-route.test.ts` do. Assert on captured call arguments and written rows, with exact values. Render tests use `renderToString` with `next/navigation` mocked and portals mocked in place (`tests/lib/sales/deals-view-render.test.ts`, `deal-panel-render.test.ts`). Every new page gets a page-gate test copied from `tests/lib/sales/activities-page-gate.test.ts`. Fixture time `NOW = "2026-11-05T15:00:00.000Z"` (Thursday, 10 AM Eastern) unless a test says otherwise.
- Finish gate per task: `npx tsc --noEmit` (accepted: exactly the 4 errors in untracked `scratch/` (`query_dj_tasks.ts` x3, `query_urgent.ts` x1) and stale `.next/` types), `npx eslint src scripts tests`, `npm test` (baseline before Task 1: 65 test files, 1017 tests; the count only grows).
- Every file a task creates or modifies is in that task's `git add` list; before committing, `git status --short` shows no untracked or modified file under `src/`, `prisma/` or `tests/` that the task touched and did not stage. Stage by explicit path only (never `git add -A` / `.`). Never commit `scratch/`, `"Sales Module Handoff/"`, `SECURITY_AUDIT.md`, `src/lib/email.ts`, `src/app/api/me/notification-preferences/test-email/`, the modified `SESSION_NOTES.md`, `docs/superpowers/plans/2026-11-05-sales-plan-1-foundation.md`, `docs/superpowers/plans/2026-11-05-sales-plan-1-ledger.md`, or anything under `docs/` except this plan file (`docs/superpowers/plans/2026-11-07-sales-plan-3a-leads-contacts.md`, committed by the controller). Branch `sales/plan-3a-leads-contacts`: never switch branches, push or merge.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Skills: implementers load superpowers:test-driven-development and superpowers:verification-before-completion. UI tasks (17 to 27) also load ui-ux-pro-max, impeccable and emil-design-eng; Task 27 also loads dataviz. Precedence: Mockup v2 (once approved) and the approved v1 mockup, then the app's components and theme tokens, then skill taste. Skip any skill step that would start a dev server, open a browser, ask the user a question or dispatch subagents.
- Copy: strings pinned in this plan come from the rulings and the v1 mockup. Where Mockup v2 words a pinned string differently, do not guess: keep the plan's string and list the difference in the task report for the controller.
- Tokens: Plan 2's map (`p-ok` to `bg-status-success text-status-success-foreground`, `p-warn` to status-warning, `p-bad` to status-danger, `--accent` to `bg-accent text-accent-foreground`, avatars `bg-amber-300|bg-teal-300|bg-blue-300|bg-violet-300` with `text-slate-950`), with Decision 34 of Plan 2 (white only on `green-700` or darker) and these contrast rules: grey words on the solid `bg-muted` fill use `MUTED_TONE`; grey words that can sit on the `bg-accent` fill use `MUTED_TEXT` (Task 1); row hover is `hover:bg-muted/50`. No raw hex in components. New components live flat in `src/components/sales/` (`contrast-scan.test.ts` reads that folder non-recursively).
- Panels: lead and contact panels use the existing `Sheet` with `DEAL_PANEL_SHEET_CLASS`, mount inside the Sales layout's existing `<Suspense>`, copy the deal panel's sonner outside-press guard and load states, and carry no `data-sales-deal-panel` attribute (shortcuts stay off inside them, A11). Every link that opens a panel is built with `panelHref` (Task 7) and opened with `changePanelUrl`; every write refreshes with `refreshAfterWrite(router)`, never a bare `router.refresh()`.

## Decisions

Each restates a controller ruling (P3A-R#) or amendment (P3A-A#) the tasks rely on; where the plan had to fill a gap, it says so.

1. **Scope (R1).** 3A: Leads Inbox, lead panel, new lead, convert (single and bulk); Contacts (list, panel, edit, create, duplicates, merge) and editable deal contacts; deal Files; Sales dashboard and forecast; Insights; Sales settings; saved views with a Stage filter; the P2-R14 carry-over. Bots, bot API, HighLevel, the form-lead first activity and 25 MB uploads are 3B. Pipedrive copy, CSV export, deal bulk edit and the load test are Plan 4.
2. **Order (R2, R30).** Task 1 is P2-R14; Tasks 2 to 15 are backend; Task 16 waits for DJ's approval of Mockup v2; Tasks 17 to 27 are UI; Task 28 is the gate. Three backend tasks make the small UI edits their type changes force and nothing more (R2: no new visible UI before Task 16): Task 3 (`deal-history.tsx` maps the four new timeline icons), Task 6 (`use-activity-done.tsx`, `next-step-dialog.tsx`, `deal-panel.tsx` and the one `markDone` call in `activities-view.tsx` pass a parent) and Task 7 (`activities-view.tsx` reads `row.parent` and builds its links with `panelHref`; lead rows reuse the existing row markup). R8's "Deal or lead" heading, the "Lead" pill and the new Activities empty-state line land in Task 21, after the checkpoint.
3. **Migration and indexes (R29).** One migration. R29's twelve indexes plus seven the new queries need: `SalesPerson(ownerId)` and `SalesOrganization(ownerId)` (Contacts "Just me"), `SalesPerson(archivedAt, name)` and `SalesOrganization(archivedAt, name)` (the Contacts list's name order once Plan 4 imports contacts), `SalesPerson(mergedIntoId)` and `SalesOrganization(mergedIntoId)` (history of merged contacts), `SalesFile(uploadedById, createdAt)` (daily upload limit). (Plan's addition.)
4. **No new models (R27, R29).** Saved views live in `TeamMember.salesSavedViews`. `mergedIntoId` is a plain column with no foreign key, so restore order does not change.
5. **Lead visibility (R3).** Seen through `dealOwnerWhere(actor, "everyone")` on `ownerId` with `archivedAt: null`; edit = owner or admin; not visible = 404 `"Lead not found."`. A CONVERTED or ARCHIVED lead is read-only (409 `LEAD_CONVERTED` / `LEAD_ARCHIVED` on every lead write but Restore and an admin's Delete, its activities and notes included); an ARCHIVED lead offers only Restore (`canRestore`, owner or admin).
6. **Archive and delete (R4 as amended by A2).** Archive sets `status: "ARCHIVED"` only (`archivedAt` stays null) and offers Undo (back to OPEN). Delete (admins, bulk bar, confirm, no Undo) sets `archivedAt`. A non-admin delete writes `delete_refused` for each lead they can see and gets 403. No "lost" status. An ARCHIVED lead leaves the Inbox; its link still opens the panel with "This lead is archived." and "Restore".
7. **New lead by hand (R5).** Person and Organization (pick or new, at least one), Source (`DEAL_SOURCES`, default "Added by hand"), Practice ZIP (stored in the `practice-zip` lead field), Owner (yourself; admins: any Sales member or "Share out automatically", which calls `assignLeadOwner(tx)` in the same transaction), First activity (presets, required). Title = organization name, else person name. `n` stays New deal.
8. **Lead source (R6).** Always one of `DEAL_SOURCES`; convert copies it to `SalesDeal.source`. The `form-source` and `practice-name` lead fields are neither shown nor settable in 3A (Source and Organization supersede them).
9. **Lead panel (R7, A1, A11).** `?lead=<id>`: crumb "Leads Inbox", editable title, person, organization, owner picker (owner/admin), primary "Convert to deal"; warn bar "No next step. Call within 5 minutes of opt-in works best." with "Schedule"; composer (Activity, Note); Next steps; Details (Source; Organization and Person editable with the Add deal pickers (plan's choice, matching R18); the LEAD custom fields except `form-source` and `practice-name`; Created); History. CONVERTED: "Converted to {deal title}." with "Open deal" (swaps `?lead` for `?deal`), or "Converted to a deal you cannot open." when that deal is not visible. Shortcuts are off inside it.
10. **Lead activities everywhere (R8).** Activities page column "Deal or lead" (a lead row says "Lead" and opens the lead panel), sidebar due count, dashboard boxes and tiles, "No next step". An activity counts through its lead only while its `dealId` is null; once convert moves it to the deal, only the deal's visibility and status apply. (Plan's rule, Review Focus 1.) Ticking done, reopening and editing a note through a lead that is not OPEN is refused (409), so a done call left on a converted lead cannot be reopened into work nothing shows. Adding an activity or note first takes the lead row with a guarded `updateMany` (status OPEN), so it waits for, or loses to, a convert running at the same moment.
11. **Inbox (R9, A3).** Columns: checkbox, Lead (with "{person} · ZIP {zip}"), Source, Created ("{n}d old" pill after 2 days), Owner, Next step (`NextStepPill`). Everyone / Just me, search (title, organization, person; `/` focuses it), newest first, "Show more" by 50. Bulk bar: "{n} selected", "Convert to deal", "Assign to…", "Archive", "Delete" (admins), "Clear". Select-all ("Select all shown leads", Mockup v2's label) ticks the loaded rows only; the header checkbox is `aria-checked="mixed"` when some are ticked; ticks of rows no longer shown are dropped. Under 640px, where the table head is hidden, a strip above the cards holds the same select-all box (plan's addition; Task 16 adds it to Mockup v2), and the bulk bar sticks to the top (`role="region"`, Mockup v2). The footer names who gets new leads with one period at the end; its "Change it in Sales settings." shows to admins only (plan's choice: others cannot open settings).
12. **Lead owner change (R10, A3).** Owner or admin may change it (so a non-admin only gives away their own leads); the target must be a Sales member; open activities owned by the old owner move in the same transaction (`movedActivityIds` on the one `owner_changed` row); guarded write on `{ id, ownerId: <read owner>, status: "OPEN", archivedAt: null }` (a lead converted or given away a moment earlier is not reassigned), and it is the first write of the request. Bulk requests take ids 1..100 and run one transaction per lead with per-lead results.
13. **Leads count (R11).** My open leads (owner me, OPEN, not deleted), screen-reader suffix "open leads".
14. **Convert (R12 as amended by A1).** Pipeline (Sales and Consulting), Stage (not won, lost or No Show, not archived; first by default), the lead's person and organization read-only (the Add deal pickers only when the lead has neither; at least one required), Value optional; Total and Monthly both required when the stage `requiresValue` (server `checkStageMove`, 422). One transaction, every refusal first (lead, owner, pipeline, stage, picked contacts, values), then the guarded `updateMany` OPEN to CONVERTED on `{ id, status: "OPEN", archivedAt: null, ownerId: <read owner> }` as the first write (a second click gets 409 `"This lead was already converted."`; a lead given to someone else a moment earlier is re-read and refused), then any new contacts, the deal (lead title, owner, source, `stageEnteredAt`), `convertedDealId` (P2002 maps to 409), the lead's open activities (dealId null) and live notes get `dealId` (`leadId` kept), a CALL "First call after conversion" due today for the deal owner when no open activity moved, a deal `created` row with `fromLeadId`, a lead `converted` row `{ dealId }`. Custom field values stay on the lead. The deal's History also reads its lead's history (plan's choice, so moved notes stay visible). Toast "Lead converted. Find it in {pipeline}." and the panel swaps to `?deal=`.
15. **Bulk convert (R13, A1, A3).** Pipeline and Stage only (no value; stages that need a value are refused), ids 1..25, one transaction per lead, per-lead results; leads with neither person nor organization are skipped and listed ("Add a person or an organization first: {titles}."). Toast "{n} leads converted. Find them in {pipeline}." (singular "Lead converted. Find it in {pipeline}.").
16. **Names (R14).** Contacts keep one `name` as typed (full names allowed); the first-name-plus-last-initial rule binds seeds, fixtures, tests and docs; the schema comment is corrected. New fields: person `role`; organization `phone`, `zip`.
17. **Duplicate keys (R15, A5).** Stored `emailKey` (lower case after trimming only ASCII whitespace `[ \t\n\r\f\v]` at both ends, the same set in the app and in the SQL backfill, so both give the same key), `phoneKey` and `nameKey` on people, `nameKey` on organizations, written by every create and update path and backfilled by the migration. `phoneKey` (plan's reading of A5's "drop a leading 1 from 11 digits, keep 10"): digits only; fewer than 7 is null; when 11 or more digits start with `1`, that `1` is dropped; then the first 10 are kept, so an extension never changes the key ("512-555-0142 x23" and "(512) 555-0142" both give `5125550142`); US only, no library. `nameKey` keeps only lower-case `a-z0-9` (spaces and punctuation removed, so "Oak-Creek Dental." equals "Oak Creek Dental"; plan's reading of "collapsed"). Matches: person same emailKey, or same phoneKey, or same nameKey with the same organization; organization same nameKey, and the same zip when both have one. Accepted: restoring a snapshot taken before this migration brings contacts back with null keys (the restore inserts whole rows); after such a restore the controller re-runs the migration's two backfill `UPDATE` statements. Snapshots taken after it carry their keys.
18. **Contacts visibility (A4).** Admin or `seesAllDeals`: all live contacts. Otherwise: owned by me OR linked to a live deal or lead I own. The Add deal and new lead pickers use the same rule. Every count on a contact (open deals in both lists, the panel's people, deals and leads) carries the same filter as the list it counts. Duplicate bars name only visible matches; a hidden one gives "A matching contact already exists. Ask an admin to merge." A person's organization that the viewer may not see shows as plain text, never a link that opens a 404 panel. Lists and search never select email or phone; links come only from validated values (`http:`/`https:` websites, `mailto:`, `tel:`).
19. **Contacts page and panel (R17).** `/sales/contacts` with tabs People | Organizations (`?tab=organizations`), search (name; people also by organization name), Everyone / Just me ("Just me" = contacts I own), "Show more", "+ Person" / "+ Organization". A row opens the contact panel (`?person=` / `?organization=`): Details editable by the contact owner or an admin, Deals (open first) and Leads lists (each opens its panel; 20 rows each, with "Showing 20 of {n}." and true counts when there are more), the duplicate bar with "Merge" (admins), History (including rows of contacts merged into it). An old link to a merged contact opens the contact it was merged into (plan's choice, one hop). The mockup footer "Names follow the house rule..." is not shipped.
20. **Merge (R16, A6).** Admins only, the preview included (its counts span every rep's records), in a confirm dialog with counts ("Moves 3 deals, 1 lead and 4 notes."). One transaction (explicit `{ timeout: 30_000, maxWait: 5_000 }`; the per-deal and per-lead history rows go in one `createMany`) with guarded writes on both rows (a miss after a write throws to roll back; retry once, then 409); repoint every reference (`MERGE_REPOINTS`, pinned by a test that reads `prisma/schema.prisma`: A6 asks for the generated client, but Prisma 7's runtime data model carries no `relationFromFields`, so the schema text is the only list of foreign keys; plan's choice); fill blank fields on the kept contact, never overwrite; the kept person's organization wins when set; keys recomputed; refuse when more than 500 linked rows would move; history `merged` (kept), `merged_into` (dropped) and one `contact_changed` per affected deal and lead. No Undo.
21. **Deal and lead contacts (R18).** Deal Details' Organization and Person are editable by owner/admin with the Add deal pickers; a deal keeps at least one; a `contact_changed` row records names before and after. Lead Details work the same (a lead may end with neither).
22. **Files (A7 replaces R19's client tokens).** `POST /api/sales/deals/[dealId]/files`, multipart, server-side `put` to the PRIVATE store; cap 4 MB ("Up to 4 MB"); PDF, DOCX, XLSX, PNG, JPEG only, checked by magic bytes (no CSV, TXT, SVG or octet-stream; an Office file holding macros, Excel 4.0 macro sheets, ActiveX parts or embedded OLE objects is refused, plan's addition); the route checks Sales access first, then the Origin, then the size, and reads at most the cap even when `Content-Length` is missing; a failed database write after the upload deletes the blob and answers a plain 503 instead of rethrowing (a thrown Prisma error could carry the file name to Sentry); pathname `sales-files/<uuid>.<ext>` made by the server (`addRandomSuffix: false`, `allowOverwrite: false`). Limits: 50 live files per deal; 30 files or 100 MB per person per app-time day, counting removed files too. Display name cleaned (no path parts, control or direction characters; 200 characters; ends with the real type's extension). Downloads only via `GET /api/sales/files/[fileId]` after the deal visibility check and a `sales-files/` prefix check, with `Content-Disposition: attachment` (RFC 5987), `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Content-Security-Policy: sandbox`. File names are never logged or sent to Sentry. Raising to 25 MB with client tokens is a 3B item after the audit.
23. **No malware scanner (R20).** Recorded risk: an infected file could be stored and downloaded by staff. Mitigations are Decision 22's.
24. **Final versions (R21).** The File tab has a required checkbox "This is the final version the client received."; the row stores `finalConfirmedAt` (NOT NULL) and `stageName`. A "Files" section under Next steps lists name, size, stage, who and when, "Download", and "Remove" (owner or admin; soft delete, blob kept); history `file_added` / `file_removed`. The composer becomes three tabs (Activity, Note, File) on deals; leads keep two.
25. **Dashboard (R22, R23).** `/sales/dashboard`, first nav item; `/sales` still opens Deals. Greeting by app-time hour ("Good morning" before 12, "Good afternoon" before 17, else "Good evening", plus ", {first word of name}"); date line "{Weekday}, {Mon d}. Here is what needs you today."; Everyone / Just me. KPI tiles over Sales and Consulting pipelines: Open deals, Pipeline value (raw), Won this month (app-time month), Overdue activities (deals and leads). Boxes: "Today and overdue", "No next step" (deals AND leads, lead rows marked "Lead"), "Deals in Follow-Up" (stage key `follow-up`), "Recent activity" (the 7 newest deal history rows the viewer may see, scanned 50 rows at a time, at most 4 pages, stopping once 7 are found), 8 rows each, "View all" where a page exists. "View all" carries `scope=mine` while the dashboard is on Just me; the Follow-Up link names the first Sales pipeline that has a `follow-up` stage (`?pipeline=<key>&stage=follow-up`) and is left out when none has one; the No next step link opens Deals with "No next step" (deals only, since Deals shows no leads; plan's reading).
26. **Forecast (R24).** "Expected to close": weighted value (`valueCents x probability / 100`, lost stages 0, rounded per stage) of open deals by `expectedCloseDate` month: "This month", "Next month", "No close date: {n} deals". Deal Details gets "Expected close" (date, stored as app-time end of day; history `updated`).
27. **Insights (R25).** `/sales/insights`: Pipeline funnel (open deals per stage now, count and value, pipeline picker; the range does not apply, plan's reading), Deals won over time (won value per app-time month), Average deal cycle time (whole calendar days created to won, per month won), Activities completed per person. Range "Last 3 months" (default), 6, 12; Everyone / Just me; CSS/SVG only; each chart has a screen-reader table. Reads at most 5,000 won deals per range.
28. **Settings (R26, A8).** `/sales/settings`, admins only (`notFound()` for others, no `loading.tsx`, so the 404 is real). "Who gets new leads" saves with an explicit "Save" (one history row per real change). GET returns every Sales member and a has-access flag for each saved id; people who lost access show ticked but disabled with "No Sales access" and drop on Save; a saved single person who lost access shows a warn bar and opens the person select; PATCH refusals for the single person carry `code: "ASSIGNEE_LOST_ACCESS"`; with nobody eligible the card and the Inbox footer say "New leads go to {first admin} until someone is picked." (the card names the first admin through `LeadAssignmentView.firstAdminName`, A8) The warn bar names the real fallback, which is the round-robin list when it has eligible people (plan's refinement of R26's "first admin", matching `assignLeadOwner`). The route moves to `readJson` + `z.strictObject`. "Rules (always on)": the mockup's eight lines. "Pipelines and stages": Sales and Consulting pipelines; "Edit stages" edits rotting days only (1..365, blank = never; won and lost stages "Never"), one `updated` row per changed stage (entity `SalesStage`). No "Copy from Pipedrive" card.
29. **Saved views (R27, A9).** Up to 20 per person (names 1..40, unique ignoring case), no history row; a view holds pipeline, view, scope, status, next, stage and q. `BoardQuery.stage` (a stage key): the board shows only that column and the list filters rows; an unknown key is ignored; changing pipeline clears it unless the same change names a stage (applying a saved view does). A view saved with `pipeline: null` applies on the pipeline shown. Deals toolbar "Views" menu (apply, "Save this view…", remove) and a "Stage" group in the Filter menu.
30. **Nav (R28).** Sales dashboard, Deals, Leads Inbox (count, Decision 13), Activities (due count incl. leads), Contacts, Insights, Sales settings (admins). Neutral icon keys `home`, `inbox`, `people`, `chart`, `settings`; a per-link `countLabel`. The nav lands in Task 17 before some of its pages (Tasks 18 to 27); nothing ships in between, and Task 28 checks every link.
31. **Undo.** Archive (single and bulk) offers Undo; assign, convert, merge, delete and file remove do not (Plan 2 Decision 24 extended).
32. **Gate additions (A10).** The Sales-dirs grep for `logActivity|notify|notifyChannel|slack`, widened by the plan to email, HighLevel, `revalidatePath` and the client-token upload names (`sendEmail|@/lib/email|@/lib/highlevel|revalidatePath|handleUpload|@vercel/blob/client|ASSETS_READ_WRITE_TOKEN`), is empty (today's Sales code has no hit); a guard test keeps `src/lib/agent-data.ts`, `src/app/api/agent/**` and `src/app/api/mcp/**` free of `sales`; the controller runs `EXPLAIN` on dev for the dashboard, Inbox and Contacts queries. Accepted: the monthly storage-check total includes Sales file bytes (a number only).
33. **Stalled (A11).** `isStalled` accepts lead statuses; only OPEN with no open activity is stalled.
34. **P2-R14 first (R2).** The two 4.32:1 spots on the accent fill take `MUTED_TEXT`; the K4 scan test loses its ticket tag.
35. **One panel at a time (plan's rule).** `panelHref` removes `deal`, `lead`, `person`, `organization` and `compose` before setting one; when a hand-edited URL names several, the deal wins, then lead, person, organization.

## Review Focus

1. **Activities that moved with a converted lead, and a lead changed while it converts.** A done call moved to a deal that now belongs to another rep, or an open call on a converted lead, must never show on Activities, the dashboard or the due count through the lead; a lead an admin gives to another rep while its old owner clicks Convert must not become the old owner's deal. Expect the lead branch of every activity filter to require `dealId: null`, and every lead guarded write to carry the owner it read. Tests: Task 7 ("an activity that moved to a deal never matches through its lead"), Task 8 ("a lead given away while it converts is refused"), Task 5 ("moves the old owner's open activities with the lead").
2. **The last evening of a month in Eastern time.** A deal won at 11:30 PM Eastern on Nov 30 (Dec 1 in UTC), an expected close of Nov 30, and Insights month buckets viewed that night. Expect November, not December. Tests: Task 13 ("won this month and the forecast read the Eastern month on Nov 30 at 11:30 PM", "buckets a deal won at 11:30 PM Eastern on Oct 31 in October").
3. **Who can see a contact (A4).** A see-own rep must never learn a hidden contact's name, email, phone or deal count through the Contacts list (people AND organizations: every `_count` carries the owner filter), an organization's Contact column or people count, the duplicate bar, the merge preview, picker search, or a person's organization link. Expect only visible names, owner-filtered counts, "A matching contact already exists. Ask an admin to merge." for a hidden match, 403 on the preview, and plain text for a hidden organization. Tests: Task 2 ("refuses a picked organization the person cannot see"), Task 9 ("lists people the person may see", "lists organizations with owner-filtered counts", "hides other reps' matches behind a plain line, exactly", "a person's hidden organization is not a link"), Task 11 ("only signed-in admins preview or merge").
4. **A file that lies about itself, and a file link that points elsewhere.** An `.exe` renamed `contract.pdf`, a macro `.docm` renamed `.docx`, an `.xlsx` holding an Excel 4.0 macro sheet, an SVG named `.png`, a name like `..\..\backups\x.pdf` with control and right-to-left characters, a 5 MB body without `Content-Length`; and a download of another rep's file by id, or of a row whose pathname is `backups/...`. Expect a refusal by bytes, a cleaned name that ends in the real extension, a server-made pathname, a 413, and downloads by id only with the deal's visibility re-checked, `backups/...` refused before `get()`, and attachment, `nosniff` and `sandbox` headers. Test: Task 12 ("refuses files whose bytes are not an allowed type", "cleans names", "downloads only through the app, as an attachment").
5. **Stale links and saved views.** `?lead=` of a deleted lead or another rep's lead, `?person=` of a merged contact, a saved view naming a removed pipeline or a stage key that no longer exists. Expect 404 `"Lead not found."`, the kept contact opening instead, and a fallback to the first pipeline with all stages. Tests: Task 3 ("a deleted or hidden lead is not found"), Task 9 ("an old link to a merged contact opens the kept one"), Task 15 ("a saved view naming a stage that is gone shows every stage").

---

### Task 1: Grey words on the accent fill (P2-R14 carry-over)

**Files:**
- Modify: `src/components/sales/sales-pills.tsx:30` (add `MUTED_TEXT`; build `MUTED_TONE` from it)
- Modify: `src/components/sales/new-deal-dialog.tsx:395` (the highlighted option's `{choice.detail}` line)
- Modify: `src/components/sales/deals-board.tsx:332, 347, 366` (column summary line, column footer, empty-column text; all sit on `bg-accent` while a card is dragged over)
- Modify: `tests/lib/sales/name-examples-scan.test.ts:35` (title tidy)
- Test: `tests/lib/sales/muted-tone-render.test.ts` (add cases)

**Interfaces:**
- Produces: `export const MUTED_TEXT = "text-slate-600 dark:text-muted-foreground"` and `MUTED_TONE` built as `` `bg-muted ${MUTED_TEXT}` `` (value unchanged: `"bg-muted text-slate-600 dark:text-muted-foreground"`). Later tasks use `MUTED_TEXT` for grey words that can sit on `bg-accent` (ticked rows, highlighted options, drag-over).

- [ ] **Step 1: Write the failing tests** in `tests/lib/sales/muted-tone-render.test.ts`
  - "measures the pair that fails on the accent fill": `contrast(utilityColour("text-muted-foreground", "light")!, utilityColour("bg-accent", "light")!)` is `toBeCloseTo(4.32, 2)`.
  - "grey words on the accent fill pass AA in light and dark" (`it.each(THEMES)`): `contrast(shown(classList(MUTED_TEXT), "text", theme), utilityColour("bg-accent", theme)!)` is `>= 4.5`.
  - "MUTED_TONE is the muted fill plus MUTED_TEXT": `MUTED_TEXT` is `"text-slate-600 dark:text-muted-foreground"` and `MUTED_TONE` is `` `bg-muted ${MUTED_TEXT}` ``.
  - "the drag-over column and the highlighted option use MUTED_TEXT" (reads source with `fs.readFileSync`): in `src/components/sales/deals-board.tsx` the text from `function StageColumn` up to `function DropBar` contains no `text-muted-foreground`; in `src/components/sales/new-deal-dialog.tsx` the line holding `{choice.detail}` contains `MUTED_TEXT`.
  - In `name-examples-scan.test.ts`, `describe("full names in Sales code are made up (K4)", ...)` becomes `describe("full names in Sales code are made up", ...)` (no assertion change).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/muted-tone-render.test.ts`
Expected: FAIL (`MUTED_TEXT` is not exported; the source checks find `text-muted-foreground`).

- [ ] **Step 3: Implement.** Replace `text-muted-foreground` with `MUTED_TEXT` (through `cn`) at the three `deals-board.tsx` spots and the `new-deal-dialog.tsx` detail line. Nothing else changes.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/lib/sales/muted-tone-render.test.ts tests/lib/sales/name-examples-scan.test.ts tests/lib/sales/contrast-scan.test.ts`
Expected: PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/sales/sales-pills.tsx src/components/sales/new-deal-dialog.tsx src/components/sales/deals-board.tsx tests/lib/sales/muted-tone-render.test.ts tests/lib/sales/name-examples-scan.test.ts
git commit -m "fix(sales): grey words on the accent fill pass AA in light mode (P2-R14)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Plan 3A columns, duplicate keys, contact visibility and the shared contact writer

**Files:**
- Modify: `prisma/schema.prisma`:
  - `SalesPerson` (~l.1915): replace the name comment with `// The name as typed. Seeds, fixtures and tests use first name plus last initial; real contacts may hold full names.`; add `role String?`, `emailKey String?`, `phoneKey String?`, `nameKey String?`, `mergedIntoId String?` (comment: a plain id, no relation, set when merged into another person); `@@index([organizationId])`, `@@index([ownerId])`, `@@index([archivedAt, name])`, `@@index([emailKey])`, `@@index([phoneKey])`, `@@index([nameKey])`, `@@index([mergedIntoId])`
  - `SalesOrganization` (~l.1898): `phone String?`, `zip String?`, `nameKey String?`, `mergedIntoId String?`; `@@index([ownerId])`, `@@index([archivedAt, name])`, `@@index([nameKey])`, `@@index([mergedIntoId])`
  - `SalesLead` (~l.1960): `@@index([ownerId, status, createdAt])`, `@@index([personId])`, `@@index([organizationId])`
  - `SalesDeal` (~l.2001): `@@index([personId])`, `@@index([organizationId])`, `@@index([status, wonAt])`
  - `SalesFile` (~l.2060): `finalConfirmedAt DateTime`, `stageName String?`, `@@index([uploadedById, createdAt])`
  - `SalesAuditLog` (~l.2147): `@@index([entityType, at])`; `TeamMember` (~l.288): `salesSavedViews Json?`
- Create: `prisma/migrations/20261107000001_sales_leads_contacts/migration.sql`
- Create: `src/lib/sales/contact-keys.ts` (client-safe, pure), `src/lib/sales/contact-access.ts`, `src/lib/sales/contact-write.ts`
- Modify: `src/lib/sales/deals.ts` (`createDeal` uses `resolveContacts`; its own `contactSchema` ~l.58-64 and contact code ~l.135-167 move out), `src/lib/sales/contacts.ts:18-40` (`searchContacts` uses Decision 18 visibility), `src/lib/sales/constants.ts` (export `HAND_MADE_SOURCE = "Added by hand"`, moved from `deals.ts:43`)
- Test: `tests/lib/sales/contact-keys.test.ts`, `tests/lib/sales/contact-write.test.ts`; modify `tests/lib/sales/deals.test.ts`, `tests/lib/sales/contacts.test.ts`

**Interfaces:**
- Consumes: `SalesActor`, `dealOwnerWhere` (`access.ts`); `recordSalesAudit`, `SalesRequestMeta`; `fail`, `SalesFail`; `TITLE_MAX`.
- Produces (`contact-keys.ts`): `emailKey(email: string | null | undefined): string | null`, `phoneKey(phone: string | null | undefined): string | null`, `nameKey(name: string): string | null`, `personKeys(p: { name: string; email: string | null; phone: string | null }): { nameKey: string | null; emailKey: string | null; phoneKey: string | null }`, `organizationKeys(o: { name: string }): { nameKey: string | null }`.
- Produces (`contact-access.ts`): `CONTACT_NOT_FOUND = "Contact not found."`, `NOT_YOUR_CONTACT = "Only the contact's owner or an admin can change this contact."`, `visiblePersonWhere(actor: SalesActor, scope: "everyone" | "mine"): Prisma.SalesPersonWhereInput`, `visibleOrganizationWhere(actor, scope): Prisma.SalesOrganizationWhereInput`, `canEditContact(actor: SalesActor, contact: { ownerId: string }): boolean` (admin or owner). Shapes (u = `actor.userId`): "mine", for any actor: `{ archivedAt: null, ownerId: u }`; "everyone" for an admin or `seesAllDeals`: `{ archivedAt: null }`; "everyone" for anyone else: `{ archivedAt: null, OR: [{ ownerId: u }, { deals: { some: { ownerId: u, archivedAt: null } } }, { leads: { some: { ownerId: u, archivedAt: null } } }] }`.
- Produces (`contact-write.ts`): `contactRefSchema` (moved from `deals.ts`: `z.union([{ id: string(1..64) }, { name: trimmed 1..200 }]).nullable()`, NO default (Global Constraints, zod 4); `createDealSchema` and `createLeadSchema` write `contactRefSchema.default(null)`; update and convert schemas write `contactRefSchema.optional()`), `type ContactRef = z.infer<typeof contactRefSchema>`, `ORG_NOT_FOUND = "That organization was not found."`, `PERSON_NOT_FOUND = "That person was not found."`, `type ResolvedContacts = { organization: { id: string; name: string } | null; person: { id: string; name: string } | null }`, and three steps:
  - `checkContactRefs(tx: Prisma.TransactionClient, actor: SalesActor, input: { organization: ContactRef; person: ContactRef }): Promise<{ ok: true; picked: ResolvedContacts } | SalesFail>`: read-only; checks BOTH picked ids (organization first) against `visibleOrganizationWhere` / `visiblePersonWhere(actor, "everyone")` before returning; writes nothing.
  - `createContacts(tx, actor, input: { organization: ContactRef; person: ContactRef }, picked: ResolvedContacts, ownerId: string, meta: Partial<SalesRequestMeta>): Promise<ResolvedContacts>`: never refuses; creates each `{ name }` contact for `ownerId` with its keys and its `created` row (organization first); a new person joins the resolved organization; a picked person is never moved.
  - `resolveContacts(tx, actor, input, ownerId, meta): Promise<({ ok: true } & ResolvedContacts) | SalesFail>` = `checkContactRefs` then `createContacts`, for callers whose every other refusal comes before it (`createDeal`). Callers with a later refusal or a guarded write (Tasks 5, 8, 10) call the two steps apart: check first, create after the last refusal and after the first guarded write.

- [ ] **Step 1: Write the failing tests**

`contact-keys.test.ts`:
- "keys match however the details were typed": `emailKey(" Sarah@Oak.COM ")` and `emailKey("\tsarah@oak.com\n")` are `"sarah@oak.com"`; `emailKey(" a@b.example")` keeps the no-break space (`" a@b.example"`; only `[ \t\n\r\f\v]` is trimmed, as in the SQL); `emailKey("  ")`, `emailKey("")`, `emailKey(null)` are `null`. `phoneKey` of `"(512) 555-0142"`, `"+1 512.555.0142"`, `"1-512-555-0142"`, `"5125550142"`, `"512-555-0142 x23"` and `"+1 512 555 0142 ext. 5"` is `"5125550142"`; `"555-0142"` is `"5550142"`; `"12345"`, `"ext"`, `null` are `null`. `nameKey` of `"Oak Creek Dental"`, `"oak-creek dental."` and `"OAK CREEK DENTAL"` is `"oakcreekdental"`; `"O'Brien Dental"` and `"OBrien Dental"` are `"obriendental"`; `"Dr. Sarah K."` is `"drsarahk"`; `"  "` and `"--"` are `null`.
- "the migration backfills with the same rules": the text of `prisma/migrations/20261107000001_sales_leads_contacts/migration.sql` contains `NULLIF(lower(regexp_replace("email", '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g')), '')`, `WHEN length(k.d) >= 11 AND left(k.d, 1) = '1' THEN left(substr(k.d, 2), 10)` and `NULLIF(regexp_replace(lower("name"), '[^a-z0-9]', '', 'g'), '')`.

`contact-write.test.ts` (fake `tx`; see-own actor `{ userId: "r", isAdmin: false, seesAllDeals: false, via: "user" }`):
- "refuses a picked organization the person cannot see": `{ organization: { id: "o9" }, person: null }` with `salesOrganization.findFirst` returning null: `{ ok: false, status: 400, error: "That organization was not found." }`; the lookup's `where` is `{ id: "o9", archivedAt: null, OR: [{ ownerId: "r" }, { deals: { some: { ownerId: "r", archivedAt: null } } }, { leads: { some: { ownerId: "r", archivedAt: null } } }] }`; nothing created, no audit.
- "creates new contacts with their keys and history": `{ organization: { name: "Oak Creek Dental" }, person: { name: "Sarah K." } }`, owner "b": organization create `data` `{ name: "Oak Creek Dental", ownerId: "b", nameKey: "oakcreekdental" }`; person create `data` `{ name: "Sarah K.", ownerId: "b", organizationId: <org id>, nameKey: "sarahk", emailKey: null, phoneKey: null }`; audits in order `{ entityType: "SalesOrganization", entityId: <org id>, action: "created", after: { name: "Oak Creek Dental", ownerId: "b" } }`, `{ entityType: "SalesPerson", entityId: <person id>, action: "created", after: { name: "Sarah K.", ownerId: "b", organizationId: <org id> } }`.
- "never moves a picked person into a new organization": `{ organization: { name: "New Practice" }, person: { id: "p1" } }`: no `salesPerson.update` or `updateMany` call.
- "checks every picked contact before making a new one": `{ organization: { name: "New Practice" }, person: { id: "p9" } }` with p9 hidden: `{ ok: false, status: 400, error: "That person was not found." }`; `salesOrganization.create` never called; no audit row. `checkContactRefs` alone never calls a `create`.
- "neither contact is fine here": `{ organization: null, person: null }` gives `{ ok: true, organization: null, person: null }` (callers decide whether one is required).
- "contact visibility shapes": `visiblePersonWhere(seeOwn, "mine")` and `visiblePersonWhere(admin, "mine")` are `{ archivedAt: null, ownerId: <their id> }`; `visiblePersonWhere(seesAll, "everyone")` and the admin's are `{ archivedAt: null }`; the see-own actor's "everyone" is the three-branch `OR`; the same four for `visibleOrganizationWhere`.
- "update schemas leave out what was not sent": `contactRefSchema.optional()` in a strictObject parses `{ title: "x" }` to `{ title: "x" }` with no `organization` key (pins the zod 4 note in Global Constraints).

`deals.test.ts` changes (A4 changes the picked-contact lookup, and every create now writes keys):
- `:255-256` and `:340` (the create `data` assertions) gain the keys: organization `{ name: "Oak Creek Family Dentistry", ownerId: "r", nameKey: "oakcreekfamilydentistry" }`; person `{ name: "Mark T.", ownerId: "r", organizationId: "org-new", nameKey: "markt", emailKey: null, phoneKey: null }`; `{ name: "Sarah K.", ownerId: "r", organizationId: null, nameKey: "sarahk", emailKey: null, phoneKey: null }`. The four history rows and their `after` payloads are unchanged (keys never go in history).
- `:316` becomes `{ id: "o1", archivedAt: null, OR: [{ ownerId: "r" }, { deals: { some: { ownerId: "r", archivedAt: null } } }, { leads: { some: { ownerId: "r", archivedAt: null } } }] }`.
- The fake `findContact` (`:64-70`) is rewritten to honour `where.OR`: a row matches when its `ownerId` is the actor's, or its fixture field `dealOwnerIds` / `leadOwnerIds` (owners of its live deals and leads) holds the actor; so "refuses an organization or person the person cannot see, before writing anything" (`:345-355`) still refuses `o2` and `pe1`.

`contacts.test.ts` changes: `searchContacts(actor, "organization", "br")` for the see-own actor calls `findMany` with `where: { archivedAt: null, OR: [<the three branches for "r">], name: { contains: "br", mode: "insensitive" } }`; for an admin `where: { archivedAt: null, name: { contains: "br", mode: "insensitive" } }`; the person search at `:75` expects the same `OR` shape in place of `ownerId: "r"`; the route case at `:105` asserts `where.OR` is present (in place of `toMatchObject({ ownerId: "r" })`); select, order and `take: 8` unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/contact-keys.test.ts tests/lib/sales/contact-write.test.ts tests/lib/sales/deals.test.ts tests/lib/sales/contacts.test.ts`
Expected: FAIL (modules and migration not found; keys not written).

- [ ] **Step 3: Schema and migration.** `migration.sql` (pinned):

```sql
-- Plan 3A: leads, contacts, files and saved views. Columns and indexes only.
ALTER TABLE "SalesPerson" ADD COLUMN "role" TEXT, ADD COLUMN "emailKey" TEXT, ADD COLUMN "phoneKey" TEXT, ADD COLUMN "nameKey" TEXT, ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "SalesOrganization" ADD COLUMN "phone" TEXT, ADD COLUMN "zip" TEXT, ADD COLUMN "nameKey" TEXT, ADD COLUMN "mergedIntoId" TEXT;
-- No SalesFile row exists yet (nothing could upload before this plan), so NOT NULL needs no default.
ALTER TABLE "SalesFile" ADD COLUMN "finalConfirmedAt" TIMESTAMP(3) NOT NULL, ADD COLUMN "stageName" TEXT;
ALTER TABLE "TeamMember" ADD COLUMN "salesSavedViews" JSONB;

-- Duplicate keys for rows that already exist: the same rules as src/lib/sales/contact-keys.ts.
-- After restoring a snapshot taken before this migration, run these two UPDATEs again (Decision 17).
UPDATE "SalesPerson" AS p SET
  "emailKey" = NULLIF(lower(regexp_replace(p."email", '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g')), ''),
  "phoneKey" = CASE WHEN length(k.d) < 7 THEN NULL
                    WHEN length(k.d) >= 11 AND left(k.d, 1) = '1' THEN left(substr(k.d, 2), 10)
                    ELSE left(k.d, 10) END,
  "nameKey" = NULLIF(regexp_replace(lower(p."name"), '[^a-z0-9]', '', 'g'), '')
FROM (SELECT "id", regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g') AS d FROM "SalesPerson") AS k
WHERE k."id" = p."id";
UPDATE "SalesOrganization" SET "nameKey" = NULLIF(regexp_replace(lower("name"), '[^a-z0-9]', '', 'g'), '');

CREATE INDEX "SalesPerson_organizationId_idx" ON "SalesPerson"("organizationId");
CREATE INDEX "SalesPerson_ownerId_idx" ON "SalesPerson"("ownerId");
CREATE INDEX "SalesPerson_archivedAt_name_idx" ON "SalesPerson"("archivedAt", "name");
CREATE INDEX "SalesOrganization_archivedAt_name_idx" ON "SalesOrganization"("archivedAt", "name");
CREATE INDEX "SalesPerson_emailKey_idx" ON "SalesPerson"("emailKey");
CREATE INDEX "SalesPerson_phoneKey_idx" ON "SalesPerson"("phoneKey");
CREATE INDEX "SalesPerson_nameKey_idx" ON "SalesPerson"("nameKey");
CREATE INDEX "SalesPerson_mergedIntoId_idx" ON "SalesPerson"("mergedIntoId");
CREATE INDEX "SalesOrganization_ownerId_idx" ON "SalesOrganization"("ownerId");
CREATE INDEX "SalesOrganization_nameKey_idx" ON "SalesOrganization"("nameKey");
CREATE INDEX "SalesOrganization_mergedIntoId_idx" ON "SalesOrganization"("mergedIntoId");
CREATE INDEX "SalesLead_ownerId_status_createdAt_idx" ON "SalesLead"("ownerId", "status", "createdAt");
CREATE INDEX "SalesLead_personId_idx" ON "SalesLead"("personId");
CREATE INDEX "SalesLead_organizationId_idx" ON "SalesLead"("organizationId");
CREATE INDEX "SalesDeal_personId_idx" ON "SalesDeal"("personId");
CREATE INDEX "SalesDeal_organizationId_idx" ON "SalesDeal"("organizationId");
CREATE INDEX "SalesDeal_status_wonAt_idx" ON "SalesDeal"("status", "wonAt");
CREATE INDEX "SalesFile_uploadedById_createdAt_idx" ON "SalesFile"("uploadedById", "createdAt");
CREATE INDEX "SalesAuditLog_entityType_at_idx" ON "SalesAuditLog"("entityType", "at");
```

Run `npx prisma migrate deploy`, then `npx prisma generate`, then `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`: expected output is an empty migration. (`CREATE INDEX` on `SalesAuditLog` is fine: its append-only triggers block row changes, not DDL.)

- [ ] **Step 4: Implement the three modules and the callers.** `emailKey`: strip `/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g`, then `toLowerCase()`; empty is null. `phoneKey`: digits only; fewer than 7 is null; 11 or more starting with `1` drop that `1`; keep the first 10. `nameKey`: `toLowerCase()`, then keep only `[a-z0-9]`; empty is null. `createDeal` keeps its order of checks and its four history rows, calling `resolveContacts(tx, actor, { organization, person }, input.ownerId, meta)` where it used to resolve contacts itself (its picked-id checks already run before any create, `deals.ts:146-167`).

- [ ] **Step 5: Run to verify they pass**

Run: the Step 2 command plus `npx vitest run tests/lib/backup-coverage.test.ts`
Expected: PASS.

- [ ] **Step 6: Finish gate** (Global Constraints): all pass.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261107000001_sales_leads_contacts/migration.sql src/lib/sales/contact-keys.ts src/lib/sales/contact-access.ts src/lib/sales/contact-write.ts src/lib/sales/deals.ts src/lib/sales/contacts.ts src/lib/sales/constants.ts tests/lib/sales/contact-keys.test.ts tests/lib/sales/contact-write.test.ts tests/lib/sales/deals.test.ts tests/lib/sales/contacts.test.ts
git commit -m "feat(sales): Plan 3A columns, duplicate keys and one way to pick or add contacts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Lead access, lead history and the lead panel data

**Files:**
- Create: `src/lib/sales/lead-access.ts`, `src/lib/sales/lead-audit.ts`, `src/lib/sales/lead-panel.ts`
- Modify: `src/lib/sales/deal-audit.ts` (export `FieldRef`, the child events and `ContactChange`; add `contact_changed`), `src/lib/sales/timeline.ts` (entity-aware wording ~l.109-180, new icons ~l.17, a shared page loader, `loadLeadTimeline`), `src/components/sales/deal-history.tsx:40` (type-forced: `ICONS` maps the four new keys, `converted: ArrowRightLeft`, `contact: Contact`, `file: Paperclip`, `merged: Merge`, all in lucide-react 1.23)
- Create: `src/app/api/sales/leads/[leadId]/route.ts` (GET here), `src/app/api/sales/leads/[leadId]/timeline/route.ts` (GET)
- Test: `tests/lib/sales/lead-panel.test.ts`, `tests/lib/sales/lead-read-routes.test.ts`; modify `tests/lib/sales/timeline.test.ts`

**Interfaces:**
- Consumes: `dealOwnerWhere`, `canEditDeal`, `SalesActor`; `recordSalesAudit`; `fail`; `visibleDealWhere`; `PanelActivity`, `PanelField` (`deal-panel.ts`); `loadSalesMembers`, `SalesMemberOption` (`board.ts`).
- Produces (`lead-access.ts`): `LEAD_NOT_FOUND = "Lead not found."`, `NOT_YOUR_LEAD = "Only the lead owner or an admin can change this lead."`, `LEAD_CONVERTED = "This lead was converted. Open its deal instead."`, `LEAD_ARCHIVED = "This lead is archived. Restore it first."`, `visibleLeadWhere(actor: SalesActor, leadId: string): Prisma.SalesLeadWhereInput` (`{ id, archivedAt: null, ...dealOwnerWhere(actor, "everyone") }`), `findLeadForEdit<S extends Prisma.SalesLeadSelect & { ownerId: true }>(tx: Prisma.TransactionClient, actor: SalesActor, leadId: string, select: S): Promise<{ ok: true; lead: Prisma.SalesLeadGetPayload<{ select: S }> } | SalesFail>` (404 `LEAD_NOT_FOUND`, 403 `NOT_YOUR_LEAD`).
- Produces (`deal-audit.ts`): `export type FieldRef` (today a private type at `:28`, used by `LeadAuditEvent`); `export type ContactChange = { organizationId: string | null; organizationName: string | null; personId: string | null; personName: string | null }`; `export type ChildAuditEvent` (the existing `activity_added`, `activity_done | activity_reopened | activity_missed`, `activity_removed`, `note_added`, `note_edited` members); `DealAuditEvent` gains `{ action: "contact_changed"; before: ContactChange; after: ContactChange & { merged?: true } }`.
- Produces (`lead-audit.ts`): `type LeadAuditEvent` =
  `{ action: "created"; after: { title: string; ownerId: string; source: string; organizationId: string | null; personId: string | null } }`
  | `{ action: "updated"; before: Partial<{ title: string; source: string }>; after: Partial<{ title: string; source: string }> }`
  | `{ action: "owner_changed"; before: { ownerId: string }; after: { ownerId: string; movedActivityIds?: string[] } }`
  | `{ action: "contact_changed"; before: ContactChange; after: ContactChange & { merged?: true } }`
  | `{ action: "field_changed"; before: FieldRef; after: FieldRef }`
  | `{ action: "status_changed"; before: { status: SalesLeadStatus }; after: { status: SalesLeadStatus } }`
  | `{ action: "converted"; after: { dealId: string } }`
  | `{ action: "archived"; before: { archivedAt: null }; after: { archivedAt: string } }`
  | `{ action: "delete_refused" }` | `ChildAuditEvent`;
  `recordLeadAudit(tx, actor: SalesActor | SalesSystemActor, leadId: string, event: LeadAuditEvent, meta?: Partial<SalesRequestMeta>): Promise<void>` (entity `SalesLead`).
- Produces (`timeline.ts`): `TimelineIcon` adds `"converted" | "contact" | "file" | "merged"`; `describeAuditRow(row: { entityType?: string; action: string; actorType: string; before: unknown; after: unknown }, names: Map<string, string>)` (no `entityType` reads as `SalesDeal`, so Plan 2 callers and tests keep working); `loadLeadTimeline(actor, leadId, cursor: TimelineCursor | null, db = prisma): Promise<{ entries: TimelineEntry[]; nextCursor: TimelineCursor | null } | null>`. A private `loadTimelinePage(db, actor, sources: { entityType: string; entityId: string }[], cursor)` serves deal, lead and (Task 9) contact timelines: with one source its `where` keeps Plan 2's exact shape `{ entityType, entityId, ...cursorClause }`; with several it is `{ AND: [{ OR: sources }, cursorClause] }` (the cursor clause left out on the first page). Rows now also select `entityType`.
- Produces (`lead-panel.ts`): `type LeadPanelData = { lead: { id: string; title: string; status: "OPEN" | "CONVERTED" | "ARCHIVED"; source: string; createdAt: string; owner: SalesMemberOption; organization: { id: string; name: string } | null; person: { id: string; name: string } | null }; convertedDeal: { id: string; title: string } | null; openActivities: PanelActivity[]; fields: PanelField[]; members: SalesMemberOption[]; canEdit: boolean; canRestore: boolean }` (`canEdit`: owner or admin and OPEN; `canRestore`: owner or admin and ARCHIVED), `LEAD_HIDDEN_FIELD_KEYS = ["form-source", "practice-name"] as const`, `loadLeadPanel(actor, leadId, db = prisma): Promise<LeadPanelData | null>`.
- Produces (routes): `GET /api/sales/leads/[leadId]` (`LeadPanelData`, or 404 `{ error: "Lead not found." }`); `GET /api/sales/leads/[leadId]/timeline?at=&id=` (`{ entries, nextCursor }` or 404).

- [ ] **Step 1: Write the failing tests**

`lead-panel.test.ts` (see-own actor "r" unless stated):
- "a deleted or hidden lead is not found" (Review Focus 5): `salesLead.findFirst` is called with `where: { id: "l1", archivedAt: null, ownerId: "r" }`; when it returns null, `loadLeadPanel` returns `null`. For an admin the `where` is `{ id: "l1", archivedAt: null }`.
- "findLeadForEdit refuses someone who can see but not change the lead": lead owned by "b", actor `{ userId: "r", isAdmin: false, seesAllDeals: true, via: "user" }`: `{ ok: false, status: 403, error: "Only the lead owner or an admin can change this lead." }`; not found: 404 `"Lead not found."`.
- "shows the lead's own fields, minus Form Source and Practice Name": `salesCustomField.findMany` with `where: { entity: "LEAD", archivedAt: null, key: { notIn: ["form-source", "practice-name"] } }, orderBy: { position: "asc" }`; fields `practice-zip` ("Practice ZIP", TEXT, value "78704") and `best-time` ("Best time to call", SELECT, options `["Morning", "Afternoon"]`, no value) give `[{ key: "practice-zip", label: "Practice ZIP", fieldType: "TEXT", options: [], value: "78704" }, { key: "best-time", label: "Best time to call", fieldType: "SELECT", options: ["Morning", "Afternoon"], value: null }]`.
- "lists the lead's open activities only": `salesActivity.findMany` with `where: { leadId: "l1", dealId: null, doneAt: null, archivedAt: null }`, `orderBy: [{ dueAt: "asc" }, { id: "asc" }]`.
- "only the owner or an admin edits, and never a converted or archived lead": owner "r" and OPEN: `canEdit: true, canRestore: false`; CONVERTED: `canEdit: false, canRestore: false`; ARCHIVED: `canEdit: false, canRestore: true`; owner "b" seen by seesAll "r": `canEdit: false` (and `canRestore: false` when ARCHIVED); an admin on b's ARCHIVED lead: `canRestore: true`.
- "a converted lead names its deal only when the viewer may open it": CONVERTED with `convertedDealId: "d7"`: `salesDeal.findFirst` with `where: { id: "d7", archivedAt: null, ownerId: "r" }` returning `{ id: "d7", title: "Oak Creek Dental" }` gives `convertedDeal: { id: "d7", title: "Oak Creek Dental" }`; returning null gives `convertedDeal: null`.

`timeline.test.ts` additions (`names` = `new Map([["b", "Ben Example"]])`):
- "words lead history": with `entityType: "SalesLead"`: `created` "Lead created" (icon `created`); `archived` "Lead deleted" (`deleted`); `delete_refused` "Tried to delete this lead (refused)" (`deleted`); `status_changed` to `{ status: "ARCHIVED" }` "Archived" (`deleted`); to `{ status: "OPEN" }` "Restored to the Inbox" (`reopened`); `converted` "Converted to a deal" (`converted`); `owner_changed` to "b" "Owner changed to Ben E."; an unknown action "Lead updated". With `entityType: "SalesDeal"` and with none, `created` is still "Deal created" and an unknown action "Deal updated".
- "words contact changes" (icon `contact`): only the organization changing to `{ organizationId: "o1", organizationName: "Oak Creek Dental" }`: "Organization changed to Oak Creek Dental"; organization cleared: "Organization removed"; person changed to "Sarah K.": "Person changed to Sarah K."; person cleared: "Person removed"; both changed: "Organization and person changed"; a person change with `after.merged: true`: "Person changed to Sarah K. (merged duplicates)". No text contains U+2014.
- "loads a lead's history": not visible gives `null`; visible: `salesAuditLog.findMany` with `where: { entityType: "SalesLead", entityId: "l1" }`, `orderBy: [{ at: "desc" }, { id: "desc" }]`, `take: 31`. The Plan 2 deal timeline cases pass unchanged.

`lead-read-routes.test.ts` (mock `requireSalesUser`): GET lead without Sales access: 403 and no query; `loadLeadPanel` null: 404 `{ error: "Lead not found." }`; found: 200 with the panel JSON. GET timeline with `at=yesterday` ignores the cursor (first page), not a 500.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/lead-panel.test.ts tests/lib/sales/lead-read-routes.test.ts tests/lib/sales/timeline.test.ts`
Expected: FAIL (modules not found; new wording missing).

- [ ] **Step 3: Implement.** Read the route handler guide first. `describeAuditRow` branches on `row.entityType ?? "SalesDeal"` only where wording differs (`created`, `archived`, `delete_refused`, `status_changed`, the fallback); `contact_changed` compares the ids in `before` and `after` to pick its line. Routes follow `src/app/api/sales/deals/[dealId]/route.ts`.

- [ ] **Step 4: Run to verify they pass**

Run: the Step 2 command plus `npx vitest run tests/lib/sales/deal-read-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/lead-access.ts src/lib/sales/lead-audit.ts src/lib/sales/lead-panel.ts src/lib/sales/deal-audit.ts src/lib/sales/timeline.ts src/components/sales/deal-history.tsx "src/app/api/sales/leads/[leadId]/route.ts" "src/app/api/sales/leads/[leadId]/timeline/route.ts" tests/lib/sales/lead-panel.test.ts tests/lib/sales/lead-read-routes.test.ts tests/lib/sales/timeline.test.ts
git commit -m "feat(sales): lead access, lead history and the lead panel data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Leads Inbox data and who gets new leads

**Files:**
- Create: `src/lib/sales/leads-query.ts` (client-safe), `src/lib/sales/leads-page.ts`
- Modify: `src/lib/sales/lead-assignment.ts` (add `loadAssignmentSummary`; `assignLeadOwner` unchanged), `src/lib/sales/constants.ts` (`LEADS_PAGE_SIZE = 50`, `PRACTICE_ZIP_FIELD_KEY = "practice-zip"`)
- Create: `src/app/api/sales/leads/route.ts` (GET here)
- Test: `tests/lib/sales/leads-page.test.ts`; modify `tests/lib/sales/lead-assignment.test.ts`

**Interfaces:**
- Consumes: `dealOwnerWhere`, `SALES_MEMBER_WHERE`; `loadSalesMembers`; `shortName`; `searchParamsRecord`.
- Produces (`leads-query.ts`): `type LeadsQuery = { scope: "everyone" | "mine"; q: string; cursor: string | null }`, `parseLeadsQuery(params: Record<string, string | string[] | undefined>): LeadsQuery` (first array element; bad values fall back; `q` trimmed, cut to 100, under 2 characters becomes ""; `cursor` 1..64 characters or null), `leadsQueryToSearch(query: LeadsQuery): string` (keys scope, q; non-defaults only; never the cursor).
- Produces (`leads-page.ts`): `type LeadRow = { id: string; title: string; source: string; createdAt: string; ownerId: string; personName: string | null; organizationName: string | null; zip: string | null; next: { type: SalesActivityType; subject: string; dueAt: string; hasTime: boolean } | null }`, `type LeadRowsPage = { rows: LeadRow[]; nextCursor: string | null }`, `type LeadsPageData = { query: LeadsQuery; rows: LeadRow[]; nextCursor: string | null; members: SalesMemberOption[]; canSeeEveryone: boolean; assignment: AssignmentSummary }`, `leadsInboxWhere(actor, query): Prisma.SalesLeadWhereInput`, `loadLeadRows(actor, query, db = prisma): Promise<LeadRowsPage>`, `loadLeadsPage(actor, query, db = prisma): Promise<LeadsPageData>` (always the first page).
- Produces (`lead-assignment.ts`): `type AssignmentSummary = { mode: "ROUND_ROBIN" | "SINGLE"; names: string[]; fallbackName: string | null }`: what `assignLeadOwner` would do now, without moving the cursor (SINGLE whose person has access: `{ mode: "SINGLE", names: [short name], fallbackName: null }`; else the eligible rotation in saved order: `{ mode: "ROUND_ROBIN", names, fallbackName: null }`; nobody eligible: `{ mode: "ROUND_ROBIN", names: [], fallbackName: <first admin's short name> | null }`). `loadAssignmentSummary(db: Pick<typeof prisma, "salesSettings" | "teamMember"> = prisma): Promise<AssignmentSummary>`.
- Produces (route): `GET /api/sales/leads?scope=&q=&cursor=` returns `LeadRowsPage`.

- [ ] **Step 1: Write the failing tests** `leads-page.test.ts` (see-own actor "r")
- "parses the Inbox URL": `parseLeadsQuery({})` is `{ scope: "everyone", q: "", cursor: null }`; `{ scope: "mine", q: "  oak " }` gives scope "mine", q "oak"; `{ scope: "all", q: "a" }` gives the defaults; a 150-character q is cut to 100; `leadsQueryToSearch({ scope: "mine", q: "oak", cursor: "l9" })` is `"scope=mine&q=oak"`; the defaults give `""`.
- "shows open, live leads the person may see": `leadsInboxWhere(actor, { scope: "everyone", q: "", cursor: null })` is `{ status: "OPEN", archivedAt: null, ownerId: "r" }`; an admin with "everyone" has no `ownerId`; with "mine" `ownerId: <admin id>`; `q: "oak"` adds `OR: [{ title: { contains: "oak", mode: "insensitive" } }, { organization: { name: { contains: "oak", mode: "insensitive" } } }, { person: { name: { contains: "oak", mode: "insensitive" } } }]`.
- "pages newest first, 50 at a time": `salesLead.findMany` with `orderBy: [{ createdAt: "desc" }, { id: "desc" }]`, `take: 51`, no `cursor` or `skip`; 51 rows give 50 rows and `nextCursor` = the 50th id; `cursor: "l50"` adds `cursor: { id: "l50" }, skip: 1`; `JSON.stringify` of the `select` contains neither `"email"` nor `"phone"`.
- "reads each lead's next step and ZIP with one query each": open activities read once with `where: { leadId: { in: [<ids>] }, dealId: null, doneAt: null, archivedAt: null }`, `orderBy: [{ dueAt: "asc" }, { id: "asc" }]`; the earliest per lead is `next`, none gives `null`; ZIPs read once with `salesCustomFieldValue.findMany({ where: { leadId: { in: [<ids>] }, field: { key: "practice-zip" } }, select: { leadId: true, value: true } })`, giving `zip: "78704"` or `null`.
- "knows whether to offer Everyone / Just me": `canSeeEveryone` false for the see-own actor, true for an admin.
- Route: without Sales access 403 and no query; `?scope=mine&cursor=l50` passes `cursor: { id: "l50" }, skip: 1`; a 65-character cursor is ignored (no `cursor` or `skip`), not a 500.

`lead-assignment.test.ts` addition, "says who gets new leads without moving the turn" (fake db): no settings row, first admin "Dana Example": `{ mode: "ROUND_ROBIN", names: [], fallbackName: "Dana E." }`; ROUND_ROBIN `["b", "r"]`, both Sales members ("Ben Example", "Robert O."), database returning them as `[r, b]`: `names: ["Ben E.", "Robert O."]`; `["b", "x"]` with x lost access: `names: ["Ben E."]`; SINGLE "b" with access: `{ mode: "SINGLE", names: ["Ben E."], fallbackName: null }`; SINGLE "b" without access and rotation `["r"]`: `{ mode: "ROUND_ROBIN", names: ["Robert O."], fallbackName: null }`. `$queryRaw` and every update are never called.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/leads-page.test.ts tests/lib/sales/lead-assignment.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Copy the shape of `src/lib/sales/board-query.ts` and of `loadNextSteps` in `board.ts`. `loadLeadsPage` runs rows, members and the summary in one `Promise.all`.

- [ ] **Step 4: Run to verify they pass** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/leads-query.ts src/lib/sales/leads-page.ts src/lib/sales/lead-assignment.ts src/lib/sales/constants.ts src/app/api/sales/leads/route.ts tests/lib/sales/leads-page.test.ts tests/lib/sales/lead-assignment.test.ts
git commit -m "feat(sales): Leads Inbox data and who gets new leads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: New lead, lead edits, archive, delete and bulk actions

**Files:**
- Create: `src/lib/sales/leads.ts`, `src/lib/sales/lead-bulk.ts`
- Modify: `src/app/api/sales/leads/route.ts` (add POST), `src/app/api/sales/leads/[leadId]/route.ts` (add PATCH, DELETE), `src/lib/sales/constants.ts` (`BULK_IDS_MAX = 100`)
- Create: `src/app/api/sales/leads/[leadId]/archive/route.ts` (POST), `src/app/api/sales/leads/[leadId]/fields/[fieldKey]/route.ts` (PUT), `src/app/api/sales/leads/bulk/route.ts` (POST)
- Test: `tests/lib/sales/leads.test.ts`, `tests/lib/sales/lead-bulk.test.ts`

**Interfaces:**
- Consumes: Task 2's `checkContactRefs`, `createContacts`, `contactRefSchema`, `HAND_MADE_SOURCE`; Task 3's `findLeadForEdit`, `visibleLeadWhere`, `recordLeadAudit`, `LEAD_CONVERTED`, `LEAD_ARCHIVED`, `NOT_YOUR_LEAD`; `assignLeadOwner`; `normalizeFieldValue`; `dealFieldSchema` (reused as the lead field body); `FIRST_ACTIVITY_PRESETS`, `DEAL_SOURCES`, `canDeleteSalesRecords`, `SALES_MEMBER_WHERE`.
- Produces (`leads.ts`): `createLeadSchema` (strictObject `{ organization: contactRefSchema.default(null); person: contactRefSchema.default(null); source: z.enum(DEAL_SOURCES) default "Added by hand"; zip?: string trimmed max 20; ownerId: string(1..64) | "auto"; firstActivity: "call-today" | "call-tomorrow" | "demo-2-days" }`), `updateLeadSchema` (strictObject, at least one of `title` (trimmed 1..200), `source`, `ownerId`, `organization: contactRefSchema.optional()`, `person: contactRefSchema.optional()`; refine "Nothing to change."; a key left out stays out), `type CreateLeadInput`, `type UpdateLeadInput`, `createLead(actor, input, meta, now): Promise<{ ok: true; lead: { id: string } } | SalesFail>`, `updateLead(actor, leadId, input, meta): Promise<{ ok: true; lead: { id: string; title: string; source: string; ownerId: string; organizationId: string | null; personId: string | null } } | SalesFail>`, `setLeadArchived(actor, leadId, archived: boolean, meta): Promise<{ ok: true; changed: boolean } | SalesFail>`, `deleteLead(actor, leadId, meta, now): Promise<{ ok: true } | SalesFail>`, `setLeadField(actor, leadId, fieldKey: string, value: string | null, meta): Promise<{ ok: true; value: string | null } | SalesFail>`.
- Produces (`lead-bulk.ts`): `bulkLeadSchema` (discriminated union on `action`: `{ action: "assign"; ids; ownerId }`, `{ action: "archive"; ids }`, `{ action: "restore"; ids }`, `{ action: "delete"; ids }`; `ids` deduped, 1..100, each `string(1..64)` with the error `"Invalid input."`; `ownerId` `string(1..64)`), `type BulkLeadInput`, `type BulkLeadResult = { id: string; ok: true } | { id: string; ok: false; error: string }`, `runLeadBulk(actor, input, meta, now): Promise<{ ok: true; results: BulkLeadResult[] } | SalesFail>`.
- Produces (routes): `POST /api/sales/leads` (201 `{ lead: { id } }`), `PATCH /api/sales/leads/[leadId]` (`{ lead }`), `DELETE /api/sales/leads/[leadId]` (`{ ok: true }`), `POST /api/sales/leads/[leadId]/archive` body `{ archived: boolean }` (`{ ok: true, changed }`), `PUT /api/sales/leads/[leadId]/fields/[fieldKey]` body `{ value }` (`{ value }`), `POST /api/sales/leads/bulk` (`{ results }`).
- Messages (pinned): `"You can only add leads for yourself."` (403), `"Choose a team member with Sales access."` (400), `"Add a person or an organization."` (400), `"Pick one of the listed sources."` (400), `"Give the lead a name."` and `"Keep the name under 200 characters."` (400), `"This lead just changed. Refresh and try again."` (409), `"Only an admin can delete leads."` (403), `"That field is not used on leads."` (404), `"Pick at least one lead."` and `"Pick up to 100 leads at a time."` (400).

- [ ] **Step 1: Write the failing tests** (`now = new Date("2026-11-05T15:00:00Z")`; requests carry `x-forwarded-for: 203.0.113.9`)

`leads.test.ts`:
- "only admins add leads for others": non-admin "r" with `ownerId: "b"` or `"auto"`: 403 `"You can only add leads for yourself."`, nothing written; an owner outside `SALES_MEMBER_WHERE`: 400 `"Choose a team member with Sales access."`; `organization: null, person: null`: 400 `"Add a person or an organization."`; `source: "Walk-in"`: 400 `"Pick one of the listed sources."`.
- "adds a lead with its contacts, ZIP and first call": by "r", `{ organization: { name: "Crestview Dental" }, person: { name: "Laura B." }, source: "Referral", zip: "78704", ownerId: "r", firstActivity: "call-today" }`: one `$transaction`; lead `data` `{ title: "Crestview Dental", ownerId: "r", source: "Referral", organizationId: <org>, personId: <person> }`; `salesCustomFieldValue.upsert` keyed `fieldId_leadId` with value `"78704"`; activity `{ type: "CALL", subject: "First call", dueAt: endOfDay("2026-11-05"), hasTime: false, ownerId: "r", leadId: <lead>, personId: <person>, createdBy: "r" }`; history in order, each with `ipAddress: "203.0.113.9"`: `SalesOrganization created`, `SalesPerson created`, `{ entityType: "SalesLead", action: "created", after: { title: "Crestview Dental", ownerId: "r", source: "Referral", organizationId: <org>, personId: <person> } }`, `{ entityType: "SalesLead", action: "field_changed", before: { fieldKey: "practice-zip", label: "Practice ZIP", value: null }, after: { fieldKey: "practice-zip", label: "Practice ZIP", value: "78704" } }`, `{ entityType: "SalesLead", action: "activity_added" }`.
- "shares a lead out automatically for an admin": admin with `ownerId: "auto"`; `assignLeadOwner` (mocked module) is called with the transaction client and returns "b": the lead, its new contacts and its first activity are owned by "b".
- "a refused new lead uses nobody's turn": admin, `ownerId: "auto"`, `organization: { id: "o9" }` (hidden): 400 `"That organization was not found."`; `assignLeadOwner` never called; nothing created and no history row.
- "names a lead after its person when there is no organization, and defaults the source": only `person: { name: "Laura B." }`, no `source`: `title: "Laura B."`, `source: "Added by hand"`.
- "moves the old owner's open activities with the lead" (A3): owner "r" PATCHes `{ ownerId: "b" }`; open a1 (owner r), open a2 (owner z), done a3 (owner r): `salesActivity.findMany` with `where: { leadId: "l1", dealId: null, ownerId: "r", doneAt: null, archivedAt: null }`; guarded `salesLead.updateMany({ where: { id: "l1", ownerId: "r", status: "OPEN", archivedAt: null }, data: { ownerId: "b" } })` as the request's first write; `salesActivity.updateMany({ where: { id: { in: ["a1"] }, dealId: null, ownerId: "r" }, data: { ownerId: "b" } })`; one row `{ action: "owner_changed", before: { ownerId: "r" }, after: { ownerId: "b", movedActivityIds: ["a1"] } }`. When the guarded write matches nothing twice: 409 `"This lead just changed. Refresh and try again."`. When it misses and the re-read shows an admin already gave the lead to "z": non-admin "r" gets 403 `"Only the lead owner or an admin can change this lead."` and nothing is written.
- "refuses edits from people who may not make them": seesAll "r" on b's lead: 403 `"Only the lead owner or an admin can change this lead."`; hidden: 404 `"Lead not found."` (for `updateLead`, `setLeadArchived` and `setLeadField` alike: no update, upsert or history row); CONVERTED: 409 `"This lead was converted. Open its deal instead."`; ARCHIVED (`updateLead`, `setLeadField`): 409 `"This lead is archived. Restore it first."`; owner to a non-Sales member: 400.
- "a title-only edit leaves the contacts alone": `{ title: "Crestview Family Dental" }` on a lead with o1 and p1: the `salesLead.update` `data` has no `organizationId` or `personId` key, and no `contact_changed` row is written.
- "changes a lead's contacts with a readable history row": `{ organization: { id: "o2" } }` ("Bright Smile Dental") on a lead with o1 "Crestview Dental" and p1 "Laura B.": `organizationId: "o2"` and `{ action: "contact_changed", before: { organizationId: "o1", organizationName: "Crestview Dental", personId: "p1", personName: "Laura B." }, after: { organizationId: "o2", organizationName: "Bright Smile Dental", personId: "p1", personName: "Laura B." } }`; `{ person: null }` sets `personId: null`.
- "a change that changes nothing writes nothing": the same title: 200, no history; `{ colour: "red" }`: 400.
- "archives with a way back" (Decision 6): `setLeadArchived(actor, "l1", true)` on OPEN: `salesLead.updateMany({ where: { id: "l1", status: "OPEN", archivedAt: null, ownerId: "r" }, data: { status: "ARCHIVED" } })` (restore: `where: { id: "l1", status: "ARCHIVED", archivedAt: null, ownerId: "r" }`), row `{ action: "status_changed", before: { status: "OPEN" }, after: { status: "ARCHIVED" } }`, `changed: true`; again: `changed: false`, no row; `false` restores with the OPEN row; CONVERTED: 409.
- "deleting is for admins, and attempts are logged": non-admin owner "r": 403 `"Only an admin can delete leads."`, no update, exactly one row `{ entityType: "SalesLead", entityId: "l1", action: "delete_refused", actorType: "USER", actorId: "r", ipAddress: "203.0.113.9" }`; hidden: 404 and no row; admin: `archivedAt: now` and `{ action: "archived", before: { archivedAt: null }, after: { archivedAt: "2026-11-05T15:00:00.000Z" } }`; DELETE with `Origin: https://evil.example`: 403 `"Request blocked."`, nothing written.
- "sets a lead field": `setLeadField(actor, "l1", "practice-zip", "78704")` upserts keyed `fieldId_leadId` and writes `field_changed`; `null` deletes the value row; `"form-source"`, `"practice-name"` and a DEAL field's key: 404 `"That field is not used on leads."`.

`lead-bulk.test.ts`:
- "bounds the request": 101 ids: 400 `"Pick up to 100 leads at a time."`; `[]`: 400 `"Pick at least one lead."`; a 65-character id: 400 `"Invalid input."` and nothing read; `["l1", "l1"]` runs once.
- "assigns lead by lead, each in its own transaction": non-admin "r" assigns `["l1" (owner r), "l2" (owner b)]` to "b": two `$transaction` calls; `results` is `[{ id: "l1", ok: true }, { id: "l2", ok: false, error: "Only the lead owner or an admin can change this lead." }]`.
- "archives and restores in bulk": `archive` over two OPEN leads writes two `status_changed` rows; `restore` writes two back.
- "a non-admin bulk delete is refused and logged": non-admin over `["l1" (visible), "l9" (hidden)]`: 403 `"Only an admin can delete leads."`, one `delete_refused` row for l1 only, no `archivedAt` set. An admin: both get `archivedAt`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/leads.test.ts tests/lib/sales/lead-bulk.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** All reads that decide a write happen inside the transaction. `createLead` checks everything first (at least one contact, the source, a chosen owner is a Sales member, `checkContactRefs`), then picks the owner (`"auto"` calls `assignLeadOwner(tx)`, whose cursor `UPDATE` is the first write), then `createContacts(..., ownerId, meta)`, the lead, the ZIP value (skipped silently when the `practice-zip` field is missing or archived) and the first activity. `updateLead`: `findLeadForEdit`, status checks, owner check, `checkContactRefs`, then the guarded owner write (first write), then `createContacts`, the update and its rows. `deleteLead` mirrors `archiveDeal` (`deals.ts:345`): visibility first, then `delete_refused` is written and RETURNED as the 403 so the row commits. The bulk route answers `failResponse` for a whole-request refusal, else `{ results }`.

- [ ] **Step 4: Run to verify they pass**

Run: the Step 2 command plus `npx vitest run tests/lib/sales/http.test.ts`
Expected: PASS (the CSRF guard covers the new routes).

- [ ] **Step 5: Finish gate** (Global Constraints): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/leads.ts src/lib/sales/lead-bulk.ts src/lib/sales/constants.ts src/app/api/sales/leads/route.ts "src/app/api/sales/leads/[leadId]/route.ts" "src/app/api/sales/leads/[leadId]/archive/route.ts" "src/app/api/sales/leads/[leadId]/fields/[fieldKey]/route.ts" src/app/api/sales/leads/bulk/route.ts tests/lib/sales/leads.test.ts tests/lib/sales/lead-bulk.test.ts
git commit -m "feat(sales): add, edit, archive, delete and bulk-change leads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Activities and notes on leads

**Files:**
- Modify: `src/lib/sales/activities.ts` (add `createLeadActivity`; `setActivityDone` serves deal and lead activities, ~l.137-200), `src/lib/sales/notes.ts` (add `addLeadNote`; `editNote` serves both, ~l.71-110)
- Create: `src/app/api/sales/leads/[leadId]/activities/route.ts` (POST), `src/app/api/sales/leads/[leadId]/notes/route.ts` (POST)
- Modify: `src/lib/sales/api-client.ts` (parent-aware wrappers), `src/components/sales/use-activity-done.tsx`, `src/components/sales/next-step-dialog.tsx`, `src/components/sales/deal-panel.tsx` (passes a deal parent; nothing else), `src/components/sales/activities-view.tsx:271` (type-forced, one line: `markDone({ id: row.id, subject: row.subject }, { kind: "deal", id: row.deal.id, title: row.deal.title })`; Task 7 does the rest)
- Test: modify `tests/lib/sales/activities.test.ts`, `tests/lib/sales/notes.test.ts`, `tests/lib/sales/api-client.test.ts`

**Interfaces:**
- Consumes: Task 3's `findLeadForEdit`, `recordLeadAudit`, `LEAD_CONVERTED`, `LEAD_ARCHIVED`; `createActivitySchema`, `noteSchema`.
- Produces (`activities.ts`): `createLeadActivity(actor, leadId, input: CreateActivityInput, meta): Promise<{ ok: true; activity: PanelActivity } | SalesFail>` (the activity belongs to whoever scheduled it, Plan 2 Decision 15); `setActivityDone` answers `{ ok: true; changed: boolean; activity: { id: string; doneAt: string | null }; parent: { kind: "deal" | "lead"; id: string; title: string; status: string; openActivityCount: number } }` (replaces Plan 2's `deal` key).
- Produces (`notes.ts`): `addLeadNote(actor, leadId, input: NoteInput, meta): Promise<{ ok: true; note: { id: string; body: string; createdAt: string } } | SalesFail>`; `editNote` reaches a note through its deal, or through its lead while the note has no deal, and writes its row there.
- Produces (`api-client.ts`): `type SalesParentRef = { kind: "deal" | "lead"; id: string }`, `createActivityFor(parent: SalesParentRef, body: CreateActivityInput): Promise<ApiResult<{ activity: PanelActivity }>>`, `addNoteFor(parent: SalesParentRef, body: NoteInput): Promise<ApiResult<{ note: { id: string; body: string; createdAt: string } }>>` (deal: `/api/sales/deals/{id}/...`; lead: `/api/sales/leads/{id}/...`; ids `encodeURIComponent`-ed). Plan 2's `createActivityRequest` and `addNoteRequest` stay.
- Produces (components): `useActivityDone(onChanged).markDone(activity: { id: string; subject: string }, parent: SalesParentRef & { title: string })`; `NextStepDialog` prop `parent: SalesParentRef & { title: string }` (replaces `deal`), saving through `createActivityFor`.
- Produces (routes): `POST /api/sales/leads/[leadId]/activities` (201 `{ activity }`), `POST /api/sales/leads/[leadId]/notes` (201 `{ note }`).

- [ ] **Step 1: Write the failing tests**

`activities.test.ts` additions (`now = 2026-11-05T15:00Z`):
- "schedules an activity on a lead": owner "r", `{ type: "MEETING", subject: "Demo", dueDate: "2026-11-07", dueTime: "09:30" }`: creates `{ type: "MEETING", subject: "Demo", dueAt: new Date("2026-11-07T14:30:00.000Z"), hasTime: true, ownerId: "r", createdBy: "r", leadId: "l1", personId: <lead personId> }` with no `dealId`, and one `{ entityType: "SalesLead", entityId: "l1", action: "activity_added" }` row; by admin "z" on r's lead: `ownerId: "z"`.
- "refuses activities on closed or hidden leads": CONVERTED: 409 `"This lead was converted. Open its deal instead."`; ARCHIVED: 409 `"This lead is archived. Restore it first."`; seesAll non-owner: 403; hidden: 404 `"Lead not found."`; in each case nothing is created and no row is written.
- "takes the lead row before adding to it": `createLeadActivity` (and `addLeadNote`) first call `salesLead.updateMany({ where: { id: "l1", status: "OPEN", archivedAt: null, ownerId: "r" }, data: { updatedAt: expect.any(Date) } })` (this row lock waits for, or loses to, a convert of the same lead); when it matches nothing and the re-read shows CONVERTED: 409 `"This lead was converted. Open its deal instead."` and no activity or note is created.
- "ticks a lead activity done and says what is left": the lookup's `where` for see-own "r" is `{ id: "a1", archivedAt: null, OR: [{ dealId: { not: null }, deal: { archivedAt: null, ownerId: "r" } }, { dealId: null, leadId: { not: null }, lead: { archivedAt: null, ownerId: "r" } }] }`; `parent` is `{ kind: "lead", id: "l1", title: "Crestview Dental", status: "OPEN", openActivityCount: 0 }`, the count read as `salesActivity.count({ where: { leadId: "l1", dealId: null, doneAt: null, archivedAt: null } })`; the row is `activity_done` on `SalesLead` l1.
- "never reopens work on a closed lead": a done activity (`dealId: null`) on a CONVERTED lead, `done: false`: 409 `"This lead was converted. Open its deal instead."`; on an ARCHIVED lead (`done: true` or `false`): 409 `"This lead is archived. Restore it first."`; nothing written.
- Plan 2 cases that change: every done result reads `parent: { kind: "deal", id, title, status, openActivityCount }` instead of `deal: {...}` (`:327`, `:340`, `:352`, `:372`, `:466`); the lookup-shape assertions at `:386-391` (see-own) and `:416-422` (seesAll: lead branch `lead: { archivedAt: null }`) become the two-branch `OR` shape above; in the 404 table at `:394-398`, "a lead-only activity" becomes "an activity on another rep's lead" (`dealId: null, leadId: "l2"`, l2 owned by "x"; still 404), and a new case ticks a lead-only activity on r's visible lead (200). The fake `salesActivity.findFirst` (`:84-93`) is rewritten to evaluate both `OR` branches against `state.deals` and a new `state.leads`, returning `deal` or `lead` (`{ id, title, status, ownerId }`) with the row.

`notes.test.ts` additions:
- "adds a note to a lead": `{ body: "Prefers mornings" }` by "r": note `{ body: "Prefers mornings", authorId: "r", leadId: "l1" }` (no `dealId`), row `note_added` on `SalesLead` l1; CONVERTED lead: 409.
- "edits a lead note through its lead, and a moved note through its deal": a lead note (`dealId: null`): `note_edited` on `SalesLead` l1; a note with `dealId: "d1", leadId: "l1"`: `note_edited` on `SalesDeal` d1; a note on another rep's lead (see-own actor): 404 `"Note not found."`; a lead note whose lead is CONVERTED or ARCHIVED: 409 with that lead's message, nothing written; `addLeadNote` on a hidden lead: 404 `"Lead not found."`, no note and no row.
- Plan 2 cases that change: the lookup assertion at `:266-270` becomes the two-branch `OR` shape (as in `activities.test.ts`); in the 404 table, "a note on a lead, not a deal" (`:276`) becomes a note on another rep's lead (still 404); the fake `salesNote.findFirst` (`:63-69`) is rewritten to evaluate both `OR` branches and return `deal` or `lead` (`{ ownerId, status }`) with the row.

`api-client.test.ts` additions (fetch mocked): `createActivityFor({ kind: "lead", id: "l 1" }, body)` POSTs to `/api/sales/leads/l%201/activities`; `{ kind: "deal", id: "d1" }` to `/api/sales/deals/d1/activities`; `addNoteFor` likewise to `/notes`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/activities.test.ts tests/lib/sales/notes.test.ts tests/lib/sales/api-client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Keep the RACED retry in `setActivityDone` and `editNote`. A lead activity or note is reached through its lead only while `dealId` is null (Decision 10), and its lead's status is checked after the lookup (not OPEN: 409). `deal-panel.tsx` passes `{ kind: "deal", id: deal.id, title: deal.title }` where it passed the deal; `use-activity-done.tsx` prompts when `needsNextStepPrompt(result.data.parent)`.

- [ ] **Step 4: Run to verify they pass**

Run: the Step 2 command plus `npx vitest run tests/lib/sales/next-steps-render.test.ts tests/lib/sales/deal-panel-render.test.ts`
Expected: PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/activities.ts src/lib/sales/notes.ts "src/app/api/sales/leads/[leadId]/activities/route.ts" "src/app/api/sales/leads/[leadId]/notes/route.ts" src/lib/sales/api-client.ts src/components/sales/use-activity-done.tsx src/components/sales/next-step-dialog.tsx src/components/sales/deal-panel.tsx src/components/sales/activities-view.tsx tests/lib/sales/activities.test.ts tests/lib/sales/notes.test.ts tests/lib/sales/api-client.test.ts
git commit -m "feat(sales): activities and notes on leads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Lead activities on the Activities page, in the due count and in the stalled rule

**Files:**
- Modify: `src/lib/sales/activities-page.ts` (~l.19-30 `ActivityRow`, ~l.42-51 `ROW_SELECT`, ~l.64-88 `activitiesWhere`), `src/lib/sales/nav.ts:32-40` (`salesDueCountWhere`), `src/lib/sales/rules.ts:63` (`isStalled`), `src/lib/sales/panel-url.ts` (add `panelHref`, `activePanel`), `src/components/sales/activities-view.tsx` (type-forced only, Decision 2: `row.parent` replaces `row.deal`, links come from `panelHref`, a tick passes the parent; lead rows reuse the existing row markup, with no new heading, pill or copy before Task 16)
- Test: modify `tests/lib/sales/activities-page.test.ts`, `tests/lib/sales/nav.test.ts`, `tests/lib/sales/rules.test.ts`, `tests/lib/sales/panel-url.test.ts`, `tests/lib/sales/activities-view-render.test.ts`, `tests/lib/sales/scroll-containment-render.test.ts` (fixtures)

**Interfaces:**
- Consumes: Task 6's `SalesParentRef` and `useActivityDone` with a parent.
- Produces (`activities-page.ts`): `ActivityRow.parent: { kind: "deal" | "lead"; id: string; title: string; ownerId: string }` (replaces `deal`); `activityParentWhere(actor: SalesActor, done: boolean): Prisma.SalesActivityWhereInput` = `{ OR: [{ dealId: { not: null }, deal: { archivedAt: null, ...(done ? {} : { status: "OPEN" }), ...dealOwnerWhere(actor, "everyone") } }, { dealId: null, leadId: { not: null }, lead: { archivedAt: null, ...(done ? {} : { status: "OPEN" }), ...dealOwnerWhere(actor, "everyone") } }] }` (Task 13 reuses it).
- Produces (`nav.ts`): `salesDueCountWhere(userId, now)` = `{ ownerId, doneAt: null, archivedAt: null, dueAt: { lte: endOfDay(dateInputValue(now)) }, OR: [{ dealId: { not: null }, deal: { status: "OPEN", archivedAt: null } }, { dealId: null, leadId: { not: null }, lead: { status: "OPEN", archivedAt: null } }] }`.
- Produces (`rules.ts`): `isStalled(openActivityCount: number, status: "OPEN" | "WON" | "LOST" | "CONVERTED" | "ARCHIVED"): boolean`.
- Produces (`panel-url.ts`): `type PanelTarget = { kind: "deal" | "lead" | "person" | "organization"; id: string }`, `panelHref(pathname: string, search: string, target: PanelTarget | null): string` (drops `deal`, `lead`, `person`, `organization` and `compose`, keeps every other param in order, then sets the target's; no `?` when nothing is left), `activePanel(search: URLSearchParams): PanelTarget | null` (deal, then lead, person, organization).

- [ ] **Step 1: Write the failing tests**

`activities-page.test.ts` (replacing the deal-only expectations):
- "lists deal and lead activities the person may see": `activitiesWhere` for see-own "r", `when: "open"`: `{ doneAt: null, archivedAt: null, OR: [{ dealId: { not: null }, deal: { archivedAt: null, status: "OPEN", ownerId: "r" } }, { dealId: null, leadId: { not: null }, lead: { archivedAt: null, status: "OPEN", ownerId: "r" } }] }` (no top-level `dealId` or `deal`); `when: "done"` drops `status` in both branches and uses `doneAt: { not: null }`; `scope: "mine"` adds top-level `ownerId: "r"`; `when: "overdue"` adds `dueAt: { lt: startOfDay("2026-11-05") }`.
- "an activity that moved to a deal never matches through its lead" (Review Focus 1): the lead branch of `activityParentWhere(actor, false)`, of `activityParentWhere(actor, true)` and of `salesDueCountWhere("r", now)` each contains `dealId: null`.
- "a lead row names its lead": a canned row `{ ..., deal: null, lead: { id: "l1", title: "Crestview Dental", ownerId: "r" } }` becomes `parent: { kind: "lead", id: "l1", title: "Crestview Dental", ownerId: "r" }`; a deal row becomes `kind: "deal"`; the select includes `lead: { select: { id: true, title: true, ownerId: true } }`.

`nav.test.ts`: the `salesDueCountWhere` case expects the `OR` shape above (11:30 PM Eastern still counts to the end of Nov 5).

`rules.test.ts`: `isStalled(0, "OPEN")` true; `(1, "OPEN")` false; `(0, "CONVERTED")`, `(0, "ARCHIVED")`, `(0, "WON")` false.

`panel-url.test.ts`:
- `panelHref("/sales/activities", "when=today&deal=d1&compose=activity", { kind: "lead", id: "l1" })` is `"/sales/activities?when=today&lead=l1"`; with `null` it is `"/sales/activities?when=today"`; `panelHref("/sales/leads", "", null)` is `"/sales/leads"`.
- `activePanel(new URLSearchParams("lead=l1&deal=d1"))` is `{ kind: "deal", id: "d1" }`; `"person=p1&organization=o1"` gives `{ kind: "person", id: "p1" }`; `""` gives `null`.

`activities-view-render.test.ts` (its `useSearchParams` mock is `when=overdue`, `:17`): a lead row's title link has `href="/sales/activities?when=overdue&amp;lead=l1"` and `data-lead-id="l1"`; a deal row keeps `href="/sales/activities?when=overdue&amp;deal=d1"` (`:109`); the fixtures' `deal:` becomes `parent: { kind: "deal", ... }`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/activities-page.test.ts tests/lib/sales/nav.test.ts tests/lib/sales/rules.test.ts tests/lib/sales/panel-url.test.ts tests/lib/sales/activities-view-render.test.ts tests/lib/sales/scroll-containment-render.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `activities-view.tsx` every row link comes from `panelHref` (a deal or lead target) and a tick calls `markDone(activity, { kind, id, title })`. A lead row opens `?lead=`; the lead panel arrives in Task 21, so until then the URL changes and nothing opens (intended; nothing ships before Task 28).

- [ ] **Step 4: Run to verify they pass** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/activities-page.ts src/lib/sales/nav.ts src/lib/sales/rules.ts src/lib/sales/panel-url.ts src/components/sales/activities-view.tsx tests/lib/sales/activities-page.test.ts tests/lib/sales/nav.test.ts tests/lib/sales/rules.test.ts tests/lib/sales/panel-url.test.ts tests/lib/sales/activities-view-render.test.ts tests/lib/sales/scroll-containment-render.test.ts
git commit -m "feat(sales): lead activities on Activities, in the due count and the stalled rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Convert a lead to a deal (one or many)

**Files:**
- Create: `src/lib/sales/lead-convert.ts`
- Modify: `src/lib/sales/deal-audit.ts` (`created` gains optional `fromLeadId`, `movedActivityIds`, `movedNoteIds`), `src/lib/sales/timeline.ts` ("Converted from lead" line; a converted deal's History also reads its lead's rows), `src/lib/sales/deals.ts` (export its money schema as `moneySchema`), `src/lib/sales/constants.ts` (`BULK_CONVERT_MAX = 25`, `CONVERT_FIRST_CALL_SUBJECT = "First call after conversion"`)
- Create: `src/app/api/sales/leads/[leadId]/convert/route.ts` (POST), `src/app/api/sales/leads/convert/route.ts` (GET targets, POST bulk)
- Test: `tests/lib/sales/lead-convert.test.ts`; modify `tests/lib/sales/timeline.test.ts`

**Interfaces:**
- Consumes: Task 2's `checkContactRefs`, `createContacts`, `contactRefSchema`; Task 3's `findLeadForEdit`, `recordLeadAudit`, `LEAD_ARCHIVED`; `recordDealAudit`; `checkStageMove`; `isBoardPipeline`; `SALES_MEMBER_WHERE`.
- Produces: `convertLeadSchema` (strictObject `{ pipelineId: string(1..64); stageId: string(1..64); organization: contactRefSchema.optional(); person: contactRefSchema.optional(); valueCents?: money; mrrCents?: money }`), `bulkConvertSchema` (strictObject `{ ids: 1..25 deduped, each string(1..64); pipelineId: string(1..64); stageId: string(1..64) }`; an id over 64 characters gives `"Invalid input."`), exported types `ConvertLeadInput` and `BulkConvertInput` (`z.infer` of each), `type ConvertTarget = { id: string; key: string; name: string; stages: { id: string; name: string; requiresValue: boolean }[] }`, `loadConvertTargets(db = prisma): Promise<ConvertTarget[]>` (Sales and Consulting pipelines by position; their stages by position that are not won, lost, No Show or archived), `convertLead(actor, leadId, input, meta, now): Promise<{ ok: true; deal: { id: string; pipelineKey: string; pipelineName: string } } | SalesFail>`, `convertLeads(actor, input, meta, now): Promise<{ ok: true; results: ({ id: string; ok: true; dealId: string } | { id: string; ok: false; error: string })[]; pipeline: { key: string; name: string } } | SalesFail>`.
- Produces (routes): `POST /api/sales/leads/[leadId]/convert` (`{ deal }`), `GET /api/sales/leads/convert` (`{ targets }`), `POST /api/sales/leads/convert` (`{ results, pipeline }`).
- Messages (pinned): `"This lead was already converted."` (409), `"Pick a stage from the list."` (400), `"Pick a stage that does not need a value."` (400, bulk), `"Convert up to 25 leads at a time."` (400), `"The lead's owner no longer has Sales access. Give the lead to someone else first."` (400); reused: `"Pick a pipeline."`, `"Deals can't be added to a delivery pipeline yet."`, `"Add a person or an organization."`, and the rules.ts 422 message with code `PROPOSAL_NEEDS_VALUE`.

- [ ] **Step 1: Write the failing tests** `lead-convert.test.ts` (lead l1 OPEN, owner "r", title "Crestview Dental", source "Referral", person p1, organization o1; pipeline pm1 "Direct Mail" (key `direct-mail`) with s1 "New Opt-In" (position 1), s3 No Show (`isNoShow`), s5 Proposal Sent (`requiresValue`), s7 Contract Signed (`isWon`), s9 Deal Lost Nurture (`isLost`); `now = 2026-11-05T15:00Z`)
- "converts with everything moving to the deal": `{ pipelineId: "pm1", stageId: "s1" }`: `salesLead.updateMany({ where: { id: "l1", status: "OPEN", archivedAt: null, ownerId: "r" }, data: { status: "CONVERTED" } })` as the first write; deal `data` `{ title: "Crestview Dental", pipelineId: "pm1", stageId: "s1", ownerId: "r", organizationId: "o1", personId: "p1", valueCents: 0, mrrCents: 0, source: "Referral", stageEnteredAt: now }`; `salesLead.update({ where: { id: "l1" }, data: { convertedDealId: <deal> } })`; open activity a1 found with `where: { leadId: "l1", dealId: null, doneAt: null, archivedAt: null }` and moved by `updateMany({ where: { id: { in: ["a1"] } }, data: { dealId: <deal> } })`; notes n1, n2 found with `where: { leadId: "l1", dealId: null, archivedAt: null }` and moved the same way; no new activity; rows in order `{ entityType: "SalesDeal", action: "created", after: { title: "Crestview Dental", pipelineId: "pm1", stageId: "s1", stageName: "New Opt-In", ownerId: "r", valueCents: 0, mrrCents: 0, organizationId: "o1", personId: "p1", source: "Referral", fromLeadId: "l1", movedActivityIds: ["a1"], movedNoteIds: ["n1", "n2"] } }`, `{ entityType: "SalesLead", entityId: "l1", action: "converted", after: { dealId: <deal> } }`; returns `{ ok: true, deal: { id: <deal>, pipelineKey: "direct-mail", pipelineName: "Direct Mail" } }`.
- "adds the first call when nothing moves": with no open activity, creates `{ type: "CALL", subject: "First call after conversion", dueAt: endOfDay("2026-11-05"), hasTime: false, ownerId: "r", dealId: <deal>, personId: "p1", createdBy: <actor id> }` and an `activity_added` row on the deal right after `created`.
- "converts once when clicked twice": the guarded write matches nothing and the re-read shows CONVERTED: 409 `"This lead was already converted."`, no deal created; with `person: { name: "Laura B." }` on a lead with no contacts, the same miss also leaves `salesPerson.create` and `salesAuditLog.create` uncalled; `salesLead.update` rejecting with a Prisma `P2002` error: 409 with the same message (not a 500).
- "a lead given away while it converts is refused": owner "r" converts; the guarded write misses and the re-read shows owner "z": non-admin "r" gets 403 `"Only the lead owner or an admin can change this lead."`, no deal and no row.
- "refuses before writing anything": `person: { name: "Laura B." }` on a lead with no contacts and stage s5 with no values: 422 `PROPOSAL_NEEDS_VALUE`; `salesLead.updateMany`, `salesPerson.create` and `salesAuditLog.create` never called.
- "never lands on a won, lost or No Show stage": s3, s7, s9 and a stage of another pipeline: 400 `"Pick a stage from the list."`; a Delivery pipeline: 400 `"Deals can't be added to a delivery pipeline yet."`.
- "asks for both values at Proposal Sent": s5 with only `valueCents: 1440000`: 422 `{ code: "PROPOSAL_NEEDS_VALUE", error: "Add the total value and monthly value before moving to Proposal Sent." }`, nothing written; with `mrrCents: 120000` too, the deal has both.
- "needs a person or an organization": a lead with neither and no input: 400 `"Add a person or an organization."`; with `person: { name: "Laura B." }`: a person owned by "r" is created and set on the deal.
- "refuses archived leads, departed owners and other people's leads": ARCHIVED: 409 `"This lead is archived. Restore it first."`; owner without Sales access: 400 `"The lead's owner no longer has Sales access. Give the lead to someone else first."`; seesAll non-owner: 403; hidden: 404.
- "converts many, one transaction each": 26 ids: 400 `"Convert up to 25 leads at a time."`; a 65-character id or `stageId`: 400 `"Invalid input."` and nothing read; s5: 400 `"Pick a stage that does not need a value."`; `["l1", "l2" (no contacts), "l3" (owner b; actor non-admin "r")]`: results `[{ id: "l1", ok: true, dealId: <deal> }, { id: "l2", ok: false, error: "Add a person or an organization." }, { id: "l3", ok: false, error: "Only the lead owner or an admin can change this lead." }]`, `pipeline: { key: "direct-mail", name: "Direct Mail" }`, three `$transaction` calls.
- "lists where a lead can go": `loadConvertTargets` returns pm1 with stages that include `{ id: "s1", name: "New Opt-In", requiresValue: false }` and `{ id: "s5", name: "Proposal Sent", requiresValue: true }` and exclude s3, s7, s9.

`timeline.test.ts` additions:
- `created` with `after.fromLeadId` and `source: "Referral"`: "Converted from lead (Referral)" (icon `converted`); without a source: "Converted from a lead".
- "a converted deal's History includes its lead's": `loadDealTimeline` for a deal whose lookup returns `convertedFromLead: { id: "l1" }` queries `where: { AND: [{ OR: [{ entityType: "SalesDeal", entityId: "d1" }, { entityType: "SalesLead", entityId: "l1" }] }] }` on the first page; a deal without one keeps `where: { entityType: "SalesDeal", entityId: "d1" }`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/lead-convert.test.ts tests/lib/sales/timeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Order inside the transaction, every refusal before the first write: `findLeadForEdit`; status checks; the owner still a Sales member; pipeline and stage; contacts (the lead's own, else `checkContactRefs` on the input and the at-least-one check); `checkStageMove` (pure, on the input values); then the guarded status write with the read owner in `where` (the first write; a miss re-reads through `findLeadForEdit` and answers its refusal, or retries once, then 409); then `createContacts` (owned by the lead owner); deal; `convertedDealId`; moves; first call; history. `convertLeads` checks pipeline and stage once, then calls `convertLead` per id.

- [ ] **Step 4: Run to verify they pass**

Run: the Step 2 command plus `npx vitest run tests/lib/sales/deal-read-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/lead-convert.ts src/lib/sales/deal-audit.ts src/lib/sales/timeline.ts src/lib/sales/deals.ts src/lib/sales/constants.ts "src/app/api/sales/leads/[leadId]/convert/route.ts" src/app/api/sales/leads/convert/route.ts tests/lib/sales/lead-convert.test.ts tests/lib/sales/timeline.test.ts
git commit -m "feat(sales): convert leads to deals, one or many at a time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Contacts list, contact panel data, duplicates and contact history

**Files:**
- Create: `src/lib/sales/contacts-query.ts` (client-safe), `src/lib/sales/contacts-page.ts`, `src/lib/sales/duplicates.ts`, `src/lib/sales/contact-panel.ts`
- Modify: `src/lib/sales/timeline.ts` (contact wording, `loadContactTimeline`), `src/lib/sales/constants.ts` (`CONTACTS_PAGE_SIZE = 50`, `DUPLICATE_MATCHES_MAX = 5`, `CONTACT_LINKED_ROWS = 20`)
- Create: `src/app/api/sales/contacts/[kind]/route.ts` (GET here), `src/app/api/sales/contacts/[kind]/[contactId]/route.ts` (GET here), `src/app/api/sales/contacts/[kind]/[contactId]/timeline/route.ts` (GET). The Plan 2 picker `src/app/api/sales/contacts/route.ts` stays as it is.
- Test: `tests/lib/sales/contacts-page.test.ts`, `tests/lib/sales/duplicates.test.ts`, `tests/lib/sales/contact-panel.test.ts`; modify `tests/lib/sales/timeline.test.ts`

**Interfaces:**
- Consumes: Task 2's `visiblePersonWhere`, `visibleOrganizationWhere`, `canEditContact`, `CONTACT_NOT_FOUND`; `dealOwnerWhere`, `canDeleteSalesRecords`; `loadSalesMembers`; Task 3's private timeline page loader.
- Produces (`contacts-query.ts`): `type ContactKind = "person" | "organization"`, `CONTACT_PATHS: Record<ContactKind, "people" | "organizations">`, `contactKindFromPath(segment: string): ContactKind | null`, `type ContactsQuery = { tab: "people" | "organizations"; scope: "everyone" | "mine"; q: string; cursor: string | null }`, `parseContactsQuery(params): ContactsQuery`, `contactsQueryToSearch(query): string` (keys tab (only when "organizations"), scope, q; never the cursor).
- Produces (`contacts-page.ts`): `type PersonRow = { kind: "person"; id: string; name: string; organizationName: string | null; openDeals: number; ownerId: string }`, `type OrganizationRow = { kind: "organization"; id: string; name: string; contactName: string | null; openDeals: number; ownerId: string }`, `type ContactRow = PersonRow | OrganizationRow`, `type ContactRowsPage = { rows: ContactRow[]; nextCursor: string | null }`, `type ContactsPageData = { query: ContactsQuery; rows: ContactRow[]; nextCursor: string | null; members: SalesMemberOption[]; canSeeEveryone: boolean }`, `loadContactRows(actor, query, db = prisma): Promise<ContactRowsPage>`, `loadContactsPage(actor, query, db = prisma): Promise<ContactsPageData>`.
- Produces (`duplicates.ts`): `type DuplicateInfo = { matches: { id: string; name: string }[]; hiddenMatch: boolean }`, `findPersonDuplicates(db, actor, person: { id: string; emailKey: string | null; phoneKey: string | null; nameKey: string | null; organizationId: string | null }): Promise<DuplicateInfo>`, `findOrganizationDuplicates(db, actor, org: { id: string; nameKey: string | null; zip: string | null }): Promise<DuplicateInfo>`.
- Produces (`contact-panel.ts`): `type ContactLinkedDeal = { id: string; title: string; status: "OPEN" | "WON" | "LOST"; stageName: string; valueCents: number }`, `type ContactLinkedLead = { id: string; title: string; status: "OPEN" | "CONVERTED" | "ARCHIVED" }`, `type PersonPanelData = { kind: "person"; person: { id: string; name: string; email: string | null; phone: string | null; role: string | null; organization: { id: string; name: string; visible: boolean } | null; owner: SalesMemberOption; createdAt: string }; deals: ContactLinkedDeal[]; leads: ContactLinkedLead[]; counts: { deals: number; leads: number }; duplicates: DuplicateInfo; canEdit: boolean; canMerge: boolean; redirectedFrom: string | null }`, `type OrganizationPanelData = { kind: "organization"; organization: { id: string; name: string; phone: string | null; website: string | null; address: string | null; zip: string | null; owner: SalesMemberOption; createdAt: string }; people: { id: string; name: string }[]; deals: ContactLinkedDeal[]; leads: ContactLinkedLead[]; counts: { people: number; deals: number; leads: number }; duplicates: DuplicateInfo; canEdit: boolean; canMerge: boolean; redirectedFrom: string | null }` (each count is a `count` with the same `where` as its list, run in the same `Promise.all`; `organization.visible` says whether the viewer may open that organization), `type ContactPanelData = PersonPanelData | OrganizationPanelData`, `loadContactPanel(actor, kind: ContactKind, id: string, db = prisma): Promise<ContactPanelData | null>`.
- Produces (`timeline.ts`): `loadContactTimeline(actor, kind: ContactKind, id: string, cursor: TimelineCursor | null, db = prisma)` (same return as `loadLeadTimeline`).
- Produces (routes): `GET /api/sales/contacts/[kind]?scope=&q=&cursor=` (`ContactRowsPage`; `kind` is `people` or `organizations`, anything else 400 `"Invalid input."`), `GET /api/sales/contacts/[kind]/[contactId]` (`ContactPanelData` or 404 `{ error: "Contact not found." }`), `GET /api/sales/contacts/[kind]/[contactId]/timeline?at=&id=`.

- [ ] **Step 1: Write the failing tests** (see-own actor "r" unless stated)

`contacts-page.test.ts`:
- "parses the Contacts URL": `parseContactsQuery({})` is `{ tab: "people", scope: "everyone", q: "", cursor: null }`; `{ tab: "organizations", scope: "mine", q: " oak " }` gives those values with q "oak"; `{ tab: "deals" }` gives tab "people"; `contactsQueryToSearch({ tab: "organizations", scope: "mine", q: "oak", cursor: "x" })` is `"tab=organizations&scope=mine&q=oak"`; the defaults give `""`; `contactKindFromPath("people")` is `"person"`, `"organizations"` is `"organization"`, `"deals"` is `null`.
- "lists people the person may see, never their email or phone": `salesPerson.findMany` with `where` = `visiblePersonWhere(actor, "everyone")`, `orderBy: [{ name: "asc" }, { id: "asc" }]`, `take: 51`; `JSON.stringify(select)` contains neither `"email"` nor `"phone"`; the open-deal count is `_count: { select: { deals: { where: { status: "OPEN", archivedAt: null, ownerId: "r" } } } }` (no `ownerId` for an admin); a row maps to `{ kind: "person", id: "p1", name: "Sarah K.", organizationName: "Oak Creek Dental", openDeals: 2, ownerId: "r" }`.
- "searches by name without loosening who is visible": people `q: "oak"`: `where: { AND: [<visiblePersonWhere>, { OR: [{ name: { contains: "oak", mode: "insensitive" } }, { organization: { name: { contains: "oak", mode: "insensitive" } } }] }] }`; organizations: `where: { AND: [<visibleOrganizationWhere>, { name: { contains: "oak", mode: "insensitive" } }] }`.
- "lists organizations with owner-filtered counts": the organizations select's open-deal count is `_count: { select: { deals: { where: { status: "OPEN", archivedAt: null, ownerId: "r" } } } }` (no `ownerId` for an admin), and `JSON.stringify(select)` contains neither `"email"` nor `"phone"`.
- "names an organization's first visible person": the organizations select includes `people: { where: <visiblePersonWhere(actor, "everyone")>, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1, select: { name: true } }`, giving `contactName: "Sarah K."` or `null`.
- "Just me means contacts I own": scope "mine" gives `where: { archivedAt: null, ownerId: "r" }` (an admin: their own id).
- "pages by 50": 51 rows give 50 and `nextCursor` = the 50th id; `cursor: "p50"` adds `cursor: { id: "p50" }, skip: 1`.
- Route: `GET /api/sales/contacts/people?q=oak` gives 200 `{ rows, nextCursor }`; `GET /api/sales/contacts/deals` gives 400 `{ error: "Invalid input." }`; without Sales access 403.

`duplicates.test.ts`:
- "finds people with the same email, phone, or name in the same practice": person `{ id: "p1", emailKey: "sarah@oak.example", phoneKey: "5125550142", nameKey: "sarahk", organizationId: "o1" }`; the match `where` is `{ id: { not: "p1" }, archivedAt: null, OR: [{ emailKey: "sarah@oak.example" }, { phoneKey: "5125550142" }, { nameKey: "sarahk", organizationId: "o1" }] }`; the matches come from one query `salesPerson.findMany({ where: { AND: [<match where>, visiblePersonWhere(actor, "everyone")] }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 5 })`.
- "leaves out keys it does not have": with `organizationId: null` the name branch is left out; with every key null and no organization no query runs and the result is `{ matches: [], hiddenMatch: false }`.
- "hides other reps' matches behind a plain line, exactly": for the see-own actor `hiddenMatch` comes from `salesPerson.findFirst({ where: { AND: [<match where>, { NOT: visiblePersonWhere(actor, "everyone") }] }, select: { id: true } })`: a row gives `hiddenMatch: true`, null gives `false`, however many visible matches there are; for an admin or a seesAll actor that query never runs and `hiddenMatch` is `false`. The same for organizations.
- "matches practices by name, and by ZIP when both have one": `{ id: "o1", nameKey: "oakcreekdental", zip: "78704" }` gives the match `where` `{ id: { not: "o1" }, archivedAt: null, nameKey: "oakcreekdental", OR: [{ zip: null }, { zip: "78704" }] }`; `zip: null` drops the `OR`; `nameKey: null` runs no query.

`contact-panel.test.ts`:
- "shows a person with the deals and leads the viewer may see": `salesPerson.findFirst` with `where: { id: "p1", ...visiblePersonWhere(actor, "everyone") }`; deals `salesDeal.findMany({ where: { personId: "p1", archivedAt: null, ownerId: "r" }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 20, select: { id: true, title: true, status: true, valueCents: true, stage: { select: { name: true } } } })`; leads `salesLead.findMany({ where: { personId: "p1", archivedAt: null, ownerId: "r" }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 20 })`; the person carries `email`, `phone` and `role`.
- "an organization lists its visible people": `salesPerson.findMany({ where: { organizationId: "o1", ...visiblePersonWhere(actor, "everyone") }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 20, select: { id: true, name: true } })`.
- "counts what the lists would show, past the first 20": `counts` come from `salesPerson.count`, `salesDeal.count` and `salesLead.count` with exactly the `where` of their lists (35 visible people give `counts.people: 35` while `people` holds 20).
- "a person's hidden organization is not a link": p1 (owned by "r") with o5 owned by "b" and no deal or lead of r's on it: the organization lookup with `visibleOrganizationWhere(actor, "everyone")` finds nothing, so `person.organization` is `{ id: "o5", name: "Bright Smile Dental", visible: false }`; a visible one has `visible: true`.
- "the owner or an admin edits; only an admin merges": owner "r": `canEdit: true, canMerge: false`; owner "b" seen by seesAll "r": `canEdit: false`; signed-in admin: `canEdit: true, canMerge: true`.
- "an old link to a merged contact opens the kept one" (Review Focus 5): the visible lookup for "p2" returns null; `salesPerson.findFirst({ where: { id: "p2", mergedIntoId: { not: null } }, select: { mergedIntoId: true } })` returns `"p1"`; p1 is visible: the panel for p1 with `redirectedFrom: "p2"`; p1 hidden: `null`; p2 not merged: `null`; only one hop is followed.

`timeline.test.ts` additions:
- "words contact history": `created` on `SalesPerson` "Person added", on `SalesOrganization` "Organization added" (icon `created`); `updated` with `after: { name: "Sarah Example" }` "Renamed to Sarah Example"; with `after: { email: "x", phone: "y" }` "Details updated: email, phone"; with `after: { zip: "78704", website: "https://oak.example/" }` "Details updated: website, ZIP" (order: email, phone, role, organization, website, address, ZIP); `merged` on `SalesPerson` with `after: { droppedId: "p2", dropped: { name: "Sarah Example" } }` "Merged Sarah Example into this person", on `SalesOrganization` "... into this organization" (icon `merged`); `merged_into` with `after: { keptId: "p1", keptName: "Sarah K." }` "Merged into Sarah K." (icon `merged`); an unknown action "Contact updated".
- "loads a contact's history with the contacts merged into it": after the visibility lookup, `salesPerson.findMany({ where: { mergedIntoId: "p1" }, select: { id: true } })` returns `[{ id: "p2" }]` and the history `where` is `{ AND: [{ OR: [{ entityType: "SalesPerson", entityId: "p1" }, { entityType: "SalesPerson", entityId: "p2" }] }] }`; with none merged it is `{ entityType: "SalesPerson", entityId: "p1" }`; hidden: `null`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/contacts-page.test.ts tests/lib/sales/duplicates.test.ts tests/lib/sales/contact-panel.test.ts tests/lib/sales/timeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** `loadContactPanel` runs the details, deals, leads (and people) and duplicate lookups in one `Promise.all` after the visibility read. The panel route maps `[kind]` through `contactKindFromPath`.

- [ ] **Step 4: Run to verify they pass** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/contacts-query.ts src/lib/sales/contacts-page.ts src/lib/sales/duplicates.ts src/lib/sales/contact-panel.ts src/lib/sales/timeline.ts src/lib/sales/constants.ts "src/app/api/sales/contacts/[kind]/route.ts" "src/app/api/sales/contacts/[kind]/[contactId]/route.ts" "src/app/api/sales/contacts/[kind]/[contactId]/timeline/route.ts" tests/lib/sales/contacts-page.test.ts tests/lib/sales/duplicates.test.ts tests/lib/sales/contact-panel.test.ts tests/lib/sales/timeline.test.ts
git commit -m "feat(sales): contacts list, contact panel data, duplicates and history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Add and edit contacts; change a deal's person and organization

**Files:**
- Create: `src/lib/sales/contact-links.ts` (client-safe, pure), `src/lib/sales/contacts-edit.ts`
- Modify: `src/app/api/sales/contacts/[kind]/route.ts` (add POST), `src/app/api/sales/contacts/[kind]/[contactId]/route.ts` (add PATCH), `src/lib/sales/deals.ts` (~l.77-91 `updateDealSchema` gains `organization` and `person`; `updateDeal` ~l.249-336 writes `contact_changed`)
- Test: `tests/lib/sales/contact-links.test.ts`, `tests/lib/sales/contacts-edit.test.ts`; modify `tests/lib/sales/deals.test.ts`

**Interfaces:**
- Consumes: Task 2's `checkContactRefs`, `createContacts`, `contactRefSchema`, `personKeys`, `organizationKeys`, `canEditContact`, visibility helpers, `CONTACT_NOT_FOUND`, `NOT_YOUR_CONTACT`; Task 3's `ContactChange`; Task 9's `ContactKind`, `contactKindFromPath`; `auditDiff`.
- Produces (`contact-links.ts`): `normalizeWebsite(input: string): string | null` (trimmed; no `://` gets `https://` in front; must parse with `new URL`, protocol `http:` or `https:`, host containing a dot; returns `url.href`), `safeWebHref(stored: string | null): string | null` (same parse and protocol check, no prefixing), `mailtoHref(email: string | null): string | null` (`/^[^\s@?#]+@[^\s@?#]+\.[^\s@?#]+$/`, else null), `telHref(phone: string | null): string | null` (a leading `+` and digits; fewer than 7 digits null).
- Produces (`contacts-edit.ts`): `createPersonSchema` (strictObject `{ name: trimmed 1..200; email?: email max 254 | null; phone?: trimmed max 40 | null; role?: trimmed max 100 | null; organization: contactRefSchema.optional() }`), `updatePersonSchema` (the same keys, all optional, at least one; `organization: contactRefSchema.optional()`, so a key left out stays out and `organization: null` removes it), `createOrganizationSchema` (strictObject `{ name; phone?; website?; address?: trimmed max 500 | null; zip?: /^\d{5}(-\d{4})?$/ | null }`; website through `normalizeWebsite`), `updateOrganizationSchema`, `createPerson(actor, input, meta)`, `createOrganization(actor, input, meta)`: `Promise<{ ok: true; contact: { id: string; name: string } } | SalesFail>`; `updatePerson(actor, personId, input, meta)`, `updateOrganization(actor, organizationId, input, meta)`: `Promise<{ ok: true; changed: boolean; contact: { id: string; name: string } } | SalesFail>`; exported types `CreatePersonInput`, `UpdatePersonInput`, `CreateOrganizationInput`, `UpdateOrganizationInput` (each `z.infer` of its schema, as `CreateDealInput` is). New contacts belong to the actor; keys are recomputed on every write; edits are guarded writes on `updatedAt`. Order: lookup, edit right, `checkContactRefs`, then (when a new organization is named) `createContacts`, then the guarded person write; because that write can come after a create, its miss throws a private `ContactRaced` error (rollback) and the service retries once in a new transaction, then answers 409.
- Produces (`deals.ts`): `updateDealSchema` accepts `organization: contactRefSchema.optional()` and `person: contactRefSchema.optional()` (null removes; left out stays as is); a deal keeps at least one; `updateDeal` runs `checkContactRefs` with its other checks and `createContacts` only after its last refusal (`updateDeal` has no guarded write); new contacts belong to the deal owner; one `contact_changed` row with names before and after.
- Produces (routes): `POST /api/sales/contacts/[kind]` (201 `{ contact }`), `PATCH /api/sales/contacts/[kind]/[contactId]` (`{ changed, contact }`).
- Messages (pinned): `"Add a name."`, `"Keep the name under 200 characters."`, `"Enter a real email address."`, `"Keep the phone number under 40 characters."`, `"Keep the role under 100 characters."`, `"Keep the address under 500 characters."`, `"Enter a web address like https://example.com."`, `"Enter a 5-digit ZIP code."` (400), `"This contact just changed. Refresh and try again."` (409).

- [ ] **Step 1: Write the failing tests**

`contact-links.test.ts`:
- `normalizeWebsite("oakcreekdental.com")` is `"https://oakcreekdental.com/"`; `"http://oak.example/path"` stays `"http://oak.example/path"`; `"javascript:alert(1)"`, `"ftp://oak.example"`, `""`, `"https://"`, `"oak"` are `null`.
- `safeWebHref("https://oak.example/")` is `"https://oak.example/"`; `safeWebHref("javascript:alert(1)")` and `safeWebHref(null)` are `null`.
- `mailtoHref("sarah@oak.example")` is `"mailto:sarah@oak.example"`; `"not an email"` and `"a@b.example?subject=x"` are `null`.
- `telHref("(512) 555-0142")` is `"tel:5125550142"`; `"+1 512 555 0142"` is `"tel:+15125550142"`; `"abc"` and `"555"` are `null`.

`contacts-edit.test.ts` (see-own actor "r")
- "adds a person with keys and history": `{ name: "Sarah Example", email: " Sarah@Oak.example ", phone: "(512) 555-0142", role: "Office manager", organization: { id: "o1" } }`: create `data` `{ name: "Sarah Example", email: "Sarah@Oak.example", phone: "(512) 555-0142", role: "Office manager", organizationId: "o1", ownerId: "r", nameKey: "sarahexample", emailKey: "sarah@oak.example", phoneKey: "5125550142" }`; row `{ entityType: "SalesPerson", action: "created", after: { name: "Sarah Example", ownerId: "r", organizationId: "o1" } }`; `email: "nope"`: 400 `"Enter a real email address."`; `name: ""`: 400 `"Add a name."`.
- "edits a person with a guarded write": seesAll non-owner: 403 `"Only the contact's owner or an admin can change this contact."`; hidden: 404 `"Contact not found."`; `{ phone: "512 555 0199" }`: `salesPerson.updateMany({ where: { id: "p1", archivedAt: null, mergedIntoId: null, updatedAt: <read> }, data: { phone: "512 555 0199", phoneKey: "5125550199" } })` and `{ action: "updated", before: { phone: "(512) 555-0142" }, after: { phone: "512 555 0199" } }`; the same phone: `changed: false`, no row; two misses: 409 `"This contact just changed. Refresh and try again."`; `{ organization: null }`: `organizationId: null` and `{ action: "updated", before: { organizationId: "o1" }, after: { organizationId: null } }`.
- "a phone-only edit keeps the organization": `{ phone: "512 555 0199" }` on p1 with o1: the guarded write's `data` has no `organizationId` key.
- "a race after a new practice rolls back": `{ organization: { name: "New Practice" } }` with the guarded write missing on both tries: 409, and `$transaction` was called twice (the first try's function rejected, so its organization and history row roll back).
- "a hidden organization is not found": `createPerson` or `updatePerson` with `organization: { id: "o9" }` (hidden): 400 `"That organization was not found."`, nothing written.
- "adds and edits a practice": `{ name: "Oak Creek Dental", website: "oakcreekdental.com", zip: "78704" }`: `website: "https://oakcreekdental.com/"`, `nameKey: "oakcreekdental"`; `website: "javascript:alert(1)"`: 400 `"Enter a web address like https://example.com."`; `zip: "7870"`: 400 `"Enter a 5-digit ZIP code."`; `zip: "78704-1234"` is saved.
- Routes: `POST /api/sales/contacts/people` gives 201 `{ contact: { id, name } }`; `POST /api/sales/contacts/organizations` with a `role` key: 400; `PATCH` with `Origin: https://evil.example`: 403 `"Request blocked."`, nothing written.

`deals.test.ts` additions (d1 has o1 "Oak Creek Dental" and p1 "Sarah K."):
- "changes a deal's person with a readable history row": `{ person: { id: "p2" } }` (p2 "Dana Q.", visible): `personId: "p2"` and `{ action: "contact_changed", before: { organizationId: "o1", organizationName: "Oak Creek Dental", personId: "p1", personName: "Sarah K." }, after: { organizationId: "o1", organizationName: "Oak Creek Dental", personId: "p2", personName: "Dana Q." } }`.
- "a deal keeps a person or an organization": `{ organization: null, person: null }`: 400 `"Add a person or an organization."`; `{ organization: null }` with p1 kept: saved with `organizationId: null`.
- "a new practice belongs to the deal owner": deal owned by "r", admin "z" sends `{ organization: { name: "New Practice" } }`: the organization is created with `ownerId: "r"` and gets its `created` row; a hidden person id: 400 `"That person was not found."`.
- "a title, value or source edit leaves the contacts alone": `{ title: "Oak Creek Dental East" }` and `{ valueCents: 500000 }` each answer 200, the update `data` has no `organizationId` or `personId` key, and no `contact_changed` row is written.
- "refuses before making a contact": `{ organization: { name: "New Practice" }, valueCents: 0 }` on a deal in Proposal Sent: 422, `salesOrganization.create` never called.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/contact-links.test.ts tests/lib/sales/contacts-edit.test.ts tests/lib/sales/deals.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** History `updated` rows use `auditDiff` over `{ name, email, phone, role, organizationId }` (people) or `{ name, phone, website, address, zip }` (organizations); keys never appear in history. Email is stored trimmed with its case kept; only `emailKey` is lower case.

- [ ] **Step 4: Run to verify they pass** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/contact-links.ts src/lib/sales/contacts-edit.ts src/lib/sales/deals.ts "src/app/api/sales/contacts/[kind]/route.ts" "src/app/api/sales/contacts/[kind]/[contactId]/route.ts" tests/lib/sales/contact-links.test.ts tests/lib/sales/contacts-edit.test.ts tests/lib/sales/deals.test.ts
git commit -m "feat(sales): add and edit contacts, change a deal's person and organization

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Merge duplicate contacts (admins)

**Files:**
- Create: `src/lib/sales/contact-merge.ts`, `src/app/api/sales/contacts/[kind]/[contactId]/merge/route.ts` (GET preview, POST merge)
- Modify: `src/lib/sales/constants.ts` (`MERGE_LINKED_MAX = 500`), `src/lib/sales/audit.ts` (add `recordSalesAuditMany`)
- Test: `tests/lib/sales/contact-merge.test.ts`; modify `tests/lib/sales/audit.test.ts`

**Interfaces:**
- Consumes: `canDeleteSalesRecords`; Task 2's `personKeys`, `organizationKeys`, `CONTACT_NOT_FOUND`; Task 3's `ContactChange`; `recordSalesAudit`; Task 9's `ContactKind`.
- Produces (`audit.ts`): `recordSalesAuditMany(tx: Prisma.TransactionClient, actor: SalesActor | SalesSystemActor, entries: SalesAuditEntry[], meta?: Partial<SalesRequestMeta>): Promise<void>`: one `tx.salesAuditLog.createMany({ data })` whose rows are exactly what `recordSalesAudit` would write one by one (same bot-key refusal); no call when `entries` is empty. Inserts pass the append-only triggers.
- Produces: `MERGE_REPOINTS = { person: ["salesActivity.personId", "salesDeal.personId", "salesLead.personId", "salesNote.personId"], organization: ["salesDeal.organizationId", "salesLead.organizationId", "salesNote.organizationId", "salesPerson.organizationId"] } as const`, `type MergeCounts = { people: number; deals: number; leads: number; notes: number; activities: number }`, `mergeBodySchema` (strictObject `{ dropId: string(1..64) }`), `loadMergePreview(actor, kind: ContactKind, keepId, dropId, db = prisma): Promise<{ ok: true; keep: { id: string; name: string }; drop: { id: string; name: string }; counts: MergeCounts } | SalesFail>` (its first line is `if (!canDeleteSalesRecords(actor)) return fail(403, "Only an admin can merge contacts.")`, before any read: the counts span every rep's records), `mergeContacts(actor, kind, keepId, dropId, meta, now): Promise<{ ok: true; kept: { id: string; name: string } } | SalesFail>` (each try is `prisma.$transaction(fn, { timeout: 30_000, maxWait: 5_000 })`: up to 500 repointed rows over the Neon websocket can pass the 5-second default).
- Produces (routes): `GET /api/sales/contacts/[kind]/[contactId]/merge?with=<dropId>` (preview), `POST /api/sales/contacts/[kind]/[contactId]/merge` body `{ dropId }` (`{ kept }`).
- Messages (pinned): `"Only an admin can merge contacts."` (403), `"Pick two different contacts."` (400), `"Contact not found."` (404), `"This merge would move more than 500 records. It is too big to do here."` (400), `"One of these contacts just changed. Refresh and try again."` (409).

- [ ] **Step 1: Write the failing tests** `contact-merge.test.ts` (admin actor `{ userId: "z", isAdmin: true, seesAllDeals: true, via: "user" }`, `now = 2026-11-05T15:00Z`)
- "repoints every link the schema has" (Decision 20: the schema text, since Prisma 7's runtime data model has no `relationFromFields`): read `prisma/schema.prisma`; within each `model X { ... }` block, every line matching `/^\s+\w+\s+SalesPerson\??\s+@relation\((?:(?:name:\s*)?"[^"]*",\s*)?fields:\s*\[(\w+)\]/` gives `` `${lowerFirst(X)}.${field}` ``; the sorted list equals `MERGE_REPOINTS.person` and has at least 4 entries; the same pattern with `SalesOrganization` equals `MERGE_REPOINTS.organization` (at least 4). A self-check runs both patterns on sample lines: `  person SalesPerson? @relation("Referrer", fields: [referrerId], references: [id])` and `  person SalesPerson? @relation(name: "Referrer", fields: [referrerId], references: [id])` each yield `referrerId`.
- "only signed-in admins preview or merge": seesAll non-admin: `mergeContacts` and `loadMergePreview` both answer 403 `"Only an admin can merge contacts."`, and the preview calls no `findFirst` and no `count`; `{ via: "bot", botTokenId: "t1", isAdmin: false, ... }`: 403 for both.
- "refuses a merge that makes no sense": `keepId === dropId`: 400 `"Pick two different contacts."`; either row missing, archived or already merged (lookup `where: { id, archivedAt: null, mergedIntoId: null }` returns null): 404 `"Contact not found."`.
- "refuses a merge too big for one go": counts 300 deals, 150 leads, 60 notes, 0 activities: 400 `"This merge would move more than 500 records. It is too big to do here."`.
- "a big merge writes its history in one go": 300 affected deals: exactly one `salesAuditLog.createMany` holding 300 `contact_changed` rows (plus the affected leads' rows in the same call), and `$transaction` is called with `{ timeout: 30_000, maxWait: 5_000 }`.
- "merges two people, filling blanks and never overwriting": keep p1 `{ name: "Sarah K.", email: null, phone: "(512) 555-0142", role: null, organizationId: null, updatedAt: T }`, drop p2 `{ name: "Sarah Example", email: "sarah@oak.example", phone: null, role: "Owner", organizationId: "o1" }`: `salesPerson.updateMany({ where: { id: "p1", archivedAt: null, mergedIntoId: null, updatedAt: T }, data: { email: "sarah@oak.example", role: "Owner", organizationId: "o1", nameKey: "sarahk", emailKey: "sarah@oak.example", phoneKey: "5125550142" } })`; `salesPerson.updateMany({ where: { id: "p2", archivedAt: null, mergedIntoId: null }, data: { archivedAt: now, mergedIntoId: "p1" } })`; `salesDeal.updateMany({ where: { personId: "p2" }, data: { personId: "p1" } })` and the same on `salesLead`, `salesActivity`, `salesNote`; affected deal d4 (o1 "Oak Creek Dental") gets `{ entityType: "SalesDeal", entityId: "d4", action: "contact_changed", before: { organizationId: "o1", organizationName: "Oak Creek Dental", personId: "p2", personName: "Sarah Example" }, after: { organizationId: "o1", organizationName: "Oak Creek Dental", personId: "p1", personName: "Sarah K.", merged: true } }`, lead l3 the same on `SalesLead`; then `{ entityType: "SalesPerson", entityId: "p1", action: "merged", after: { droppedId: "p2", dropped: { name: "Sarah Example", email: "sarah@oak.example", phone: null, role: "Owner", organizationId: "o1" } } }` and `{ entityType: "SalesPerson", entityId: "p2", action: "merged_into", after: { keptId: "p1", keptName: "Sarah K." } }`.
- "the kept person's practice wins": keep has `organizationId: "o5"`: the kept update's `data` has no `organizationId`.
- "merges two practices": repoints `salesPerson`, `salesDeal`, `salesLead`, `salesNote` by `organizationId`; a blank kept `website` is filled from the dropped one; the kept `nameKey` is recomputed.
- "a race rolls the merge back and answers 409": the dropped row's guarded write matches nothing on both tries: 409 `"One of these contacts just changed. Refresh and try again."`, and `$transaction` was called twice (the first try's function rejected so its writes roll back).
- "previews what will move": person p2: `count` on `salesDeal`, `salesLead`, `salesNote`, `salesActivity` with `where: { personId: "p2" }` (no `archivedAt` filter: every row moves) gives `{ people: 0, deals: 1, leads: 1, notes: 4, activities: 2 }`; an organization also counts `salesPerson.count({ where: { organizationId: "o2" } })`.
- Routes: GET without `with`: 400 `{ error: "Invalid input." }`; a seesAll non-admin GET `/merge?with=p2`: 403 `{ error: "Only an admin can merge contacts." }` and no count query; POST with `Origin: https://evil.example`: 403, nothing written.

`audit.test.ts` addition, "writes many rows at once, the same as one by one": `recordSalesAuditMany(tx, actor, [e1, e2], meta)` calls `createMany` once with the two rows `recordSalesAudit` would write for e1 and e2; `[]` calls nothing; a bot actor without `botTokenId` throws.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/sales/contact-merge.test.ts tests/lib/sales/audit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** One try = read both rows, count, guarded kept write, guarded dropped write, repoints, history. A guarded write that misses after an earlier write in the same try throws a private `MergeRaced` error (rolling the transaction back); `mergeContacts` catches it, runs one more try in a new transaction, then answers 409. Before repointing, collect each affected deal and lead with its other contact's id and name (one `findMany` each, selecting `organization: { select: { id: true, name: true } }` for a person merge or `person: { ... }` for an organization merge), so every `contact_changed` row names both sides; no titles are read. All of those rows go through one `recordSalesAuditMany`.

- [ ] **Step 4: Run to verify it passes** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/contact-merge.ts src/lib/sales/constants.ts src/lib/sales/audit.ts "src/app/api/sales/contacts/[kind]/[contactId]/merge/route.ts" tests/lib/sales/contact-merge.test.ts tests/lib/sales/audit.test.ts
git commit -m "feat(sales): admins merge duplicate people and practices

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Final-version deal files (private store, server-side upload)

**Files:**
- Create: `src/lib/sales/file-rules.ts` (pure, no prisma), `src/lib/sales/files.ts`
- Modify: `src/lib/sales/http.ts:9-15` (`SalesFail.status` adds `413 | 415 | 503`), `src/lib/sales/deal-panel.ts` (defines `PanelFile` next to `PanelActivity`; `DealPanelData.files`), `src/lib/sales/deal-audit.ts` (`file_added`, `file_removed`), `src/lib/sales/timeline.ts` (file lines), `src/lib/sales/constants.ts` (file limits)
- Create: `src/app/api/sales/deals/[dealId]/files/route.ts` (POST), `src/app/api/sales/files/[fileId]/route.ts` (GET download, DELETE remove)
- Test: `tests/lib/sales/file-rules.test.ts`, `tests/lib/sales/files.test.ts`; modify `tests/lib/sales/deal-panel.test.ts`, `tests/lib/sales/timeline.test.ts`, and the typed fixtures the new required field breaks: `tests/lib/sales/deal-panel-header-render.test.ts:48` (`panel()` gains `files: []`), `tests/lib/sales/scroll-containment-render.test.ts:107` (`PANEL` gains `files: []`), `tests/lib/sales/deal-read-routes.test.ts:52-62` (the prisma mock gains `salesFile: { findMany: vi.fn(async () => []) }`, so "returns the panel" still passes)

**Interfaces:**
- Consumes: `findDealForEdit`, `visibleDealWhere`, `dealOwnerWhere`, `canEditDeal`, `NOT_YOUR_DEAL`; `recordDealAudit`; `assertSameOrigin`, `fail`, `failResponse`; `put`, `get`, `del` from `@vercel/blob`; `startOfDay`, `dateInputValue`; `node:crypto` (`createHash`, `randomUUID`).
- Produces (`constants.ts`): `FILE_MAX_BYTES = 4 * 1024 * 1024`, `FORM_OVERHEAD_BYTES = 64 * 1024`, `FILES_PER_DEAL_MAX = 50`, `FILES_PER_PERSON_DAY = 30`, `FILE_BYTES_PER_PERSON_DAY = 100 * 1024 * 1024`, `FILE_NAME_MAX = 200`, `FILE_PATH_PREFIX = "sales-files/"`.
- Produces (`file-rules.ts`): `FILE_TYPES = { pdf: { ext: "pdf", contentType: "application/pdf" }, docx: { ext: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, xlsx: { ext: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, png: { ext: "png", contentType: "image/png" }, jpg: { ext: "jpg", contentType: "image/jpeg" } } as const`, `type FileTypeKey = keyof typeof FILE_TYPES`, `sniffFileType(bytes: Uint8Array): FileTypeKey | null` (PDF starts `%PDF-`; PNG starts `89 50 4E 47 0D 0A 1A 0A`; JPEG starts `FF D8 FF`; a ZIP (`50 4B 03 04`) is DOCX when its bytes contain the ASCII `word/document.xml`, XLSX when they contain `xl/workbook.xml`, and refused when they contain `vbaProject.bin`, `macrosheets/`, `/activeX/` or `embeddings/oleObject`, or neither name), `cleanFileName(raw: string, ext: string): string` (keep what follows the last `/` or `\`; drop `U+0000-U+001F`, `U+007F-U+009F`, `U+202A-U+202E`, `U+2066-U+2069`; collapse spaces; trim; drop leading dots; make it end with `.${ext}` (`.jpg` also accepts `.jpeg`), case-insensitive, appending when it does not; cut the base so the whole is at most 200 characters; empty becomes `file.${ext}`), `contentDisposition(name: string): string` (`attachment; filename="<ASCII copy: every character outside 0x20-0x7E, and every double quote and backslash, becomes _>"; filename*=UTF-8''<encodeURIComponent(name) with ' ( ) * also encoded>`).
- Produces (`deal-panel.ts`, imported by `files.ts`, and by client code with `import type`): `type PanelFile = { id: string; name: string; sizeBytes: number; contentType: string; stageName: string | null; uploadedBy: string; createdAt: string; canRemove: boolean }` (`uploadedBy` a short name).
- Produces (`files.ts`): `uploadDealFile(actor, dealId: string, input: { name: string; bytes: Uint8Array; confirmedFinal: boolean }, meta, now): Promise<{ ok: true; file: PanelFile } | SalesFail>`, `removeDealFile(actor, fileId: string, meta, now): Promise<{ ok: true; changed: boolean } | SalesFail>`, `findFileForDownload(actor, fileId: string, db = prisma): Promise<{ blobPathname: string; name: string; contentType: string; sizeBytes: number } | null>`.
- Produces (`deal-audit.ts`): `{ action: "file_added"; after: { fileId: string; name: string; sizeBytes: number; stageName: string | null } }`, `{ action: "file_removed"; before: { fileId: string; name: string } }`.
- Produces (`deal-panel.ts`): `DealPanelData.files: PanelFile[]` (live files, newest first, `take: FILES_PER_DEAL_MAX`).
- Produces (routes): `POST /api/sales/deals/[dealId]/files` (multipart fields `file` and `confirmedFinal` = `"true"`; 201 `{ file }`; `export const runtime = "nodejs"`), `GET /api/sales/files/[fileId]` (the bytes, as an attachment), `DELETE /api/sales/files/[fileId]` (`{ ok: true, changed }`).
- Messages (pinned): `"Choose a file first."` (400), `"Tick the box to confirm this is the final version the client received."` (400), `"Files can be up to 4 MB."` (413), `"Only PDF, Word, Excel, PNG or JPG files can be added."` (415), `"This deal already has 50 files. Remove one first."` (400), `"You can add up to 30 files a day. Try again tomorrow."` (400), `"You can add up to 100 MB of files a day. Try again tomorrow."` (400), `"File storage is not set up yet."` (503), `"Could not store the file. Try again."` (503), `"File not found."` (404).

- [ ] **Step 1: Write the failing tests**

`file-rules.test.ts`:
- "recognises allowed files by their bytes": `%PDF-1.7` bytes give `"pdf"`; the PNG signature gives `"png"`; `FF D8 FF E0` gives `"jpg"`; a ZIP holding `word/document.xml` gives `"docx"`; one holding `xl/workbook.xml` gives `"xlsx"`.
- "refuses files whose bytes are not an allowed type" (Review Focus 4): a ZIP holding `word/document.xml` and `word/vbaProject.bin` (a macro `.docm`), a ZIP holding `xl/workbook.xml` and `xl/macrosheets/sheet1.xml`, one holding `xl/activeX/activeX1.xml`, one holding `word/embeddings/oleObject1.bin`, a ZIP with neither, `MZ` (an `.exe`), `<svg`, `<!DOCTYPE html` and empty bytes give `null`.
- "cleans names" (Review Focus 4): `("Signed contract.pdf", "pdf")` stays; `("..\\..\\backups\\x.pdf", "pdf")` gives `"x.pdf"`; `("a/b/../contract.PDF", "pdf")` gives `"contract.PDF"`; `("contract‮fdp.exe", "pdf")` gives `"contractfdp.exe.pdf"`; `("photo.jpeg", "jpg")` stays; `(" \u0000 ", "png")` gives `"file.png"`; `("..hidden.pdf", "pdf")` gives `"hidden.pdf"`; a 300-character base plus `.pdf` gives exactly 200 characters ending in `.pdf`.
- "writes a safe download header": `contentDisposition("Signed contract.pdf")` is `attachment; filename="Signed contract.pdf"; filename*=UTF-8''Signed%20contract.pdf`; `contentDisposition("Résumé \"final\".pdf")` is `attachment; filename="R_sum_ _final_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22.pdf`.

`files.test.ts` (mock `@vercel/blob` `put`/`get`/`del` and prisma; `BLOB_READ_WRITE_TOKEN` set; deal d1 owned by "r" in stage "Proposal Sent"; `now = 2026-11-05T15:00Z`):
- "stores a final version privately under a name the server makes": a 1,000-byte PDF named "Signed contract.pdf", `confirmedFinal: true`, by "r": `put` called once with a pathname matching `/^sales-files\/[0-9a-f-]{36}\.pdf$/`, the bytes, and options exactly `{ access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/pdf" }` (no `token` key); row `data` `{ name: "Signed contract.pdf", blobPathname: <that pathname>, contentType: "application/pdf", sizeBytes: 1000, sha256: <hex SHA-256 of the bytes>, uploadedById: "r", dealId: "d1", finalConfirmedAt: now, stageName: "Proposal Sent" }`; row `{ entityType: "SalesDeal", entityId: "d1", action: "file_added", after: { fileId: <id>, name: "Signed contract.pdf", sizeBytes: 1000, stageName: "Proposal Sent" } }`.
- "asks for the final-version tick": `confirmedFinal: false`: 400 `"Tick the box to confirm this is the final version the client received."`, `put` never called.
- "refuses a file that lies about its type": an `MZ` file named "contract.pdf": 415 `"Only PDF, Word, Excel, PNG or JPG files can be added."`, no `put`; the same for the macro ZIP and an SVG named "logo.png".
- "keeps to the limits": 50 live files on d1: 400 `"This deal already has 50 files. Remove one first."`; 30 files today for "r": 400 `"You can add up to 30 files a day. Try again tomorrow."`; 99 MB today plus a 2 MB file: 400 `"You can add up to 100 MB of files a day. Try again tomorrow."`; the daily figures come from `salesFile.aggregate({ where: { uploadedById: "r", createdAt: { gte: startOfDay("2026-11-05") } }, _count: { _all: true }, _sum: { sizeBytes: true } })` (removed files count too).
- "cleans up when the database says no after the upload": the re-check inside the transaction finds 50 files: 400 and `del` called with the stored pathname. `$transaction` rejecting with an error whose message contains `"Signed contract.pdf"`: 503 `"Could not store the file. Try again."` (not rethrown), `del` called with the pathname, and no `console.error` argument contains `"Signed contract"`.
- "says so when storage is missing or failing, without naming the file": both `BLOB_READ_WRITE_TOKEN` and `BLOB_STORE_ID` unset: 503 `"File storage is not set up yet."`; `put` rejecting: 503 `"Could not store the file. Try again."` and no `console.error` argument contains `"Signed contract"`.
- "only the deal owner or an admin adds files": seesAll non-owner: 403; hidden deal: 404.
- Route POST: without Sales access: 403 and the body is never read; `Content-Length: 6000000`: 413 `"Files can be up to 4 MB."` and `request.formData` never read; no `Content-Length` with a 5 MB body: 413, the body reader cancelled once past `FILE_MAX_BYTES + FORM_OVERHEAD_BYTES`, and `request.formData` never called; no `file` field: 400 `"Choose a file first."`; `Origin: https://evil.example`: 403 and no `put`.
- "downloads only through the app, as an attachment": a visible live file: `get("sales-files/abc.pdf", { access: "private" })`, response 200 with headers `content-type: application/pdf`, `content-disposition: attachment; filename="Signed contract.pdf"; filename*=UTF-8''Signed%20contract.pdf`, `x-content-type-options: nosniff`, `cache-control: private, no-store`, `content-security-policy: sandbox`; a removed file, a hidden deal, or `get` returning null: 404 `{ error: "File not found." }`; a row whose `blobPathname` is `"backups/2026-11-05.json"`: 404 and `get` never called. The file lookup is `where: { id: "f1", archivedAt: null, dealId: { not: null }, deal: { archivedAt: null, ownerId: "r" } }` for a see-own actor.
- "removes a file softly": owner: `salesFile.updateMany({ where: { id: "f1", archivedAt: null }, data: { archivedAt: now } })` and `{ action: "file_removed", before: { fileId: "f1", name: "Signed contract.pdf" } }`; again: `{ ok: true, changed: false }`, no row; seesAll non-owner: 403; a file on a deal the actor cannot see: 404 `"File not found."`, no `updateMany` and no row; DELETE with a foreign Origin: 403; `del` is never called.

`deal-panel.test.ts` addition: `salesFile.findMany({ where: { dealId: "d1", archivedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 })` feeds `files: [{ id: "f1", name: "Signed contract.pdf", sizeBytes: 1000, contentType: "application/pdf", stageName: "Proposal Sent", uploadedBy: "Sarah K.", createdAt: "2026-11-05T15:00:00.000Z", canRemove: true }]` for owner "r".

`timeline.test.ts` addition: `file_added` "File added: Signed contract.pdf" and `file_removed` "File removed: Signed contract.pdf" (icon `file`).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/file-rules.test.ts tests/lib/sales/files.test.ts tests/lib/sales/deal-panel.test.ts tests/lib/sales/timeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Upload order: route (`requireSalesUser()`, then `assertSameOrigin`, then `Content-Length` (413 above `FILE_MAX_BYTES + FORM_OVERHEAD_BYTES`); without the header, read `request.body` through a byte counter that cancels and answers 413 past that cap, then parse with `new Response(bytes, { headers: { "content-type": <the request's> } }).formData()`; `file` present, `file.size`, bytes) then `uploadDealFile`: tick check, credentials, sniff, a read-only pre-check (edit right and limits), `put`, then one transaction that re-checks the edit right and limits, creates the row and writes `file_added`; if that transaction refuses, `del(pathname)` (best effort) and answer its refusal; if it throws, catch it, `del(pathname)` (best effort), log a fixed line with no error text, and answer 503 `"Could not store the file. Try again."` (never rethrow: `toErrorResponse` would pass a Prisma message holding the name on to Sentry). Download builds `new Response(result.stream, { headers })`. Never put a file name in a thrown error or a log line.

- [ ] **Step 4: Run to verify they pass**

Run: the Step 2 command plus `npx vitest run tests/lib/sales/http.test.ts tests/lib/sales/deal-panel-header-render.test.ts tests/lib/sales/scroll-containment-render.test.ts tests/lib/sales/deal-read-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/file-rules.ts src/lib/sales/files.ts src/lib/sales/http.ts src/lib/sales/deal-panel.ts src/lib/sales/deal-audit.ts src/lib/sales/timeline.ts src/lib/sales/constants.ts "src/app/api/sales/deals/[dealId]/files/route.ts" "src/app/api/sales/files/[fileId]/route.ts" tests/lib/sales/file-rules.test.ts tests/lib/sales/files.test.ts tests/lib/sales/deal-panel.test.ts tests/lib/sales/timeline.test.ts tests/lib/sales/deal-panel-header-render.test.ts tests/lib/sales/scroll-containment-render.test.ts tests/lib/sales/deal-read-routes.test.ts
git commit -m "feat(sales): final-version files on deals, stored privately

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Dashboard and forecast data, expected close, Insights data

**Files:**
- Create: `src/lib/sales/dashboard.ts`, `src/lib/sales/insights-query.ts` (client-safe), `src/lib/sales/insights.ts`
- Modify: `src/lib/sales/deals.ts` (`updateDealSchema` gains `expectedCloseDate`), `src/lib/sales/deal-audit.ts:30` (`Editable` becomes `{ title: string; source: string | null; expectedCloseDate: string | null }`, so the `updated` row type-checks), `src/lib/sales/deal-panel.ts` (`deal.expectedCloseDate`), `src/lib/sales/timeline.ts` (expected close line in `updatedLine`), `src/lib/sales/constants.ts` (`DASHBOARD_LIST_ROWS = 8`, `RECENT_ACTIVITY_ROWS = 7`, `RECENT_FEED_SCAN = 50`, `RECENT_FEED_PAGES = 4`, `INSIGHTS_ROW_CAP = 5000`, `FOLLOW_UP_STAGE_KEY = "follow-up"`)
- Test: `tests/lib/sales/dashboard.test.ts`, `tests/lib/sales/insights.test.ts`; modify `tests/lib/sales/deals.test.ts`, `tests/lib/sales/deal-panel.test.ts`, `tests/lib/sales/timeline.test.ts`, and the typed `DealPanelData` fixtures `tests/lib/sales/deal-panel-header-render.test.ts:48` and `tests/lib/sales/scroll-containment-render.test.ts:107` (`deal` gains `expectedCloseDate: null`)

**Interfaces:**
- Consumes: Task 7's `activityParentWhere`; `dealOwnerWhere`; `describeAuditRow`, `TimelineIcon`; `loadSalesMembers`, `BoardPipeline`, `isBoardPipeline`; `daysInStage`, `shortName`, `isValidDateString` (all `@/lib/sales/format`); `startOfDay`, `endOfDay`, `dateInputValue`, `addMonthsToDateString` (`@/lib/utils`).
- Produces (`dashboard.ts`): `type DashboardScope = "everyone" | "mine"`, `parseDashboardScope(params: Record<string, string | string[] | undefined>): DashboardScope`, `appMonthBounds(now: Date): { thisMonth: Date; nextMonth: Date; monthAfter: Date }` (app-time start of the 1st of this month, next month and the month after), `weightedCents(groups: { stageId: string; sumCents: number }[], stages: Map<string, { probability: number; isLost: boolean }>): number` (per stage `Math.round(sum * probability / 100)`, lost stages 0), `type DashboardParent = { kind: "deal" | "lead"; id: string; title: string }`, `type DashboardActivity = { id: string; type: SalesActivityType; subject: string; dueAt: string; hasTime: boolean; ownerId: string; parent: DashboardParent }`, `type DashboardStalled = { kind: "deal" | "lead"; id: string; title: string; since: string; stageName: string | null; ownerId: string }`, `type DashboardFollowUp = { id: string; title: string; pipelineName: string; valueCents: number; mrrCents: number; ownerId: string; next: { type: SalesActivityType; subject: string; dueAt: string; hasTime: boolean } | null }`, `type DashboardRecent = { id: string; at: string; icon: TimelineIcon; text: string; dealId: string; dealTitle: string; actorName: string | null }`, `type DashboardData = { scope: DashboardScope; canSeeEveryone: boolean; viewerName: string; members: SalesMemberOption[]; kpis: { openDeals: number; pipelineCents: number; wonThisMonthCents: number; wonThisMonthCount: number; overdueActivities: number }; forecast: { thisMonthCents: number; nextMonthCents: number; noCloseDateCount: number }; today: DashboardActivity[]; todayCount: number; noNextStep: DashboardStalled[]; noNextStepCount: number; followUp: DashboardFollowUp[]; followUpPipelineKey: string | null; recent: DashboardRecent[] }` (`followUpPipelineKey`: the first Sales pipeline, by position, with a live `follow-up` stage, read from the same `salesStage.findMany` as the probabilities), `loadDashboard(actor, scope: DashboardScope, now: Date, db = prisma): Promise<DashboardData>` (every query in one `Promise.all`).
- Produces (`insights-query.ts`): `type InsightsRange = 3 | 6 | 12`, `type InsightsQuery = { range: InsightsRange; scope: "everyone" | "mine"; pipeline: string | null }`, `parseInsightsQuery(params): InsightsQuery`, `insightsQueryToSearch(query): string` (keys range (when not 3), scope, pipeline).
- Produces (`insights.ts`): `insightMonths(now: Date, range: InsightsRange): string[]` (`"YYYY-MM"`, oldest first, ending with this app-time month), `type InsightsData = { query: InsightsQuery; canSeeEveryone: boolean; pipelines: BoardPipeline[]; pipeline: BoardPipeline | null; months: string[]; funnel: { stageId: string; name: string; count: number; valueCents: number }[]; wonByMonth: { month: string; valueCents: number; count: number }[]; cycleByMonth: { month: string; avgDays: number | null; count: number }[]; activitiesByPerson: { ownerId: string; name: string; count: number }[]; capped: boolean }`, `loadInsights(actor, query, now, db = prisma): Promise<InsightsData>`.
- Produces (`deals.ts`, `deal-panel.ts`): `updateDealSchema.expectedCloseDate?: "YYYY-MM-DD" | null` (error `"Enter a real date."`), stored as `endOfDay(value)`, history `updated` with the date string; `DealPanelData.deal.expectedCloseDate: string | null` (`"YYYY-MM-DD"` via `dateInputValue`).
- Dashboard deal scope (used by every deal query): `{ archivedAt: null, status: "OPEN", pipeline: { kind: { in: ["SALES", "CONSULTING"] }, archivedAt: null }, ...dealOwnerWhere(actor, scope) }`.

- [ ] **Step 1: Write the failing tests** (see-own actor "r"; `now = new Date("2026-11-05T15:00:00Z")` unless stated)

`dashboard.test.ts`:
- "reads the Eastern month": `appMonthBounds(now)` is `{ thisMonth: startOfDay("2026-11-01"), nextMonth: startOfDay("2026-12-01"), monthAfter: startOfDay("2027-01-01") }`.
- "won this month and the forecast read the Eastern month on Nov 30 at 11:30 PM" (Review Focus 2): `appMonthBounds(new Date("2026-12-01T04:30:00Z"))` gives the same three dates; `startOfDay("2026-12-01").toISOString()` is `"2026-12-01T05:00:00.000Z"` (a deal won at 04:30Z on Dec 1 counts in November); `endOfDay("2026-11-30")` (an expected close of Nov 30) is before `startOfDay("2026-12-01")`.
- "KPI tiles follow Everyone / Just me over Sales and Consulting": `salesDeal.aggregate` with `where: { archivedAt: null, status: "OPEN", pipeline: { kind: { in: ["SALES", "CONSULTING"] }, archivedAt: null }, ownerId: "r" }, _count: { _all: true }, _sum: { valueCents: true }` answering `{ _count: { _all: 3 }, _sum: { valueCents: 4320000 } }` gives `openDeals: 3, pipelineCents: 4320000`; the won aggregate's `where` is `{ archivedAt: null, status: "WON", wonAt: { gte: startOfDay("2026-11-01"), lt: startOfDay("2026-12-01") }, pipeline: { kind: { in: ["SALES", "CONSULTING"] }, archivedAt: null }, ownerId: "r" }`; overdue is `salesActivity.count({ where: { doneAt: null, archivedAt: null, dueAt: { lt: startOfDay("2026-11-05") }, ...activityParentWhere(actor, false) } })`, plus `ownerId: "r"` for "mine"; an admin with "everyone" has no `ownerId` in the deal scope.
- "lists today's and overdue work on deals and leads, most overdue first": `salesActivity.findMany({ where: { doneAt: null, archivedAt: null, dueAt: { lte: endOfDay("2026-11-05") }, ...activityParentWhere(actor, false) }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 8 })`; a row with `deal: null, lead: { id: "l1", title: "Crestview Dental" }` gives `parent: { kind: "lead", id: "l1", title: "Crestview Dental" }`; `todayCount` comes from the matching `count`.
- "finds deals and leads with no next step": deals `findMany({ where: { ...dealScope, activities: { none: { doneAt: null, archivedAt: null } } }, orderBy: [{ stageEnteredAt: "asc" }, { id: "asc" }], take: 8 })`; leads `findMany({ where: { status: "OPEN", archivedAt: null, ownerId: "r", activities: { none: { doneAt: null, archivedAt: null } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 8 })`; the two lists merge by `since` (deal `stageEnteredAt`, lead `createdAt`) oldest first and stop at 8; `noNextStepCount` = the two matching `count`s added.
- "shows deals in Follow-Up": `salesDeal.findMany({ where: { ...dealScope, stage: { key: "follow-up" } }, orderBy: [{ stageEnteredAt: "desc" }, { id: "desc" }], take: 8 })`, each with its earliest open activity as `next`.
- "recent activity keeps only deals the viewer may see": the first page is `salesAuditLog.findMany({ where: { entityType: "SalesDeal" }, orderBy: [{ at: "desc" }, { id: "desc" }], take: 50 })`; each page's deals are looked up once with `where: { id: { in: [<ids>] }, archivedAt: null, ownerId: "r" }`; 9 visible on the first page give the newest 7 and no second page is read; when a page finds fewer than 7 the next page continues after the last row (`where: { entityType: "SalesDeal", OR: [{ at: { lt: <last at> } }, { at: <last at>, id: { lt: <last id> } }] }`); at most 4 pages are read (3 visible rows over 4 full pages give 3 entries and exactly 4 audit reads); `text` and `icon` come from `describeAuditRow`.
- "links Follow-Up to a pipeline that has it": stages of `direct-mail` (position 1) and `new-mover-mail` (position 2) both holding `follow-up` give `followUpPipelineKey: "direct-mail"`; none gives `null`.
- "weights the forecast by win chance; lost stages count nothing": `weightedCents([{ stageId: "s4", sumCents: 1000000 }, { stageId: "s9", sumCents: 500000 }, { stageId: "s5", sumCents: 100001 }], new Map([["s4", { probability: 30, isLost: false }], ["s9", { probability: 100, isLost: true }], ["s5", { probability: 50, isLost: false }]]))` is `350001`; the forecast reads `salesDeal.groupBy({ by: ["stageId"], where: { ...dealScope, expectedCloseDate: { gte: startOfDay("2026-11-01"), lt: startOfDay("2026-12-01") } }, _sum: { valueCents: true } })` and the same for Dec 1 to Jan 1; `noCloseDateCount` from `salesDeal.count({ where: { ...dealScope, expectedCloseDate: null } })`.
- "reads the scope and the viewer's name": `parseDashboardScope({ scope: "mine" })` is `"mine"`, `{}` and `{ scope: "all" }` are `"everyone"`; `viewerName` comes from `teamMember.findUnique({ where: { id: "r" }, select: { name: true } })`.

`insights.test.ts`:
- "parses the Insights URL": `parseInsightsQuery({})` is `{ range: 3, scope: "everyone", pipeline: null }`; `range` `"6"` gives 6, `"12"` gives 12, `"7"` gives 3; `insightsQueryToSearch({ range: 12, scope: "mine", pipeline: "direct-mail" })` is `"range=12&scope=mine&pipeline=direct-mail"`; the defaults give `""`.
- "counts months in Eastern time" (Review Focus 2): `insightMonths(now, 3)` is `["2026-09", "2026-10", "2026-11"]`; `insightMonths(now, 12)` starts `"2025-12"` and ends `"2026-11"`; `insightMonths(new Date("2026-12-01T04:30:00Z"), 3)` is `["2026-09", "2026-10", "2026-11"]`.
- "reads won deals once, and says when it hit the cap": `salesDeal.findMany({ where: { archivedAt: null, status: "WON", wonAt: { gte: startOfDay("2026-09-01") }, pipeline: { kind: { in: ["SALES", "CONSULTING"] } }, ownerId: "r" }, select: { wonAt: true, createdAt: true, valueCents: true }, orderBy: { wonAt: "asc" }, take: 5000 })`; 5,000 rows give `capped: true`.
- "buckets a deal won at 11:30 PM Eastern on Oct 31 in October": `wonAt: new Date("2026-11-01T03:30:00Z")` counts in `"2026-10"`.
- "averages whole days from created to won": created `zonedDateTime("2026-10-01", "09:00")`, won `zonedDateTime("2026-10-11", "16:00")` (10 days) and created Oct 5, won Oct 9 (4 days) give October `{ month: "2026-10", avgDays: 7, count: 2 }`; a month with none is `{ month: "2026-09", avgDays: null, count: 0 }`.
- "the funnel shows open deals per stage now": an unknown pipeline key falls back to the first pipeline; `salesDeal.groupBy({ by: ["stageId"], where: { archivedAt: null, status: "OPEN", pipelineId: "pm1", ownerId: "r" }, _count: { _all: true }, _sum: { valueCents: true } })`; every live stage appears in position order, empty ones as `count: 0, valueCents: 0`.
- "counts activities done per person": `salesActivity.groupBy({ by: ["ownerId"], where: { doneAt: { gte: startOfDay("2026-09-01") }, archivedAt: null, ...activityParentWhere(actor, true) }, _count: { _all: true } })`, plus `ownerId: "r"` for "mine"; names from `loadSalesMembers` ("No longer in Sales" for anyone missing); sorted by count, highest first, then name.

`deals.test.ts`: "sets the expected close as an Eastern end of day": `{ expectedCloseDate: "2026-11-30" }` updates `expectedCloseDate: endOfDay("2026-11-30")` and writes `{ action: "updated", before: { expectedCloseDate: null }, after: { expectedCloseDate: "2026-11-30" } }`; `"2026-02-30"`: 400 `"Enter a real date."`; `null` clears with `after: { expectedCloseDate: null }`.
`deal-panel.test.ts`: a stored `endOfDay("2026-11-30")` gives `deal.expectedCloseDate: "2026-11-30"`; none gives `null`.
`timeline.test.ts`: `updated` with `after: { expectedCloseDate: "2026-11-30" }` reads "Expected close set to Nov 30"; with `null`, "Expected close cleared".

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/dashboard.test.ts tests/lib/sales/insights.test.ts tests/lib/sales/deals.test.ts tests/lib/sales/deal-panel.test.ts tests/lib/sales/timeline.test.ts tests/lib/sales/deal-panel-header-render.test.ts tests/lib/sales/scroll-containment-render.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Stage probabilities for `weightedCents` come from one `salesStage.findMany` over the Sales and Consulting pipelines. Month keys use `dateInputValue(date).slice(0, 7)`. Cycle days use `daysInStage(createdAt, wonAt)` (calendar days, app time). No raw SQL.

- [ ] **Step 4: Run to verify they pass** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/dashboard.ts src/lib/sales/insights-query.ts src/lib/sales/insights.ts src/lib/sales/deals.ts src/lib/sales/deal-audit.ts src/lib/sales/deal-panel.ts src/lib/sales/timeline.ts src/lib/sales/constants.ts tests/lib/sales/dashboard.test.ts tests/lib/sales/insights.test.ts tests/lib/sales/deals.test.ts tests/lib/sales/deal-panel.test.ts tests/lib/sales/timeline.test.ts tests/lib/sales/deal-panel-header-render.test.ts tests/lib/sales/scroll-containment-render.test.ts
git commit -m "feat(sales): dashboard and forecast data, expected close and Insights data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Who gets new leads (Ruling 24) and per-stage rotting days

**Files:**
- Create: `src/lib/sales/settings.ts`, `src/app/api/sales/pipelines/[pipelineId]/stages/route.ts` (PATCH)
- Modify: `src/app/api/sales/settings/route.ts` (rewritten on `settings.ts`, `readJson` + `z.strictObject`), `src/lib/sales/http.ts:13-14` (`code` adds `"ASSIGNEE_LOST_ACCESS"`), `src/lib/sales/constants.ts` (`ROTTING_DAYS_MAX = 365`)
- Test: modify `tests/lib/sales/settings-route.test.ts`; create `tests/lib/sales/stage-settings.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `toErrorResponse`; `adminActor` (`bot-admin.ts`); `SALES_MEMBER_WHERE`; `auditDiff`, `recordSalesAudit`, `requestMeta`; `readJson`, `fail`, `failResponse`; Task 4's `loadAssignmentSummary`, `AssignmentSummary`; `loadSalesMembers`.
- Produces (`settings.ts`): `type SavedPersonView = { id: string; name: string | null; hasAccess: boolean }`, `type LeadAssignmentView = { mode: "ROUND_ROBIN" | "SINGLE"; members: SalesMemberOption[]; rotation: SavedPersonView[]; single: SavedPersonView | null; effective: AssignmentSummary; firstAdminName: string | null }` (`firstAdminName`: the short name `assignLeadOwner` falls back to when nobody is eligible, read the same way as `AssignmentSummary.fallbackName`, so the card can name them while a draft has nobody ticked; A8), `loadLeadAssignmentView(db = prisma): Promise<LeadAssignmentView>`, `updateSettingsSchema` (strictObject `{ leadAssignMode?: "ROUND_ROBIN" | "SINGLE" (error "Pick how new leads are shared out."); roundRobinMemberIds?: string(1..64)[] max 100 (error "Choose up to 100 people."), deduped; singleAssigneeId?: string(1..64) | null }`, refine "Nothing to change."), `type StageSettings = { id: string; key: string; name: string; kind: "SALES" | "CONSULTING"; stages: { id: string; name: string; probability: number; isWon: boolean; isLost: boolean; rottingDays: number | null }[] }`, `loadStageSettings(db = prisma): Promise<StageSettings[]>`, `stageRottingSchema` (strictObject `{ stages: { id: string(1..64); rottingDays: int 1..365 | null }[] (1..50) }`, error `"Use a number from 1 to 365, or leave it blank."`), `updateStageRotting(admin: SalesActor, pipelineId: string, input, meta): Promise<{ ok: true; stages: { id: string; rottingDays: number | null }[] } | SalesFail>`.
- Produces (routes): `GET /api/sales/settings` (`{ settings: { leadAssignMode, roundRobinMemberIds, singleAssigneeId }, view: LeadAssignmentView }`), `PATCH /api/sales/settings` (`{ settings, view }`), `PATCH /api/sales/pipelines/[pipelineId]/stages` (`{ stages }`).
- Messages (pinned): `"Choose team members with Sales access."` (400; with `code: "ASSIGNEE_LOST_ACCESS"` when it is the single person), `"The person who gets every new lead no longer has Sales access. Pick someone else."` (400, `code: "ASSIGNEE_LOST_ACCESS"`), `"Choose the person who gets every new lead."` (400), `"Won and lost stages never go stale."` (400), `"That stage is not part of this pipeline."` (400), `"Pipeline not found."` (404).

- [ ] **Step 1: Write the failing tests**

`settings-route.test.ts`. Plan 1 cases that change: the fake `teamMember.findMany` (`:16-18`) answers both the `id: { in }` lookup and the `SALES_MEMBER_WHERE` list `loadSalesMembers` and the summary read (with names); the GET cases (`:92-107`) assert `body.settings` with `toEqual` and that `body.view` is present (the body now holds both); "never lets the caller set the rotation cursor" (`:258-264`) becomes `{ roundRobinMemberIds: ["b"], rrCursor: 99 }`: 400 and `upsert` never called (strictObject); "refuses single-person mode when the saved person no longer has Sales access" (`:208-218`) and "re-checks the saved person on any save that stays in single-person mode" (`:220-228`) expect 400 `{ error: "The person who gets every new lead no longer has Sales access. Pick someone else.", code: "ASSIGNEE_LOST_ACCESS" }`; "refuses a single assignee without Sales access" (`:164-169`, the person named in the request) expects `{ error: "Choose team members with Sales access.", code: "ASSIGNEE_LOST_ACCESS" }`. Every other Plan 1 case keeps its assertions.
- "shows who can get leads and who lost access": saved `{ leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: ["b", "x", "gone"], singleAssigneeId: null }`; Sales members b "Ben Example" and r "Robert O."; x a team member "Dana Q." without Sales; "gone" not on the team: `view.rotation` is `[{ id: "b", name: "Ben Example", hasAccess: true }, { id: "x", name: "Dana Q.", hasAccess: false }, { id: "gone", name: null, hasAccess: false }]`; `view.members` is `[{ id: "b", name: "Ben Example" }, { id: "r", name: "Robert O." }]`; `view.single` is `null`; `view.effective` is `{ mode: "ROUND_ROBIN", names: ["Ben E."], fallbackName: null }`; with first admin "Mark Example", `view.firstAdminName` is `"Mark E."`; the response never contains `rrCursor`.
- "explains a refused save when the single person lost access" (Ruling 24): saved SINGLE "b" who lost access, PATCH `{ roundRobinMemberIds: ["r"] }`: 400 `{ error: "The person who gets every new lead no longer has Sales access. Pick someone else.", code: "ASSIGNEE_LOST_ACCESS" }`, nothing saved.
- "names a single person without access with the same code": `{ leadAssignMode: "SINGLE", singleAssigneeId: "x" }`: 400 `{ error: "Choose team members with Sales access.", code: "ASSIGNEE_LOST_ACCESS" }`.
- "refuses a rotation id without access plainly": `{ roundRobinMemberIds: ["b", "x"] }`: 400 `{ error: "Choose team members with Sales access." }` (no `code`).
- "rejects unknown keys and bad values in Sales wording": `{ rrCursor: 5 }`: 400, nothing saved; `{ leadAssignMode: "WEIGHTED" }`: 400 `{ error: "Pick how new leads are shared out." }`; `{}`: 400 `{ error: "Nothing to change." }`; a body that is not JSON: 400 `{ error: "Invalid input." }`.

`stage-settings.test.ts`:
- "lists Sales and Consulting pipelines with their stages": `salesPipeline.findMany` with `where: { archivedAt: null, kind: { in: ["SALES", "CONSULTING"] } }, orderBy: { position: "asc" }`, stages with `where: { archivedAt: null }, orderBy: { position: "asc" }`; each stage comes back as `{ id, name, probability, isWon, isLost, rottingDays }`.
- "admins only": `requireAdmin` rejecting: 403 `{ error: "This action is for admins only." }`, no query.
- "saves only what changed, one history row per stage": pm1 with s4 (14), s5 (14), s7 won (null); body `{ stages: [{ id: "s4", rottingDays: 21 }, { id: "s5", rottingDays: 14 }, { id: "s7", rottingDays: null }] }`: exactly one `salesStage.update({ where: { id: "s4" }, data: { rottingDays: 21 } })` and one row `{ entityType: "SalesStage", entityId: "s4", action: "updated", before: { rottingDays: 14 }, after: { rottingDays: 21 } }` with the admin as actor and the request's IP; response `{ stages: [{ id: "s4", rottingDays: 21 }, { id: "s5", rottingDays: 14 }, { id: "s7", rottingDays: null }] }`.
- "keeps the numbers sensible": `rottingDays` 0, 366 or 2.5: 400 `"Use a number from 1 to 365, or leave it blank."`; won s7 with 30: 400 `"Won and lost stages never go stale."`; a stage of another pipeline: 400 `"That stage is not part of this pipeline."`; a Delivery or unknown pipeline: 404 `"Pipeline not found."`; `Origin: https://evil.example`: 403 `"Request blocked."`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/settings-route.test.ts tests/lib/sales/stage-settings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Keep Plan 1's settings rules (one lookup for everyone named, re-check of a kept single person, `auditDiff` row only when something changed, a new row always gets a real list). Stage updates run in one transaction; a stage whose number did not change writes nothing.

- [ ] **Step 4: Run to verify they pass**

Run: the Step 2 command plus `npx vitest run tests/lib/sales/http.test.ts tests/lib/sales/lead-assignment.test.ts`
Expected: PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/settings.ts src/app/api/sales/settings/route.ts "src/app/api/sales/pipelines/[pipelineId]/stages/route.ts" src/lib/sales/http.ts src/lib/sales/constants.ts tests/lib/sales/settings-route.test.ts tests/lib/sales/stage-settings.test.ts
git commit -m "feat(sales): explain refused lead-assignment saves and edit rotting days per stage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Saved views and the Stage filter

**Files:**
- Modify: `src/lib/sales/board-query.ts` (`stage`; saved view schemas; `savedViewToQuery`), `src/lib/sales/board.ts:146` (`boardDealWhere` stage filter; `loadBoardPage` and `loadDealListPage` resolve the stage key), `src/lib/sales/board-client.ts` (`nextBoardQuery` clears `stage` on a pipeline change; `addSavedView`, `removeSavedView`), `src/lib/sales/view-preference.ts` (`loadSavedViews`, `saveSavedViews`), `src/lib/sales/constants.ts` (`SAVED_VIEWS_MAX = 20`, `SAVED_VIEW_NAME_MAX = 40`)
- Create: `src/app/api/sales/views/route.ts` (PUT)
- Test: `tests/lib/sales/saved-views.test.ts`; modify `tests/lib/sales/board-query.test.ts`, `tests/lib/sales/board.test.ts`, `tests/lib/sales/board-client.test.ts`, and the `BoardQuery` literals in `tests/lib/sales/api-client.test.ts:30-37`, `tests/lib/sales/deals-view-render.test.ts:67,171,185,273,302,340,361` (every query literal in that file) and `tests/lib/sales/scroll-containment-render.test.ts:73` (each gains `stage: null`; `src/components/sales/deals-view.tsx:75` is a partial patch and is left to Task 26)

**Interfaces:**
- Produces (`board-query.ts`): `BoardQuery.stage: string | null` (a stage key, 1..64 characters); `boardQueryToSearch` writes keys in the order pipeline, view, scope, status, next, stage, q; `savedBoardViewSchema` (strictObject `{ name: trimmed 1..40; pipeline: string(1..64) | null; view; scope; status; next; stage: string(1..64) | null; q: string max 100 }`), `savedViewsSchema` (array, max 20, names unique ignoring case), `type SavedBoardView`, `savedViewToQuery(view: SavedBoardView): BoardQuery` (`cursor: null`).
- Produces (`board.ts`): `boardDealWhere(actor, query, pipelineId, now, stageId: string | null = null)`; `query.stage` resolves among the shown pipeline's live stages; when found, the board shows that one column and the list filters by `stageId`; an unknown key is ignored.
- Produces (`board-client.ts`): `nextBoardQuery(current, resolvedPipelineKey, patch)` sets `stage: null` only when `patch.pipeline` is given, differs from `resolvedPipelineKey`, and the patch has no `stage` key (so applying a saved view keeps its stage); `addSavedView(views: SavedBoardView[], name: string, query: BoardQuery): { ok: true; views: SavedBoardView[] } | { ok: false; error: string }`, `removeSavedView(views: SavedBoardView[], name: string): SavedBoardView[]`.
- Produces (`view-preference.ts`): `loadSavedViews(userId, db = prisma): Promise<SavedBoardView[]>` (anything invalid gives `[]`), `saveSavedViews(userId, views: SavedBoardView[], db = prisma): Promise<void>`.
- Produces (route): `PUT /api/sales/views` body `{ views: SavedBoardView[] }` returns `{ views }` (no history row).
- Messages (pinned): `"Give the view a name."`, `"Keep the name under 40 characters."`, `"You can keep up to 20 views. Remove one first."`, `"You already have a view with that name."` (400).

- [ ] **Step 1: Write the failing tests**

`board-query.test.ts`: `DEFAULTS` gains `stage: null`; `parseBoardQuery({ stage: "proposal-sent" }).stage` is `"proposal-sent"`; a 65-character stage is `null`; `boardQueryToSearch({ ...DEFAULTS, pipeline: "direct-mail", stage: "proposal-sent", q: "oak" })` is `"pipeline=direct-mail&stage=proposal-sent&q=oak"`.

`saved-views.test.ts`:
- "checks view names and the limit": 21 views: `"You can keep up to 20 views. Remove one first."`; name `"  "`: `"Give the view a name."`; 41 characters: `"Keep the name under 40 characters."`; "Proposals out" and "proposals OUT": `"You already have a view with that name."`.
- "turns a saved view back into a board query": `savedViewToQuery({ name: "Proposals out", pipeline: "direct-mail", view: "list", scope: "mine", status: "open", next: "any", stage: "proposal-sent", q: "" })` is `{ pipeline: "direct-mail", view: "list", scope: "mine", status: "open", next: "any", stage: "proposal-sent", q: "", cursor: null }`.
- "adds and removes views": `addSavedView([], "Proposals out", query)` gives `{ ok: true, views: [{ name: "Proposals out", pipeline, view, scope, status, next, stage, q }] }` (no cursor); a duplicate name ignoring case gives `{ ok: false, error: "You already have a view with that name." }`; a 21st gives the limit error; `removeSavedView(views, "Proposals out")` drops it.
- "loads and saves views per person, with no history": stored `{ views: 3 }` loads as `[]`; a valid stored list loads as is; `saveSavedViews("r", views)` calls `teamMember.update({ where: { id: "r" }, data: { salesSavedViews: views } })`; the PUT route with 21 views: 400; with `Origin: https://evil.example`: 403; `salesAuditLog.create` is never called.

`board.test.ts`:
- "shows only the chosen stage": `query.stage = "proposal-sent"` on direct-mail (s5): `columns` has one column (s5) while `stages` still lists every live stage (the Filter menu needs them), the per-stage `findMany` and the `groupBy` both have `stageId: "s5"` in `where`; in list view the `findMany` `where` includes `stageId: "s5"`.
- "a saved view naming a stage that is gone shows every stage" (Review Focus 5): `query.stage = "nope"`: every column, no `stageId` in any `where`; `query.pipeline = "gone"` with `stage: "proposal-sent"`: the first pipeline is shown and "proposal-sent" resolves among its own stages.

`board-client.test.ts`: `DEFAULTS` gains `stage: null`; `nextBoardQuery({ ...DEFAULTS, pipeline: "direct-mail", stage: "proposal-sent" }, "direct-mail", { pipeline: "new-mover-mail" }).stage` is `null`; with `{ view: "list" }` it stays `"proposal-sent"`; with `{ pipeline: "direct-mail" }` (the same pipeline) it stays; `nextBoardQuery({ ...DEFAULTS, pipeline: "new-mover-mail" }, "new-mover-mail", { pipeline: "direct-mail", stage: "proposal-sent" }).stage` is `"proposal-sent"` (a saved view names both).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/board-query.test.ts tests/lib/sales/saved-views.test.ts tests/lib/sales/board.test.ts tests/lib/sales/board-client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Reuse `oneOf` and `keyOrNull` in `board-query.ts`. `savedViewsSchema`'s uniqueness is a `superRefine` with the pinned message.

- [ ] **Step 4: Run to verify they pass**

Run: the Step 2 command plus `npm test` (every updated `BoardQuery` literal compiles and passes)
Expected: PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/board-query.ts src/lib/sales/board.ts src/lib/sales/board-client.ts src/lib/sales/view-preference.ts src/lib/sales/constants.ts src/app/api/sales/views/route.ts tests/lib/sales/saved-views.test.ts tests/lib/sales/board-query.test.ts tests/lib/sales/board.test.ts tests/lib/sales/board-client.test.ts tests/lib/sales/api-client.test.ts tests/lib/sales/deals-view-render.test.ts tests/lib/sales/scroll-containment-render.test.ts
git commit -m "feat(sales): saved views and a Stage filter for the Deals board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Checkpoint: Mockup v2 approved by DJ (controller)

- [ ] The controller confirms that DJ approved `scratch/sales-mockup/sales-command-mockup-v2.html` (lead panel, new lead, convert and bulk convert, assign, Contacts with the contact panel, edit, duplicate bar, merge, "+ Person" / "+ Organization", deal Files section and File tab, editable Organization / Person / Expected close, dashboard with the forecast box, Insights, Sales settings with the person select, the Ruling 24 bar and the Edit stages dialog, the Deals toolbar Views menu and Stage filter, the full nav), and records the approval (date and any changes DJ asked for) in `SESSION_NOTES.md` (not committed). UI Tasks 17 to 27 do not start before this box is ticked. Any change DJ asks for that alters a ruling's behaviour is ruled by the controller first and written into the affected task.
- [ ] Before Task 17 starts, the controller settles with DJ every string where Mockup v2 and this plan differ, writes the final wording into the owning task, and records the list in `SESSION_NOTES.md`. Known today: archive toast (v2 "{n} leads archived." vs `bulkToast` "2 archived.", Task 20); delete confirm (v2 "They leave the Leads Inbox for good. The history keeps a record. This cannot be undone." and button "Delete {n} leads" vs "They disappear from the Inbox. Their history stays." and "Delete", Task 20); bulk convert skip line (v2 ends "It stays in the inbox." / "They stay in the inbox.", Task 21); File tab types (v2 "PDF, Word, Excel or images. Up to 4 MB." vs "PDF, Word, Excel, PNG or JPG. Up to 4 MB.", Task 24: keep "PNG or JPG", A7 allows no other image); the Ruling 24 bar (v2 "New leads go to the first admin, {name}, until you pick someone else." vs `lostAccessBar`, Task 25, which names the real fallback, Decision 28). The controller also adds the plan's additions Mockup v2 does not draw yet: the Inbox's select-all strip above the cards under 640px (Decision 11) and the empty and error states pinned in Tasks 18, 21 and 23.

---

### Task 17: The full Sales nav, neutral icons, count labels and the isolation guard

Load ui-ux-pro-max, impeccable and emil-design-eng first. Look: Mockup v2's nav (and v1 `renderNav`).

**Files:**
- Modify: `src/components/layout/sidebar.tsx:26-32` (icon keys, `countLabel`), `:207-242` (renders each group link through `SidebarGroupLink`; neutral words only, comments included)
- Create: `src/components/layout/sidebar-group-link.tsx` (`SidebarGroupLink` and its `ICONS`, in its own file so a test can render it without `sidebar.tsx`'s import chain: `change-password-dialog.tsx`, a server action, `@/lib/auth`, `@/lib/prisma`; the existing layout-folder scan in `sidebar-secrecy.test.ts` covers it)
- Modify: `src/lib/sales/nav.ts` (the full list, both counts, `salesLeadCountWhere`), `src/app/(app)/layout.tsx:21-61` (the lead count, only when `salesOn`)
- Test: modify `tests/lib/sales/nav.test.ts`, `tests/lib/sales/sidebar-secrecy.test.ts`; create `tests/lib/sales/sales-isolation.test.ts`

**Interfaces:**
- Produces (`sidebar.tsx`): `SidebarNavGroup.links: { href: string; label: string; icon: "board" | "calendar" | "home" | "inbox" | "people" | "chart" | "settings"; count: number; countLabel: string }[]`.
- Produces (`sidebar-group-link.tsx`): `ICONS = { board: SquareKanban, calendar: CalendarCheck, home: LayoutDashboard, inbox: Inbox, people: Users, chart: ChartColumn, settings: Settings }`; `SidebarGroupLink({ link, active }: { link: SidebarNavGroup["links"][number]; active: boolean })` (the type imported from `sidebar.tsx` with `import type`); the sr-only suffix is one string, `` {` ${link.countLabel}`} ``, so the HTML has no `<!-- -->` inside it.
- Produces (`nav.ts`): `salesNavGroup(perms: { isAdmin: boolean; canUseSales: boolean }, counts: { due: number; leads: number }): SidebarNavGroup | null`; `salesLeadCountWhere(userId: string): Prisma.SalesLeadWhereInput` = `{ ownerId: userId, status: "OPEN", archivedAt: null }`.

- [ ] **Step 1: Write the failing tests**
- `nav.test.ts`, "gives an admin every Sales page in order": `salesNavGroup({ isAdmin: true, canUseSales: false }, { due: 3, leads: 2 })` is `{ title: "Sales", badge: "NEW", links: [{ href: "/sales/dashboard", label: "Sales dashboard", icon: "home", count: 0, countLabel: "" }, { href: "/sales/deals", label: "Deals", icon: "board", count: 0, countLabel: "" }, { href: "/sales/leads", label: "Leads Inbox", icon: "inbox", count: 2, countLabel: "open leads" }, { href: "/sales/activities", label: "Activities", icon: "calendar", count: 3, countLabel: "due today or overdue" }, { href: "/sales/contacts", label: "Contacts", icon: "people", count: 0, countLabel: "" }, { href: "/sales/insights", label: "Insights", icon: "chart", count: 0, countLabel: "" }, { href: "/sales/settings", label: "Sales settings", icon: "settings", count: 0, countLabel: "" }] }`; a Sales user gets the first six; `{ isAdmin: false, canUseSales: false }` gets `null` (Robert O.); `salesLeadCountWhere("r")` is `{ ownerId: "r", status: "OPEN", archivedAt: null }`.
- `sidebar-secrecy.test.ts` additions: `sidebar.tsx`, `sidebar-group-link.tsx` and `topbar.tsx` match none of `/sales/i`, `/deals/i`, `/leads/i`; `sidebar.tsx` no longer contains `due today or overdue`; `renderToString(createElement(SidebarGroupLink, { link: { href: "/x", label: "X", icon: "inbox", count: 2, countLabel: "open items" }, active: false }))` (imported from `@/components/layout/sidebar-group-link`, `next/navigation` mocked) contains `<span class="sr-only"> open items</span>`; with `count: 0` there is no pill.
- `sales-isolation.test.ts` (A10, widened by the plan): every file under `src/lib/sales`, `src/app/api/sales`, `src/components/sales` and `src/app/(app)/sales` (recursive) has no match for `/logActivity|notify|notifyChannel|slack|sendEmail|@\/lib\/email|@\/lib\/highlevel|revalidatePath|handleUpload|@vercel\/blob\/client|ASSETS_READ_WRITE_TOKEN/` (today's Sales code has no hit); `src/lib/agent-data.ts` and every file under `src/app/api/agent/` and `src/app/api/mcp/` has no match for `/sales/i`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/nav.test.ts tests/lib/sales/sidebar-secrecy.test.ts tests/lib/sales/sales-isolation.test.ts`
Expected: FAIL (the isolation test passes already; the others fail).

- [ ] **Step 3: Implement.** The app layout adds `prisma.salesLead.count({ where: salesLeadCountWhere(perms.userId) })` to its existing `Promise.all` only when `salesOn` (else `Promise.resolve(0)`). Links point at pages built in Tasks 18 to 27 (Decision 30). At 375px the group follows the existing mobile drawer; count pills never wrap (`shrink-0`).

- [ ] **Step 4: Run to verify they pass** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/sidebar.tsx src/components/layout/sidebar-group-link.tsx src/lib/sales/nav.ts "src/app/(app)/layout.tsx" tests/lib/sales/nav.test.ts tests/lib/sales/sidebar-secrecy.test.ts tests/lib/sales/sales-isolation.test.ts
git commit -m "feat(sales): full Sales nav with neutral icons, count labels and an isolation guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Sales dashboard page

Load ui-ux-pro-max, impeccable and emil-design-eng first. Read `page.md` and `loading.md`. Look: Mockup v2's dashboard (with the forecast box) and v1 `viewHome`.

**Files:**
- Create: `src/app/(app)/sales/dashboard/page.tsx`, `src/app/(app)/sales/dashboard/loading.tsx`, `src/components/sales/dashboard-view.tsx`, `src/lib/sales/dashboard-client.ts` (pure)
- Test: `tests/lib/sales/dashboard-client.test.ts`, `tests/lib/sales/dashboard-page-gate.test.ts`, `tests/lib/sales/dashboard-view-render.test.ts`; modify `tests/lib/sales/scroll-containment-render.test.ts`

**Interfaces:**
- Consumes: Task 13's `loadDashboard`, `parseDashboardScope`, `DashboardData` and row types; `requireSalesPage`; `SEGMENT_GROUP`, `SEGMENT`, `NextStepPill`, `OwnerAvatar`, `ACTIVITY_ICONS`, `MUTED_TEXT`; `formatMoney`, `daysInStage`, `nextStepPill`, `shortName`; `panelHref`, `changePanelUrl`, `pageRendered`; `EmptyState`.
- Produces (`dashboard-client.ts`): `greeting(now: Date, fullName: string): string`, `dashboardDateLine(now: Date): string`, `overdueCaption(n: number): string`, `wonCaption(n: number): string`, `noCloseDateLine(n: number): string`, `stalledCaption(row: DashboardStalled, now: Date): string`, `todayCaption(row: DashboardActivity, now: Date): string`, `followUpCaption(row: DashboardFollowUp): string`, `dashboardEmpty(box: "today" | "noNextStep" | "followUp" | "recent", mine?: boolean): { title: string; description: string; action: { label: string; href: string } }` (`mine`: Just me, or a viewer who sees only their own deals), `viewAllHrefs(scope: DashboardScope, followUpPipelineKey: string | null): { today: string; noNextStep: string; followUp: string | null }`, `forecastHint(forecast: DashboardData["forecast"]): string | null`.
- Produces (component): `DashboardView({ data: DashboardData; now: string })`.

- [ ] **Step 1: Write the failing tests**

`dashboard-client.test.ts`:
- "greets by Eastern hour and first name": `greeting(new Date("2026-11-05T15:00:00Z"), "Ben Example")` is `"Good morning, Ben"`; at `17:00Z` `"Good afternoon, Ben"`; at `22:00Z` `"Good evening, Ben"`; at `2026-11-06T04:30:00Z` `"Good evening, Ben"`; name `"  DJ "` gives `"Good morning, DJ"`; `""` gives `"Good morning"`.
- "dates the page in Eastern time": `dashboardDateLine(new Date("2026-11-05T15:00:00Z"))` and `dashboardDateLine(new Date("2026-11-06T04:30:00Z"))` are both `"Thursday, Nov 5. Here is what needs you today."`.
- "captions tiles in words": `overdueCaption(0)` `"all caught up"`, `overdueCaption(2)` `"need a call or reschedule"`; `wonCaption(1)` `"1 deal"`, `wonCaption(0)` `"0 deals"`, `wonCaption(2)` `"2 deals"`; `noCloseDateLine(1)` `"No close date: 1 deal"`, `noCloseDateLine(4)` `"No close date: 4 deals"`; `forecastHint({ thisMonthCents: 0, nextMonthCents: 0, noCloseDateCount: 3 })` is `"Set an expected close date on a deal to see it here."`, and any month above 0 gives `null`.
- "captions box rows": `stalledCaption({ kind: "deal", stageName: "Demo Complete", since: "2026-10-27T15:00:00.000Z", ... }, NOW)` is `"Demo Complete · 9 days in stage"`; since Nov 4: `"Demo Complete · 1 day in stage"`; a lead since Nov 2: `"Lead · 3 days old"`; `todayCaption` for parent "Oak Creek Dental" due `endOfDay("2026-11-02")`: `"Oak Creek Dental · overdue 3d"`, due `endOfDay("2026-11-05")`: `"Oak Creek Dental · today"`; `followUpCaption({ pipelineName: "Direct Mail", valueCents: 1440000, mrrCents: 120000, ... })` is `"Direct Mail · $14,400 · $1,200/mo"`, with `mrrCents: 0` `"Direct Mail · $14,400"`.
- "every empty box explains itself and offers a next move": `dashboardEmpty("today")` is `{ title: "Nothing due. Nice.", description: "Calls and meetings you plan show up here.", action: { label: "Open Activities", href: "/sales/activities" } }`; `"noNextStep"`: `{ title: "Every deal has a next step.", description: "Deals and leads with nothing planned show up here.", action: { label: "Open Deals", href: "/sales/deals" } }`; `"followUp"`: `{ title: "None right now.", description: "Deals in a Follow-Up stage show up here.", action: { label: "Open Deals", href: "/sales/deals" } }`; `"recent"`: `{ title: "Nothing yet.", description: "Changes to deals show up here as they happen.", action: { label: "Open Deals", href: "/sales/deals" } }`; `dashboardEmpty("recent", true)`: `{ title: "No recent changes on your deals.", description: "Changes to your deals show up here as they happen.", action: { label: "Open Deals", href: "/sales/deals" } }` (the other boxes ignore `mine`).
- "View all keeps Just me and the Follow-Up pipeline": `viewAllHrefs("everyone", "direct-mail")` is `{ today: "/sales/activities", noNextStep: "/sales/deals?next=none", followUp: "/sales/deals?pipeline=direct-mail&stage=follow-up" }`; `viewAllHrefs("mine", "direct-mail")` is `{ today: "/sales/activities?scope=mine", noNextStep: "/sales/deals?scope=mine&next=none", followUp: "/sales/deals?pipeline=direct-mail&scope=mine&stage=follow-up" }` (Deals keys in `boardQueryToSearch` order); `followUpPipelineKey: null` gives `followUp: null`.

`dashboard-page-gate.test.ts` (copy `activities-page-gate.test.ts`): the gate rejecting stops the loader; `?scope=mine` calls `loadDashboard(actor, "mine", expect.any(Date))`; the element's props are `{ data, now }` with `now` an ISO date.

`dashboard-view-render.test.ts` (fixture with "Ben Example", 3 open deals, $43,200, 2 won worth $32,400, 2 overdue, forecast $4,320 / $0 / 2 with no date):
- h1 `"Good morning, Ben"` and the date line; tile labels `"Open deals"`, `"Pipeline value"`, `"Won this month"`, `"Overdue activities"` with `"sales pipelines"`, `"open, all stages"`, `"2 deals"`, `"need a call or reschedule"`; the overdue tile has `data-alert="true"`; each tile value's class holds `min-w-0`, `[overflow-wrap:anywhere]` and `tabular-nums` (a $12,345,678 pipeline wraps inside its tile at 375px instead of pushing the page sideways).
- the forecast box `"Expected to close"` shows `"This month"`, `"$4,320"`, `"Next month"`, `"No close date: 2 deals"`; with both months at $0 it also shows the `forecastHint` line.
- box headings `"Today and overdue"`, `"No next step"`, `"Deals in Follow-Up"`, `"Recent activity"`; a lead row in "No next step" shows `"Lead · 3 days old"` and links `href="/sales/dashboard?lead=l1"` with `data-lead-id="l1"`; deal rows link `?deal=` and carry `data-deal-id` (the deal panel returns focus there); "View all" links are `viewAllHrefs(data.scope, data.followUpPipelineKey)`, and the Follow-Up box has no "View all" when that key is null.
- an empty box shows its `dashboardEmpty` title, description and action link (Recent with `mine` when the scope is "mine" or `canSeeEveryone` is false); the Everyone / Just me group is absent when `canSeeEveryone` is false.
- `scroll-containment-render.test.ts` adds `DashboardView`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/dashboard-client.test.ts tests/lib/sales/dashboard-page-gate.test.ts tests/lib/sales/dashboard-view-render.test.ts tests/lib/sales/scroll-containment-render.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `dashboard-client.ts`**, then the page and view.
- `page.tsx`: `const actor = await requireSalesPage()`; `parseDashboardScope(await searchParams)`; `loadDashboard(actor, scope, now)`; `<DashboardView data={data} now={now.toISOString()} />`.
- Layout per the mockups: header row (h1, date line, Everyone / Just me with `SEGMENT_GROUP`/`SEGMENT`, `ShortcutsButton className="max-sm:hidden"`); KPI tiles `grid grid-cols-2 gap-3 min-[820px]:grid-cols-4` (12px label, 22px value with `min-w-0 [overflow-wrap:anywhere] tabular-nums`, 12px caption; the overdue value in the danger text colour while its caption says it in words); the forecast box where Mockup v2 puts it, with the line "Weighted by each stage's win chance."; boxes `grid gap-3 min-[820px]:grid-cols-2`, rows 40px tall on coarse pointers, `hover:bg-muted/50`, count pills on "Today and overdue" (`todayCount`) and "No next step" (`noNextStepCount`). Rows open panels through `panelHref` + `changePanelUrl`.
- `loading.tsx`: the header, four tile skeletons and four box skeletons with three rows each, `aria-busy="true"`.

- [ ] **Step 4: Run to verify they pass** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass. Controller click-through note: both scopes, a lead row, 375px tiles in two columns.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/sales/dashboard/page.tsx" "src/app/(app)/sales/dashboard/loading.tsx" src/components/sales/dashboard-view.tsx src/lib/sales/dashboard-client.ts tests/lib/sales/dashboard-client.test.ts tests/lib/sales/dashboard-page-gate.test.ts tests/lib/sales/dashboard-view-render.test.ts tests/lib/sales/scroll-containment-render.test.ts
git commit -m "feat(sales): Sales dashboard with KPI tiles, forecast and work boxes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Shared contact picker, lead requests and sentence helpers

Load ui-ux-pro-max, impeccable and emil-design-eng first.

**Files:**
- Create: `src/components/sales/contact-picker.tsx` (the Add deal combobox, moved out of `new-deal-dialog.tsx`)
- Modify: `src/components/sales/new-deal-dialog.tsx` (uses `ContactPicker`, `contactBody` and `existingChoice` from the new file; markup and behaviour unchanged), `src/lib/sales/api-client.ts` (lead and convert wrappers), `src/lib/sales/format.ts` (`endSentence`, `joinNames`)
- Test: modify `tests/lib/sales/format.test.ts`, `tests/lib/sales/api-client.test.ts`, `tests/lib/sales/muted-tone-render.test.ts` (Task 1's `{choice.detail}` source check now reads `src/components/sales/contact-picker.tsx`, where that line moves); `tests/lib/sales/new-deal-dialog-render.test.ts` must pass unchanged

**Interfaces:**
- Consumes (all `import type`): Task 3's `LeadPanelData`; Task 4's `LeadsQuery`, `LeadRowsPage` (and `leadsQueryToSearch` at runtime, from the client-safe `leads-query.ts`); Task 5's `CreateLeadInput`, `UpdateLeadInput`, `BulkLeadInput`, `BulkLeadResult`; Task 8's `ConvertTarget`, `ConvertLeadInput`, `BulkConvertInput`; Task 2's `ContactRef`; `ContactResult` (`contacts.ts`).
- Produces (`contact-picker.tsx`): `type ContactChoice = { key: string; kind: "existing"; id: string; name: string; detail: string | null } | { key: "new"; kind: "new"; name: string }` (moved unchanged from `new-deal-dialog.tsx:37`; `detail` is the line the picker shows under a name), `contactBody(choice: ContactChoice | null): ContactRef` (moved from `new-deal-dialog.tsx:291`: existing gives `{ id }`, new gives `{ name }`, none gives `null`; Tasks 20 to 24 send contacts only through it), `existingChoice(kind: "person" | "organization", result: ContactResult): ContactChoice` (moved; also turns a panel's `{ id, name }` into a choice), `ContactPicker({ kind, label, placeholder, inputRef, value, onChange, disabled }: { kind: "organization" | "person"; label: string; placeholder: string; inputRef?: React.RefObject<HTMLInputElement | null>; value: ContactChoice | null; onChange: (value: ContactChoice | null) => void; disabled?: boolean })` (Plan 2's props plus `disabled`; callers focus it through `inputRef`; search through `searchContactsRequest`, last option "Add new {person|organization}: {text}", detail line in `MUTED_TEXT`).
- Produces (`format.ts`): `endSentence(text: string): string` (adds "." unless empty or already ending in ".", "!" or "?"), `joinNames(names: string[]): string`.
- Produces (`api-client.ts`): `getLeadRowsPage(query: LeadsQuery): Promise<ApiResult<LeadRowsPage>>`, `getLeadPanel(leadId)`, `getLeadTimeline(leadId, cursor: TimelineCursor | null)`, `createLeadRequest(body: CreateLeadInput)`, `updateLeadRequest(leadId, body: UpdateLeadInput)`, `setLeadArchivedRequest(leadId, archived: boolean)`, `setLeadFieldRequest(leadId, fieldKey, value: string | null)`, `runLeadBulkRequest(body: BulkLeadInput)`, `getConvertTargets(): Promise<ApiResult<{ targets: ConvertTarget[] }>>`, `convertLeadRequest(leadId, body: ConvertLeadInput)`, `convertLeadsRequest(body: BulkConvertInput)` (types imported with `import type`).

- [ ] **Step 1: Write the failing tests**
- `format.test.ts`: `endSentence("Robert O.")` is `"Robert O."`; `"DJ"` gives `"DJ."`; `""` gives `""`; `"Done!"` stays; `joinNames([])` is `""`; `["Ben S."]` gives `"Ben S."`; `["Ben S.", "Robert O."]` gives `"Ben S. and Robert O."`; `["Ben S.", "Dana Q.", "Robert O."]` gives `"Ben S., Dana Q. and Robert O."`.
- `api-client.test.ts` (fetch mocked): `getLeadRowsPage({ scope: "mine", q: "oak", cursor: "l50" })` GETs `/api/sales/leads?scope=mine&q=oak&cursor=l50`; `getLeadPanel("l1")` GETs `/api/sales/leads/l1`; `getLeadTimeline("l1", { at, id })` GETs `/api/sales/leads/l1/timeline?...` with the same query encoding as `getDealTimeline`; `createLeadRequest` POSTs `/api/sales/leads`; `updateLeadRequest("l1", ...)` PATCHes `/api/sales/leads/l1`; `setLeadArchivedRequest("l1", true)` POSTs `/api/sales/leads/l1/archive` with body `{"archived":true}`; `setLeadFieldRequest("l1", "practice-zip", "78704")` PUTs `/api/sales/leads/l1/fields/practice-zip` with `{"value":"78704"}`; `runLeadBulkRequest` POSTs `/api/sales/leads/bulk`; `getConvertTargets()` GETs `/api/sales/leads/convert`; `convertLeadRequest("l1", ...)` POSTs `/api/sales/leads/l1/convert`; `convertLeadsRequest` POSTs `/api/sales/leads/convert`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/format.test.ts tests/lib/sales/api-client.test.ts tests/lib/sales/new-deal-dialog-render.test.ts tests/lib/sales/muted-tone-render.test.ts`
Expected: FAIL (format and api-client cases, and the moved `{choice.detail}` check; the dialog test passes).

- [ ] **Step 3: Implement.** Move the combobox code, `ContactChoice`, `contactBody` and `existingChoice` from `new-deal-dialog.tsx` into `contact-picker.tsx` without changing markup, classes or copy; `disabled` passes through to the input and the trigger.

- [ ] **Step 4: Run to verify they pass** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/sales/contact-picker.tsx src/components/sales/new-deal-dialog.tsx src/lib/sales/api-client.ts src/lib/sales/format.ts tests/lib/sales/format.test.ts tests/lib/sales/api-client.test.ts tests/lib/sales/muted-tone-render.test.ts
git commit -m "refactor(sales): shared contact picker, lead requests and sentence helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Leads Inbox page, new lead, assign, archive and delete

Load ui-ux-pro-max, impeccable and emil-design-eng first. Read `page.md` and `loading.md`. Look: Mockup v2 (new lead dialog, assign picker) and v1 `viewLeads`.

**Files:**
- Create: `src/app/(app)/sales/leads/page.tsx`, `src/app/(app)/sales/leads/loading.tsx`, `src/components/sales/leads-view.tsx`, `src/components/sales/new-lead-dialog.tsx`, `src/components/sales/lead-bulk-dialogs.tsx` (`LeadsBulkBar`, `AssignLeadsDialog`, `DeleteLeadsDialog`), `src/lib/sales/leads-client.ts` (pure)
- Test: `tests/lib/sales/leads-client.test.ts`, `tests/lib/sales/leads-page-gate.test.ts`, `tests/lib/sales/leads-view-render.test.ts`; modify `tests/lib/sales/scroll-containment-render.test.ts`

**Interfaces:**
- Consumes: Task 4's `loadLeadsPage`, `LeadsPageData`, `parseLeadsQuery`, `leadsQueryToSearch`, `AssignmentSummary`; Task 5's `BulkLeadResult`; Task 19's wrappers, `ContactPicker`, `contactBody`, `endSentence`, `joinNames`; `NextStepPill`, `OwnerAvatar`, `SEGMENT_GROUP`, `SEGMENT`, `MUTED_TONE`, `ShortcutsButton`, `useSalesShortcut`; `appendPage`; `panelHref`, `changePanelUrl`, `refreshAfterWrite`, `pageRendered`; `FIRST_ACTIVITY_PRESETS`, `DEAL_SOURCES`, `HAND_MADE_SOURCE`.
- Produces (`leads-client.ts`): `assignmentLine(summary: AssignmentSummary, isAdmin: boolean): string`, `leadAgeDays(createdAt: string, now: Date): number`, `isOldLead(days: number): boolean` (more than 2), `selectionState(selected: ReadonlySet<string>, rowIds: readonly string[]): "none" | "some" | "all"`, `pruneSelection(selected: ReadonlySet<string>, rowIds: readonly string[]): Set<string>`, `leadsEmptyState(query: LeadsQuery, canSeeEveryone: boolean): { title: string; description: string; action: { label: string; href: string } }`, `bulkToast(action: "assign" | "archive" | "restore" | "delete", n: number, ownerName?: string): string`, `bulkFailureLine(results: BulkLeadResult[]): string | null`.
- Produces (components): `LeadsView({ data: LeadsPageData; viewer: { userId: string; isAdmin: boolean }; now: string; openNew: boolean })`; `LeadRowView({ row, selected, now, ownerName, onToggle }: { row: LeadRow; selected: boolean; now: Date; ownerName: string | null; onToggle: (id: string) => void })` (one Inbox row, table row and stacked card in one, exported so a ticked row can be rendered); `LeadsBulkBar({ count, isAdmin, onConvert, onAssign, onArchive, onDelete, onClear }: { count: number; isAdmin: boolean; onConvert?: () => void; onAssign: () => void; onArchive: () => void; onDelete: () => void; onClear: () => void })` ("Convert to deal" shows only when `onConvert` is given; Task 21 gives it); `NewLeadDialog`, `AssignLeadsDialog`, `DeleteLeadsDialog`.
- Copy (pinned): h1 "Leads Inbox"; sub "New opt-ins land here first. Convert the good ones to deals."; button "Lead" with a plus icon (`aria-label="Add lead"`); search `aria-label="Search leads"`, placeholder "Search leads"; columns "Lead", "Source", "Created", "Owner", "Next step" (card labels under 640px "Source:", "Created:", "Owner:", "Next:"); row line "{person} · ZIP {zip}"; pill "{n}d old". New lead: title "Add lead"; "Person" (placeholder "Sarah K."), "Organization" ("Practice name"), "Source" (default "Added by hand"), "Practice ZIP" (placeholder "78704"), "Owner" (admins: members by short name plus "Share out automatically"; others: disabled, showing themselves), "First activity" ("Call today" default, "Call tomorrow", "Demo in 2 days"); inline error "Add a person or an organization."; buttons "Cancel" / "Save"; toast "Lead added with its first activity.". Assign: title "Assign 1 lead" / "Assign {n} leads", text "Their open activities move with them.", select label "New owner", buttons "Cancel" / "Assign". Delete (admins): title "Delete 1 lead?" / "Delete {n} leads?", text "They disappear from the Inbox. Their history stays.", buttons "Cancel" (autofocus) / "Delete" (destructive). Archive: toast `bulkToast("archive", n)` with Undo (bulk restore, toast `bulkToast("restore", n)`).

- [ ] **Step 1: Write the failing tests**

`leads-client.test.ts`:
- "names who gets new leads with one period": `assignmentLine({ mode: "ROUND_ROBIN", names: ["Ben S.", "Robert O."], fallbackName: null }, true)` is `"New leads are shared out round-robin between Ben S. and Robert O. Change it in Sales settings."`; three names give `"New leads are shared out round-robin between Ben S., Dana Q. and Robert O. Change it in Sales settings."`; with `isAdmin: false`, `"New leads are shared out round-robin between Ben S. and Robert O."`; SINGLE `["Ben S."]` (admin) `"New leads are shared out to Ben S. Change it in Sales settings."`; SINGLE `["DJ"]` (admin) `"New leads are shared out to DJ. Change it in Sales settings."`; no names with `fallbackName: "Dana E."` (admin) `"New leads go to Dana E. until someone is picked. Change it in Sales settings."`; no names and no fallback `"Nobody can take new leads yet."`; no result contains `".."`.
- "ages leads in Eastern days": `leadAgeDays("2026-11-02T15:00:00.000Z", NOW)` is 3; `isOldLead(3)` true, `isOldLead(2)` false.
- "ticks loaded rows only": `selectionState(new Set(), ["l1", "l2"])` `"none"`; `{l1}` `"some"`; `{l1, l2}` `"all"`; `{l1, l9}` with rows `["l1", "l2"]` `"some"`; any set with no rows `"none"`; `pruneSelection(new Set(["l1", "l9"]), ["l1", "l2"])` is `{l1}`.
- "explains an empty Inbox": defaults with `canSeeEveryone: true` give `{ title: "Inbox zero.", description: "New Check Availability opt-ins will show up here.", action: { label: "Add a lead", href: "/sales/leads?new=1" } }`; `q: "oak"` gives `{ title: "No leads match \"oak\".", description: "Try another name, or clear the search.", action: { label: "Clear search", href: "/sales/leads" } }`; `scope: "mine"` with `canSeeEveryone: true` gives `{ title: "No open leads of yours.", description: "Leads you own show up here.", action: { label: "Show everyone's", href: "/sales/leads" } }`.
- "words bulk results": `bulkToast("assign", 1, "Robert O.")` `"Assigned to Robert O."`; `("assign", 3, "Robert O.")` `"3 leads assigned to Robert O."`; `("assign", 1, "DJ")` `"Assigned to DJ."`; `("archive", 2)` `"2 archived."`; `("restore", 2)` `"2 restored."`; `("delete", 1)` `"Lead deleted."`; `("delete", 4)` `"4 leads deleted."`; `bulkFailureLine([{ id: "l1", ok: true }, { id: "l2", ok: false, error: "Only the lead owner or an admin can change this lead." }])` is `"1 of 2 could not be changed. Only the lead owner or an admin can change this lead."`; all ok gives `null`.

`leads-page-gate.test.ts`: the gate rejecting stops the loader; `?scope=mine&new=1` calls `loadLeadsPage(actor, { scope: "mine", q: "", cursor: null })` and passes `openNew: true`.

`leads-view-render.test.ts`:
- the header copy; table head cells `"Lead"`, `"Source"`, `"Created"`, `"Owner"`, `"Next step"`; the header checkbox `aria-label="Select all shown leads"`; a second select-all box with the same label inside an element with class `sm:hidden` above the cards (the phone strip); a row checkbox `aria-label="Select Crestview Dental"`; `"Laura B. · ZIP 78704"`; a `"3d old"` pill; the title link `href="/sales/leads?lead=l1"` with `data-lead-id="l1"`; the footer from `assignmentLine`; no Everyone / Just me for a see-own viewer.
- `LeadsBulkBar` with `count: 2, isAdmin: true` and every handler: `role="region"` with `aria-label="Selected leads"`, `"2 selected"` inside `role="status"`, the classes `max-sm:sticky` and `max-sm:top-0`, buttons `"Convert to deal"`, `"Assign to…"`, `"Archive"`, `"Delete"`, `"Clear"`, on `bg-accent text-accent-foreground`; `isAdmin: false`: no `"Delete"`; no `onConvert`: no `"Convert to deal"`.
- "grey words stay readable on a ticked row": `LeadRowView` with `selected: true` renders `bg-accent`, and no `class` attribute in its HTML holds `text-muted-foreground` as a whole token (MUTED_TEXT's `dark:text-muted-foreground` is fine; its grey words, card labels included, use `MUTED_TEXT`); a source check like Task 1's: the text of `function LeadRowView` in `leads-view.tsx`, up to the next top-level `function`, contains no `text-muted-foreground`.
- `scroll-containment-render.test.ts` adds `LeadsView`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/leads-client.test.ts tests/lib/sales/leads-page-gate.test.ts tests/lib/sales/leads-view-render.test.ts tests/lib/sales/scroll-containment-render.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `leads-client.ts`**, then the page, view and dialogs.
- The view copies `deals-list.tsx`'s table, stacked cards under 640px and "Show more" (reset when the server sends new rows; ticks pruned with `pruneSelection`); rows render through `LeadRowView`; a ticked row uses `bg-accent` and its grey words `MUTED_TEXT` (its own card label, not `deals-list.tsx`'s `CardLabel`, which is `text-muted-foreground`); the header checkbox and the phone strip's box (both "Select all shown leads") show `aria-checked="mixed"` for "some"; `useSalesShortcut("search", ...)` focuses the search; filter changes go through `leadsQueryToSearch` and `router.replace`.
- Bulk actions call `runLeadBulkRequest`, toast `bulkToast(...)`, show `bulkFailureLine` with `toast.error` when some failed, clear the selection, then `refreshAfterWrite(router)`.
- 375px: header wraps (the button drops under the title), the search goes full width, the select-all strip sits above the cards, the bulk bar wraps and sticks to the top (`max-sm:sticky max-sm:top-0 max-sm:z-10 max-sm:shadow`), checkboxes keep a 40px hit area.
- `loading.tsx`: header, search and six row skeletons, `aria-busy="true"`.

- [ ] **Step 4: Run to verify they pass** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass. Controller click-through note: select-all with "Show more", archive and Undo, assign as a non-admin, delete as admin, new lead "Share out automatically", footer punctuation.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/sales/leads/page.tsx" "src/app/(app)/sales/leads/loading.tsx" src/components/sales/leads-view.tsx src/components/sales/new-lead-dialog.tsx src/components/sales/lead-bulk-dialogs.tsx src/lib/sales/leads-client.ts tests/lib/sales/leads-client.test.ts tests/lib/sales/leads-page-gate.test.ts tests/lib/sales/leads-view-render.test.ts tests/lib/sales/scroll-containment-render.test.ts
git commit -m "feat(sales): Leads Inbox with new lead, assign, archive and delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Lead panel and the convert dialogs

Load ui-ux-pro-max, impeccable and emil-design-eng first. Look: Mockup v2's lead panel, convert and bulk convert dialogs, and v1 `leadPanel` / `convertModal`.

**Files:**
- Create: `src/components/sales/lead-panel.tsx` (`LeadPanel`, `LeadPanelBody`), `src/components/sales/lead-details.tsx`, `src/components/sales/convert-dialog.tsx`, `src/lib/sales/convert-client.ts` (pure)
- Modify: `src/components/sales/activity-composer.tsx:42-50` (prop `parent: SalesParentRef` replaces `dealId`; saves through `createActivityFor` / `addNoteFor`), `src/components/sales/deal-panel.tsx:311` (passes `parent`), `src/app/(app)/sales/layout.tsx` (mounts `<LeadPanel />` inside the existing Suspense), `src/components/sales/leads-view.tsx` (gives `LeadsBulkBar` its `onConvert`), `src/components/sales/activities-view.tsx` (R8's wording, held back from Task 7 by R2: the "Deal" column heading becomes "Deal or lead" and a lead row shows a "Lead" pill in `MUTED_TONE`), `src/lib/sales/activities-client.ts` (the "open" empty-state line)
- Test: `tests/lib/sales/convert-client.test.ts`, `tests/lib/sales/lead-panel-render.test.ts`; modify `tests/lib/sales/deal-panel-render.test.ts` and `tests/lib/sales/leads-view-render.test.ts` where they pass the composer or the bulk bar, `tests/lib/sales/activities-client.test.ts`, `tests/lib/sales/activities-view-render.test.ts`, `tests/lib/sales/scroll-containment-render.test.ts` (adds `LeadPanelBody`)

**Interfaces:**
- Consumes: Task 3's `LeadPanelData` (with `canRestore`); Task 8's `ConvertTarget`; Task 19's wrappers, `ContactPicker`, `contactBody`, `existingChoice`, `endSentence`; Task 6's `SalesParentRef`, `useActivityDone`; Task 7's `activePanel`, `panelHref`; `DEAL_PANEL_SHEET_CLASS`, `PanelCloseButton`, `NextSteps`, `DealHistory`, `parseMoneyToCents` (`@/lib/sales/format`).
- Produces (`convert-client.ts`): `convertTitle(n: number): string`, `whyLine(titles: string[]): string`, `convertToast(n: number, pipelineName: string): string`, `skippedLine(titles: string[]): string | null`, `type LeadNotice = { tone: "info" | "warning"; text: string; action: "open-deal" | "restore" | "schedule" | null }`, `leadNotice(data: LeadPanelData): LeadNotice | null`, `leadReadOnlyLine(ownerName: string): string`, `convertTargetsState(load: "loading" | "error" | { targets: ConvertTarget[] }): { kind: "loading"; text: string } | { kind: "error"; text: string; action: string } | { kind: "empty"; text: string } | { kind: "ready" }`.
- Produces (components): `LeadPanel()` (open when `activePanel(searchParams)` is a lead; `finalFocus` returns to the `[data-lead-id]` row that opened it, as `DealPanel` does with `data-deal-id`), `LeadPanelBody({ data, now, onChanged, onClose }: { data: LeadPanelData; now: Date; onChanged: () => void; onClose: () => void })`, `ConvertDialog({ open, onOpenChange, leads, onConverted }: { open: boolean; onOpenChange: (open: boolean) => void; leads: { id: string; title: string; personName: string | null; organizationName: string | null }[]; onConverted: (result: { dealId: string | null; pipelineName: string; converted: number }) => void })`; `ActivityComposer({ parent, onSaved, ref })`.

- [ ] **Step 1: Write the failing tests**

`convert-client.test.ts`:
- `convertTitle(1)` `"Convert to deal"`; `convertTitle(3)` `"Convert 3 leads to deals"`.
- `whyLine(["Crestview Dental", "Oak Creek"])` `"Crestview Dental, Oak Creek"`; seven titles A to G give `"A, B, C, D, E and 2 more"`.
- `convertToast(1, "Direct Mail")` `"Lead converted. Find it in Direct Mail."`; `convertToast(3, "Direct Mail")` `"3 leads converted. Find them in Direct Mail."`.
- `skippedLine(["Crestview Dental", "Oak Creek"])` `"Add a person or an organization first: Crestview Dental, Oak Creek."`; `skippedLine(["Dr. Lee K."])` `"Add a person or an organization first: Dr. Lee K."`; `skippedLine([])` `null`.
- `leadNotice`: CONVERTED with `convertedDeal: { id: "d7", title: "Oak Creek Dental" }` gives `{ tone: "info", text: "Converted to Oak Creek Dental.", action: "open-deal" }`; CONVERTED with `null` gives `{ tone: "info", text: "Converted to a deal you cannot open.", action: null }`; ARCHIVED with `canRestore` gives `{ tone: "info", text: "This lead is archived.", action: "restore" }` (without `canRestore`, `action: null`); OPEN with no open activities and `canEdit` gives `{ tone: "warning", text: "No next step. Call within 5 minutes of opt-in works best.", action: "schedule" }`; OPEN with one gives `null`. `leadReadOnlyLine("Ben S.")` is `"Only Ben S. or an admin can change this lead."`.
- "the convert dialog explains its pipelines list": `convertTargetsState("loading")` is `{ kind: "loading", text: "Loading pipelines…" }`; `"error"` gives `{ kind: "error", text: "Could not load pipelines.", action: "Try again" }`; `{ targets: [] }` gives `{ kind: "empty", text: "No sales pipelines yet. Ask an admin to run the Sales setup." }`; one target gives `{ kind: "ready" }`.

`activities-client.test.ts`: the "open" empty state's description is `"Activities you plan on a deal or lead show up here."`.

`activities-view-render.test.ts`: the table head says "Deal or lead"; a lead row shows a "Lead" pill (`MUTED_TONE` classes).

`scroll-containment-render.test.ts` adds `LeadPanelBody` (every scroller in it is also `relative`).

`lead-panel-render.test.ts` (Base UI dialog mocked as in `deal-panel-render.test.ts`; renders `LeadPanelBody`):
- an OPEN lead with no activity, owned by the viewer: crumb `"Leads Inbox"`, `aria-label="Lead name"` input with value `"Crestview Dental"`, button `"Convert to deal"`, the warning text and a `"Schedule"` button; composer tabs `"Activity"` and `"Note"` only; Details labels `"Source"`, `"Organization"`, `"Person"`, `"Practice ZIP"`, `"Created"`; the HTML has no `data-sales-deal-panel`.
- CONVERTED with d7: `"Converted to Oak Creek Dental."` and a link whose `href` contains `deal=d7` and not `lead=`; with no visible deal: `"Converted to a deal you cannot open."`; owner "b" seen by seesAll "r": `"Only Ben S. or an admin can change this lead."` and no composer; ARCHIVED with `canRestore`: `"This lead is archived."` with `"Restore"` and no composer.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/convert-client.test.ts tests/lib/sales/lead-panel-render.test.ts tests/lib/sales/deal-panel-render.test.ts tests/lib/sales/leads-view-render.test.ts tests/lib/sales/activities-client.test.ts tests/lib/sales/activities-view-render.test.ts tests/lib/sales/scroll-containment-render.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `convert-client.ts`**, then the panel and dialogs.
- Panel shell, load states, close and the sonner guard copy `deal-panel.tsx` (404 text "This lead is not available." / "It may have been deleted, or it belongs to someone whose leads you cannot see."; error "Could not load this lead." with "Try again"). Header: crumb, editable title (blur or Enter saves via `updateLeadRequest`, Esc reverts), person and organization, owner select for owner/admin (toast `endSentence("Owner changed to " + shortName(name))`), primary "Convert to deal". Body in order: notice bar from `leadNotice` ("Schedule" focuses the composer, "Restore" calls `setLeadArchivedRequest(id, false)`, "Open deal" swaps to `?deal=`), composer with `parent: { kind: "lead", id }`, Next steps (`useActivityDone` with the lead as parent), Details (`lead-details.tsx`: Source select, Organization and Person `ContactPicker`s (started from `existingChoice`) saving `{ organization: contactBody(choice) }` / `{ person: contactBody(choice) }` through `updateLeadRequest`, custom fields like `DealDetails` through `setLeadFieldRequest`, Created as a date), History (`DealHistory` fed by `getLeadTimeline`).
- Convert dialog: loads `getConvertTargets()` when opened and shows `convertTargetsState` (loading: both selects disabled with that text; error: the text and a "Try again" button that loads again, Convert disabled; empty: the text, Convert disabled); Pipeline select, Stage select (first by default); single: the lead's "Person: {name} · Organization: {name}" line from `personName` / `organizationName` (a missing side left out), or, when both are null, two `ContactPicker`s with "Add a person or an organization." (sent through `contactBody`); bulk: a lead with both null counts as skipped; "Value ($)" placeholder "Optional", or "Total value ($)" and "Monthly value ($)" (both required, text "A proposal needs a real price, so both values are required.") when the stage `requiresValue`; bulk: no value fields, stages that need a value are not offered, `whyLine` under the title and `skippedLine` for the leads without contacts. Buttons "Cancel" / "Convert" (disabled while saving). On success, single: toast `convertToast(1, pipelineName)` and the panel URL is replaced with `panelHref(..., { kind: "deal", id })`; bulk: toast `convertToast(converted, pipelineName)`, `bulkFailureLine` as an error toast when some failed, selection cleared; then `refreshAfterWrite(router)`.
- 375px: panel full screen; header wraps with "Convert to deal" on its own line; dialog fields stack.

- [ ] **Step 4: Run to verify they pass** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass. Controller click-through note: convert into Proposal Sent (values asked), double-click Convert, bulk convert with a lead lacking contacts, the panel swap to the deal, Activities lead rows now open this panel.

- [ ] **Step 6: Commit**

```bash
git add src/components/sales/lead-panel.tsx src/components/sales/lead-details.tsx src/components/sales/convert-dialog.tsx src/lib/sales/convert-client.ts src/components/sales/activity-composer.tsx src/components/sales/deal-panel.tsx "src/app/(app)/sales/layout.tsx" src/components/sales/leads-view.tsx src/components/sales/activities-view.tsx src/lib/sales/activities-client.ts tests/lib/sales/convert-client.test.ts tests/lib/sales/lead-panel-render.test.ts tests/lib/sales/deal-panel-render.test.ts tests/lib/sales/leads-view-render.test.ts tests/lib/sales/activities-client.test.ts tests/lib/sales/activities-view-render.test.ts tests/lib/sales/scroll-containment-render.test.ts
git commit -m "feat(sales): lead panel and the convert-to-deal dialogs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: Contacts page and the add person / add organization dialogs

Load ui-ux-pro-max, impeccable and emil-design-eng first. Read `page.md` and `loading.md`. Look: Mockup v2 `viewContacts`, `addPersonModal`, `addOrgModal`.

**Files:**
- Create: `src/app/(app)/sales/contacts/page.tsx`, `src/app/(app)/sales/contacts/loading.tsx`, `src/components/sales/contacts-view.tsx`, `src/components/sales/new-contact-dialogs.tsx` (`NewPersonDialog`, `NewOrganizationDialog`), `src/lib/sales/contacts-client.ts` (pure)
- Modify: `src/lib/sales/api-client.ts` (`getContactRowsPage`, `createContactRequest`)
- Test: `tests/lib/sales/contacts-client.test.ts`, `tests/lib/sales/contacts-page-gate.test.ts`, `tests/lib/sales/contacts-view-render.test.ts`; modify `tests/lib/sales/api-client.test.ts`, `tests/lib/sales/scroll-containment-render.test.ts`

**Interfaces:**
- Consumes: Task 9's `ContactKind`, `CONTACT_PATHS`, `ContactsQuery`, `parseContactsQuery`, `contactsQueryToSearch`, `ContactsPageData`, `ContactRow`, `ContactRowsPage`, `loadContactsPage`; Task 10's `CreatePersonInput` / `CreateOrganizationInput` (`import type`); Task 19's `ContactPicker`, `ContactChoice`, `contactBody`, `endSentence`; `OwnerAvatar`, `SEGMENT_GROUP`, `SEGMENT`, `MUTED_TEXT`, `useSalesShortcut`; `appendPage`; `panelHref`, `changePanelUrl`, `refreshAfterWrite`, `pageRendered`; `EmptyState`.
- Produces (`contacts-client.ts`): `contactsEmptyState(query: ContactsQuery): { title: string; description: string | null; action: { label: string; href: string } }` (a `null` description renders the one-line search strip instead of the empty block).
- Produces (`api-client.ts`): `getContactRowsPage(query: ContactsQuery): Promise<ApiResult<ContactRowsPage>>`, `createContactRequest(kind: ContactKind, body: CreatePersonInput | CreateOrganizationInput): Promise<ApiResult<{ contact: { id: string; name: string } }>>`.
- Produces (components): `ContactsView({ data: ContactsPageData; viewer: { userId: string; isAdmin: boolean }; openNew: ContactKind | null })`, `NewPersonDialog({ open, onOpenChange, onCreated })`, `NewOrganizationDialog({ open, onOpenChange, onCreated })` (`onCreated(contact: { id: string; name: string })`).
- Copy (pinned, Mockup v2): h1 "Contacts"; sub "People and the practices they work at."; header button "Person" / "Organization" with a plus icon (`aria-label="Add person"` / `"Add organization"`), matching the open tab; tabs (`role="tablist"`, `aria-label="Contacts"`, Mockup v2) "People" / "Organizations", each `role="tab"` with `aria-selected`, `aria-controls` naming the list below (`role="tabpanel"`, `aria-labelledby` the active tab), roving `tabIndex` (0 on the active tab, -1 on the other); ArrowLeft / ArrowRight / Home / End move focus between the two tabs and Enter, Space or a click opens one (manual activation, since opening a tab reloads the list), the key handling copied from `activity-composer.tsx`; search placeholder "Search people" / "Search organizations", `aria-label="Search people by name"` / `"Search organizations by name"`; columns People: an sr-only "Owner" avatar column, "Name", "Organization", "Open deals", "Owner"; Organizations: avatar, "Organization", "Contact", "Open deals", "Owner" (an empty Organization or Contact cell says "None" in `MUTED_TEXT`; card labels under 640px "Organization:" / "Contact:", "Open deals:", "Owner:"). Add person: title "Add person"; "Name" (placeholder "Sarah K.", required, inline "Add a name."), "Organization" (`ContactPicker`, placeholder "Search or add a practice"), "Role in practice" (placeholder "Office manager"), "Email" (placeholder "name@example.com"), "Phone" (placeholder "(512) 555-0100"); text "You will be the owner. Email and phone show only on this person's page and their deals."; buttons "Cancel" / "Save"; toast "Person added.". Add organization: title "Add organization"; "Name" (placeholder "Practice name"), "Phone", "ZIP" (placeholder "78704"), "Website" (placeholder "https://"), "Address" (placeholder "Street, city, state"); text "You will be the owner."; toast "Organization added.". Server refusals (Task 10's pinned messages) show inline under the form with `role="alert"`; after a save the new contact's panel opens.

- [ ] **Step 1: Write the failing tests**

`contacts-client.test.ts` ("explains an empty Contacts tab"):
- `{ tab: "people", scope: "everyone", q: "", cursor: null }` gives `{ title: "No people yet.", description: "People are added with each deal and lead, or here by hand.", action: { label: "Person", href: "/sales/contacts?new=person" } }`; the organizations tab gives `{ title: "No organizations yet.", description: "Practices are added with each deal and lead, or here by hand.", action: { label: "Organization", href: "/sales/contacts?tab=organizations&new=organization" } }`.
- `q: "oak"` on people gives `{ title: "No people match \"oak\".", description: null, action: { label: "Clear search", href: "/sales/contacts" } }`; on organizations with `scope: "mine"`: `{ title: "No organizations match \"oak\".", description: null, action: { label: "Clear search", href: "/sales/contacts?tab=organizations&scope=mine" } }`.
- `scope: "mine"` on people gives `{ title: "No people of yours yet.", description: "People you own show up here.", action: { label: "Show everyone's", href: "/sales/contacts" } }`; on organizations `{ title: "No organizations of yours yet.", description: "Organizations you own show up here.", action: { label: "Show everyone's", href: "/sales/contacts?tab=organizations" } }`.

`contacts-page-gate.test.ts`: the gate rejecting stops the loader; `?tab=organizations&scope=mine&new=organization` calls `loadContactsPage(actor, { tab: "organizations", scope: "mine", q: "", cursor: null })` and passes `openNew: "organization"`; `?new=bogus` passes `openNew: null`.

`api-client.test.ts`: `getContactRowsPage({ tab: "organizations", scope: "mine", q: "oak", cursor: "o50" })` GETs `/api/sales/contacts/organizations?scope=mine&q=oak&cursor=o50`; `createContactRequest("person", { name: "Sarah K." })` POSTs `/api/sales/contacts/people` with body `{"name":"Sarah K."}`.

`contacts-view-render.test.ts`:
- People tab, an admin, rows "Sarah K." (organization "Oak Creek Dental", 2 open deals) and "Laura B." (no organization): the header copy, `role="tablist"` holding two `role="tab"` buttons, "People" with `aria-selected="true"` and `tabindex="0"`, "Organizations" with `aria-selected="false"` and `tabindex="-1"`, both with `aria-controls` equal to the `id` of the `role="tabpanel"` element, head cells `"Name"`, `"Organization"`, `"Open deals"`, `"Owner"`, `"None"` for Laura B., the Sarah K. row link `href="/sales/contacts?person=p1"` with `data-person-id="p1"`, the Everyone / Just me group.
- Organizations tab: head cells `"Organization"`, `"Contact"`; a row links `?tab=organizations&amp;organization=o1` and carries `data-organization-id="o1"` (the contact panel returns focus there); the header button says `"Organization"`.
- A see-own viewer: no Everyone / Just me; no rows and no search: the `contactsEmptyState` title, description and action, and no search box; a search with no match: the one-line strip `No people match "oak".` with `"Clear search"`; the page never shows an email address or phone number (the fixture rows carry none and the HTML contains no `mailto:` or `tel:`).
- `scroll-containment-render.test.ts` adds `ContactsView`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/contacts-client.test.ts tests/lib/sales/contacts-page-gate.test.ts tests/lib/sales/contacts-view-render.test.ts tests/lib/sales/api-client.test.ts tests/lib/sales/scroll-containment-render.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `contacts-client.ts`**, then the wrappers, the page, the view and the dialogs.
- `page.tsx`: `requireSalesPage()`, `parseContactsQuery(params)`, `loadContactsPage(actor, query)`, `openNew` is `"person"` or `"organization"` when `params.new` says so, else `null`.
- The view copies `leads-view.tsx`'s table, cards, "Show more" and search debounce. The search box shows unless the tab has no rows with no search and scope "everyone". Tab and filter changes go through `contactsQueryToSearch` and `router.replace` (the cursor is never in the URL); the `?new=` parameter is dropped from the URL once its dialog opens.
- Dialogs: one request per Save (button disabled while saving; the person's organization sent through `contactBody`); on success toast, close, `refreshAfterWrite(router)`, then open the new contact through `changePanelUrl(panelHref(...))`.
- `loading.tsx`: header, tabs, search and six row skeletons, `aria-busy="true"`.

- [ ] **Step 4: Run to verify they pass** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass. Controller click-through note: both tabs at 375px, add person with a new organization, "Show more", a see-own user sees only their contacts.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/sales/contacts/page.tsx" "src/app/(app)/sales/contacts/loading.tsx" src/components/sales/contacts-view.tsx src/components/sales/new-contact-dialogs.tsx src/lib/sales/contacts-client.ts src/lib/sales/api-client.ts tests/lib/sales/contacts-client.test.ts tests/lib/sales/contacts-page-gate.test.ts tests/lib/sales/contacts-view-render.test.ts tests/lib/sales/api-client.test.ts tests/lib/sales/scroll-containment-render.test.ts
git commit -m "feat(sales): Contacts page with people, organizations and add dialogs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: Contact panel, duplicate bar and the merge dialog

Load ui-ux-pro-max, impeccable and emil-design-eng first. Look: Mockup v2 `personPanel`, `orgPanel`, `dupBar`, `mergeModal`.

**Files:**
- Create: `src/components/sales/contact-panel.tsx` (`ContactPanel`, `ContactPanelBody`), `src/components/sales/contact-details.tsx` (`PersonDetails`, `OrganizationDetails`), `src/components/sales/merge-dialog.tsx`
- Modify: `src/app/(app)/sales/layout.tsx` (mounts `<ContactPanel />` next to the lead panel), `src/lib/sales/api-client.ts` (panel, timeline, edit and merge wrappers), `src/lib/sales/contacts-client.ts` (duplicate and merge wording)
- Test: modify `tests/lib/sales/contacts-client.test.ts`, `tests/lib/sales/api-client.test.ts`, `tests/lib/sales/scroll-containment-render.test.ts` (adds `ContactPanelBody`); create `tests/lib/sales/contact-panel-render.test.ts`

**Interfaces:**
- Consumes: Task 9's `ContactPanelData`, `PersonPanelData`, `OrganizationPanelData`, `DuplicateInfo`, `ContactKind`, `CONTACT_PATHS`; Task 10's `UpdatePersonInput` / `UpdateOrganizationInput` (`import type`; the schemas stay on the server) and `safeWebHref`, `mailtoHref`, `telHref` (client-safe `contact-links.ts`); Task 11's `MergeCounts` (`import type`); Task 7's `activePanel`, `panelHref`; Task 19's `ContactPicker`, `contactBody`, `existingChoice`, `endSentence`, `joinNames`; `DEAL_PANEL_SHEET_CLASS`, `PanelCloseButton`, `DealHistory`, `OwnerAvatar`, `MUTED_TEXT`, `formatMoney`, `shortName`.
- Produces (`api-client.ts`): `getContactPanel(kind: ContactKind, id: string): Promise<ApiResult<ContactPanelData>>`, `getContactTimeline(kind, id, cursor: TimelineCursor | null)`, `updateContactRequest(kind, id, body: UpdatePersonInput | UpdateOrganizationInput): Promise<ApiResult<{ changed: boolean; contact: { id: string; name: string } }>>`, `getMergePreview(kind, keepId: string, dropId: string): Promise<ApiResult<{ keep: { id: string; name: string }; drop: { id: string; name: string }; counts: MergeCounts }>>`, `mergeContactsRequest(kind, keepId: string, dropId: string): Promise<ApiResult<{ kept: { id: string; name: string } }>>`.
- Produces (`contacts-client.ts`): `type DuplicateNotice = { kind: "hidden"; text: string } | { kind: "matches"; label: string; matches: { id: string; name: string }[]; tail: string | null }`, `duplicateNotice(info: DuplicateInfo, canMerge: boolean): DuplicateNotice | null`, `mergeCountsLine(counts: MergeCounts): string`, `mergeConfirmLine(kind: ContactKind, keepName: string, dropName: string): string`, `mergeFillLine(keepName: string, dropName: string): string`, `mergedToast(keepName: string, dropName: string): string`, `contactMetaCount(n: number): string`, `listCapLine(shown: number, total: number): string | null`, `MERGE_PREVIEW_ERROR = "Could not load what will move."`.
- Produces (components): `ContactPanel()` (open when `activePanel(searchParams)` is a person or organization; `finalFocus` returns to the `[data-person-id]` or `[data-organization-id]` row that opened it), `ContactPanelBody({ data, now, onChanged, onClose }: { data: ContactPanelData; now: Date; onChanged: () => void; onClose: () => void })`, `MergeDialog({ open, onOpenChange, kind, keepId, dropId, onMerged }: { open: boolean; onOpenChange: (open: boolean) => void; kind: ContactKind; keepId: string; dropId: string; onMerged: (kept: { id: string; name: string }) => void })`.
- Copy (pinned, Mockup v2): crumb "Contacts"; the name as the heading (edited in Details, not in the header). Person meta: organization as a link that opens its panel when `organization.visible`, as plain text when not, or "No organization"; role; "Owner {short name}". Organization meta: `contactMetaCount(counts.people)`, "ZIP {zip}", "Owner {short name}". Section count pills read `counts`; a list shorter than its count ends with `listCapLine` ("Showing 20 of 35."). Details labels, people: "Name", "Email", "Phone", "Role in practice", "Organization"; organizations: "Name", "Phone", "Website", "Address", "ZIP". An empty value says "Add" (editable, `aria-label="Add email"` and so on) or "Not set" (read-only); a filled email, phone or website is a real link built only by `mailtoHref`, `telHref` or `safeWebHref` (website `target="_blank" rel="noopener noreferrer"`; a stored value that fails the check shows as plain text) with an edit button `aria-label="Edit email"`. Sections "People" (organizations only; row: name and role or "No role yet"; empty "Nobody linked yet. Pick this organization on a person to add them."), "Deals" (open first; row: title, stage name, value, a "Won" or "Lost" pill when closed; empty for a person "No deals yet. Add one when {name} books a demo." and for an organization "No deals yet with {name}.", both with a "Deal" button (plus icon) linking to `/sales/deals?new=1`), "Leads" (row: title, "Converted" or "Archived" pill; empty "No leads. Opt-ins from this person show up here." / "No leads. Opt-ins from this practice show up here."), "History" with the locked pill. Counts as pills on section headings. When `redirectedFrom` is set: an info line "The link you opened was for a contact that was merged into this one." and the URL is replaced with the kept id. Merge dialog: title "Merge two people" / "Merge two organizations"; "Pick the one to keep." with a radio group (`aria-label="Which one to keep"`) of the two names; `mergeConfirmLine`; `mergeFillLine`; a warning bar `"{mergeCountsLine} This cannot be undone."`; buttons "Cancel" / "Merge into {kept name}". Toast `mergedToast`. Toasts on edits: "Saved.".

- [ ] **Step 1: Write the failing tests**

`contacts-client.test.ts` additions:
- "names possible duplicates": `duplicateNotice({ matches: [], hiddenMatch: false }, true)` is `null`; `({ matches: [], hiddenMatch: true }, false)` is `{ kind: "hidden", text: "A matching contact already exists. Ask an admin to merge." }`; `({ matches: [{ id: "p2", name: "Sarah Example" }], hiddenMatch: true }, true)` is `{ kind: "matches", label: "Possible duplicate:", matches: [{ id: "p2", name: "Sarah Example" }], tail: null }`; two matches with `canMerge: false` give `label: "Possible duplicates:"` and `tail: "Ask an admin to merge."`.
- "words the merge": `mergeCountsLine({ people: 0, deals: 3, leads: 1, notes: 4, activities: 0 })` is `"Moves 3 deals, 1 lead and 4 notes."`; `{ people: 2, deals: 0, leads: 0, notes: 0, activities: 1 }` gives `"Moves 2 people and 1 activity."`; `{ people: 1, deals: 1, leads: 0, notes: 0, activities: 2 }` gives `"Moves 1 person, 1 deal and 2 activities."` (order: people, deals, leads, activities, notes); all zero gives `"Nothing else moves."`. `mergeConfirmLine("person", "Sarah K.", "Sarah Example")` is `"Keep Sarah K. Merge Sarah Example into it. Deals, leads, notes and activities move to Sarah K."`; `mergeConfirmLine("organization", "Oak Creek Dental", "Oak Creek")` is `"Keep Oak Creek Dental. Merge Oak Creek into it. Deals, leads, people and notes move to Oak Creek Dental."`; `mergeFillLine("Sarah K.", "Ben S.")` is `"Empty details on Sarah K. are filled in from Ben S. Nothing on Sarah K. is overwritten."`; `mergedToast("Sarah K.", "Sarah Example")` is `"Merged. Sarah Example is now part of Sarah K."`; no result contains `".."`. `contactMetaCount(1)` `"1 person"`, `contactMetaCount(3)` `"3 people"`, `contactMetaCount(0)` `"0 people"`. `listCapLine(20, 35)` is `"Showing 20 of 35."`; `listCapLine(5, 5)` is `null`.

`api-client.test.ts`: `getContactPanel("person", "p1")` GETs `/api/sales/contacts/people/p1`; `getContactTimeline("organization", "o1", null)` GETs `/api/sales/contacts/organizations/o1/timeline`; `updateContactRequest("organization", "o1", { zip: "78704" })` PATCHes `/api/sales/contacts/organizations/o1`; `getMergePreview("person", "p1", "p2")` GETs `/api/sales/contacts/people/p1/merge?with=p2`; `mergeContactsRequest("person", "p1", "p2")` POSTs `/api/sales/contacts/people/p1/merge` with `{"dropId":"p2"}`.

`contact-panel-render.test.ts` (dialog mocked as in `deal-panel-render.test.ts`; renders `ContactPanelBody`):
- A person "Sarah K." the viewer owns, email `"sarah@oak.example"`, phone `"(512) 555-0142"`, organization o1 "Oak Creek Dental", one open deal and one converted lead, one visible duplicate, viewer admin: crumb `"Contacts"`; `href="mailto:sarah@oak.example"`; `href="tel:5125550142"`; the organization link `href` contains `organization=o1` and no `person=`; section headings `"Details"`, `"Deals"`, `"Leads"`, `"History"`; `"Converted"`; `"Possible duplicate:"` with a `"Merge"` button; the HTML has no `data-sales-deal-panel`.
- An organization with website `"javascript:alert(1)"` stored: no `href` containing `javascript:`; the value shows as text; website `"https://oak.example/"` links with `target="_blank"` and `rel="noopener noreferrer"`; no people: `"Nobody linked yet. Pick this organization on a person to add them."`; no deals: `"No deals yet with Oak Creek Dental."`.
- Viewer not owner and not admin (`canEdit: false`, `canMerge: false`): no `"Add"` values, empty values say `"Not set"`, no edit buttons, the duplicate bar ends `"Ask an admin to merge."` and has no `"Merge"` button.
- `redirectedFrom: "p2"`: `"The link you opened was for a contact that was merged into this one."`.
- A person whose organization has `visible: false`: the name "Bright Smile Dental" shows with no `href` containing `organization=`.
- An organization with `counts: { people: 35, deals: 2, leads: 0 }` and 20 people: the meta says `"35 people"`, the People pill says `"35"`, and `"Showing 20 of 35."` follows the list.
- `scroll-containment-render.test.ts` adds `ContactPanelBody` (every scroller in it is also `relative`).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/contacts-client.test.ts tests/lib/sales/api-client.test.ts tests/lib/sales/contact-panel-render.test.ts tests/lib/sales/scroll-containment-render.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the wording, wrappers, panel, details and dialog.
- Panel shell, load states, close and sonner guard copy `lead-panel.tsx` (404 text "This contact is not available." / "It may have been deleted, or it belongs to someone whose contacts you cannot see."; error "Could not load this contact." with "Try again"). Deal and lead rows open their panels through `panelHref` (one panel at a time, Decision 35).
- Details: click (or Enter) on a value opens an inline input; blur or Enter saves through `updateContactRequest` with only that field; Esc reverts; the Organization field uses `ContactPicker` and sends `{ organization: contactBody(choice) }` (clearing it sends `organization: null`). A refusal shows under the field with `role="alert"` and keeps the typed text.
- Merge dialog: loads `getMergePreview(kind, keepId, dropId)` on open and again when the radio swaps which one is kept; a failed preview shows `MERGE_PREVIEW_ERROR` with `role="alert"` and a "Try again" button, and keeps "Merge into {name}" disabled; "Merge into {name}" is disabled while loading or saving; on success toast, close, `refreshAfterWrite(router)`, and replace the panel URL with the kept contact.
- 375px: panel full screen; Details label and value stack under 400px; the duplicate bar wraps with "Merge" on its own line.

- [ ] **Step 4: Run to verify they pass** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass. Controller click-through note: edit every field, an invalid website, merge two people both ways, open an old link to the merged one, a see-own user sees "Ask an admin to merge.".

- [ ] **Step 6: Commit**

```bash
git add src/components/sales/contact-panel.tsx src/components/sales/contact-details.tsx src/components/sales/merge-dialog.tsx "src/app/(app)/sales/layout.tsx" src/lib/sales/api-client.ts src/lib/sales/contacts-client.ts tests/lib/sales/contacts-client.test.ts tests/lib/sales/api-client.test.ts tests/lib/sales/contact-panel-render.test.ts tests/lib/sales/scroll-containment-render.test.ts
git commit -m "feat(sales): contact panel with editable details, duplicates and merge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 24: Deal panel Files, the File tab, and editable organization, person and expected close

Load ui-ux-pro-max, impeccable and emil-design-eng first. Look: Mockup v2 deal panel (`fileRow`, `fileTab`, `removeFileModal`, the Details grid).

**Files:**
- Create: `src/components/sales/deal-files.tsx` (`DealFiles`, `RemoveFileDialog`), `src/components/sales/file-upload-tab.tsx` (`FileUploadTab`)
- Modify: `src/components/sales/activity-composer.tsx` (tabs from `composerTabs(parent.kind)`; the File tab renders `FileUploadTab`; a `ref` method `openTab(tab)`), `src/components/sales/deal-details.tsx` (Organization and Person pickers; "Expected close" date), `src/components/sales/deal-panel.tsx` (Files section between Next steps and Details; the ready branch of the private `DealPanelBody` becomes the exported `DealPanelContent`, which `DealPanelBody` renders once loaded, so a test can render a loaded panel), `src/lib/sales/api-client.ts` (`uploadDealFileRequest`, `removeDealFileRequest`; `request` sends a `FormData` body without the JSON header), `src/lib/sales/panel-client.ts` (`fileSizeLabel`, `fileMetaLine`, `fileCheck`, `composerTabs`, `nextTab`)
- Test: modify `tests/lib/sales/panel-client.test.ts`, `tests/lib/sales/api-client.test.ts`, `tests/lib/sales/deal-panel-render.test.ts`, `tests/lib/sales/scroll-containment-render.test.ts` (adds `DealFiles`)

**Interfaces:**
- Consumes: Task 12's `PanelFile`, `DealPanelData.files` (`import type` from `deal-panel.ts`), `FILE_MAX_BYTES` (`constants.ts`); Task 10's `UpdateDealInput` organization / person (`import type`); Task 13's `expectedCloseDate`; Task 19's `ContactPicker`, `ContactChoice`, `contactBody`, `existingChoice`, `endSentence`; `updateDealRequest`; `dateInputValue`, `formatDate`.
- Produces (`panel-client.ts`): `type ComposerTab = "activity" | "note" | "file"`, `composerTabs(kind: "deal" | "lead"): ComposerTab[]`, `nextTab(tabs: ComposerTab[], current: ComposerTab, key: "ArrowRight" | "ArrowLeft" | "Home" | "End"): ComposerTab`, `fileSizeLabel(bytes: number): string`, `fileMetaLine(file: PanelFile, now: Date): string`, `fileCheck(file: { name: string; size: number } | null, confirmed: boolean): string | null`.
- Produces (`api-client.ts`): `uploadDealFileRequest(dealId: string, file: File): Promise<ApiResult<{ file: PanelFile }>>` (fields `file` and `confirmedFinal` = `"true"`), `removeDealFileRequest(fileId: string): Promise<ApiResult<{ ok: true; changed: boolean }>>`.
- Produces (components): `DealFiles({ files, canEdit, now, onAddFile, onChanged }: { files: PanelFile[]; canEdit: boolean; now: Date; onAddFile: () => void; onChanged: () => void })`, `FileUploadTab({ dealId, onUploaded }: { dealId: string; onUploaded: () => void })`, `DealPanelContent({ data, now, history, titleId, composerRef, onChanged, onShowOlder, onRetryHistory }: { data: DealPanelData; now: Date; history: HistoryState; titleId: string; composerRef: React.RefObject<ComposerHandle | null>; onChanged: () => void; onShowOlder: () => void; onRetryHistory: () => void })` (today's ready branch of `DealPanelBody`, `deal-panel.tsx:255-336`, moved as is: header, bars, composer, Next steps, Files, Details, History and the move and done dialogs; `useDealMoves(onChanged)` and `useActivityDone(onChanged)` move inside it; `DealPanelBody` keeps loading, the history cursor and the `?compose=` handling; `HistoryState` from `deal-history.tsx`).
- Copy (pinned, Mockup v2): section "Files" with a count pill; row: a type tag (`PDF`, `DOCX`, `XLSX`, `PNG`, `JPG`, `aria-hidden`), the name, `fileMetaLine`; "Download" (a link to `/api/sales/files/{id}` with the `download` attribute, `aria-label="Download {name}"`); "Remove" when `canRemove` (`aria-label="Remove {name}"`). Empty: "No files yet. Add the signed contract or the final proposal once the client has it." plus, when `canEdit`, a button "Add a file" that opens the File tab. Remove dialog: title "Remove this file?", the file name, "It leaves the deal's Files list and can no longer be downloaded. The history keeps a record that it was added and removed.", buttons "Cancel" / "Remove file" (destructive); toast "File removed.". File tab: a drop zone "Drop a file or browse" with "Final versions only: signed contract, final proposal." and "PDF, Word, Excel, PNG or JPG. Up to 4 MB." (the input's `aria-describedby`; `accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg"`); a picked file shows its name, "{size} · ready to upload" and a button `aria-label="Take {name} off"`; checkbox "This is the final version the client received."; button "Upload file"; toast "File added.". Details: "Organization" and "Person" (pickers for owner/admin, plain text otherwise), "Expected close" (date input, "Add" when empty, hint "Used by the forecast on the Sales dashboard."; clearing sends `null`); toasts "Saved.".

- [ ] **Step 1: Write the failing tests**

`panel-client.test.ts`:
- "offers a File tab on deals only": `composerTabs("deal")` is `["activity", "note", "file"]`; `composerTabs("lead")` is `["activity", "note"]`; `nextTab(["activity", "note", "file"], "file", "ArrowRight")` is `"activity"`; `("activity", "ArrowLeft")` is `"file"`; `("note", "Home")` is `"activity"`; `("activity", "End")` is `"file"`.
- "sizes files in words": `fileSizeLabel(1)` `"1 KB"`; `fileSizeLabel(2048)` `"2 KB"`; `fileSizeLabel(1572864)` `"1.5 MB"`; `fileSizeLabel(4194304)` `"4 MB"`.
- "describes a file row": `{ sizeBytes: 1572864, stageName: "Proposal Sent", uploadedBy: "Ben S.", createdAt: "2026-11-05T14:00:00.000Z" }` gives `"1.5 MB · Proposal Sent · Ben S., today"`; created `2026-11-04T14:00:00.000Z` gives `"..., yesterday"`; `2026-11-02T14:00:00.000Z` gives `"..., Nov 2"`; `stageName: null` leaves the stage out (`"1.5 MB · Ben S., today"`).
- "checks a file before sending it": `fileCheck(null, true)` `"Choose a file first."`; `({ name: "setup.exe", size: 10 }, true)` `"Only PDF, Word, Excel, PNG or JPG files can be added."`; `({ name: "Contract.PDF", size: 4194305 }, true)` `"Files can be up to 4 MB."`; `({ name: "contract.pdf", size: 10 }, false)` `"Tick the box first. Files are for final versions only."`; `({ name: "photo.jpeg", size: 10 }, true)` `null`.

`api-client.test.ts`: `uploadDealFileRequest("d1", file)` POSTs `/api/sales/deals/d1/files` with a `FormData` body whose `get("confirmedFinal")` is `"true"` and `get("file")` is the file, and sets no `Content-Type` header; `removeDealFileRequest("f1")` sends `DELETE /api/sales/files/f1`.

`deal-panel-render.test.ts` (renders `DealPanelContent` inside the mocked `Sheet`, with a ready `history`; the existing `DealPanel` cases stay):
- A deal with two files (one `canRemove: true`): heading `"Files"` with a `"2"` pill; `href="/api/sales/files/f1"` with `download`; `aria-label="Download contract.pdf"`; exactly one `aria-label="Remove ...` button; the Files section comes after "Next steps" and before "Details" in the HTML.
- No files, `canEdit: true`: the empty text and `"Add a file"`; `canEdit: false`: the empty text without the button.
- Composer tabs `"Activity"`, `"Note"`, `"File"`; Details labels `"Organization"`, `"Person"`, `"Expected close"`; with `expectedCloseDate: null` the value says `"Add"`; with `"2026-11-30"` it says `"Nov 30, 2026"`.
- `FileUploadTab` rendered on its own: the `<input type="file">` has a `class` holding `sr-only`, no `hidden` attribute, and an `aria-describedby` pointing at the line "PDF, Word, Excel, PNG or JPG. Up to 4 MB."
- `scroll-containment-render.test.ts` adds `DealFiles`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/panel-client.test.ts tests/lib/sales/api-client.test.ts tests/lib/sales/deal-panel-render.test.ts tests/lib/sales/scroll-containment-render.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the helpers, wrappers and components.
- File tab: the drop zone is a `<label>` wrapping a real `<input type="file" className="sr-only">` (visually hidden but focusable: never the `hidden` attribute or `display: none`, so Tab reaches it and Enter or Space opens the picker), with the focus ring shown on the zone (`has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50`) and at least 40px tall on coarse pointers; drag and drop sets the same state; `fileCheck` runs on Upload and shows its message with `role="alert"`; one request at a time (button disabled and `aria-busy` while sending); a refusal from the server (413, 415, 503 and the limits) shows its message inline; on success toast, clear the tab, `onUploaded()` (the panel reloads and refreshes with `refreshAfterWrite`).
- `request` in `api-client.ts`: a `FormData` body goes as is, with no `Content-Type` (the browser sets the boundary).
- Expected close saves on change through `updateDealRequest(id, { expectedCloseDate })`; Organization and Person save `{ organization: contactBody(choice) }` / `{ person: contactBody(choice) }` (clearing sends `null`); a refusal such as "Add a person or an organization." shows under the field.
- 375px: file rows wrap (actions under the name), buttons keep 40px targets, the date input is full width.

- [ ] **Step 4: Run to verify they pass** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass. Controller click-through note: upload a PDF, try a renamed `.exe` and a 5 MB file, untick the box, remove a file, download as a see-own user, change organization and person, set and clear Expected close and see the dashboard forecast move.

- [ ] **Step 6: Commit**

```bash
git add src/components/sales/deal-files.tsx src/components/sales/file-upload-tab.tsx src/components/sales/activity-composer.tsx src/components/sales/deal-details.tsx src/components/sales/deal-panel.tsx src/lib/sales/api-client.ts src/lib/sales/panel-client.ts tests/lib/sales/panel-client.test.ts tests/lib/sales/api-client.test.ts tests/lib/sales/deal-panel-render.test.ts tests/lib/sales/scroll-containment-render.test.ts
git commit -m "feat(sales): deal files, the File tab and editable deal contacts and close date

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 25: Sales settings page

Load ui-ux-pro-max, impeccable and emil-design-eng first. Read `page.md` (no `loading.tsx` here, Decision 28). Look: Mockup v2 `viewSettings` and `stagesModal`.

**Files:**
- Create: `src/app/(app)/sales/settings/page.tsx`, `src/components/sales/settings-view.tsx`, `src/components/sales/lead-assignment-card.tsx`, `src/components/sales/stage-editor-dialog.tsx`, `src/lib/sales/settings-client.ts` (pure)
- Modify: `src/lib/sales/api-client.ts` (`saveSettingsRequest`, `saveStageRottingRequest`)
- Test: `tests/lib/sales/settings-client.test.ts`, `tests/lib/sales/settings-page-gate.test.ts`, `tests/lib/sales/settings-view-render.test.ts`; modify `tests/lib/sales/api-client.test.ts`, `tests/lib/sales/scroll-containment-render.test.ts`

**Interfaces:**
- Consumes: Task 14's `LeadAssignmentView`, `SavedPersonView`, `StageSettings` (`import type` in client code), `loadLeadAssignmentView`, `loadStageSettings` (the server page only); the schemas stay on the server (the client helpers below repeat their pinned messages); Task 20's `assignmentLine`; Task 19's `endSentence`, `joinNames`; `shortName`; `requireSalesPage`.
- Produces (`settings-client.ts`): `SALES_RULES: readonly string[]` (the eight lines below), `type AssignmentDraft = { mode: "ROUND_ROBIN" | "SINGLE"; rotation: string[]; single: string | null }`, `draftFromView(view: LeadAssignmentView): AssignmentDraft`, `settingsPatch(draft: AssignmentDraft, view: LeadAssignmentView): { leadAssignMode?: "ROUND_ROBIN" | "SINGLE"; roundRobinMemberIds?: string[]; singleAssigneeId?: string | null } | null` (null when nothing changed; a sent rotation never holds anyone without access), `assignmentError(draft: AssignmentDraft, view: LeadAssignmentView): string | null`, `lostAccessBar(view: LeadAssignmentView): string | null`, `lostRotationLine(people: SavedPersonView[]): string | null`, `nobodyTickedLine(firstAdminName: string | null): string`, `personLabel(person: SavedPersonView): string`, `rottingDaysInput(text: string): { ok: true; value: number | null } | { ok: false; error: string }`, `stageRottingPatch(stages: StageSettings["stages"], inputs: Record<string, string>): { ok: true; stages: { id: string; rottingDays: number | null }[] } | { ok: false; errors: Record<string, string> }`, `stageSaveToast(changed: number): string`, `pipelineLine(pipeline: StageSettings): string`.
- Produces (`api-client.ts`): `saveSettingsRequest(body): Promise<ApiResult<{ settings: { leadAssignMode: string; roundRobinMemberIds: string[]; singleAssigneeId: string | null }; view: LeadAssignmentView }>>` (PATCH `/api/sales/settings`), `saveStageRottingRequest(pipelineId: string, body: { stages: { id: string; rottingDays: number | null }[] }): Promise<ApiResult<{ stages: { id: string; rottingDays: number | null }[] }>>` (PATCH `/api/sales/pipelines/{id}/stages`).
- Produces (components): `SettingsView({ assignment, pipelines }: { assignment: LeadAssignmentView; pipelines: StageSettings[] })`.
- Copy (pinned, Mockup v2): h1 "Sales settings"; sub "Admins only."; card "Who gets new leads" with radios "Take turns (round-robin) between:" and "Always give them to:"; one checkbox per Sales member (short name); a saved person without access shows ticked and disabled with a "No Sales access" pill; the single select `aria-label="Person who gets every new lead"` with a "Pick a person" placeholder when the saved person lost access or none is set; `nobodyTickedLine(view.firstAdminName)` when round-robin has nobody eligible ticked; the line `assignmentLine(view.effective, false)` under the card; save bar "Unsaved changes" (only when changed), "Cancel", "Save" (both disabled when nothing changed); toast "Saved.". Card "Rules (always on)" lists `SALES_RULES`. Card "Pipelines and stages": one row per Sales and Consulting pipeline, `pipelineLine`, button "Edit stages" (`aria-label="Edit stages for {name}"`). Stage editor: title "{pipeline} stages"; "A deal's days-in-stage pill turns amber when it sits in a stage this long. Leave a box empty for never."; per stage the name, "{p}% win chance" (plus ", won stage" / ", lost stage"), and either "Never" (won and lost) or "Goes stale after [box] days" (`aria-label="{stage}: days before it goes stale"`, `inputMode="numeric"`); per-row error under its box; "Only the stale timer changes here. Stage names, order and win chances stay as they are."; buttons "Cancel" / "Save"; toast `stageSaveToast(n)`. No "Copy from Pipedrive" card.
- `SALES_RULES` (verbatim, in order): "Every open deal and lead needs a next activity. If it has none, it shows a \"No next step\" badge."; "A deal cannot go to Proposal Sent with a $0 value."; "At Proposal Sent, both total value and monthly value are required."; "Every deal and lead has an owner."; "A territory hold check is added 7 days before the hold ends."; "Moving a deal to No Show adds a reschedule call for today."; "The history log cannot be edited or deleted, by anyone."; "Files are for final versions only (signed contracts, final proposals)."

- [ ] **Step 1: Write the failing tests**

`settings-client.test.ts` (view fixture: members b "Ben Example", r "Robert O.", d "DJ"; rotation `[{ id: "b", name: "Ben Example", hasAccess: true }, { id: "x", name: "Dana Q.", hasAccess: false }]`, mode ROUND_ROBIN):
- "only sends what changed, without people who lost access": `settingsPatch(draftFromView(view), view)` is `null`; ticking r (`rotation: ["b", "x", "r"]`) gives `{ roundRobinMemberIds: ["b", "r"] }`; switching to SINGLE with `single: "r"` gives `{ leadAssignMode: "SINGLE", singleAssigneeId: "r" }`; `assignmentError({ mode: "SINGLE", rotation: [], single: null }, view)` is `"Choose the person who gets every new lead."`; single "x" gives `"The person who gets every new lead no longer has Sales access. Pick someone else."`; a valid draft gives `null`.
- "explains lost access truthfully" (Decision 28): mode SINGLE, `single: { id: "b", name: "Ben Example", hasAccess: false }`, `effective: { mode: "ROUND_ROBIN", names: ["Robert O."], fallbackName: null }` gives `"Ben E. no longer has Sales access. New leads are shared out round-robin until you pick someone else."`; `effective: { mode: "ROUND_ROBIN", names: [], fallbackName: "Dana E." }` gives `"Ben E. no longer has Sales access. New leads go to Dana E. until you pick someone else."`; no fallback gives `"Ben E. no longer has Sales access. Nobody can take new leads until you pick someone else."`; `name: null` starts `"A former team member no longer has Sales access."`; a single with access, or ROUND_ROBIN mode, gives `null`.
- "names skipped people": `lostRotationLine([{ id: "x", name: "Dana Q.", hasAccess: false }])` is `"Dana Q. no longer has Sales access and is skipped. Saving takes Dana Q. off this list."`; two people give `"Dana Q. and Mark T. no longer have Sales access and are skipped. Saving takes them off this list."`; only people with access give `null`; `nobodyTickedLine("Mark E.")` is `"Nobody is ticked. New leads go to Mark E. until someone is picked."` (A8 names the admin), `nobodyTickedLine("DJ")` is `"Nobody is ticked. New leads go to DJ until someone is picked."`, `nobodyTickedLine(null)` is `"Nobody is ticked. Nobody can take new leads until someone is picked."`; `personLabel({ id: "gone", name: null, hasAccess: false })` is `"A former team member"`, `personLabel({ id: "b", name: "Ben Example", hasAccess: true })` is `"Ben E."`.
- "reads rotting days": `rottingDaysInput("")` and `("  ")` give `{ ok: true, value: null }`; `"21"` gives 21; `"0"`, `"366"`, `"2.5"`, `"-3"`, `"abc"` give `{ ok: false, error: "Use a number from 1 to 365, or leave it blank." }`.
- "sends only changed stages": stages s4 (14), s5 (14), s7 won (null); inputs `{ s4: "21", s5: "14" }` give `{ ok: true, stages: [{ id: "s4", rottingDays: 21 }] }`; `{ s4: "0" }` gives `{ ok: false, errors: { s4: "Use a number from 1 to 365, or leave it blank." } }`; s7 is never sent. `stageSaveToast(0)` `"No changes to save."`, `(1)` `"Saved. 1 stage changed."`, `(3)` `"Saved. 3 stages changed."`; `pipelineLine({ name: "Direct Mail", kind: "SALES", stages: nine })` is `"Sales · 9 stages"`, a Consulting one with 6 stages `"Consulting · 6 stages"`.
- "keeps the rules as the mockup says": `SALES_RULES` has length 8 and equals the list above; no line contains an em dash (U+2014).

`settings-page-gate.test.ts`: the Sales gate rejecting stops both loaders; a Sales user who is not an admin gets `notFound()` and no loader runs; an admin gets `SettingsView` with `{ assignment, pipelines }` from `loadLeadAssignmentView()` and `loadStageSettings()`; the folder has no `loading.tsx` (`existsSync` is false).

`api-client.test.ts`: `saveSettingsRequest({ roundRobinMemberIds: ["b"] })` PATCHes `/api/sales/settings`; `saveStageRottingRequest("pm1", { stages: [{ id: "s4", rottingDays: 21 }] })` PATCHes `/api/sales/pipelines/pm1/stages`.

`settings-view-render.test.ts`: the header copy; `"Who gets new leads"`, both radio labels, a checkbox per member, `"No Sales access"` beside Dana Q. with `disabled`; the skipped-people line; `"Save"` and `"Cancel"` disabled; `"Rules (always on)"` with all eight lines; `"Pipelines and stages"` with `"Sales · 9 stages"` and `aria-label="Edit stages for Direct Mail"`; no `"Pipedrive"`. With a SINGLE saved person who lost access: the `lostAccessBar` text with `role="alert"` and the "Pick a person" option. `scroll-containment-render.test.ts` adds `SettingsView`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/settings-client.test.ts tests/lib/sales/settings-page-gate.test.ts tests/lib/sales/settings-view-render.test.ts tests/lib/sales/api-client.test.ts tests/lib/sales/scroll-containment-render.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the helpers, wrappers, page and components.
- `page.tsx`: `const actor = await requireSalesPage(); if (!actor.isAdmin) notFound();` then both loaders in one `Promise.all`.
- The card keeps a draft (`draftFromView`); Save runs `assignmentError` first (shown inline under the select with `role="alert"`), then `saveSettingsRequest(settingsPatch(...))`; on success the draft resets from the returned `view` and `refreshAfterWrite(router)` runs; a refusal shows inline (a `code: "ASSIGNEE_LOST_ACCESS"` refusal also opens the select).
- Stage editor: inputs start from the saved numbers; Save runs `stageRottingPatch`; nothing changed toasts `stageSaveToast(0)` and closes without a request.
- 375px: cards stack, checkboxes wrap with 40px targets, pipeline rows put "Edit stages" under the name, the dialog's stage rows stack the box under the name.

- [ ] **Step 4: Run to verify they pass** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass. Controller click-through note: switch modes and Save, untick everyone, a saved single person without access, edit Direct Mail stages (bad number, blank, unchanged), a non-admin Sales user gets 404.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/sales/settings/page.tsx" src/components/sales/settings-view.tsx src/components/sales/lead-assignment-card.tsx src/components/sales/stage-editor-dialog.tsx src/lib/sales/settings-client.ts src/lib/sales/api-client.ts tests/lib/sales/settings-client.test.ts tests/lib/sales/settings-page-gate.test.ts tests/lib/sales/settings-view-render.test.ts tests/lib/sales/api-client.test.ts tests/lib/sales/scroll-containment-render.test.ts
git commit -m "feat(sales): Sales settings for lead assignment, rules and stale timers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 26: Deals toolbar Views menu and Stage filter

Load ui-ux-pro-max, impeccable and emil-design-eng first. Look: Mockup v2 `viewsMenu`, `saveViewModal`, `filterMenu` (Stage group) and the "Showing {stage} only." strip.

**Files:**
- Create: `src/components/sales/saved-views-menu.tsx` (`SavedViewsMenu`, `SaveViewDialog`)
- Modify: `src/components/sales/deals-toolbar.tsx` (Stage group in the Filter menu; the Views button), `src/components/sales/deals-view.tsx:75` (`clearFilters` also sets `stage: null`; the stage strip; passes saved views), `src/app/(app)/sales/deals/page.tsx` (loads saved views in the same `Promise.all` as the board), `src/lib/sales/board-client.ts` (`activeFilterCount` counts the stage; `savedViewSummary`, `isSameView`), `src/lib/sales/view-preference.ts` (`SavedViewItem`, `loadSavedViewItems`), `src/lib/sales/api-client.ts` (`saveSavedViewsRequest`)
- Test: modify `tests/lib/sales/board-client.test.ts`, `tests/lib/sales/saved-views.test.ts`, `tests/lib/sales/api-client.test.ts`, `tests/lib/sales/deals-view-render.test.ts`, `tests/lib/sales/scroll-containment-render.test.ts`

**Interfaces:**
- Consumes: Task 15's `BoardQuery.stage`, `SavedBoardView`, `savedViewToQuery`, `addSavedView`, `removeSavedView`, `loadSavedViews`, `boardQueryToSearch`, `PUT /api/sales/views`; `BoardPageData` (`stages` lists every live stage); Task 19's `endSentence`; `MUTED_TEXT`.
- Produces (`board-client.ts`): `activeFilterCount(query)` adds 1 when `query.stage` is set; `savedViewSummary(view: Omit<SavedBoardView, "name">, names: { pipeline: string | null; stage: string | null }): string`; `isSameView(view: SavedBoardView, query: BoardQuery, shownPipelineKey: string): boolean`; `savedViewPatch(view: SavedBoardView, shownPipelineKey: string): Omit<BoardQuery, "cursor">`.
- Produces (`view-preference.ts`): `type SavedViewItem = { view: SavedBoardView; summary: string }`, `loadSavedViewItems(userId: string, db = prisma): Promise<SavedViewItem[]>` (saved views plus one read of live Sales and Consulting pipelines with their live stage keys and names, in one `Promise.all`).
- Produces (`api-client.ts`): `saveSavedViewsRequest(views: SavedBoardView[]): Promise<ApiResult<{ views: SavedBoardView[] }>>`.
- Produces (components): `DealsView` gains the prop `savedViews: SavedViewItem[]`; `SavedViewsMenu({ items, query, shownPipelineKey, currentSummary, onApply, onSaved })`.
- Copy (pinned, Mockup v2): toolbar button "Views" with a bookmark icon (`aria-haspopup="menu"`); menu label "Saved views"; each row the name and its summary (in `MUTED_TEXT`), checked when `isSameView`, with a remove button `aria-label="Remove {name}"` (toast `endSentence("Removed " + name)`); empty "No saved views yet." with "Save the filters you use most, like Proposals out or My overdue."; "Save this view…" (disabled at 20); a note "Only you see your views." or, at 20, "You can keep up to 20 views. Remove one first.". Save dialog: title "Save this view", "Name" (placeholder "Proposals out", `maxLength` 40), "Saves what you see now: {summary}. Only you see your views.", buttons "Cancel" / "Save", errors inline with `role="alert"`, toast "View saved.". Filter menu: a "Stage" group with "Any" and every stage name. Strip under the toolbar when a stage filter is on: "Showing {stage name} only." with a link button "Show all stages" (`role="status"`).

- [ ] **Step 1: Write the failing tests**

`board-client.test.ts`:
- `activeFilterCount({ ...DEFAULTS, stage: "proposal-sent" })` is 1; `hasActiveFilters({ ...DEFAULTS, stage: "proposal-sent" })` is true.
- "sums up a saved view": `savedViewSummary({ pipeline: "direct-mail", view: "list", scope: "mine", status: "open", next: "any", stage: "proposal-sent", q: "oak" }, { pipeline: "Direct Mail", stage: "Proposal Sent" })` is `"Direct Mail · List · Just me · Proposal Sent · \"oak\""`; `{ pipeline: "direct-mail", view: "board", scope: "everyone", status: "won", next: "overdue", stage: null, q: "" }` with `{ pipeline: "Direct Mail", stage: null }` gives `"Direct Mail · Board · Everyone · Won · Overdue"`; `next: "today"` adds `"Due today"`, `"none"` adds `"No next step"`, `status: "lost"` adds `"Lost"`; unknown names (`{ pipeline: null, stage: null }`) give `"Board · Everyone"`.
- "knows the view on screen": `isSameView(view, savedViewToQuery(view), "direct-mail")` is true; a different `q` is false; a view with `pipeline: null` matches a query on the shown pipeline `"direct-mail"`.
- "applies a view without losing it": `savedViewPatch(view: SavedBoardView, shownPipelineKey: string): Omit<BoardQuery, "cursor">` (in `board-client.ts`) gives the view's keys with `pipeline` replaced by `shownPipelineKey` when it is null; `boardQueryToSearch` of `nextBoardQuery(current, "direct-mail", savedViewPatch({ ...view, pipeline: null, view: "board", scope: "everyone" }, "direct-mail"))` starts `"pipeline=direct-mail"`.

`saved-views.test.ts` addition, "lists saved views with summaries": stored `[{ name: "Proposals out", pipeline: "direct-mail", view: "list", scope: "mine", status: "open", next: "any", stage: "proposal-sent", q: "" }]` and live pipelines give `[{ view: <that view>, summary: "Direct Mail · List · Just me · Proposal Sent" }]`; a view naming a pipeline that is gone gets a summary without the pipeline and stage; the pipelines read uses `where: { archivedAt: null, kind: { in: ["SALES", "CONSULTING"] } }`.

`api-client.test.ts`: `saveSavedViewsRequest(views)` PUTs `/api/sales/views` with `{"views":[...]}`.

`deals-view-render.test.ts` (add `savedViews` to every render; `scroll-containment-render.test.ts` passes `savedViews: []`):
- the toolbar has a `"Views"` button with `aria-haspopup="menu"`.
- `query.stage: "proposal-sent"` with that stage in `data.stages`: `"Showing"`, `"Proposal Sent"`, `"only."` and `"Show all stages"`; the Filter button's `aria-label` is `"Filter, 1 active"`.
- `query.stage: "nope"` (not in `data.stages`): no `"Showing"` strip.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/board-client.test.ts tests/lib/sales/saved-views.test.ts tests/lib/sales/api-client.test.ts tests/lib/sales/deals-view-render.test.ts tests/lib/sales/scroll-containment-render.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**
- `deals/page.tsx`: `loadSavedViewItems(actor.userId)` runs next to the default view and the board load (one `Promise.all` where the order allows; the board load still waits for the default view).
- Applying a view navigates with the full patch `{ pipeline, view, scope, status, next, stage, q }` through the existing `navigate` (Task 15's `nextBoardQuery` keeps the view's stage); a view with `pipeline: null` applies with the shown pipeline's key, never a bare URL (which would bring back the remembered default view, `board-query.ts:64-66`). Saving: `addSavedView(items.map(i => i.view), name, query)`; a refusal shows inline; then `saveSavedViewsRequest`, toast, close, `refreshAfterWrite(router)`. Removing: `removeSavedView` then the same request. The current view's summary comes from `savedViewSummary(query, { pipeline: data.pipeline.name, stage: <name of query.stage in data.stages> })`.
- The Stage group uses the same radio items as Status and Next step (value `""` for "Any"); choosing a stage navigates `{ stage }`; "Show all stages" navigates `{ stage: null }`.
- 375px: the toolbar wraps; the Views menu is at most `calc(100vw - 32px)` wide; long view names truncate with the full name in `title`.

- [ ] **Step 4: Run to verify they pass** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass. Controller click-through note: save, apply and remove a view, the 20-view limit, a duplicate name, Stage filter on board and list, switching pipeline clears the stage, "Clear filters" clears it.

- [ ] **Step 6: Commit**

```bash
git add src/components/sales/saved-views-menu.tsx src/components/sales/deals-toolbar.tsx src/components/sales/deals-view.tsx "src/app/(app)/sales/deals/page.tsx" src/lib/sales/board-client.ts src/lib/sales/view-preference.ts src/lib/sales/api-client.ts tests/lib/sales/board-client.test.ts tests/lib/sales/saved-views.test.ts tests/lib/sales/api-client.test.ts tests/lib/sales/deals-view-render.test.ts tests/lib/sales/scroll-containment-render.test.ts
git commit -m "feat(sales): saved views menu and a Stage filter on the Deals toolbar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 27: Insights page

Load ui-ux-pro-max, impeccable, emil-design-eng and dataviz first. Read `page.md` and `loading.md`. Look: Mockup v2 `viewInsights`, `chartCard`, `hbars`, `svgColumns`, `svgLine`.

**Files:**
- Create: `src/app/(app)/sales/insights/page.tsx`, `src/app/(app)/sales/insights/loading.tsx`, `src/components/sales/insights-view.tsx`, `src/components/sales/insights-charts.tsx` (`ChartCard`, `HorizontalBars`, `MonthColumns`, `MonthLine`), `src/lib/sales/insights-client.ts` (pure)
- Test: `tests/lib/sales/insights-client.test.ts`, `tests/lib/sales/insights-page-gate.test.ts`, `tests/lib/sales/insights-view-render.test.ts`; modify `tests/lib/sales/scroll-containment-render.test.ts`

**Interfaces:**
- Consumes: Task 13's `InsightsData`, `InsightsQuery`, `InsightsRange`, `parseInsightsQuery`, `insightsQueryToSearch`, `loadInsights`; `formatMoney`; `OwnerAvatar`, `SEGMENT_GROUP`, `SEGMENT`; `requireSalesPage`.
- Produces (`insights-client.ts`): `INSIGHTS_RANGES: readonly { value: InsightsRange; label: string }[]`, `rangeWords(range: InsightsRange): string`, `monthLabel(month: string): string`, `monthLong(month: string, current: boolean): string`, `barPercents(values: number[]): number[]`, `averageCycleDays(rows: { avgDays: number | null; count: number }[]): number | null`, `cycleLabel(days: number | null): string`, `compactMoney(cents: number): string`, `niceScale(max: number, ticks: number): { step: number; top: number }`, `CHART_SERIES_TOKEN: string` (the one theme token the series is painted with, such as `"chart-2"`, chosen with the dataviz skill; components use it as `fill-(--color-<token>)` / `bg-<token>`, never raw hex).
- Produces (components): `InsightsView({ data, now }: { data: InsightsData; now: string })`.
- Copy (pinned, Mockup v2): h1 "Insights"; sub "What closed, how fast, and where open deals sit."; a filter row (`role="group"`, `aria-label="Filters for every chart"`) with the range select (`aria-label="Date range"`), Everyone / Just me (when `canSeeEveryone`) and the note "Sales and Consulting pipelines". Cards (heading, sub, headline): "Pipeline funnel" / "Open deals in each stage right now" / "{n}" + "open deals · {value}" ("open deals of yours · {value}" with Just me), with a pipeline select `aria-label="Pipeline for the funnel"`; "Deals won over time" / "Won value per month" / "{value}" + "won in {range words} · {n} deal(s)"; "Average deal cycle time" / "Days from created to won, by month won" / "{avg} days" + "on average in {range words}"; "Activities completed per person" / "Calls, meetings, tasks and emails marked done" / "{n}" + "done in {range words}". Each card has a "Table" toggle (`aria-pressed`) and an always-present table (visually hidden until toggled) with captions "Open deals per stage in {pipeline}" (Stage, Open deals, Value), "Deals won per month, {range words}" (Month, Won value, Deals), "Average days from created to won, {range words}" (Month, Average days, Deals won), "Activities completed per person, {range words}" (Person, Activities done); month cells use `monthLong` ("Nov 2026 (so far)" for this month). Empty cards: funnel "No open deals in {pipeline}." (Just me: "No open deals of yours in {pipeline}.") / "Open deals show here, stage by stage, as they move along." / "Open the board"; won "No deals won in {range words}." (Just me: "No deals of yours won in {range words}.") / "Each month's won value shows here once a deal is marked won." / "Open the board"; cycle "Nothing won yet in this range." / "The average number of days from a new deal to a win shows here." / "Open the board"; activities "No activities marked done in {range words}." / "Calls, meetings and tasks count here once someone marks them done." / "Open activities". When `capped`: "Showing the first 5,000 won deals in this range." under the filter row.

- [ ] **Step 1: Write the failing tests**

`insights-client.test.ts`:
- `INSIGHTS_RANGES` is `[{ value: 3, label: "Last 3 months" }, { value: 6, label: "Last 6 months" }, { value: 12, label: "Last 12 months" }]`; `rangeWords(6)` `"the last 6 months"`.
- `monthLabel("2026-11")` `"Nov"`; `monthLong("2026-11", true)` `"Nov 2026 (so far)"`; `monthLong("2025-12", false)` `"Dec 2025"`.
- `barPercents([2, 4, 0])` `[50, 100, 0]`; `barPercents([0, 0])` `[0, 0]`; `barPercents([])` `[]`.
- `averageCycleDays([{ avgDays: 12, count: 2 }, { avgDays: 20, count: 1 }, { avgDays: null, count: 0 }])` is 15 (weighted by deals won, rounded); all null gives `null`. `cycleLabel(null)` `"No wins"`, `cycleLabel(1)` `"1 day"`, `cycleLabel(12)` `"12 days"`.
- `compactMoney(0)` `"$0"`; `90000` `"$900"`; `150000` `"$1.5K"`; `1200000` `"$12K"`; `12000000` `"$120K"`; `120000000` `"$1.2M"`.
- `niceScale(14400, 3)` `{ step: 5000, top: 15000 }`; `niceScale(10, 3)` `{ step: 5, top: 10 }`; `niceScale(45, 3)` `{ step: 20, top: 60 }`.
- "the series stands out from its card in both themes" (`it.each(THEMES)`, `tests/lib/sales/theme-colours.ts`): `contrast(token(CHART_SERIES_TOKEN, theme), token("card", theme))` is at least 3 (non-text contrast).

`insights-page-gate.test.ts`: the gate rejecting stops the loader; `?range=6&scope=mine&pipeline=direct-mail` calls `loadInsights(actor, { range: 6, scope: "mine", pipeline: "direct-mail" }, expect.any(Date))`; the element's props are `{ data, now }`.

`insights-view-render.test.ts` (3-month fixture ending Nov 2026, funnel for Direct Mail, two wins in Nov worth $14,400, cycle 12 days, activities Ben S. 5 and Robert O. 3):
- the header and filter copy, the range options, `"Sales and Consulting pipelines"`; the four card headings; `"2 deals"`, `"$14,400"`, `"12 days"`, `"on average in the last 3 months"`.
- every chart has its table with the caption text (for example `"Deals won per month, the last 3 months"`) and `"Nov 2026 (so far)"`; every bar or point has `tabindex="0"`, `role="img"` and an `aria-label` such as `"Nov 2026 so far: $14,400, 2 deals"` (Mockup v2); the column and line `<svg>` carry `viewBox="0 0 560 ` and a class holding `w-full` and `h-auto`, so the server render scales down at 375px before the figure is measured.
- an empty fixture shows each card's empty title, text and action, and no chart; `canSeeEveryone: false` hides Everyone / Just me; `capped: true` shows the cap line.
- `scroll-containment-render.test.ts` adds `InsightsView`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/insights-client.test.ts tests/lib/sales/insights-page-gate.test.ts tests/lib/sales/insights-view-render.test.ts tests/lib/sales/scroll-containment-render.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the helpers, the page and the charts.
- Charts are CSS and inline SVG only (no chart library). Horizontal bars use `barPercents` widths; columns and the line draw at the measured figure width (a `ResizeObserver` on the figure) so axis text stays 11px at 375px; until measured (the server render and the first paint) the SVG draws at 560 with `viewBox="0 0 560 {height}"` and `className="block h-auto w-full"`, so it scales down instead of scrolling sideways; three grid lines from `niceScale`; month labels every other month when a band is under 34px; the largest column and the last point carry a value label. One series colour, `CHART_SERIES_TOKEN`, from the theme tokens chosen with the dataviz skill (no raw hex); focus and hover show a small tooltip with the same text as the `aria-label`.
- Filter changes go through `insightsQueryToSearch` and `router.replace`.
- Cards in one column under 900px, two above; `loading.tsx` shows the header, filter row and four card skeletons, `aria-busy="true"`.

- [ ] **Step 4: Run to verify they pass** (Step 2 command): PASS.

- [ ] **Step 5: Finish gate** (Global Constraints): all pass. Controller click-through note: 3, 6 and 12 months, Just me, the funnel pipeline picker, Table toggles, keyboard focus on bars, 375px and dark mode.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/sales/insights/page.tsx" "src/app/(app)/sales/insights/loading.tsx" src/components/sales/insights-view.tsx src/components/sales/insights-charts.tsx src/lib/sales/insights-client.ts tests/lib/sales/insights-client.test.ts tests/lib/sales/insights-page-gate.test.ts tests/lib/sales/insights-view-render.test.ts tests/lib/sales/scroll-containment-render.test.ts
git commit -m "feat(sales): Insights page with funnel, wins, cycle time and activity charts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 28: Plan gate (controller)

The controller runs every check and records the results (commands, counts, anything accepted) in `SESSION_NOTES.md` (not committed). No push.

- [ ] **Step 1: Static checks.** `npx tsc --noEmit`: only the 4 accepted `scratch/` errors. `npx eslint src scripts tests`: clean. `npm test`: all pass; record the file and test counts (above 65 files / 1017 tests).
- [ ] **Step 2: Clean build and the secrecy scan of that build.** `git worktree add --detach <scratchpad>/gate-3a HEAD`, copy `.env` in, `npm ci`, `npm run build:ci` there; then, BEFORE removing the worktree, from the main checkout `npm run check:sales-secrecy -- <scratchpad>/gate-3a/.next` (the script scans `process.argv[2]`; with no path it would scan the main checkout's stale `.next` from the Plan 2 gate and prove nothing about 3A). Record its `OK: ... {n} pages ...` line. Then `git worktree remove --force <scratchpad>/gate-3a` (the copied `.env` goes with it). Expected: build succeeds and the scan prints its OK line.
- [ ] **Step 3: Isolation.** (Never run `check:sales-secrecy` without a path here.) `grep -rnE "logActivity|notify|notifyChannel|slack|sendEmail|@/lib/email|@/lib/highlevel|revalidatePath|handleUpload|@vercel/blob/client|ASSETS_READ_WRITE_TOKEN" src/lib/sales src/app/api/sales src/components/sales "src/app/(app)/sales"`: no output. `grep -rni "sales" src/lib/agent-data.ts src/app/api/agent src/app/api/mcp`: no output. `npx vitest run tests/lib/sales/sales-isolation.test.ts tests/lib/sales/sidebar-secrecy.test.ts`: PASS.
- [ ] **Step 4: Schema.** `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` on dev: an empty migration (no statements). `npx vitest run tests/lib/backup-coverage.test.ts`: PASS.
- [ ] **Step 5: Branch contents.** `git log --oneline master..HEAD` lists Tasks 1 to 27's commits and the plan file; `git show --stat` for every Plan 3A commit touches nothing under `scratch/`, `"Sales Module Handoff/"`, `SECURITY_AUDIT.md`, `src/lib/email.ts`, `src/app/api/me/notification-preferences/test-email/`, `SESSION_NOTES.md`, the two Plan 1 documents, or `docs/` other than this plan.
- [ ] **Step 6: Query plans on the dev database (read-only).** Run `EXPLAIN` for the Inbox first page (`ownerId`, `status`, `archivedAt`, `createdAt` order), the Contacts people page (name order: the admin's Everyone view on `SalesPerson(archivedAt, name)`, and the see-own filter), the duplicate lookup by `emailKey`, the dashboard overdue count and the Insights won-deals read. Record that each uses one of Task 2's indexes (a sequential scan on a table under 1,000 rows is accepted and noted).
- [ ] **Step 7: Click-through** (before the first upload, record which Blob store `.env`'s `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID` points at, so it is known whether the test file lands in the production store) at 375px, 768px and 1280px, light and dark, with `SLACK_BOT_TOKEN` blanked in a temporary `.env.development.local` (deleted afterwards): every nav link and its page (Sales dashboard, Deals, Leads Inbox, Activities, Contacts, Insights, Sales settings) plus the per-task click-through notes in Tasks 17 to 27. No horizontal page scroll anywhere; every menu, popover, dialog and panel opened at least once (render-time errors show only when clicked). Check that no Slack message was sent.
- [ ] **Step 8: Access.** As a team member without Sales (Robert O.'s role): `/sales/dashboard`, `/sales/leads`, `/sales/contacts`, `/sales/insights`, `/sales/settings` and `/?lead=l1` show the normal 404 or nothing; every new API route (`/api/sales/leads`, `/api/sales/contacts/people`, `/api/sales/files/<id>`, `/api/sales/views`, `/api/sales/pipelines/<id>/stages`, the merge and convert routes) answers 403; the page source and the sidebar have no Sales words. As a non-admin Sales user: `/sales/settings` is 404, merge and delete are absent, and the API answers 403.
- [ ] **Step 9: Storage.** Read `src/app/api/cron/storage-check/route.ts` and confirm its unprefixed `list()` reads the same store (`BLOB_READ_WRITE_TOKEN`) that Task 12 writes `sales-files/` into, so the monthly total includes Sales file bytes; record it. Do not call the cron route (it posts to Slack). The test file uploaded in Step 7 (into the store named there) is removed through the app afterwards; removal is a soft delete, so its bytes stay in that private store: record its pathname as accepted, to purge in the later cleanup (Decision 24).
- [ ] **Step 10: Record** the results and any follow-ups in `SESSION_NOTES.md` (not committed) and report to DJ in plain words.

---

## Plan review rulings

Three reviews (coverage, codebase, risk) of this plan, 2026-11-07. Each finding was checked against the repo and the rulings before it was applied. Numbers follow each review's order.

**Coverage**
- coverage-1 applied: `deal-history.tsx:40` `ICONS` is `Record<TimelineIcon, LucideIcon>`; Task 3 now maps the four new keys (all four icons exist in lucide-react 1.23) and Decision 2 names it.
- coverage-2 applied: `activities-view.tsx:271` calls `markDone` without `kind`; Task 6 makes the one-line change.
- coverage-3 applied: both typed `DealPanelData` fixtures confirmed; Tasks 12 and 13 update them.
- coverage-4 applied: `Editable` is `{ title; source }` at `deal-audit.ts:30`; Task 13 widens it.
- coverage-5 applied: `deals.test.ts:316` asserts the see-own `ownerId` lookup; Task 2 lists its new `OR` shape.
- coverage-6 applied: verified on zod 4.4.3 that a default inside `.optional()` fills `null`; `contactRefSchema` loses its default, update and convert schemas use `.optional()`, title-only and phone-only tests added, Global Constraints note added.
- coverage-7 applied: Task 2 splits `checkContactRefs` (read-only) from `createContacts`; Task 8 makes the guarded write the first write; Task 10 throws `ContactRaced` after a create; tests added.
- coverage-8 applied: the real union (`key`, `kind`, `detail`) is pinned, `contactBody` and `existingChoice` are exported and used by Tasks 20 to 24, `inputRef` kept, `autoFocus` dropped.
- coverage-9 applied: Task 19 points Task 1's `{choice.detail}` check at `contact-picker.tsx`.
- coverage-10 applied: `DealPanelBody` is private and loads in effects; Task 24 exports `DealPanelContent` (today's ready branch) and renders it.
- coverage-11 applied: Prisma 7's generated runtime data model carries no `relationFromFields` (checked); Decision 20 records the schema-text choice, the regex takes named relations, a self-check and an at-least-4 floor were added.
- coverage-12 applied: R2 is binding; Task 7 keeps only type-forced edits, and the "Deal or lead" heading, Lead pill and empty-state line move to Task 21.
- coverage-13 applied: the exact `activities.test.ts` lines and the lead-only 404 case are rewritten in Task 6.
- coverage-14 applied: reopen and note edit through a non-OPEN lead give 409; `canEdit` is false for ARCHIVED; `canRestore` added and used by `leadNotice`; `updateLead` and `setLeadField` refuse ARCHIVED.
- coverage-15 applied: `LeadPanelBody`, `ContactPanelBody` and `DealFiles` join the scroll-containment test in Tasks 21, 23 and 24.
- coverage-16 applied: both panel data types carry true `counts`; Task 23 shows them and "Showing 20 of {n}.".
- coverage-17 applied: with risk-1.
- coverage-18 applied: Task 11 Step 3 reads each affected row's other contact (id and name) before repointing.
- coverage-19 applied: Task 2 restates "mine" for any actor and tests all shapes.
- coverage-20 applied, with a different phone rule: email trimming now uses the same ASCII set in JS and SQL (exact parity, with tests); the phone rule is marked "plan's reading of A5" and changed from "last 10" to "drop a leading 1 from 11+ digits, keep the first 10", so an extension no longer changes the key (the finding's example gave `2555014223`; now `5125550142`). The UK case was dropped (US only).
- coverage-21 applied: `createLead` checks everything, including picked contacts, before `assignLeadOwner`; test asserts the rotation is untouched on a refusal.
- coverage-22 applied: "View all" carries `scope=mine`; the Follow-Up link names the first pipeline with a `follow-up` stage (`followUpPipelineKey`); Decision 25 says No next step opens deals only.
- coverage-23 applied: `LeadAssignmentView.firstAdminName` and `nobodyTickedLine` name the admin (A8).
- coverage-24 applied: `ConvertDialog` takes `personName` and `organizationName`.
- coverage-25 applied: `FieldRef` is private at `deal-audit.ts:28`; Task 3 exports it.
- coverage-26 applied: `PanelFile` lives in `deal-panel.ts`; `files.ts` imports it.
- coverage-27 applied: `deals-view-render.test.ts:171` and `:302` confirmed and listed.
- coverage-28 applied: Task 19 has a Consumes line, types only.
- coverage-29 applied: Mockup v2's differing strings confirmed; Task 16 lists them for the controller to settle with DJ before Task 17, keeping "PNG or JPG" (A7).

**Codebase**
- codebase-1 applied (Critical): `scripts/check-sales-secrecy.ts` reads `process.argv[2] ?? ".next"` and the main `.next` is the Plan 2 build; Task 28 Step 2 scans the worktree's `.next` before removing it, and Step 3 never runs the scan without a path.
- codebase-2 applied: same as coverage-1.
- codebase-3 applied: same as coverage-2.
- codebase-4 applied: the fake `findFirst` delegates destructure `where.deal`; Task 6 says they are rewritten for both `OR` branches, and lists the note-test lines too.
- codebase-5 applied: the `toEqual` create assertions, `:316`, the `findContact` fake, and `contacts.test.ts:75` and `:105` are all listed in Task 2.
- codebase-6 applied: with coverage-7 and coverage-21 (`deals.ts:24-26` confirms a returned refusal commits).
- codebase-7 applied: with coverage-7; Task 8 also gets the 422-before-create test.
- codebase-8 applied: also the `salesFile` delegate in `deal-read-routes.test.ts:52-62`, which would throw at runtime.
- codebase-9 applied: same as coverage-4.
- codebase-10 applied: the Plan 1 settings cases that change are listed with their new expectations, and the fake `teamMember.findMany` answers both reads.
- codebase-11 applied: same as coverage-9.
- codebase-12 applied: same as coverage-10.
- codebase-13 applied: a Global Constraints line keeps client code on `import type` for server modules; Tasks 23 and 25 consume types only; `PanelFile` sits in `deal-panel.ts`.
- codebase-14 applied: `nextBoardQuery` clears `stage` only on a pipeline change that names no stage; Task 26 applies a `pipeline: null` view on the shown pipeline (`savedViewPatch`).
- codebase-15 applied: `SidebarGroupLink` moves to `sidebar-group-link.tsx`, and its sr-only text is one string.
- codebase-16 applied: the render test's `when=overdue` mock is confirmed; hrefs corrected.
- codebase-17 applied: same as coverage-27.
- codebase-18 applied: same as coverage-25.
- codebase-19 applied: both helpers are in `src/lib/sales/format.ts`; the Consumes lines are corrected.
- codebase-20 applied: with coverage-20.
- codebase-21 applied: with coverage-11.
- codebase-22 applied: a thrown transaction after the upload deletes the blob and answers 503 without rethrowing; test added.
- codebase-23 applied as accepted: Decision 17 and a migration comment tell the controller to re-run the two backfill `UPDATE`s after restoring a pre-3A snapshot; the restore script is not changed in 3A.

**Risk**
- risk-1 applied: `loadMergePreview` refuses non-admins before any read; lib and route tests added (covers coverage-17).
- risk-2 applied: convert, owner change, archive and restore put the read owner (and status) in the guarded `where`; the activity move also requires `dealId: null` and the old owner; a re-read after a miss answers the refusal; test added, Review Focus 1 extended.
- risk-3 applied: `recordSalesAuditMany` (one `createMany`) and an explicit `{ timeout: 30_000, maxWait: 5_000 }`; Prisma's 5-second default confirmed (no option in `src/lib/prisma.ts`).
- risk-4 applied: "Select all shown leads" (Mockup v2), a select-all strip above the cards under 640px (plan's addition, to be drawn into Mockup v2 at Task 16), and a sticky bulk bar with `role="region"` and a status count.
- risk-5 applied: the file input is `sr-only` and focusable inside the label, with a visible focus ring and `aria-describedby`; render test added.
- risk-6 applied: `LeadRowView` is exported and a ticked-row render case plus a source check guard `MUTED_TEXT` (the token check ignores MUTED_TEXT's own `dark:` class).
- risk-7 applied: Review Focus 3 now covers contact visibility (contact keys stay tested in Task 2), 4 adds the download checks, 1 adds the convert vs owner-change race.
- risk-8 applied: the organization list's count is pinned with the owner filter, the panel counts come from `count`s with the list's filter, and a hidden organization renders as text (`visible`).
- risk-9 applied: `hiddenMatch` is an exact `NOT visible` `findFirst`, skipped for admins and seesAll.
- risk-10 applied: the widened pattern is used in the test and the gate grep; today's Sales code has no hit (checked).
- risk-11 applied: Sales access first, then Origin, then a capped body read when `Content-Length` is missing; test added.
- risk-12 applied: non-OPEN lead refusals (with coverage-14) and a guarded touch of the lead row before adding an activity or note, which serializes with convert.
- risk-13 applied: up to 4 pages of 50, stopping at 7, with "No recent changes on your deals." for Just me and see-own viewers.
- risk-14 applied: `(archivedAt, name)` indexes on both contact tables (Decision 3, migration, Task 28 EXPLAIN) and `take: FILES_PER_DEAL_MAX` on the panel's files.
- risk-15 applied: tile values get `min-w-0 [overflow-wrap:anywhere] tabular-nums`, with a render assertion.
- risk-16 partly applied: (1) the SVG scales with `viewBox` and `w-full h-auto` until measured; (3) a contrast test pins `CHART_SERIES_TOKEN` at 3:1 on the card in both themes. (2) rejected: Mockup v2 draws every bar and point as `tabindex="0" role="img"` with a tooltip (its chart code at lines 1439, 1496 and 1523), the stops are bounded (about 12 per chart at most), and Mockup v2 outranks skill taste under the plan's precedence; the table toggle already serves screen-reader users.
- risk-17 applied: Mockup v2 uses `role="tablist"` and `role="tab"`, so the full tab pattern is pinned (tabpanel, `aria-controls`, roving tabindex, arrows with manual activation).
- risk-18 applied: convert dialog loading, error and no-pipeline states, the merge preview error, and the all-zero forecast hint are pinned and tested.
- risk-19 applied: scroll containment with coverage-15; `data-deal-id` on dashboard deal rows, `data-organization-id` on organization rows, and `finalFocus` on the lead and contact panels.
- risk-20 applied: bulk ids and convert `pipelineId` and `stageId` are 1..64 with "Invalid input."; tests added.
- risk-21 applied: hidden-lead, hidden-deal-file and hidden-organization cases added in Tasks 5, 6, 10 and 12.
- risk-22 applied: the sniff also refuses `macrosheets/`, `/activeX/` and `embeddings/oleObject`; Task 28 names the Blob store before the test upload and records that a removed file's bytes stay.

**For the controller to decide**
- The phone key rule (coverage-20) now reads A5 as "drop a leading 1 from 11 or more digits, keep the first 10"; overrule it in the rulings if "last 10" was meant.
- New strings this review added, not drawn in Mockup v2 yet: the phone select-all strip, "No recent changes on your deals.", the forecast hint, the convert dialog's three states, the merge preview error, "Showing 20 of {n}.", `nobodyTickedLine`. Settle them with DJ at Task 16 together with the Mockup v2 differences listed there.
