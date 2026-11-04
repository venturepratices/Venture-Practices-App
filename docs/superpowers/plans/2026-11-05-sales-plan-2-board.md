# Sales Command, Plan 2: Board and Deal Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give people with Sales access a working, Pipedrive-like Sales area: a Deals board (drag between stages) and list, a slide-in deal panel, activities with the next-step loop, notes, Everyone / Just me, keyboard shortcuts, and the stage rules (proposal value, lost reason, No Show) enforced on the server.

**Architecture:** Server data lives in small focused modules under `src/lib/sales/` (read models return plain serializable objects; write services run one Prisma transaction that also writes the locked history row). Thin route handlers under `src/app/api/sales/` wrap each service with `requireSalesUser`, a zod `strictObject` body and `requestMeta(request)`. Pages under `src/app/(app)/sales/` are server components gated per page; client components call the routes and `router.refresh()`, the house pattern used by the task board. The deal panel opens from a `?deal=<id>` search param, like the task panel's `?taskId=`.

**Tech Stack:** Next.js 16.2 App Router, Prisma 7.8 on Neon Postgres, zod 4, vitest 4 (node env, Prisma mocked), Tailwind 4 with the app's shadcn/Base UI components (Sheet, Dialog, Menu, ContextMenu, Combobox), `@dnd-kit/core` 6.3.1 and `sonner` 2 (both already installed, no new dependencies), lucide-react icons.

**Spec:** `Sales Module Handoff/sales-module-spec.md` (sections 2, 3, 4, 7, 8, 16). Look, layout and wording: `scratch/sales-mockup/sales-command-mockup.html` (approved), flows in `scratch/sales-mockup/sales-guide.html`. Board items from `scratch/sales-mockup/feature-gaps.md` (Top 8 #2 rotting, #4 remembered view). Rulings: `docs/superpowers/plans/2026-11-05-sales-plan-1-ledger.md` and `.superpowers/sdd/2026-11-05-sales-plan-2-board/progress.md` (P2-R1..R4).

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing any page, layout, route handler or server action (AGENTS.md: this Next.js differs from training data; heed deprecations). Specifically: `01-app/01-getting-started/15-route-handlers.md` (route `params` is a Promise), `01-app/03-api-reference/03-file-conventions/page.md` (`searchParams` is a Promise), `error.md` (use `unstable_retry`, not `reset`), `loading.md`, and `01-app/02-guides/authentication.md` "Layouts and auth checks" (layouts do not re-run on navigation, so every page gates itself).
- Migrations: hand-written SQL in `prisma/migrations/<name>/migration.sql` (names start `20261106000001_`), applied to the DEV database with `npx prisma migrate deploy`, then `npx prisma generate`. NEVER `migrate dev`, `migrate reset` or `db push`. The `.env` DATABASE_URL is the dev Neon DB. Any new model goes into `src/lib/backup.ts` BACKUP_MODEL_KEYS + snapshot and `scripts/restore-from-backup.ts`, or BACKUP_EXCLUDED_MODELS with a reason (the guard test enforces it). Plan 2 adds columns only, no models.
- Sales is SECRET from one team member (Robert). Nothing posts to Slack, email or HighLevel (no `notify()`, no `notifyChannel()`, no Slack calls anywhere in Plan 2 code). Sales nav and pages exist only for users with Sales access (admin or `canUseSales`); every Sales page, server action and route is server-gated with `requireSalesUser`; bots never act as admin. Plan 2 routes are signed-in users only; no bot reaches them. The shared top bar and the shared sidebar get nothing Sales-related in their source: code every user downloads (`src/components/layout/*`) holds no Sales word, path or label, and receives the Sales nav group as data from the server layout only for people with access (Task 6).
- No em dashes in any user-facing text (labels, errors, toasts, empty states, history lines). People in seeds/fixtures/tests: first name + last initial (`Sarah K.`, `Ben S.`, `Robert O.`). Money is integer cents (`valueCents`, `mrrCents`). Dates use the app timezone helpers in `src/lib/utils.ts` (`endOfDay`, `startOfDay`, `dateInputValue`, `addDaysToDateString`, `zonedDateTime`); never `new Date("YYYY-MM-DD")`.
- Every write to Sales data records a history row via `recordSalesAudit` (through Task 2's `recordDealAudit`) in the same transaction, with `requestMeta(request)` where a Request exists. Rule-made changes use the actor `{ system: "rule" }` and no request meta.
- CSRF (spec 3.4, 18.3: SameSite cookies plus an `Origin` check on mutating requests). Every POST, PATCH, PUT and DELETE handler under `src/app/api/sales/` runs Task 2's `assertSameOrigin(request)`: `readJson` runs it as its first step, and a handler without a body (DELETE) calls it directly. A request whose `Origin` names another host gets 403 `"Request blocked."` and changes nothing. Task 2's guard test enforces this for every Sales route file, Plan 1's included.
- Every write path, in this order: `requireSalesUser()` (route) then `assertSameOrigin` (inside `readJson`, or called directly) then zod `z.strictObject` body (unknown keys rejected, 400 with the first issue's message) then `findDealForEdit` (deal not visible under `dealOwnerWhere(actor, "everyone")` or archived: 404 `"Deal not found."`; visible but `!canEditDeal`: 403) then one `prisma.$transaction` holding the change and its history rows. Routes keyed by an activity or note id apply the same visibility filter through the `deal` relation (404 when it fails) and then `canEditDeal` (or, for note edits, author or admin). The only exception is the no-show cron (Task 4), which is CRON_SECRET-gated and acts as `{ system: "rule" }`.
- Every screen must work on phone (375px), tablet and PC: no horizontal page scroll; the board scrolls sideways inside its own container; touch targets at least 40px (use Tailwind `pointer-coarse:min-h-10 pointer-coarse:min-w-10` on controls that are smaller on desktop).
- Performance (Ben: fast with many users): board queries select only needed columns (never person email or phone), are bounded (`take`) or paginated, and filter on indexed columns. Constants: `BOARD_COLUMN_LIMIT = 50` cards per column, `LIST_PAGE_SIZE = 50`, `ACTIVITIES_PAGE_SIZE = 50`, `TIMELINE_PAGE_SIZE = 30`, `CONTACT_SEARCH_LIMIT = 8`.
- Do not run the dev server or open a browser (the controller clicks through every screen in Task 10). Do not dispatch subagents.
- Tests in `tests/**/*.test.ts`, never touching a real DB: mock `@/lib/prisma` (canned rows from `vi.fn`, `$transaction: async (fn) => fn(tx)`, audits captured from `salesAuditLog.create`) and mock `@/lib/sales/access`'s `requireSalesUser` or `@/lib/permissions`, as `tests/lib/sales/settings-route.test.ts` does. Assert on captured call arguments and written rows, with exact values. Component rendering cannot be unit-tested in this node vitest env: UI tasks test their pure client helpers and server data, and rely on the controller's click-through.
- Finish gate per task: `npx tsc --noEmit` (only pre-existing errors in stale `.next/` types and untracked `scratch/` are acceptable), `npx eslint src scripts tests`, `npm test`.
- Every file a task creates or modifies is in that task's `git add` list. The gate runs on the working tree, so a file left out of the commit leaves a broken committed tree that no gate catches. Before committing, `git status --short` must show no untracked or modified file under `src/`, `prisma/` or `tests/` that the task touched and did not stage. Use only the components that already exist in `src/components/ui/` unless the task's Files list names a new one.
- Stage files by explicit path only (never `git add -A` / `.`). Untracked `scratch/`, `docs/` (except this plan file), `"Sales Module Handoff/"`, `SECURITY_AUDIT.md`, `src/lib/email.ts`, `src/app/api/me/notification-preferences/test-email/` and the modified `SESSION_NOTES.md` must NOT be committed. Never switch branches, push or merge (branch `sales/plan-2-board`).
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Skills: implementers load superpowers:test-driven-development and superpowers:verification-before-completion; UI tasks (6 to 9) also load ui-ux-pro-max, impeccable and emil-design-eng. Precedence: the approved mockup, then the app's components and theme tokens, then skill taste. Skip any skill step that would start a dev server, open a browser, ask the user a question or dispatch subagents.
- Mockup tokens map to app tokens: `p-ok` to `bg-status-success text-status-success-foreground`, `p-warn` to `status-warning`, `p-bad` to `status-danger`, `p-neu` to `bg-muted text-muted-foreground`, `--accent` to `bg-accent text-accent-foreground`, `--primary` to `primary`, column background to `bg-muted/40`; Won button `bg-green-600 text-white` (spec #16A34A), Lost button `bg-red-600 text-white` (spec #DC2626); NEW badge `bg-secondary-accent text-secondary-accent-foreground`. Owner avatar tones `bg-amber-300`, `bg-teal-300`, `bg-blue-300`, `bg-violet-300` with `text-slate-950`. No raw hex in components.

## Decisions

Spec-vs-mockup choices under P2-R1 (behaviour from the spec, look/layout/wording from the mockup), plus the three carried from the Plan 1 ledger.

1. **No Show (ledger a).** Both behaviours ship. Moving a deal into a No Show stage by hand adds the "Reschedule the missed demo" call due today (rules.ts, mockup). Spec rule 5's auto-move runs as a daily cron (`0 11 * * *`, 6 or 7 AM Eastern): a MEETING activity on an OPEN deal, not done, whose due day ended before today (app time), in a pipeline with a No Show stage, while the deal sits in a stage before No Show, moves the deal to No Show, marks the meeting missed (archived, history "Meeting missed: ...") and adds the reschedule call. Deals at or past No Show are never moved back. A second reschedule call is never added while one from the rule is still open. No Slack or email.
2. **Auto first activity for form leads (ledger b).** Plan 3 (Leads). Plan 2's hand-made "Add deal" requires a first activity (mockup), which keeps spec rule 1 at creation.
3. **Won button vs won stages (ledger c).** Status changes only through Won and Lost (panel buttons, drag drop zones, card menu), as in Pipedrive and the mockup, whose Contract Signed and Sent to Onboarding columns hold open deals. Stages flagged `isWon`/`isLost` stay ordinary columns; entering one shows a toast offering "Mark won" or "Mark lost". The flags feed forecasts later (Plan 3, Ruling 19). The board shows Open deals by default; a Status filter shows Won or Lost deals in their columns.
4. **Closed deals do not move.** A WON or LOST deal cannot change stage (409 `"This deal is closed. Reopen it first."`); Reopen returns it to OPEN in its current stage.
5. **Panel layout.** Mockup single column (header with stage bar; composer tabs; Next steps; Details; History) instead of spec 7.5's three-column body and sticky bottom bar. Width 560px on desktop, full screen under 640px (spec 7.5/7.10).
6. **Later plans.** File tab, the "from HighLevel" calls/texts box, Leads Inbox, Contacts, Sales dashboard, Insights and Sales settings are Plan 3. The Sales nav group shows only pages that exist: Deals and Activities, with the mockup's NEW badge.
7. **Keyboard shortcuts follow spec 16.1.** `/` search (focuses "Filter this board"), `n` new deal, `e` new email (composer set to Email, in an open deal), `t` new task (composer set to Task, in an open deal), `Esc` close, `?` this list. The mockup's "e = edit deal name" is dropped; the name is edited by clicking it.
8. **No global top-bar search or quick-add.** The top bar is shared with people who must not see Sales. Search in Plan 2 is the board filter (deal title, organization name, person name; spec 7.4). The keyboard-shortcuts button sits at the end of the Sales toolbar and the Activities header instead of the top bar.
9. **Filters.** Spec 7.4's drawer is reduced to a compact Filter menu beside the mockup toolbar (the existing `DropdownMenu` with radio groups; the app has no Popover wrapper and the mockup draws none): Status (Open, Won, Lost) and Next step (Any, Overdue, Today, No next step). Product, source, date range and value range are deferred (no product field). Everyone / Just me is the owner chip (spec 16.1), hidden for people set to see only their own deals.
10. **Quick actions (spec 7.4 right-click).** A Base UI ContextMenu on each card (right-click, long-press on touch, Shift+F10 or the Menu key): Open, Add activity, Move to (stage list), Mark won, Mark lost, Delete (admins). This also delivers spec 7.10 "long-press, then tap the destination" and spec 16.1 "Add activity on every card" without adding a visible button to the mockup card. Change owner lives in the panel.
11. **Drag.** Mouse drag with an 8px threshold and keyboard drag (Space picks up, Left/Right jump a column, Space drops, Esc cancels, Enter opens the deal) with screen-reader announcements. Touch uses the long-press menu instead of drag, so swiping sideways never picks a card up. Mobile hint reworded: "Swipe sideways for more stages. Press and hold a deal to move it."
12. **Deal rotting (feature-gaps #2).** New `SalesStage.rottingDays` (14 on every stage that is neither won nor lost, null on won/lost). At or past it, the days pill turns amber with a clock icon and says so to screen readers. Editing the number per stage comes with Sales settings (Plan 3).
13. **Remembered default view (spec 16.3, feature-gaps #4).** Pipeline, Board/List and Everyone/Just me are saved per person (`TeamMember.salesDefaultView`) and used when `/sales/deals` opens with none of those three in the URL. Every toolbar change writes the resolved pipeline key into the URL (Task 7's `nextBoardQuery`), so after any click the URL names `pipeline` and a save still in flight can never undo the click. Named saved filters are Plan 3. A view preference is not Sales data, so it writes no history row.
14. **Delivery pipelines hidden** (spec 12: Phase 2). The pipeline picker and Add deal list Sales and Consulting pipelines only.
15. **Who owns activities, who may write.** A first activity made with a new deal, and rule-made activities, belong to the deal owner; any other new activity belongs to the person who scheduled it (Pipedrive default). Only the deal owner or an admin may add activities or notes (spec 8.1 edit rights); everyone else sees the panel read-only. When a deal changes owner, its open activities owned by the old owner move to the new owner in the same transaction (recorded on the `owner_changed` row), so nobody keeps to-dos on a deal they can no longer open. The Activities list only ever shows activities on deals the viewer may see.
16. **History is the locked log.** Every deal-related write (fields, stage, status, owner, value, custom fields, activities on the deal, notes on the deal) records its row against the deal (`entityType "SalesDeal"`, `entityId` = deal id) with a typed action, so the panel timeline is one indexed query that always names who did it. The timeline pages with a "Show older" button rather than infinite scroll (spec 7.8), keeping keyboard focus predictable. Note bodies are plain text (never HTML, rendered with `whitespace-pre-wrap`), max 50,000 characters, so no sanitizer is needed; a note edit keeps the old text in its history row.
17. **Lost reasons.** Mockup list: Price, Chose a competitor, Not ready yet, No response, Territory already taken, Other. The optional comment goes in the new `SalesDeal.lostComment` (max 1,000 characters). "Lost always asks for a reason" (guide).
18. **Deal source.** Spec 4.6 `source` added as `SalesDeal.source` (mockup Details "Source"), one of: Check Availability form, Referral, Direct inquiry, Outbound, Renewal, Added by hand. Hand-made deals get "Added by hand".
19. **Due choices.** Mockup's Today / Tomorrow / In 2 days / Next week, plus "Pick a date" (spec `due_date` is any date). Time: "Any time" or half hours from 7:00 AM to 8:00 PM. Pill colours are day-level: anything due today is amber all day, red from the next day (spec 7.4).
20. **Empty states.** Mockup lines are kept where they exist ("No deals in {stage} yet."); every empty list also gets a one-line explanation and a primary action (spec 7.12). Activities' "Nothing here." becomes per-filter copy (Task 9).
21. **Plan 1 rulings.** Ruling 23 (delete-member refusal must show its message) lands in Task 6, because Plan 2 is the first plan where someone can own Sales rows; its last-admin message also loses an em dash. Ruling 24 (settings refusal) stays with the Sales settings screen in Plan 3. Rulings 16 and 17 apply to DATE fields and the territory hold.
22. **404 for pages, 403 for routes.** Pages answer `notFound()` to people without Sales access, so the area's existence is not confirmed; API routes keep Plan 1's 403 message. Deals a person may not see are 404 everywhere (spec 18.3).
23. **Pipeline-level access** (spec 8.3 `user_pipeline_access`) is not built; the Plan 1 who-can-see switch is the row filter.
24. **Undo.** Stage moves, Won and Lost offer Undo in the toast. Undoing a move into No Show also removes the reschedule call the rule just added (only rule-made, still open, same deal).
25. **Organization and person** are shown, not editable, on a deal in Plan 2. Add deal picks an existing one (search) or makes a new one. Editing and merging are Plan 3 (Contacts, feature-gaps #3).
26. **Toasts.** One sonner `<Toaster position="bottom-center" />` in the app layout (mockup position), used by Sales and by the Team page refusal message.
27. **Value editing** outside a move uses the same dialog titled "Deal value". A deal in a Proposal Sent stage cannot have either value cleared (spec rules 2 and 8 enforced on edit too).
28. **Territory hold (spec rule 4)** is wired to the "Territory Hold Expiry" custom field: setting it adds a Deadline "Territory hold check" due 7 days before (end of that day, Ruling 17), or today if that is already past; changing the date moves the open check; clearing removes it. The panel shows the mockup's hold infobar.
29. **Feature-gaps not folded in.** #1 Slack alerts and due-soon reminders are not built: Sales must not post to Slack while it is secret (hard rule). #3 duplicate merge, #5 forecast total, #6 Insights, #7 CSV export and #8 bulk edit belong to Contacts, the dashboard, reports and the post-import cleanup (Plan 3 or 4). Only #2 (rotting) and #4 (remembered view) belong to the board.
30. **Details labels** come from the stored custom-field labels (for example "How would you like to start?", "Territory Hold Expiry"), not the mockup's shortened sample labels, so an admin's later rename shows up without a code change.
31. **Card order.** Newest in stage first (`stageEnteredAt` desc, then `id` desc). A card just moved sits at the top of its new column before and after the refresh, and stays among the 50 shown in a full column. Older, idle deals sit lower; past 50 the column footer points to the list view.
32. **Deletion attempts are logged (spec rule 6).** A refused delete of a deal the person can see writes a `delete_refused` history row (who, when, IP) before the 403. Organizations and people made by "Add deal" get their own `created` rows (entity `SalesOrganization` / `SalesPerson`), so Plan 3's Contacts has their history from day one.
33. **"Show more" appends.** List view and Activities fetch the next page from a GET route and append it on the client; the URL never carries a cursor, and any filter change or refresh starts again from page one.

## Review Focus

1. **A stale screen versus the money rule.** A card dragged to Proposal Sent from a board that still shows an old value, a second tab, or a value cleared after the deal reached Proposal Sent. Expect the server to check stored values and answer 422 with the rule message; nothing moves and the value dialog opens. Tests: Task 4 (stale move), Task 3 (clearing a value at Proposal Sent).
2. **Times near midnight Eastern and across DST.** An activity due today viewed at 11:30 PM Eastern (already tomorrow in UTC) still says "Today"; "Tomorrow" chosen at 11:30 PM lands on the next Eastern day; a 9:30 AM activity on the DST Sunday stores 13:30 UTC; days-in-stage counts calendar days across the November change. Tests: Task 1 (format helpers), Task 5 (stored `dueAt`), Task 8 (composer due date).
3. **Money typed like a person.** `$14,400`, `14,400.5`, ` 0 `, `-5`, `12.345`, `1e6`, `$20,000,000`. Expect exact cents or a clear refusal, with the server capping at $10,000,000. Tests: Task 1 (`parseMoneyToCents`), Task 3 (PATCH above the cap).
4. **Doing the same thing twice.** Double-clicking "Save and move", dropping a card on the stage it is already in, moving into No Show again, marking an activity done twice. Expect no duplicate history rows and no second reschedule call. Tests: Task 4 and Task 5.
5. **Stale or hand-edited links.** `?pipeline=` an archived or unknown key, a saved default view pointing at a removed pipeline, `?deal=` an archived deal or one the person may not see, a malformed `cursor` on a "Show more" request. Expect a fallback to the first pipeline (or the first page) and a calm "This deal is not available." (404), never a crash or a leak. Tests: Task 1 (`parseBoardQuery`), Task 2 (`loadBoardPage`, `loadDealPanel`, GET routes), Task 5 (GET activities).

---

### Task 1: Plan 2 columns and shared Sales helpers

**Files:**
- Modify: `prisma/schema.prisma` (SalesStage `rottingDays Int?`; SalesDeal `source String?`, `lostComment String?`, `@@index([pipelineId, status, updatedAt])`; SalesActivity `@@index([doneAt, dueAt])`; TeamMember `salesDefaultView Json?`)
- Create: `prisma/migrations/20261106000001_sales_board/migration.sql`
- Modify: `src/lib/sales/seed-data.ts` (`SeedStage.rottingDays: number | null`; `buildStages` sets 14 unless the flag is `won` or `lost`)
- Create: `src/lib/sales/constants.ts`, `src/lib/sales/format.ts`, `src/lib/sales/board-query.ts` (all client-safe: no prisma, no `next/*` server imports)
- Test: `tests/lib/sales/format.test.ts`, `tests/lib/sales/board-query.test.ts`; modify `tests/lib/sales/seed.test.ts`

**Interfaces:**
- Consumes: `SalesActivityType` from `@/generated/prisma/enums`; date helpers in `src/lib/utils.ts`.
- Produces (`constants.ts`): `BOARD_COLUMN_LIMIT = 50`, `LIST_PAGE_SIZE = 50`, `ACTIVITIES_PAGE_SIZE = 50`, `TIMELINE_PAGE_SIZE = 30`, `CONTACT_SEARCH_LIMIT = 8`, `DEFAULT_ROTTING_DAYS = 14`, `MAX_DEAL_CENTS = 1_000_000_000`, `NOTE_MAX_CHARS = 50_000`, `LOST_COMMENT_MAX = 1_000`, `TEXT_FIELD_MAX = 500`, `SUBJECT_MAX = 200`, `TITLE_MAX = 200`, `MISSED_MEETING_BATCH = 200`, `TERRITORY_HOLD_FIELD_KEY = "territory-hold-expiry"`, `BOARD_PIPELINE_KINDS = ["SALES", "CONSULTING"] as const`, `ACTIVITY_TYPES = ["CALL","MEETING","TASK","DEADLINE","EMAIL","LUNCH"] as const`, `ACTIVITY_TYPE_LABELS: Record<SalesActivityType, string>` (Call, Meeting, Task, Deadline, Email, Lunch), `LOST_REASONS = ["Price","Chose a competitor","Not ready yet","No response","Territory already taken","Other"] as const`, `DEAL_SOURCES = ["Check Availability form","Referral","Direct inquiry","Outbound","Renewal","Added by hand"] as const`, `FIRST_ACTIVITY_PRESETS: Record<"call-today"|"call-tomorrow"|"demo-2-days", { label: string; type: SalesActivityType; subject: string; offsetDays: number }>` = Call today (CALL, "First call", 0), Call tomorrow (CALL, "First call", 1), Demo in 2 days (MEETING, "Demo", 2), `NEXT_STEP_PRESETS` = `[{ id: "call", label: "Call tomorrow", type: "CALL", subject: "Follow-up call", offsetDays: 1 }, { id: "email", label: "Email in 2 days", type: "EMAIL", subject: "Check in by email", offsetDays: 2 }, { id: "meeting", label: "Meeting next week", type: "MEETING", subject: "Meeting", offsetDays: 7 }]`, `DUE_CHOICES` = today 0 "Today", tomorrow 1 "Tomorrow", 2-days 2 "In 2 days", next-week 7 "Next week", pick null "Pick a date", `TIME_SLOTS: { value: string; label: string }[]` ("07:00" "7:00 AM" through "20:00" "8:00 PM", every 30 minutes, 27 entries).
- Produces (`format.ts`): `parseMoneyToCents(input: string): number | null`, `formatMoney(cents: number): string`, `shortName(name: string): string`, `type NextStepTone = "overdue" | "today" | "future" | "none"`, `nextStepPill(dueAt: Date | null, now: Date): { tone: NextStepTone; label: string }`, `dayLabel(date: Date, now: Date): string` ("Today", "Yesterday", "Tomorrow" or "Nov 3"), `daysInStage(stageEnteredAt: Date, now: Date): number`, `isRotting(days: number, rottingDays: number | null): boolean`, `activityDueAt(dueDate: string, dueTime: string | null): Date`, `isValidDateString(value: string): boolean`, `avatarTone(id: string): 0 | 1 | 2 | 3`.
- Produces (`board-query.ts`): `type BoardQuery = { pipeline: string | null; view: "board" | "list"; scope: "everyone" | "mine"; status: "open" | "won" | "lost"; next: "any" | "overdue" | "today" | "none"; q: string; cursor: string | null }`, `savedViewSchema` (zod strictObject `{ pipeline: string(1..64) | null, view, scope }`), `type SavedView`, `parseBoardQuery(params: Record<string, string | string[] | undefined>, saved?: unknown): BoardQuery`, `boardQueryToSearch(query: BoardQuery): string`.

- [ ] **Step 1: Write the failing tests** `tests/lib/sales/format.test.ts` and `tests/lib/sales/board-query.test.ts`

```ts
// format.test.ts (now = 2026-11-06T04:30:00Z is Nov 5, 11:30 PM Eastern)
const lateNov5 = new Date("2026-11-06T04:30:00Z");
it.each([
  ["14400", 1440000], ["$14,400", 1440000], ["14,400.5", 1440050], ["1200.50", 120050],
  [" 0 ", 0], ["", 0], ["10000000", 1_000_000_000],
])("parseMoneyToCents(%j) = %d", (input, cents) => expect(parseMoneyToCents(input)).toBe(cents));
it.each(["-5", "12.345", "1e6", "abc", "10000000.01", "$20,000,000"])("parseMoneyToCents(%j) is null", (input) =>
  expect(parseMoneyToCents(input)).toBeNull());
it("formats whole dollars without cents", () => {
  expect(formatMoney(1440000)).toBe("$14,400");
  expect(formatMoney(1440050)).toBe("$14,400.50");
  expect(formatMoney(0)).toBe("$0");
});
it("shortens names to first name and last initial", () => {
  expect(shortName("Robert Ortiz")).toBe("Robert O.");
  expect(shortName("  Mary Ann Lee ")).toBe("Mary L.");
  expect(shortName("DJ")).toBe("DJ");
  expect(shortName("Sarah K.")).toBe("Sarah K.");
});
it("reads due days in Eastern time, not UTC", () => {
  expect(nextStepPill(endOfDay("2026-11-05"), lateNov5)).toEqual({ tone: "today", label: "Today" });
  expect(nextStepPill(endOfDay("2026-11-06"), lateNov5)).toEqual({ tone: "future", label: "Tomorrow" });
  expect(nextStepPill(endOfDay("2026-11-02"), lateNov5)).toEqual({ tone: "overdue", label: "Overdue 3d" });
  expect(nextStepPill(endOfDay("2026-11-12"), lateNov5)).toEqual({ tone: "future", label: "Nov 12" });
  expect(nextStepPill(null, lateNov5)).toEqual({ tone: "none", label: "No next step" });
  // a 9 AM activity is still "Today" at 3 PM the same day (day-level colours)
  expect(nextStepPill(zonedDateTime("2026-11-05", "09:00"), new Date("2026-11-05T20:00:00Z")).label).toBe("Today");
});
it("counts calendar days in stage across the November DST change", () => {
  expect(daysInStage(zonedDateTime("2026-10-31", "23:00"), zonedDateTime("2026-11-02", "08:00"))).toBe(2);
  expect(daysInStage(zonedDateTime("2026-11-05", "08:00"), lateNov5)).toBe(0);
});
it("rots at the threshold, never without one", () => {
  expect(isRotting(14, 14)).toBe(true);
  expect(isRotting(13, 14)).toBe(false);
  expect(isRotting(30, null)).toBe(false);
});
it("stores due times in Eastern time", () => {
  expect(activityDueAt("2026-11-05", null)).toEqual(endOfDay("2026-11-05"));
  expect(activityDueAt("2026-03-08", "09:30").toISOString()).toBe("2026-03-08T13:30:00.000Z");
});
it("accepts only real calendar dates", () => {
  expect(isValidDateString("2026-02-28")).toBe(true);
  expect(isValidDateString("2026-02-30")).toBe(false);
  expect(isValidDateString("26-2-1")).toBe(false);
});
it("labels days relative to now", () => {
  expect(dayLabel(new Date("2026-11-05T15:00:00Z"), lateNov5)).toBe("Today");
  expect(dayLabel(new Date("2026-11-04T15:00:00Z"), lateNov5)).toBe("Yesterday");
  expect(dayLabel(new Date("2026-11-03T15:00:00Z"), lateNov5)).toBe("Nov 3");
});
it("gives each person a stable avatar tone", () => {
  expect(avatarTone("member-1")).toBe(avatarTone("member-1"));
  expect([0, 1, 2, 3]).toContain(avatarTone("member-2"));
});
```

```ts
// board-query.test.ts
const DEFAULTS = { pipeline: null, view: "board", scope: "everyone", status: "open", next: "any", q: "", cursor: null };
it("defaults everything", () => expect(parseBoardQuery({})).toEqual(DEFAULTS));
it("reads valid params and trims search", () =>
  expect(parseBoardQuery({ pipeline: "direct-mail", view: "list", scope: "mine", status: "won", next: "overdue", q: "  bright " }))
    .toEqual({ ...DEFAULTS, pipeline: "direct-mail", view: "list", scope: "mine", status: "won", next: "overdue", q: "bright" }));
it("falls back on bad values, short searches and arrays", () => {
  expect(parseBoardQuery({ view: "grid", status: "deleted", next: "x", q: "a" })).toEqual(DEFAULTS);
  expect(parseBoardQuery({ view: ["list", "board"] }).view).toBe("list");
  expect(parseBoardQuery({ q: "x".repeat(150) }).q).toHaveLength(100);
});
it("uses the saved view only when the URL names none of pipeline, view, scope", () => {
  const saved = { pipeline: "new-mover-mail", view: "list", scope: "mine" };
  expect(parseBoardQuery({}, saved)).toEqual({ ...DEFAULTS, ...saved });
  expect(parseBoardQuery({ view: "board" }, saved)).toEqual({ ...DEFAULTS, view: "board" });
  expect(parseBoardQuery({}, { view: 3 })).toEqual(DEFAULTS);
});
it("writes only non-default params", () =>
  expect(boardQueryToSearch({ ...DEFAULTS, pipeline: "direct-mail", q: "oak" })).toBe("pipeline=direct-mail&q=oak"));
```

Seed test addition: every stage in `SALES_SEED_PIPELINES` has `rottingDays` 14 when neither `isWon` nor `isLost`, and `null` otherwise (Direct Mail "Contract Signed" is null, "Follow-Up" is 14).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/format.test.ts tests/lib/sales/board-query.test.ts tests/lib/sales/seed.test.ts`
Expected: FAIL (modules not found; `rottingDays` undefined).

- [ ] **Step 3: Schema and migration**

`migration.sql` (pinned):

```sql
ALTER TABLE "SalesStage" ADD COLUMN "rottingDays" INTEGER;
UPDATE "SalesStage" SET "rottingDays" = 14 WHERE "isWon" = false AND "isLost" = false;
ALTER TABLE "SalesDeal" ADD COLUMN "source" TEXT, ADD COLUMN "lostComment" TEXT;
ALTER TABLE "TeamMember" ADD COLUMN "salesDefaultView" JSONB;
CREATE INDEX "SalesDeal_pipelineId_status_updatedAt_idx" ON "SalesDeal"("pipelineId", "status", "updatedAt");
CREATE INDEX "SalesActivity_doneAt_dueAt_idx" ON "SalesActivity"("doneAt", "dueAt");
```

Run `npx prisma migrate deploy` then `npx prisma generate`. Then `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`: expected output is an empty migration (no statements).

- [ ] **Step 4: Implement the three modules**

`parseMoneyToCents`: trim, strip one leading `$` and thousands commas, then accept only `^\d+(\.\d{1,2})?$`; blank is 0; above `MAX_DEAL_CENTS` is null. `boardQueryToSearch` writes keys in the order pipeline, view, scope, status, next, q and never writes `cursor`. `nextStepPill` and `dayLabel` compare `dateInputValue` strings (app time) with `addDaysToDateString`; overdue days are the calendar-day difference. `daysInStage` is the calendar-day difference of the two `dateInputValue`s. `parseBoardQuery` takes the first element of array params, validates each value against its list, trims `q` and slices to 100 (shorter than 2 becomes ""), reads `cursor` as a 1..64 string, and applies `savedViewSchema.safeParse(saved)` only when `pipeline`, `view` and `scope` are all absent. An unknown pipeline key is NOT rejected here (Task 2 falls back).

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/lib/sales/format.test.ts tests/lib/sales/board-query.test.ts tests/lib/sales/seed.test.ts`
Expected: PASS.

- [ ] **Step 6: Finish gate**

Run: `npx tsc --noEmit`, `npx eslint src scripts tests`, `npm test`. Expected: all pass (tsc: only pre-existing `.next/` and `scratch/` errors).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261106000001_sales_board/migration.sql src/lib/sales/seed-data.ts src/lib/sales/constants.ts src/lib/sales/format.ts src/lib/sales/board-query.ts tests/lib/sales/format.test.ts tests/lib/sales/board-query.test.ts tests/lib/sales/seed.test.ts
git commit -m "feat(sales): board columns, rotting days and shared Sales helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Deal access, history events and the read models

**Files:**
- Create: `src/lib/sales/http.ts`, `src/lib/sales/deal-access.ts`, `src/lib/sales/deal-audit.ts`, `src/lib/sales/board.ts`, `src/lib/sales/deal-panel.ts`, `src/lib/sales/timeline.ts`, `src/lib/sales/view-preference.ts`
- Create: `src/app/api/sales/deals/route.ts` (GET only in this task: list view pages), `src/app/api/sales/deals/[dealId]/route.ts` (GET only in this task), `src/app/api/sales/deals/[dealId]/timeline/route.ts` (GET), `src/app/api/sales/view/route.ts` (PUT)
- Modify (Origin check on Plan 1's mutating routes): `src/app/api/sales/settings/route.ts` (PATCH), `src/app/api/sales/bots/route.ts` (POST), `src/app/api/sales/bots/[botId]/route.ts` (PATCH, POST)
- Test: `tests/lib/sales/board.test.ts`, `tests/lib/sales/deal-panel.test.ts`, `tests/lib/sales/timeline.test.ts`, `tests/lib/sales/deal-read-routes.test.ts`, `tests/lib/sales/http.test.ts`; modify `tests/lib/sales/settings-route.test.ts`

**Interfaces:**
- Consumes: `SalesActor`, `requireSalesUser`, `dealOwnerWhere`, `canEditDeal`, `SALES_MEMBER_WHERE` (`access.ts`); `recordSalesAudit`, `SalesSystemActor`, `SalesRequestMeta` (`audit.ts`); `isStalled` (`rules.ts`); Task 1's constants, `BoardQuery`, `savedViewSchema`, format helpers.
- Produces (`http.ts`, server): `type SalesFail = { ok: false; status: 400 | 403 | 404 | 409 | 422; error: string; code?: "PROPOSAL_NEEDS_VALUE" }`, `fail(status, error, code?): SalesFail`, `failResponse(f: SalesFail): NextResponse` (`{ error, code? }` JSON), `assertSameOrigin(request: Request): SalesFail | null` (no `Origin` header: null; an `Origin` that does not parse as a URL, `"null"` included, or whose `host` differs from `request.headers.get("x-forwarded-host") ?? request.headers.get("host")`: 403 `"Request blocked."`), `readJson<S extends z.ZodType>(request: Request, schema: S): Promise<{ ok: true; data: z.infer<S> } | SalesFail>` (first runs `assertSameOrigin`; then bad JSON or schema failure: 400 with the first issue's message, else `"Invalid input."`).
- Produces (`deal-access.ts`): `DEAL_NOT_FOUND = "Deal not found."`, `NOT_YOUR_DEAL = "Only the deal owner or an admin can change this deal."`, `visibleDealWhere(actor: SalesActor, dealId: string): Prisma.SalesDealWhereInput` (`{ id, archivedAt: null, ...dealOwnerWhere(actor, "everyone") }`), `findDealForEdit(tx: Prisma.TransactionClient, actor: SalesActor, dealId: string, select: Prisma.SalesDealSelect): Promise<{ ok: true; deal: ... } | SalesFail>` (`select` must include `ownerId`; 404 `DEAL_NOT_FOUND` when not visible, 403 `NOT_YOUR_DEAL` when `!canEditDeal`).
- Produces (`deal-audit.ts`): `type DealAuditEvent` (discriminated on `action`, payloads pinned below), `recordDealAudit(tx, actor: SalesActor | SalesSystemActor, dealId: string, event: DealAuditEvent, meta?: Partial<SalesRequestMeta>): Promise<void>` (calls `recordSalesAudit` with `entityType: "SalesDeal"`, `entityId: dealId`). Payloads (dates as ISO strings):
  - `created` after `{ title, pipelineId, stageId, stageName, ownerId, valueCents, mrrCents, organizationId, personId, source }`
  - `updated` before/after: changed keys of `{ title, source }`
  - `stage_changed` before/after `{ stageId, stageName }`
  - `status_changed` before `{ status }`, after `{ status, lostReason?, lostComment? }`
  - `value_changed` before/after `{ valueCents, mrrCents }`
  - `owner_changed` before `{ ownerId }`, after `{ ownerId, movedActivityIds?: string[] }` (key present only when open activities moved with the deal, Decision 15)
  - `field_changed` before/after `{ fieldKey, label, value: string | null }`
  - `archived` before `{ archivedAt: null }`, after `{ archivedAt }`
  - `delete_refused` (no before/after; the row itself, with actor and request meta, is the record, Decision 32)
  - `activity_added` after `{ activityId, type, subject, dueAt, hasTime, createdBy }`
  - `activity_done`, `activity_reopened`, `activity_missed` after `{ activityId, type, subject }`
  - `activity_removed` before `{ activityId, type, subject }`
  - `note_added` after `{ noteId }`; `note_edited` before `{ noteId, body }`, after `{ noteId, body }`
- Produces (`board.ts`): `type BoardPipeline = { id; key; name; kind: "SALES" | "CONSULTING" }`, `type BoardStage = { id; key; name; position; probability; isWon; isLost; requiresValue; isNoShow; rottingDays: number | null }`, `type BoardCard = { id; title; valueCents; mrrCents; stageId; status: "OPEN" | "WON" | "LOST"; stageEnteredAt: string; ownerId; personName: string | null; organizationName: string | null; next: { type: SalesActivityType; subject: string; dueAt: string } | null }`, `type BoardColumn = { stage: BoardStage; count: number; totalCents: number; cards: BoardCard[] }`, `type SalesMemberOption = { id: string; name: string }`, `type DealListRow = BoardCard & { stageName: string }`, `type DealListPage = { rows: DealListRow[]; nextCursor: string | null }`, `type BoardPageData = { query: BoardQuery; pipelines: BoardPipeline[]; pipeline: BoardPipeline; stages: BoardStage[]; columns: BoardColumn[] | null; list: DealListPage | null; totals: { count: number; valueCents: number }; members: SalesMemberOption[]; canSeeEveryone: boolean }`, `boardDealWhere(actor, query, pipelineId, now): Prisma.SalesDealWhereInput`, `loadSalesMembers(db?): Promise<SalesMemberOption[]>`, `loadBoardPage(actor, query, now, db = prisma): Promise<BoardPageData | null>` (null when no pipeline exists; its `list` is always the first page), `loadDealListPage(actor, query, now, db = prisma): Promise<DealListPage | null>` (same pipeline resolution and fallback as `loadBoardPage`, same `boardDealWhere`, honours `query.cursor`; null when no pipeline exists; `loadBoardPage`'s list branch shares its query code).
- Produces (`deal-panel.ts`): `type PanelActivity = { id; type; subject; dueAt: string; hasTime: boolean; createdBy: string; ownerId: string }`, `type PanelField = { key; label; fieldType: "TEXT" | "NUMBER" | "DATE" | "SELECT"; options: string[]; value: string | null }`, `type DealPanelData = { deal: { id; title; status; valueCents; mrrCents; stageId; stageEnteredAt: string; lostReason: string | null; lostComment: string | null; source: string | null; owner: SalesMemberOption; organization: { id; name } | null; person: { id; name } | null }; pipeline: BoardPipeline; stages: BoardStage[]; openActivities: PanelActivity[]; fields: PanelField[]; members: SalesMemberOption[]; canEdit: boolean; territoryHold: { expiry: string; checkDueAt: string | null } | null }`, `loadDealPanel(actor, dealId, db = prisma): Promise<DealPanelData | null>`.
- Produces (`timeline.ts`): `type TimelineIcon = "created" | "stage" | "won" | "lost" | "reopened" | "value" | "owner" | "field" | "deleted" | "activity" | "done" | "missed" | "note"`, `type TimelineEntry = { id; at: string; actorType: "USER" | "BOT" | "SYSTEM" | "WEBHOOK"; actorName: string | null; icon: TimelineIcon; text: string; note?: { id: string; body: string; canEdit: boolean } }`, `type TimelineCursor = { at: string; id: string }`, `describeAuditRow(row: { action: string; actorType: string; before: unknown; after: unknown }, names: Map<string, string>): { icon: TimelineIcon; text: string }`, `loadDealTimeline(actor, dealId, cursor: TimelineCursor | null, db = prisma): Promise<{ entries: TimelineEntry[]; nextCursor: TimelineCursor | null } | null>`.
- Produces (`view-preference.ts`): `loadDefaultView(userId: string, db = prisma): Promise<unknown>` (raw JSON, parsed by `parseBoardQuery`), `saveDefaultView(userId: string, view: SavedView, db = prisma): Promise<void>`.
- Produces (routes): `GET /api/sales/deals?pipeline=&scope=&status=&next=&q=&cursor=` returns `DealListPage` (parsed with `parseBoardQuery(params)` and no saved view; `{ rows: [], nextCursor: null }` when no pipeline exists); `GET /api/sales/deals/[dealId]` returns `DealPanelData` or 404 `{ error: "Deal not found." }`; `GET /api/sales/deals/[dealId]/timeline?at=<iso>&id=<id>` returns `{ entries, nextCursor }` or 404; `PUT /api/sales/view` body `SavedView` returns `{ ok: true }`.

- [ ] **Step 1: Write the failing tests**

`board.test.ts` (fake db with `vi.fn` delegates capturing args; `now = new Date("2026-11-05T15:00:00Z")`; actor `{ userId: "r", isAdmin: false, seesAllDeals: false, via: "user" }` unless stated):
- pipelines are read with `where: { archivedAt: null, kind: { in: ["SALES", "CONSULTING"] } }, orderBy: { position: "asc" }`; with none, `loadBoardPage` returns `null`.
- `query.pipeline = "gone"` (not in the list) falls back to the first pipeline by position (Review Focus 5).
- every `salesDeal.findMany`, `groupBy` and `aggregate` call's `where` contains `archivedAt: null`, `pipelineId`, `status: "OPEN"` and `ownerId: "r"` (seesAllDeals false, scope "everyone"); for an admin with scope "everyone" there is no `ownerId`; with scope "mine" it is the admin's id.
- board view issues one `findMany` per stage with `take: 50`, `where.stageId` set and `orderBy: [{ stageEnteredAt: "desc" }, { id: "desc" }]` (newest in stage first, Decision 31, matching Task 7's optimistic top insert); `column.count` and `column.totalCents` come from `groupBy({ by: ["stageId"], _count: { _all: true }, _sum: { valueCents: true } })`, so a stage with 73 deals shows `count: 73` and 50 cards.
- `JSON.stringify` of every deal `select` contains neither `"email"` nor `"phone"`.
- `query.next = "none"` adds `activities: { none: { doneAt: null, archivedAt: null } }`; `"overdue"` adds `activities: { some: { doneAt: null, archivedAt: null, dueAt: { lt: startOfDay("2026-11-05") } } }`.
- `query.q = "oak"` adds `OR: [{ title: { contains: "oak", mode: "insensitive" } }, { organization: { name: { contains: "oak", mode: "insensitive" } } }, { person: { name: { contains: "oak", mode: "insensitive" } } }]`.
- `card.next` is the earliest open activity (two open activities due Nov 7 and Nov 6 give the Nov 6 one); a deal with none has `next: null`. Open activities are read once with `where: { dealId: { in: [...] }, doneAt: null, archivedAt: null }`.
- list view: one `findMany` with `take: 51` and `orderBy: [{ updatedAt: "desc" }, { id: "desc" }]` and no `cursor`/`skip`; 51 rows returned gives 50 rows and `nextCursor` = the 50th row's id; `columns` is null.
- `loadDealListPage` with `query.cursor = "d50"` adds `cursor: { id: "d50" }, skip: 1` to that same `findMany` (same `where`, `orderBy`, `take: 51`); 12 rows returned give 12 rows and `nextCursor: null`; with no pipeline it returns `null`.
- `canSeeEveryone` is false for the actor above and true for an admin.

`deal-panel.test.ts`:
- `findFirst` is called with `where: { id: "d1", archivedAt: null, ownerId: "r" }` for the actor above; when it returns null (archived, not visible or missing), `loadDealPanel` returns `null` (Review Focus 5).
- a deal owned by "b" seen by `{ userId: "r", isAdmin: false, seesAllDeals: true }` gives `canEdit: false`; owner "r" gives `true`.
- fields: of custom fields `[target-start-date (DEAL, []), territory-hold-expiry (DEAL, ["direct-mail","new-mover-mail"]), engagement-type (DEAL, ["marketing-agency"]), practice-zip (LEAD, [])]` a direct-mail deal gets the first two in `position` order with their stored values (or `null`).
- `territoryHold` is `{ expiry: "2026-11-19", checkDueAt: <ISO of the open "rule:territory-hold" activity> }` when the field has a value, else `null`.

`timeline.test.ts`:
- `describeAuditRow` gives exactly: created "Deal created"; stage_changed (USER) "Moved to Proposal Sent"; stage_changed (SYSTEM) "Moved to No Show (No Show rule)"; status_changed WON "Marked as won"; LOST with reason Price "Marked as lost: Price"; OPEN "Reopened"; value_changed `{ valueCents: 1440000, mrrCents: 120000 }` "Value set to $14,400 ($1,200/mo)" and with `mrrCents: 0` "Value set to $14,400"; owner_changed to "b" with names `{ b: "Ben Shaver" }` "Owner changed to Ben S."; updated title "Renamed to Oak Creek Dental"; field_changed "Territory Hold Expiry set to 2026-11-19" and to null "Territory Hold Expiry cleared"; archived "Deal deleted"; delete_refused "Tried to delete this deal (refused)" (icon `deleted`); owner_changed with `movedActivityIds: ["a1"]` still "Owner changed to Ben S."; activity_added `{ type: "CALL", subject: "First call", dueAt: endOfDay("2026-11-06").toISOString(), createdBy: "u1" }` "Call scheduled: First call (Nov 6)"; with `createdBy: "rule:no-show"` "Call added by the No Show rule: Reschedule the missed demo (Nov 5)"; with `"rule:territory-hold"` "Deadline added by the territory hold rule: Territory hold check (Nov 12)"; activity_done "Call done: First call"; activity_reopened "Call reopened: First call"; activity_missed "Meeting missed: Demo"; activity_removed "Call removed: Reschedule the missed demo"; note_added "Note added"; note_edited "Note edited". No text contains the em dash character (U+2014).
- `loadDealTimeline` queries `salesAuditLog.findMany({ where: { entityType: "SalesDeal", entityId: "d1" }, orderBy: [{ at: "desc" }, { id: "desc" }], take: 31 })`; with a cursor it adds `OR: [{ at: { lt: cursorAt } }, { at: cursorAt, id: { lt: cursorId } }]`; 31 rows give 30 entries and a `nextCursor`; `note_added` rows carry `note.body` from `salesNote.findMany({ where: { id: { in: [...] }, archivedAt: null } })` and `canEdit` true only for the note's author or an admin; actor names come from one `teamMember.findMany` over the actor ids and owner ids; returns `null` when the deal is not visible.

`deal-read-routes.test.ts` (mock `requireSalesUser`):
- GET deal: `requireSalesUser` rejecting with `PermissionError(403, "You don't have access to Sales.")` gives 403 and no query; panel `null` gives 404 `{ error: "Deal not found." }`; found gives 200 with the panel JSON.
- GET timeline: bad cursor (`at=yesterday`) is ignored (first page), not a 500.
- PUT view: `{ pipeline: "direct-mail", view: "list", scope: "mine" }` saves via `teamMember.update({ where: { id: "r" }, data: { salesDefaultView: {...} } })`; `{ view: "grid" }` and `{ pipeline: "x", view: "board", scope: "mine", extra: 1 }` give 400 and save nothing.
- GET deals list: without Sales access 403 and no query; `?pipeline=direct-mail&view=list` with 51 canned rows gives 200 `{ rows: <50 rows>, nextCursor: "d50" }`; `?cursor=d50` passes `cursor: { id: "d50" }, skip: 1`; a bad cursor (`cursor=` followed by 65 characters) is ignored: the `findMany` has no `cursor` or `skip` and the first page comes back, not a 500.

`http.test.ts`:
- `assertSameOrigin`: a request to `https://app.example.com/api/sales/view` with header `host: app.example.com` and no `Origin` gives `null`; `Origin: https://app.example.com` gives `null`; `Origin: https://evil.example` gives `{ ok: false, status: 403, error: "Request blocked." }`; `Origin: null` gives 403; `x-forwarded-host: app.example.com`, `host: internal:3000`, `Origin: https://app.example.com` gives `null`.
- cross-origin PUT `/api/sales/view` (valid body, `Origin: https://evil.example`): 403 `{ error: "Request blocked." }` and `teamMember.update` is never called; the same request with a same-origin `Origin` saves.
- guard: read every `route.ts` under `src/app/api/sales/` (`fs.readdirSync(dir, { recursive: true })`); each file that exports `DELETE` contains `assertSameOrigin(`; each file that exports `POST`, `PATCH` or `PUT` contains `readJson(` or `assertSameOrigin(`. Later tasks' routes fall under this test automatically.

`settings-route.test.ts` addition: PATCH with `Origin: https://evil.example` gives 403 `{ error: "Request blocked." }` and nothing is saved.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/board.test.ts tests/lib/sales/deal-panel.test.ts tests/lib/sales/timeline.test.ts tests/lib/sales/deal-read-routes.test.ts tests/lib/sales/http.test.ts tests/lib/sales/settings-route.test.ts`
Expected: FAIL (modules not found; the settings and guard cases fail because Plan 1's routes have no Origin check).

- [ ] **Step 3: Implement**

Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` first. Run `loadBoardPage`'s independent queries with `Promise.all`. Status filter maps open/won/lost to OPEN/WON/LOST. Card ordering inside a column: `[{ stageEnteredAt: "desc" }, { id: "desc" }]` (Decision 31). List pages use Prisma cursor pagination (`cursor: { id }, skip: 1`, `take: 51`). Routes: `requireSalesUser()` inside `try`, `toErrorResponse` in `catch` (the Plan 1 route pattern). The timeline route parses `at` with `Date.parse` and drops an invalid cursor. In Plan 1's settings and bots handlers, call `assertSameOrigin(request)` right after `requireAdmin()` and return `failResponse` when it fails; change nothing else in them.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/lib/sales/board.test.ts tests/lib/sales/deal-panel.test.ts tests/lib/sales/timeline.test.ts tests/lib/sales/deal-read-routes.test.ts tests/lib/sales/http.test.ts tests/lib/sales/settings-route.test.ts tests/lib/sales/bot-routes.test.ts`
Expected: PASS (bot-routes unchanged: its requests carry no `Origin`).

- [ ] **Step 5: Finish gate** (`npx tsc --noEmit`, `npx eslint src scripts tests`, `npm test`): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/http.ts src/lib/sales/deal-access.ts src/lib/sales/deal-audit.ts src/lib/sales/board.ts src/lib/sales/deal-panel.ts src/lib/sales/timeline.ts src/lib/sales/view-preference.ts src/app/api/sales/deals/route.ts "src/app/api/sales/deals/[dealId]/route.ts" "src/app/api/sales/deals/[dealId]/timeline/route.ts" src/app/api/sales/view/route.ts src/app/api/sales/settings/route.ts src/app/api/sales/bots/route.ts "src/app/api/sales/bots/[botId]/route.ts" tests/lib/sales/board.test.ts tests/lib/sales/deal-panel.test.ts tests/lib/sales/timeline.test.ts tests/lib/sales/deal-read-routes.test.ts tests/lib/sales/http.test.ts tests/lib/sales/settings-route.test.ts
git commit -m "feat(sales): board, deal panel and history read models

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Add, edit and delete deals; custom fields and the territory hold

**Files:**
- Create: `src/lib/sales/deals.ts`, `src/lib/sales/custom-fields.ts` (client-safe), `src/lib/sales/contacts.ts`
- Create: `src/app/api/sales/deals/[dealId]/fields/[fieldKey]/route.ts` (PUT), `src/app/api/sales/contacts/route.ts` (GET)
- Modify: `src/app/api/sales/deals/route.ts` (add POST beside Task 2's GET), `src/app/api/sales/deals/[dealId]/route.ts` (add PATCH and DELETE), `src/lib/sales/rules.ts` (add `territoryHoldCheckDueAt`)
- Test: `tests/lib/sales/deals.test.ts`, `tests/lib/sales/deal-fields.test.ts`, `tests/lib/sales/contacts.test.ts`, and add to `tests/lib/sales/rules.test.ts`

**Interfaces:**
- Consumes: Task 2's `readJson`, `assertSameOrigin`, `failResponse`, `fail`, `findDealForEdit`, `visibleDealWhere`, `recordDealAudit`; `recordSalesAudit`, `requestMeta`, `SALES_MEMBER_WHERE`, `canDeleteSalesRecords`, `territoryHoldCheckDate`; Task 1 constants and `isValidDateString`, `activityDueAt`.
- Produces (`deals.ts`): `createDealSchema` (strictObject: `pipelineId`, `ownerId`, `organization: { id } | { name: trimmed 1..200 } | null`, `person: same | null`, `valueCents: int 0..MAX_DEAL_CENTS` default 0, `firstActivity: "call-today" | "call-tomorrow" | "demo-2-days"`), `updateDealSchema` (strictObject, at least one of: `title` trimmed 1..200, `valueCents`, `mrrCents`, `ownerId`, `source: DEAL_SOURCES | null`), `createDeal(actor, input, meta, now): Promise<{ ok: true; deal: { id: string; pipelineKey: string } } | SalesFail>`, `updateDeal(actor, dealId, input, meta, now): Promise<{ ok: true; deal: { id; title; valueCents; mrrCents; ownerId; source } } | SalesFail>`, `archiveDeal(actor, dealId, meta, now): Promise<{ ok: true } | SalesFail>`, `setDealField(actor, dealId, fieldKey, value: string | null, meta, now): Promise<{ ok: true; value: string | null } | SalesFail>`.
- Produces (`custom-fields.ts`): `normalizeFieldValue(field: { fieldType: "TEXT" | "NUMBER" | "DATE" | "SELECT"; options: string[] }, raw: string | null): { ok: true; value: string | null } | { ok: false; error: string }`.
- Produces (`rules.ts`): `territoryHoldCheckDueAt(expiry: string, now: Date): Date` (the later of `territoryHoldCheckDate(endOfDay(expiry))` and `endOfDay(dateInputValue(now))`).
- Produces (`contacts.ts`): `searchContacts(actor, kind: "organization" | "person", q: string, db = prisma): Promise<{ id: string; name: string; organizationName?: string | null }[]>`.
- Produces (routes): `POST /api/sales/deals` (201 `{ deal: { id, pipelineKey } }`), `PATCH /api/sales/deals/[dealId]`, `DELETE /api/sales/deals/[dealId]`, `PUT /api/sales/deals/[dealId]/fields/[fieldKey]` body `{ value: string | null }`, `GET /api/sales/contacts?kind=organization|person&q=...` (`{ results }`).
- Messages (pinned): `"You can only add deals for yourself."` (403), `"Choose a team member with Sales access."` (400), `"Add a person or an organization."` (400), `"Pick a pipeline."` (400), `"Deals can't be added to a delivery pipeline yet."` (400), `"That organization was not found."`, `"That person was not found."` (400), `"Values can be up to $10,000,000."` (400, zod max), `"A deal in Proposal Sent needs a total value and a monthly value above $0."` (422, code `PROPOSAL_NEEDS_VALUE`), `"Only an admin can delete deals."` (403), `"That field is not used on this deal."` (404), field errors `"Enter a number."`, `"Enter a real date."`, `"Pick one of the listed options."`, `"Keep it under 500 characters."` (400).

- [ ] **Step 1: Write the failing tests**

`deals.test.ts` (`now = new Date("2026-11-05T15:00:00Z")`, request with `x-forwarded-for: 203.0.113.9, 10.0.0.1`):
- create as non-admin "r" with `ownerId: "b"`: 403 `"You can only add deals for yourself."`, nothing written.
- create with an owner outside `SALES_MEMBER_WHERE`: 400 `"Choose a team member with Sales access."`.
- create with `organization: null, person: null`: 400 `"Add a person or an organization."`.
- create in a DELIVERY pipeline: 400 `"Deals can't be added to a delivery pipeline yet."`.
- create `{ organization: { name: "Oak Creek Family Dentistry" }, person: { name: "Mark T." }, firstActivity: "call-tomorrow", valueCents: 0 }` as admin for owner "r": one `$transaction`; new organization and person rows have `ownerId: "r"` and the person's `organizationId` is the new organization; the deal has `title: "Oak Creek Family Dentistry"`, the lowest-position stage, `stageEnteredAt: now`, `source: "Added by hand"`; the activity is `{ type: "CALL", subject: "First call", dueAt: endOfDay("2026-11-06"), hasTime: false, ownerId: "r", createdBy: <admin id> }`; exactly four history rows in this order, all with `ipAddress: "203.0.113.9"`: `{ entityType: "SalesOrganization", entityId: <org id>, action: "created", after: { name: "Oak Creek Family Dentistry", ownerId: "r" } }`, `{ entityType: "SalesPerson", entityId: <person id>, action: "created", after: { name: "Mark T.", ownerId: "r", organizationId: <org id> } }`, `{ entityType: "SalesDeal", action: "created" }`, `{ entityType: "SalesDeal", action: "activity_added" }`.
- create with an existing organization `{ id: "o1" }` (visible to the actor) and no person writes no `SalesOrganization` row: only `created` and `activity_added` on the deal.
- create with only `person: { name: "Sarah K." }` gives `title: "Sarah K."`.
- PATCH a deal visible but owned by "b" as "r" (seesAllDeals true): 403 `"Only the deal owner or an admin can change this deal."`; a deal not visible: 404 `"Deal not found."`.
- PATCH `{ ownerId: "b" }` by owner "r" with no open activities: history `owner_changed` `{ before: { ownerId: "r" }, after: { ownerId: "b" } }`; to a member without Sales access: 400.
- PATCH `{ ownerId: "b" }` by owner "r" when the deal has open activities a1 (owner "r") and a2 (owner admin "z"), plus a done activity a3 (owner "r"): `salesActivity.findMany` uses `where: { dealId: "d1", ownerId: "r", doneAt: null, archivedAt: null }`, then `salesActivity.updateMany({ where: { id: { in: ["a1"] } }, data: { ownerId: "b" } })` in the same transaction; a2 and a3 are untouched; one `owner_changed` row `{ before: { ownerId: "r" }, after: { ownerId: "b", movedActivityIds: ["a1"] } }` (Decision 15).
- PATCH `{ valueCents: 1440000, mrrCents: 120000 }`: one `value_changed` row `{ before: { valueCents: 0, mrrCents: 0 }, after: { valueCents: 1440000, mrrCents: 120000 } }`.
- PATCH `{ mrrCents: 0 }` on an OPEN deal whose stage has `requiresValue: true`: 422 with code `PROPOSAL_NEEDS_VALUE`, nothing written (Review Focus 1).
- PATCH `{ valueCents: 1_000_000_001 }`: 400 `"Values can be up to $10,000,000."` (Review Focus 3); `{ colour: "red" }`: 400; a PATCH that changes nothing: 200 and no history row.
- DELETE as non-admin owner "r": 403 `"Only an admin can delete deals."`, no `salesDeal.update` (archivedAt untouched), and exactly one history row `{ entityType: "SalesDeal", entityId: "d1", action: "delete_refused", actorType: "USER", actorId: "r", ipAddress: "203.0.113.9" }` (spec rule 6). The same for a non-admin who can see but does not own the deal (seesAllDeals true). A deal the actor cannot see: 404 `"Deal not found."` and no row.
- DELETE as admin: `archivedAt: now` and one `archived` row. DELETE with `Origin: https://evil.example` as admin: 403 `"Request blocked."`, nothing written.

`deal-fields.test.ts`:
- `normalizeFieldValue`: DATE `"2026-11-19"` ok, `"2026-02-30"` error `"Enter a real date."`; NUMBER `"5,000"` gives `"5000"`, `"12.5"` gives `"12.5"`, `"abc"` error `"Enter a number."`; SELECT `"Full program"` ok when listed, `"Maybe"` error `"Pick one of the listed options."`; TEXT 501 characters error `"Keep it under 500 characters."`; `""` and `null` give `{ ok: true, value: null }`.
- `setDealField` for `engagement-type` on a direct-mail deal: 404 `"That field is not used on this deal."`.
- setting `territory-hold-expiry` to `"2026-11-19"` (now Nov 5) upserts the value row (`fieldId_dealId`), writes `field_changed`, and creates `{ type: "DEADLINE", subject: "Territory hold check", dueAt: endOfDay("2026-11-12"), hasTime: false, ownerId: <deal owner>, createdBy: "rule:territory-hold" }` with an `activity_added` row from actorType SYSTEM.
- changing it to `"2026-12-01"` archives the open `rule:territory-hold` activity (`activity_removed`, SYSTEM) and creates one due `endOfDay("2026-11-24")`.
- setting `"2026-11-08"` gives a check due `endOfDay("2026-11-05")` (today, the computed date has passed).
- clearing it deletes the value row and archives the open check.
- `rules.test.ts`: `territoryHoldCheckDueAt("2026-11-19", now)` equals `endOfDay("2026-11-12")`; `("2026-11-08", now)` equals `endOfDay("2026-11-05")`.

`contacts.test.ts`: `searchContacts(actor, "organization", "br")` calls `salesOrganization.findMany({ where: { archivedAt: null, name: { contains: "br", mode: "insensitive" }, ownerId: "r" }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 8 })` for a seesAllDeals-false actor (no `ownerId` for an admin); `q` of `"b"` returns `[]` without a query; the GET route with `kind=deals` gives 400.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/deals.test.ts tests/lib/sales/deal-fields.test.ts tests/lib/sales/contacts.test.ts tests/lib/sales/rules.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Read the route handler guide first. All reads that decide a write happen inside the transaction. `createDeal` records a new organization and a new person with `recordSalesAudit` (entity `SalesOrganization` / `SalesPerson`, action `created`) right after creating each, before the deal's own rows. `updateDeal` writes `value_changed`, `owner_changed` and `updated` (title/source via `auditDiff`) as separate rows, only for what changed; an owner change also moves the old owner's open activities on the deal (test above). `archiveDeal` does not use `findDealForEdit`: inside one transaction it reads the deal with `visibleDealWhere` (404 when missing), then if `!canDeleteSalesRecords(actor)` writes `delete_refused` and RETURNS the 403 fail (returning, not throwing, so the row commits), else archives. The DELETE handler calls `assertSameOrigin(request)` right after `requireSalesUser()`. DATE field values are stored as `"YYYY-MM-DD"` strings (Ruling 16), never ISO timestamps.

- [ ] **Step 4: Run to verify they pass** (same command): PASS.
- [ ] **Step 5: Finish gate** (`npx tsc --noEmit`, `npx eslint src scripts tests`, `npm test`): all pass.
- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/deals.ts src/lib/sales/custom-fields.ts src/lib/sales/contacts.ts src/lib/sales/rules.ts src/app/api/sales/deals/route.ts "src/app/api/sales/deals/[dealId]/route.ts" "src/app/api/sales/deals/[dealId]/fields/[fieldKey]/route.ts" src/app/api/sales/contacts/route.ts tests/lib/sales/deals.test.ts tests/lib/sales/deal-fields.test.ts tests/lib/sales/contacts.test.ts tests/lib/sales/rules.test.ts
git commit -m "feat(sales): add, edit and delete deals, custom fields and territory hold check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Stage moves, Won and Lost, and the missed-meeting rule

**Files:**
- Create: `src/lib/sales/stage-moves.ts`, `src/lib/sales/no-show.ts`
- Create: `src/app/api/sales/deals/[dealId]/move/route.ts` (POST), `src/app/api/sales/deals/[dealId]/status/route.ts` (POST), `src/app/api/cron/sales-no-show/route.ts` (GET)
- Modify: `vercel.json` (add `{ "path": "/api/cron/sales-no-show", "schedule": "0 11 * * *" }`)
- Test: `tests/lib/sales/stage-moves.test.ts`, `tests/lib/sales/no-show.test.ts`

**Interfaces:**
- Consumes: `checkStageMove`, `activitiesOnStageEntry`, `NewActivity` (`rules.ts`); Task 2's `findDealForEdit`, `recordDealAudit`, `readJson`, `failResponse`; Task 1's `LOST_REASONS`, `MAX_DEAL_CENTS`, `MISSED_MEETING_BATCH`, `LOST_COMMENT_MAX`.
- Produces (`stage-moves.ts`): `moveDealSchema` (strictObject `{ stageId, valueCents?, mrrCents?, undoActivityIds?: string[] max 10 }`), `statusSchema` (discriminated union on `status`: `{ status: "WON" }`, `{ status: "LOST"; lostReason: LOST_REASONS (error "Pick a reason."); lostComment?: trimmed max 1000 (error "Keep the comment under 1,000 characters.") }`, `{ status: "OPEN" }`), `type MoveResult = { ok: true; changed: boolean; deal: { id; stageId; stageEnteredAt: string; valueCents; mrrCents }; previousStageId: string; enteredStage: { id; name; isWon; isLost; isNoShow }; createdActivityIds: string[] }`, `moveDealStage(actor, dealId, input, meta, now): Promise<MoveResult | SalesFail>`, `setDealStatus(actor, dealId, input, meta, now): Promise<{ ok: true; changed: boolean; deal: { id; status; wonAt: string | null; lostAt: string | null; lostReason: string | null } } | SalesFail>`, `addStageEntryActivities(tx, deal: { id; ownerId; personId: string | null }, target: { isNoShow: boolean }, now): Promise<string[]>` (shared by the move and the cron; skips a rule activity when an open one with the same `createdBy` already exists on the deal; writes `activity_added` as `{ system: "rule" }`).
- Produces (`no-show.ts`): `applyMissedMeetingRule(now: Date, db = prisma): Promise<{ moved: number; meetingsMarked: number }>`.
- Produces (routes): `POST /api/sales/deals/[dealId]/move` returns `MoveResult` or `{ error, code? }` with 400/403/404/409/422; `POST /api/sales/deals/[dealId]/status`; `GET /api/cron/sales-no-show` (Bearer `CRON_SECRET`, else 401; `runtime = "nodejs"`, `dynamic = "force-dynamic"`).
- Messages (pinned): `"This deal is closed. Reopen it first."` (409), `"That stage is not part of this deal's pipeline."` (400), the rules.ts message `"Add the total value and monthly value before moving to Proposal Sent."` (422, code `PROPOSAL_NEEDS_VALUE`).

- [ ] **Step 1: Write the failing tests**

`stage-moves.test.ts` (Direct Mail stages s1 New Opt-In .. s3 No Show (`isNoShow`) .. s4 Demo Complete, s5 Proposal Sent (`requiresValue`), s7 Contract Signed (`isWon`); `now = new Date("2026-11-05T15:00:00Z")`):
- moving a deal with `valueCents: 0, mrrCents: 0` to s5: 422 `{ code: "PROPOSAL_NEEDS_VALUE", error: "Add the total value and monthly value before moving to Proposal Sent." }`; no update, no history.
- stale screen: the client sends only `{ stageId: "s5" }` while the stored deal has `valueCents: 1440000, mrrCents: 0`: 422 (values are read inside the transaction, Review Focus 1).
- moving to s5 with `{ valueCents: 1440000, mrrCents: 120000 }`: one transaction updates `{ stageId: "s5", stageEnteredAt: now, valueCents: 1440000, mrrCents: 120000 }` and writes `value_changed` then `stage_changed` `{ before: { stageId: "s4", stageName: "Demo Complete" }, after: { stageId: "s5", stageName: "Proposal Sent" } }`, both actorType USER.
- a stage from another pipeline: 400; a WON deal: 409 `"This deal is closed. Reopen it first."`.
- moving to the stage the deal is already in: `{ ok: true, changed: false }`, no update, no history (Review Focus 4).
- moving into s3: creates `{ type: "CALL", subject: "Reschedule the missed demo", dueAt: endOfDay("2026-11-05"), hasTime: false, ownerId: <deal owner>, createdBy: "rule:no-show", dealId, personId }`, an `activity_added` row with actorType SYSTEM, and returns its id in `createdActivityIds`.
- moving into s3 when an open `rule:no-show` activity already exists on the deal: no second activity (Review Focus 4).
- `undoActivityIds: ["a1", "a2", "a3"]` where a1 is this deal's open rule-made call, a2 was made by a member, a3 belongs to another deal: only a1 gets `archivedAt: now` and an `activity_removed` row.
- not visible: 404; visible but not editable: 403.
- status LOST without a reason: 400 `"Pick a reason."`; with a 1,001-character comment: 400.
- status LOST `{ lostReason: "Price", lostComment: "Went with a cheaper printer" }`: `{ status: "LOST", lostAt: now, lostReason: "Price", lostComment: "Went with a cheaper printer", wonAt: null }` and `status_changed` `{ before: { status: "OPEN" }, after: { status: "LOST", lostReason: "Price", lostComment: "Went with a cheaper printer" } }`.
- status WON: `wonAt: now`; WON again: `changed: false`, no history; OPEN from LOST clears `lostAt`, `lostReason`, `lostComment`, `wonAt`.

`no-show.test.ts` (`now = new Date("2026-11-06T12:00:00Z")`, 7 AM Eastern Nov 6):
- the activity query is bounded (`take: 200`, `orderBy: { dueAt: "asc" }`) and filters `type: "MEETING", doneAt: null, archivedAt: null, dueAt: { lt: startOfDay("2026-11-06") }, deal: { status: "OPEN", archivedAt: null }` plus an `OR` per pipeline with an `isNoShow` stage: `{ deal: { pipelineId, stage: { position: { lt: <No Show position> } } } }`.
- a meeting due `endOfDay("2026-11-05")` on a deal in Appointment Scheduled (position 2) moves the deal to No Show with a SYSTEM `stage_changed`, archives the meeting with an `activity_missed` row, and adds a reschedule CALL due `endOfDay("2026-11-06")`; result `{ moved: 1, meetingsMarked: 1 }`.
- two missed meetings on one deal: one move, two `activity_missed` rows, one reschedule call.
- with no pipeline having a No Show stage, no activity query runs and the result is `{ moved: 0, meetingsMarked: 0 }`.
- the cron route without `Authorization: Bearer <CRON_SECRET>` (or with `CRON_SECRET` unset) answers 401 and calls nothing.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/stage-moves.test.ts tests/lib/sales/no-show.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Read the route handler guide first. Move order inside one transaction: load deal (edit check), refuse closed, load target stage `{ id, pipelineId: deal.pipelineId, archivedAt: null }`, same stage returns unchanged, compute next values (input or stored), `checkStageMove`, update, history rows, `addStageEntryActivities`, undo archive. The cron processes each deal in its own transaction (re-reading the deal as OPEN), so one bad row does not roll back the others; it calls no notify or Slack code.

- [ ] **Step 4: Run to verify they pass** (same command): PASS.
- [ ] **Step 5: Finish gate** (`npx tsc --noEmit`, `npx eslint src scripts tests`, `npm test`): all pass.
- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/stage-moves.ts src/lib/sales/no-show.ts "src/app/api/sales/deals/[dealId]/move/route.ts" "src/app/api/sales/deals/[dealId]/status/route.ts" src/app/api/cron/sales-no-show/route.ts vercel.json tests/lib/sales/stage-moves.test.ts tests/lib/sales/no-show.test.ts
git commit -m "feat(sales): stage moves with the proposal and No Show rules, won and lost

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Activities, notes and the Activities list data

**Files:**
- Create: `src/lib/sales/activities.ts`, `src/lib/sales/notes.ts`, `src/lib/sales/activities-page.ts`, `src/lib/sales/activities-query.ts` (client-safe: no prisma, no `next/*` server imports)
- Create: `src/app/api/sales/deals/[dealId]/activities/route.ts` (POST), `src/app/api/sales/activities/route.ts` (GET: next pages for "Show more"), `src/app/api/sales/activities/[activityId]/route.ts` (PATCH), `src/app/api/sales/deals/[dealId]/notes/route.ts` (POST), `src/app/api/sales/notes/[noteId]/route.ts` (PATCH)
- Test: `tests/lib/sales/activities.test.ts`, `tests/lib/sales/notes.test.ts`, `tests/lib/sales/activities-page.test.ts`

**Interfaces:**
- Consumes: Task 2's `findDealForEdit`, `recordDealAudit`, `readJson`, `failResponse`, `PanelActivity`, `SalesMemberOption`, `loadSalesMembers`; Task 1's `activityDueAt`, `isValidDateString`, `ACTIVITY_TYPES`, `ACTIVITY_TYPE_LABELS`, `NOTE_MAX_CHARS`, `ACTIVITIES_PAGE_SIZE`; `dealOwnerWhere`, `canEditDeal`.
- Produces (`activities.ts`): `createActivitySchema` (strictObject `{ type: ACTIVITY_TYPES, subject: trimmed max 200 default "", dueDate: real "YYYY-MM-DD" (error "Enter a real date."), dueTime: "HH:MM" 00:00..23:59 or null, default null (error "Pick a time from the list.") }`), `createDealActivity(actor, dealId, input, meta, now): Promise<{ ok: true; activity: PanelActivity } | SalesFail>`, `setActivityDone(actor, activityId, done: boolean, meta, now): Promise<{ ok: true; changed: boolean; activity: { id; doneAt: string | null }; deal: { id; title; status; openActivityCount: number } } | SalesFail>`.
- Produces (`notes.ts`): `noteSchema` (strictObject `{ body: trimmed 1..50,000 }`, errors `"Write something first."`, `"Notes can be up to 50,000 characters."`), `addDealNote(actor, dealId, input, meta): Promise<{ ok: true; note: { id; body; createdAt: string } } | SalesFail>`, `editNote(actor, noteId, input, meta): Promise<{ ok: true; changed: boolean; note: { id; body } } | SalesFail>`.
- Produces (`activities-query.ts`, client-safe): `type ActivitiesQuery = { when: "open" | "overdue" | "today" | "done"; type: SalesActivityType | "all"; scope: "everyone" | "mine"; cursor: string | null }`, `parseActivitiesQuery(params: Record<string, string | string[] | undefined>): ActivitiesQuery` (first element of arrays; unknown values fall back; `cursor` a 1..64 string or null), `activitiesQueryToSearch(query: ActivitiesQuery): string` (keys in the order when, type, scope; only non-default values; never writes `cursor`).
- Produces (`activities-page.ts`): `type ActivityRow = { id; type; subject; dueAt: string; hasTime: boolean; doneAt: string | null; ownerId: string; deal: { id; title; ownerId } }`, `type ActivityRowsPage = { rows: ActivityRow[]; nextCursor: string | null }`, `activitiesWhere(actor, query, now): Prisma.SalesActivityWhereInput`, `loadActivityRows(actor, query, now, db = prisma): Promise<ActivityRowsPage>` (honours `query.cursor` as `cursor: { id }, skip: 1`, `take: 51`), `loadActivitiesPage(actor, query, now, db = prisma): Promise<{ query; rows: ActivityRow[]; nextCursor: string | null; members: SalesMemberOption[]; canSeeEveryone: boolean }>` (rows from `loadActivityRows`, always the first page).
- Produces (route): `GET /api/sales/activities?when=&type=&scope=&cursor=` returns `ActivityRowsPage` (parsed with `parseActivitiesQuery`).
- Messages (pinned): `"Activity not found."` (404), `"Note not found."` (404), `"Only the person who wrote this note or an admin can edit it."` (403).

- [ ] **Step 1: Write the failing tests**

`activities.test.ts` (`now = new Date("2026-11-05T15:00:00Z")`):
- `{ type: "CALL", subject: "  ", dueDate: "2026-11-06", dueTime: null }` by owner "r" creates `{ type: "CALL", subject: "Call", dueAt: endOfDay("2026-11-06"), hasTime: false, ownerId: "r", createdBy: "r", dealId: "d1", personId: <deal personId> }` and an `activity_added` row with `ipAddress` from the request.
- by admin "b" on Robert's deal: `ownerId: "b"` (Decision 15).
- `dueTime: "09:30"` on `"2026-03-08"` stores `dueAt` `2026-03-08T13:30:00.000Z`, `hasTime: true` (Review Focus 2).
- `dueTime: "24:00"`: 400 `"Pick a time from the list."`; `dueDate: "2026-02-30"`: 400 `"Enter a real date."`; `type: "LUNCHEON"`: 400.
- a visible deal owned by someone else (non-admin): 403.
- `setActivityDone(actor, "a1", true)` sets `doneAt: now`, writes `activity_done` with `after: { activityId: "a1", type: "CALL", subject: "First call" }`, and returns `deal: { openActivityCount: 0, status: "OPEN" }` from `salesActivity.count({ where: { dealId: "d1", doneAt: null, archivedAt: null } })`.
- done again on an already-done activity: `changed: false`, no update, no history (Review Focus 4).
- `done: false` clears `doneAt` and writes `activity_reopened`.
- the activity lookup filters `archivedAt: null`, `dealId: { not: null }` and `deal: { archivedAt: null, ownerId: "r" }` for a seesAllDeals-false actor; no row gives 404 `"Activity not found."` (covers another rep's deal, a lead-only activity and an archived one).

`notes.test.ts`:
- body `"   "`: 400 `"Write something first."`; 50,001 characters: 400.
- body `"<script>alert(1)</script>"` is stored exactly as given (plain text; the UI renders text only) with `authorId: "r"`, `dealId: "d1"`, and a `note_added` row `{ after: { noteId } }`.
- edit by a non-author non-admin: 403 `"Only the person who wrote this note or an admin can edit it."`; by an admin: `note_edited` `{ before: { noteId: "n1", body: "old" }, after: { noteId: "n1", body: "new" } }`; edit with the same body: `changed: false`, no history; a note on a deal the actor cannot see: 404 `"Note not found."`.

`activities-page.test.ts` (`now = new Date("2026-11-05T15:00:00Z")`):
- `parseActivitiesQuery({})` is `{ when: "open", type: "all", scope: "everyone", cursor: null }`; `{ type: "PARTY", when: "later" }` gives the defaults; `activitiesQueryToSearch({ when: "today", type: "MEETING", scope: "mine", cursor: "a9" })` is `"when=today&type=MEETING&scope=mine"`; the defaults give `""`.
- The deal filter is ALWAYS present and always carries the deal-visibility rule: `deal: { archivedAt: null, ...dealOwnerWhere(actor, "everyone") }`, plus `status: "OPEN"` for every `when` except "done".
- `when: "overdue"` filters `doneAt: null, archivedAt: null, dealId: { not: null }, dueAt: { lt: startOfDay("2026-11-05") }, deal: { status: "OPEN", archivedAt: null, ownerId: "r" }` for a seesAllDeals-false actor "r", ordered `[{ dueAt: "asc" }, { id: "asc" }]`, `take: 51`, no `cursor`/`skip`.
- `when: "today"` uses `dueAt: { gte: startOfDay("2026-11-05"), lte: endOfDay("2026-11-05") }`; `when: "done"` uses `doneAt: { not: null }`, `deal: { archivedAt: null, ownerId: "r" }` (no status), order `[{ doneAt: "desc" }, { id: "desc" }]`.
- visibility (the reassigned-deal leak): the seesAllDeals-false actor "r" with `scope: "mine"` gets BOTH `ownerId: "r"` and `deal.ownerId: "r"`, for `when` "open" and "done" alike; an admin with `scope: "mine"` gets `ownerId: <admin>` and no `deal.ownerId`; an admin with `scope: "everyone"` gets neither; `type: "MEETING"` adds `type: "MEETING"`.
- `loadActivityRows` with `cursor: "a50"` adds `cursor: { id: "a50" }, skip: 1`; 51 rows give 50 and `nextCursor: "a50"`.
- GET `/api/sales/activities`: without Sales access 403 and no query; `?when=overdue` with 51 canned rows gives 200 `{ rows: <50>, nextCursor: <50th id> }`; a 65-character `cursor` is ignored (no `cursor`/`skip` in the `findMany`), not a 500.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/activities.test.ts tests/lib/sales/notes.test.ts tests/lib/sales/activities-page.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Read the route handler guide first. `PATCH /api/sales/activities/[activityId]` body is strictObject `{ done: boolean }` (no other edits in Plan 2). Note bodies are never parsed as HTML anywhere.

- [ ] **Step 4: Run to verify they pass** (same command): PASS.
- [ ] **Step 5: Finish gate** (`npx tsc --noEmit`, `npx eslint src scripts tests`, `npm test`): all pass.
- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/activities.ts src/lib/sales/notes.ts src/lib/sales/activities-page.ts src/lib/sales/activities-query.ts "src/app/api/sales/deals/[dealId]/activities/route.ts" src/app/api/sales/activities/route.ts "src/app/api/sales/activities/[activityId]/route.ts" "src/app/api/sales/deals/[dealId]/notes/route.ts" "src/app/api/sales/notes/[noteId]/route.ts" tests/lib/sales/activities.test.ts tests/lib/sales/notes.test.ts tests/lib/sales/activities-page.test.ts
git commit -m "feat(sales): activities, notes and the activities list data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Sales area shell, sidebar entry, shortcuts and the delete-member message

Load ui-ux-pro-max, impeccable and emil-design-eng before the UI steps.

**Files:**
- Create: `src/lib/sales/page-gate.ts`, `src/lib/sales/nav.ts` (imported ONLY by the server `src/app/(app)/layout.tsx`, never by a client component), `src/lib/sales/shortcuts.ts` (client-safe)
- Create: `src/app/(app)/sales/layout.tsx`, `src/app/(app)/sales/page.tsx`, `src/app/(app)/sales/error.tsx`
- Create: `src/components/sales/sales-shortcuts.tsx`, `src/components/sales/shortcuts-help-dialog.tsx`
- Modify: `src/app/(app)/layout.tsx` (builds the nav group, due count, one `<Toaster position="bottom-center" />`), `src/components/layout/sidebar.tsx` (generic `navGroup` prop, no Sales literals), `src/lib/actions/team-members.ts`, `src/components/team/delete-team-member-button.tsx`
- Test: `tests/lib/sales/page-gate.test.ts`, `tests/lib/sales/nav.test.ts`, `tests/lib/sales/shortcuts.test.ts`, `tests/lib/sales/sidebar-secrecy.test.ts`; modify `tests/lib/team-member-delete.test.ts`

**Interfaces:**
- Consumes: `requireSalesUser`, `SalesActor`, `PermissionError`; `endOfDay`, `dateInputValue`.
- Produces: `requireSalesPage(): Promise<SalesActor>` (403 calls `notFound()`, 401 calls `redirect("/login")`, other errors rethrow); `type SidebarNavGroup = { title: string; badge: string | null; links: { href: string; label: string; icon: "board" | "calendar"; count: number }[] }` (exported from `sidebar.tsx`; deliberately generic so the shared sidebar bundle that every user downloads, Robert included, names nothing Sales-related); `salesNavGroup(perms: { isAdmin: boolean; canUseSales: boolean }, dueCount: number): SidebarNavGroup | null` (in `nav.ts`, `import type` of `SidebarNavGroup`); `salesDueCountWhere(userId: string, now: Date): Prisma.SalesActivityWhereInput` (`{ ownerId, doneAt: null, archivedAt: null, dueAt: { lte: endOfDay(dateInputValue(now)) }, deal: { status: "OPEN", archivedAt: null } }`; type-only Prisma import); `type ShortcutAction = "search" | "new-deal" | "new-email" | "new-task" | "help"`; `resolveShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; inEditable: boolean }, ctx: { dealOpen: boolean }): ShortcutAction | null`; `SALES_SHORTCUT_EVENT = "sales:shortcut"`; `SHORTCUT_HELP: { keys: string; label: string }[]`; `useSalesShortcut(action: ShortcutAction, handler: () => void): void` (in `sales-shortcuts.tsx`); `deleteTeamMemberAction(memberId): Promise<{ error: string | null }>` (house action shape, like `updateTeamMemberAction`).

- [ ] **Step 1: Write the failing tests**

```ts
// shortcuts.test.ts
const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; inEditable: boolean }> = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, inEditable: false, ...extra });
it.each([["/", "search"], ["n", "new-deal"], ["N", "new-deal"], ["?", "help"]])("%s gives %s", (k, action) =>
  expect(resolveShortcut(key(k), { dealOpen: false })).toBe(action));
it("e and t need an open deal", () => {
  expect(resolveShortcut(key("e"), { dealOpen: false })).toBeNull();
  expect(resolveShortcut(key("e"), { dealOpen: true })).toBe("new-email");
  expect(resolveShortcut(key("t"), { dealOpen: true })).toBe("new-task");
});
it("never fires while typing or with ctrl, cmd or alt", () => {
  for (const k of ["/", "n", "?", "e", "t"]) expect(resolveShortcut(key(k, { inEditable: true }), { dealOpen: true })).toBeNull();
  expect(resolveShortcut(key("n", { ctrlKey: true }), { dealOpen: false })).toBeNull();
  expect(resolveShortcut(key("/", { metaKey: true }), { dealOpen: false })).toBeNull();
  expect(resolveShortcut(key("n", { altKey: true }), { dealOpen: false })).toBeNull();
  expect(resolveShortcut(key("Escape"), { dealOpen: true })).toBeNull();
});
it("lists the help rows in the mockup's order without em dashes", () =>
  expect(SHORTCUT_HELP.map((row) => row.keys)).toEqual(["/", "n", "e", "t", "Esc", "?"]));
```

- `nav.test.ts`: `salesNavGroup({ isAdmin: false, canUseSales: false }, 0)` is `null` (Robert); `{ isAdmin: true, canUseSales: false }` and `{ isAdmin: false, canUseSales: true }` with due count 3 give `{ title: "Sales", badge: "NEW", links: [{ href: "/sales/deals", label: "Deals", icon: "board", count: 0 }, { href: "/sales/activities", label: "Activities", icon: "calendar", count: 3 }] }`; `salesDueCountWhere("r", new Date("2026-11-06T04:30:00Z")).dueAt` is `{ lte: endOfDay("2026-11-05") }`.
- `sidebar-secrecy.test.ts` (reads source files with `fs.readFileSync`): `src/components/layout/sidebar.tsx` and `src/components/layout/topbar.tsx` match neither `/sales/i` nor `/deals/i` (so no path, label, import of `@/lib/sales` or prop name gives Sales away); `src/app/(app)/layout.tsx` imports `@/lib/sales/nav`; no file under `src/components/` outside `src/components/sales/` imports `@/lib/sales/nav`.
- `page-gate.test.ts` (mock `next/navigation` `notFound`/`redirect` to throw tagged errors, mock `requireSalesUser`): a 403 PermissionError calls `notFound`; a 401 calls `redirect("/login")`; an actor is returned as is; a plain `Error("db down")` is rethrown.
- `team-member-delete.test.ts`: the Sales-records case now resolves `{ error: "This person still owns Sales records. Reassign them first." }` (Slack and delete untouched); the last-admin case resolves `{ error: "This is the only admin. Promote someone else before removing them." }`; success resolves `{ error: null }`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/sales/shortcuts.test.ts tests/lib/sales/nav.test.ts tests/lib/sales/page-gate.test.ts tests/lib/sales/sidebar-secrecy.test.ts tests/lib/team-member-delete.test.ts`
Expected: FAIL (the secrecy test fails only on the missing `nav` import in the app layout until Step 3).

- [ ] **Step 3: Implement the server pieces**

Read `03-layouts-and-pages.md`, `03-api-reference/03-file-conventions/layout.md`, `error.md` and the authentication guide's "Layouts and auth checks" first.
- `sales/layout.tsx`: `await requireSalesPage()` (keeps the shell, shortcuts and help text away from people without access), then `{children}` plus `<Suspense fallback={null}><SalesShortcuts /></Suspense>`. Every Sales page ALSO calls `requireSalesPage()` itself (layouts do not re-run on navigation).
- `sales/page.tsx`: `await requireSalesPage(); redirect("/sales/deals")`.
- `sales/error.tsx` (client): reports with `Sentry.captureException(error)` in an effect (as `global-error.tsx` does); shows heading "Something went wrong", text "This page could not load. Try again, and if it keeps happening, send the error ID below to DJ.", a "Try again" button calling `unstable_retry()`, and `Error ID: {error.digest}` when present.
- `(app)/layout.tsx`: `const salesOn = !!perms && (perms.isAdmin || perms.caps.canUseSales)`; only when `salesOn`, add `prisma.salesActivity.count({ where: salesDueCountWhere(userId, new Date()) })` to the existing `Promise.all` (else `Promise.resolve(0)`); pass `navGroup={salesNavGroup({ isAdmin: !!perms?.isAdmin, canUseSales: !!perms?.caps.canUseSales }, dueCount)}` to `Sidebar` (null for people without access, so their page HTML and RSC payload carry no Sales text either); mount `<Toaster position="bottom-center" />` once.
- `team-members.ts`: `deleteTeamMemberAction` returns `{ error }` for the two refusals instead of throwing (permission failures from `requireAdmin` still throw), and `{ error: null }` on success; also replace the em dash in the update path's message with `"This is the only admin. Promote someone else to admin first."`.

- [ ] **Step 4: Implement the UI pieces**

- Sidebar: new optional prop `navGroup?: SidebarNavGroup | null`; when present, a group placed right after the main links, rendered entirely from the prop (the file holds no Sales literal; the guard test enforces it). Group label `navGroup.title` in the Leadership label style plus, when `navGroup.badge`, a small pill (`bg-secondary-accent text-secondary-accent-foreground`, 9px uppercase). Each link uses `ICONS[link.icon]` with `const ICONS = { board: SquareKanban, calendar: CalendarCheck }` (lucide), active when `pathname.startsWith(href)`. A link with `count > 0` shows it in the mockup's `.cnt` pill (`ml-auto shrink-0 rounded-full bg-white/10 px-1.5 text-[11px] font-bold tabular-nums`) with `<span className="sr-only"> due today or overdue</span>`.
- `SalesShortcuts` (client): one `keydown` listener on `document`; `inEditable` = target inside `input, textarea, select, [contenteditable="true"]`; `dealOpen` = `searchParams.has("deal")`; on an action it calls `preventDefault()`, then: `help` opens `ShortcutsHelpDialog`; `new-deal` dispatches the event on `/sales/deals`, else `router.push("/sales/deals?new=1")`; `search`, `new-email`, `new-task` dispatch `new CustomEvent(SALES_SHORTCUT_EVENT, { detail: action })`. `useSalesShortcut` subscribes and unsubscribes in an effect.
- `ShortcutsHelpDialog` (existing `Dialog`): title "Keyboard shortcuts"; rows `kbd` + label from `SHORTCUT_HELP`: `/` "Search", `n` "New deal", `e` "New email (in an open deal)", `t` "New task (in an open deal)", `Esc` "Close panel or window", `?` "This list"; footnote "Same keys as Pipedrive." Export a small `ShortcutsButton` (icon button, lucide `Keyboard`, `aria-label="Keyboard shortcuts"`, `title="Keyboard shortcuts (?)"`) that opens it, for the Deals toolbar and Activities header.
- Delete-member button: `startTransition(async () => { const { error } = await deleteTeamMemberAction(memberId); if (error) toast.error(error); })`.
- 375px: the Sales group follows the existing mobile drawer; the count pill never wraps (`shrink-0`).

- [ ] **Step 5: Run to verify they pass** (Step 2 command): PASS.
- [ ] **Step 6: Finish gate** (`npx tsc --noEmit`, `npx eslint src scripts tests`, `npm test`): all pass.
- [ ] **Step 7: Commit**

```bash
git add src/lib/sales/page-gate.ts src/lib/sales/nav.ts src/lib/sales/shortcuts.ts "src/app/(app)/sales/layout.tsx" "src/app/(app)/sales/page.tsx" "src/app/(app)/sales/error.tsx" src/components/sales/sales-shortcuts.tsx src/components/sales/shortcuts-help-dialog.tsx "src/app/(app)/layout.tsx" src/components/layout/sidebar.tsx src/lib/actions/team-members.ts src/components/team/delete-team-member-button.tsx tests/lib/sales/page-gate.test.ts tests/lib/sales/nav.test.ts tests/lib/sales/shortcuts.test.ts tests/lib/sales/sidebar-secrecy.test.ts tests/lib/team-member-delete.test.ts
git commit -m "feat(sales): Sales area shell, sidebar entry, shortcuts and delete-member message

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Deals board and list

Load ui-ux-pro-max, impeccable and emil-design-eng first. Read `page.md` and `loading.md`.

**Files:**
- Create: `src/app/(app)/sales/deals/page.tsx`, `src/app/(app)/sales/deals/loading.tsx`
- Create: `src/lib/sales/api-client.ts` (client-safe fetch wrappers), `src/lib/sales/board-client.ts` (pure)
- Create: `src/components/ui/context-menu.tsx` (Base UI `@base-ui/react/context-menu`, styled like `dropdown-menu.tsx`)
- Create: `src/components/sales/deals-view.tsx`, `deals-toolbar.tsx`, `deals-board.tsx`, `deal-card.tsx`, `deal-quick-actions.tsx`, `deals-list.tsx`, `sales-pills.tsx`, `use-deal-moves.tsx`, `value-dialog.tsx`, `lost-dialog.tsx`, `new-deal-dialog.tsx` (all under `src/components/sales/`)
- Test: `tests/lib/sales/board-client.test.ts`

**Interfaces:**
- Consumes: `loadBoardPage`, `BoardPageData`, `BoardStage`, `BoardCard`, `DealListPage` (Task 2); `loadDefaultView` (Task 2); `parseBoardQuery`, `boardQueryToSearch`, `BoardQuery` (Task 1); `ActivitiesQuery`, `activitiesQueryToSearch` (Task 5, `activities-query.ts`), `ActivityRowsPage` (type only); all routes of Tasks 2 to 5; existing `DropdownMenu*` (`dropdown-menu.tsx`) and `Dialog*` (`dialog.tsx`) components; `useSalesShortcut`, `ShortcutsButton`, `requireSalesPage` (Task 6); `nextStepPill`, `daysInStage`, `isRotting`, `formatMoney`, `parseMoneyToCents`, `shortName`, `avatarTone` (Task 1).
- Produces (`api-client.ts`): `type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code?: string }`; `getDealPanel(dealId)`, `getDealTimeline(dealId, cursor)`, `createDealRequest(body)`, `updateDealRequest(dealId, body)`, `deleteDealRequest(dealId)`, `setDealFieldRequest(dealId, fieldKey, value)`, `moveDealRequest(dealId, body)`, `setDealStatusRequest(dealId, body)`, `createActivityRequest(dealId, body)`, `setActivityDoneRequest(activityId, done)`, `addNoteRequest(dealId, body)`, `editNoteRequest(noteId, body)`, `searchContactsRequest(kind, q)`, `saveDefaultViewRequest(view)`, `getDealListPage(query: BoardQuery): Promise<ApiResult<DealListPage>>` (GET `/api/sales/deals?` + `boardQueryToSearch(query)` + `cursor` from `query.cursor`), `getActivitiesPage(query: ActivitiesQuery): Promise<ApiResult<ActivityRowsPage>>` (GET `/api/sales/activities?` + `activitiesQueryToSearch(query)` + `cursor`); each returns `Promise<ApiResult<...>>` typed with `import type` from the server modules; a network failure becomes `{ ok: false, status: 0, error: "Could not reach the server. Check your connection and try again." }`.
- Produces (`board-client.ts`): `applyOptimisticMove(columns: BoardColumn[], dealId: string, toStageId: string, nowIso: string): BoardColumn[]` (pure, input untouched; card goes to the top of the target column with `stageEnteredAt: nowIso`, which is where Task 2's newest-first order puts it after the refresh; both columns' `count` and `totalCents` adjust), `nextBoardQuery(current: BoardQuery, resolvedPipelineKey: string, patch: Partial<Omit<BoardQuery, "cursor">>): BoardQuery` (`{ ...current, pipeline: resolvedPipelineKey, ...patch, cursor: null }`: every toolbar change names the pipeline, so the saved view only ever applies to a bare `/sales/deals`), `appendPage<T extends { id: string }>(rows: T[], next: T[]): T[]` (keeps `rows`, adds the rows of `next` whose id is not already shown), `nextColumnIndex(current: number, key: string, count: number): number`, `dragAnnouncements` (`onDragStart(title)`, `onDragOver(title, stageName)`, `onDragEnd(title, stageName)`, `onDragCancel(title, stageName)`), `moveToast(stage: { name; isNoShow; isWon; isLost }): { message: string; offer: "won" | "lost" | null }`.
- Produces (components): `useDealMoves(onChanged: () => void): { move(deal: MovableDeal, target: BoardStage, hooks?: { optimistic?: () => void; revert?: () => void }): Promise<void>; setStatus(deal: MovableDeal, status: "WON" | "LOST" | "OPEN"): Promise<void>; editValue(deal: MovableDeal, stage: BoardStage): void; dialogs: React.ReactNode }` with `type MovableDeal = { id: string; title: string; stageId: string; valueCents: number; mrrCents: number }`; `NextStepPill`, `DaysPill`, `OwnerAvatar` (`sales-pills.tsx`); `ValueDialog`, `LostDialog`. Task 8 and Task 9 reuse all of these.

- [ ] **Step 1: Write the failing test** `tests/lib/sales/board-client.test.ts`

```ts
it("moves a card optimistically without touching the input", () => {
  const columns = [col("s4", [card("d1", 0)]), col("s5", [card("d2", 1440000)])];
  const next = applyOptimisticMove(columns, "d1", "s5", "2026-11-05T15:00:00.000Z");
  expect(next[0]).toMatchObject({ count: 0, totalCents: 0, cards: [] });
  expect(next[1].cards.map((c) => c.id)).toEqual(["d1", "d2"]);
  expect(next[1].cards[0]).toMatchObject({ stageId: "s5", stageEnteredAt: "2026-11-05T15:00:00.000Z" });
  expect(next[1]).toMatchObject({ count: 2, totalCents: 1440000 });
  expect(columns[0].cards).toHaveLength(1);
});
const DEFAULTS: BoardQuery = { pipeline: null, view: "board", scope: "everyone", status: "open", next: "any", q: "", cursor: null };
it("always names the resolved pipeline so a saved view cannot undo a click", () => {
  const next = nextBoardQuery(DEFAULTS, "direct-mail", { view: "board" });
  expect(next).toEqual({ ...DEFAULTS, pipeline: "direct-mail" });
  expect(boardQueryToSearch(next)).toContain("pipeline=direct-mail");
  expect(nextBoardQuery(DEFAULTS, "direct-mail", { scope: "mine" })).toMatchObject({ pipeline: "direct-mail", scope: "mine" });
  expect(nextBoardQuery({ ...DEFAULTS, pipeline: "direct-mail" }, "direct-mail", { pipeline: "new-mover-mail" }).pipeline).toBe("new-mover-mail");
  expect(nextBoardQuery({ ...DEFAULTS, cursor: "d50" }, "direct-mail", { q: "oak" })).toMatchObject({ q: "oak", cursor: null });
});
it("appends a page without repeating rows", () => {
  expect(appendPage([{ id: "d1" }, { id: "d2" }], [{ id: "d2" }, { id: "d3" }]).map((r) => r.id)).toEqual(["d1", "d2", "d3"]);
});
it("jumps one column per arrow and stops at the ends", () => {
  expect(nextColumnIndex(2, "ArrowRight", 8)).toBe(3);
  expect(nextColumnIndex(7, "ArrowRight", 8)).toBe(7);
  expect(nextColumnIndex(0, "ArrowLeft", 8)).toBe(0);
  expect(nextColumnIndex(3, "ArrowUp", 8)).toBe(3);
});
it("announces keyboard drags in plain words", () => {
  expect(dragAnnouncements.onDragStart("Bright Smile Dental")).toBe(
    "Picked up Bright Smile Dental. Use the left and right arrow keys to pick a stage, Space to drop, Escape to cancel.");
  expect(dragAnnouncements.onDragEnd("Bright Smile Dental", "Proposal Sent")).toBe("Bright Smile Dental moved to Proposal Sent.");
  expect(dragAnnouncements.onDragCancel("Bright Smile Dental", "Demo Complete")).toBe(
    "Move cancelled. Bright Smile Dental stays in Demo Complete.");
});
it("words the move toast like the mockup", () => {
  expect(moveToast({ name: "No Show", isNoShow: true, isWon: false, isLost: false }))
    .toEqual({ message: "Moved to No Show. Reschedule call added for today.", offer: null });
  expect(moveToast({ name: "Contract Signed", isNoShow: false, isWon: true, isLost: false }))
    .toEqual({ message: "Moved to Contract Signed.", offer: "won" });
  expect(moveToast({ name: "Deal Lost Nurture", isNoShow: false, isWon: false, isLost: true }).offer).toBe("lost");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/sales/board-client.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `board-client.ts` and `api-client.ts`**, then run the test: PASS.

- [ ] **Step 4: Build the page and components (mockup `viewDeals`, `card`, `askValue`, `askLost`, `newDealModal`, drop bar)**

- `page.tsx`: `const actor = await requireSalesPage()`; `const params = await searchParams`; read `loadDefaultView(actor.userId)` only when none of `pipeline`, `view`, `scope` is present; `parseBoardQuery`; `loadBoardPage(actor, query, new Date())`; null renders `EmptyState` (lucide `SquareKanban`) "No pipelines yet" / "Sales needs its pipelines before deals can be added. Ask an admin to run the Sales setup." Else `<DealsView data={...} viewer={{ userId, isAdmin }} openNew={params.new === "1"} />`.
- Layout: the page fills the space under the top bar: wrapper `-m-4 md:-m-6 flex h-[calc(100dvh-3.5rem)] min-w-0 flex-col`; toolbar `shrink-0`; board `flex-1 min-h-0 overflow-x-auto overscroll-x-contain`; each column `flex min-h-0 flex-col`, its body `overflow-y-auto`. No horizontal page scroll at any width.
- Toolbar (mockup `.tbar`), left to right: Pipeline select (`aria-label="Pipeline"`, Sales and Consulting pipelines); view segmented control with icon buttons `aria-label="Board view"` / `"List view"`, `aria-pressed`; Everyone | Just me segmented control (only when `canSeeEveryone`); Filter button (the existing `DropdownMenu`, no new ui file: trigger is the Filter button; content holds two `DropdownMenuGroup`s, each a `DropdownMenuLabel` ("Status", "Next step") over a `DropdownMenuRadioGroup` of `DropdownMenuRadioItem`s (Open, Won, Lost; Any, Overdue, Today, No next step), then `DropdownMenuSeparator` and a `DropdownMenuItem` "Clear filters"; radio items keep the menu open (Base UI default) and are `pointer-coarse:min-h-10`; the button shows a dot and `aria-label="Filter, 2 active"` when filters are on); search input placeholder "Filter this board", `aria-label="Filter this board"`, debounced 300ms into `q`, focused by the `search` shortcut; primary button "+ Deal" (lucide `Plus` + "Deal"); `ShortcutsButton`; summary `"{formatMoney(total)} · {n} deal(s)"` in `aria-live="polite"`. Every change builds `const next = nextBoardQuery(data.query, data.pipeline.key, patch)` and calls `router.replace("?" + boardQueryToSearch(next), { scroll: false })`; a pipeline, view or scope change also calls `saveDefaultViewRequest({ pipeline: next.pipeline, view: next.view, scope: next.scope })` with that same resolved key (errors logged with `console.error`, never shown). Never build a toolbar URL any other way.
- Column (mockup `.col`, `flex: 1 0 240px`, `max-width: 300px`, `bg-muted/40`, `rounded-[10px]`): header with stage name (truncate, `title="Win chance {p}%"`), `"{$sum} · {n} deal(s)"` (tabular numbers), a 2px primary bar at `width: {probability}%`; `<section aria-label="{stage}, {n} deals">`. Empty column: "No deals in {stage} yet." When the whole pipeline is empty with no filters, the first column instead shows `EmptyState` "No deals in {pipeline} yet." / "Add a deal by hand to get started." / button "Deal"; with filters on, a bar above the board says "No deals match these filters." with "Clear filters". Over 50 cards: footer "Showing 50 of {count}." with button "Open list view".
- Card (mockup `.dcard`): row 1 title (truncate) and value right-aligned (`$0` when 0); row 2 person name plus " · $1,200/mo" when MRR is set; row 3 `NextStepPill` (type icon + label; "No next step" uses the warning icon), `DaysPill` (`"{n}d"`, `title="Days in this stage"`; amber with lucide `Clock` and `aria-label="{n} days in this stage, idle too long"` when `isRotting`), `OwnerAvatar` (22px initials, tone from `avatarTone`, `title` owner name) pushed right. Hover: primary border. Click or Enter opens the panel (`?deal=<id>` via `router.push(..., { scroll: false })`).
- Quick actions (`deal-quick-actions.tsx`, ContextMenu on the card, right-click, long-press, Shift+F10): "Open", "Add activity" (opens the panel with the composer focused), "Move to" submenu (every stage, current one checked), "Mark won", "Mark lost", and for admins a separated destructive "Delete". Delete opens a confirm built from the existing `Dialog` (no new ui file; `role="alertdialog"` on `DialogContent`, `showCloseButton={false}`): title "Delete {title}?", text "It disappears from the board. Its history stays.", buttons "Cancel" (autofocus) and "Delete" (`variant="destructive"`, disabled while deleting); toast "Deal deleted.". The dialog's open state lives beside the context menu so it survives the menu closing.
- Drag (`deals-board.tsx`, `DndContext` with `MouseSensor` `{ activationConstraint: { distance: 8 } }` and `KeyboardSensor` `{ keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] }, coordinateGetter }` where the getter uses `nextColumnIndex` to jump to the next column's centre; `accessibility={{ announcements, screenReaderInstructions }}` from `dragAnnouncements`). No touch or pointer sensor. While dragging: source card `opacity-40`; `DragOverlay` copy with `shadow-lg` and `scale-[1.02]` (`motion-reduce:scale-100`); target column `outline-2 outline-dashed outline-primary bg-accent`; the drop bar (mockup `.dropbar`, fixed bottom, `pb-[calc(12px+env(safe-area-inset-bottom))]`) slides up in 150ms ease-out with two droppable zones "Lost" (lucide `X`, red dashed) and "Won" (lucide `Check`, green dashed), filled when hovered.
- `useDealMoves.move`: if the target `requiresValue` and either stored value is 0, open `ValueDialog` in move mode first (no request); otherwise apply `hooks.optimistic`, call `moveDealRequest`; on 422 `PROPOSAL_NEEDS_VALUE` revert and open the dialog; on any other failure revert and `toast.error(error)`; on success `toast(moveToast(...).message, { action: offer ? { label: "Mark won" | "Mark lost", onClick } : undefined, cancel: { label: "Undo", onClick: move back with undoActivityIds = createdActivityIds } })` then `onChanged()` (`router.refresh()`). `setStatus("WON")` toasts "{title} won. Nice work." with Undo (status OPEN); `"LOST"` opens `LostDialog` then toasts "{title} marked lost." with Undo; `"OPEN"` toasts "Reopened.".
- `ValueDialog` (mockup `askValue`): move mode title "Add the deal value first", text "{title} is moving to **{stage}**. A proposal needs a real price, so both values are required.", fields "Total value ($)" (placeholder `14400`) and "Monthly value ($)" (placeholder `1200`), `inputMode="decimal"`, autofocus on the first; inline error under the fields "Both must be more than $0." (`role="alert"`) or the parse error "Enter an amount like 14,400."; buttons "Cancel" / "Save and move". Edit mode title "Deal value", no text, button "Save", zero allowed (server refuses at Proposal Sent); success toast "Value saved.". Submit button disabled while saving.
- `LostDialog` (mockup `askLost`): title "Mark as lost"; "Reason" select of `LOST_REASONS` (autofocus); "Comment (optional)" textarea, placeholder "What happened?", max 1,000; buttons "Cancel" / "Mark lost" (red).
- `NewDealDialog` (mockup `newDealModal`, opened by "+ Deal", `n`, `?new=1`): title "Add deal"; row "Person" (Combobox over `searchContactsRequest("person")`, placeholder "Sarah K.", last option "Add new person: {text}") and "Organization" (same for organizations, placeholder "Practice name"); row "Pipeline" (current pipeline preselected) and "Owner" (members by `shortName`; disabled showing yourself for non-admins); "Value ($)" placeholder "Optional until Proposal Sent"; "First activity" select "Call today" (default), "Call tomorrow", "Demo in 2 days"; inline error "Add a person or an organization."; buttons "Cancel" / "Save". Success toast "Deal added with its first activity."; when the pipeline differs, navigate to it.
- List view (mockup list table, `deals-list.tsx`): columns (avatar), Deal, Person, Stage, Value, Next activity, Owner; row click opens the panel. "Show more" (shown when `nextCursor`) calls `getDealListPage({ ...data.query, pipeline: data.pipeline.key, cursor: nextCursor })` and appends with `appendPage`; while loading the button reads "Loading" and is disabled; a failure toasts its error and keeps the rows. The appended rows and cursor reset to `data.list` whenever the server sends a new `data.list` (a filter change or a `router.refresh()`), using React's "adjust state when a prop changes" pattern (keep the previous `data.list` in state and compare during render), not an effect. The URL never carries a cursor. Under 640px rows become stacked cards with "Person:", "Stage:", "Value:", "Next:", "Owner:" labels (mockup `.t.cards`).
- 375px: the toolbar wraps (pipeline select grows; search full width; summary on its own last line); columns are `flex: 0 0 84%` with `scroll-snap-type: x mandatory` and `scroll-snap-align: center`; hint above the board "Swipe sideways for more stages. Press and hold a deal to move it."; all toolbar controls 40px tall on coarse pointers; the drop bar never shows on touch.
- `loading.tsx`: the same outer shell: toolbar of `Skeleton` blocks (select, two segmented controls, search, button) and five columns each with a header bar and three 72px card skeletons.

- [ ] **Step 5: Finish gate** (`npx tsc --noEmit`, `npx eslint src scripts tests`, `npm test`): all pass, and `git status --short` shows no new or modified file under `src/` or `tests/` that is missing from Step 6's `git add`. Note for the controller's click-through: drag on desktop, keyboard drag, long-press menu at 375px, $0 to Proposal Sent, drop on Won/Lost, Undo, list view "Show more", filters, Board/Everyone clicks from a bare `/sales/deals` with a saved view (the click sticks), new deal, delete confirm, dark mode.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/sales/deals/page.tsx" "src/app/(app)/sales/deals/loading.tsx" src/lib/sales/api-client.ts src/lib/sales/board-client.ts src/components/ui/context-menu.tsx src/components/sales/deals-view.tsx src/components/sales/deals-toolbar.tsx src/components/sales/deals-board.tsx src/components/sales/deal-card.tsx src/components/sales/deal-quick-actions.tsx src/components/sales/deals-list.tsx src/components/sales/sales-pills.tsx src/components/sales/use-deal-moves.tsx src/components/sales/value-dialog.tsx src/components/sales/lost-dialog.tsx src/components/sales/new-deal-dialog.tsx tests/lib/sales/board-client.test.ts
git commit -m "feat(sales): deals board and list with drag, filters and the value and lost dialogs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Deal panel

Load ui-ux-pro-max, impeccable and emil-design-eng first.

**Files:**
- Create: `src/lib/sales/panel-client.ts` (pure)
- Create: `src/components/sales/deal-panel.tsx`, `deal-panel-header.tsx`, `activity-composer.tsx`, `next-steps.tsx`, `deal-details.tsx`, `deal-history.tsx`, `next-step-dialog.tsx`, `use-activity-done.tsx` (under `src/components/sales/`)
- Modify: `src/app/(app)/sales/layout.tsx` (mount `<DealPanel />` inside the existing Suspense)
- Test: `tests/lib/sales/panel-client.test.ts`

**Interfaces:**
- Consumes: Task 7's `api-client`, `useDealMoves`, `ValueDialog`, `LostDialog`, pills; Task 2's `DealPanelData`, `TimelineEntry`; Task 6's `useSalesShortcut`; Task 1's `NEXT_STEP_PRESETS`, `DUE_CHOICES`, `TIME_SLOTS`, `ACTIVITY_TYPE_LABELS`, `dayLabel`, `normalizeFieldValue` (Task 3).
- Produces (`panel-client.ts`): `groupTimelineByDay(entries: TimelineEntry[], now: Date): { label: string; entries: TimelineEntry[] }[]` (app-time days, newest first, labels from `dayLabel`), `composerDueDate(choice: "today" | "tomorrow" | "2-days" | "next-week" | "pick", today: string, picked: string): string | null`, `needsNextStepPrompt(deal: { status: string; openActivityCount: number }): boolean`, `stageCaption(stageName: string, days: number, probability: number): string`, `DEAL_PANEL_SHEET_CLASS = "gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]"` (same `data-[side=right]:` variant as `SheetContent`'s own `data-[side=right]:w-3/4` and `data-[side=right]:sm:max-w-sm`, so tailwind-merge replaces them; a plain `w-full sm:max-w-[560px]` loses to the attribute selector's higher specificity and leaves the panel 75% wide on phones and 384px on desktop).
- Produces (components): `DealPanel` (reads `?deal=`), `NextStepDialog`, `useActivityDone(onChanged): { markDone(activity: { id: string; subject: string }, deal: { id: string; title: string }): Promise<void>; dialogs: React.ReactNode }` (Task 9 reuses it).

- [ ] **Step 1: Write the failing test** `tests/lib/sales/panel-client.test.ts`

```ts
const now = new Date("2026-11-06T04:30:00Z"); // Nov 5, 11:30 PM Eastern
it("groups history by Eastern day, newest first", () => {
  const groups = groupTimelineByDay([entry("e1", "2026-11-06T03:00:00Z"), entry("e2", "2026-11-04T15:00:00Z"), entry("e3", "2026-11-03T15:00:00Z")], now);
  expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Nov 3"]);
});
it("turns due choices into Eastern dates", () => {
  expect(composerDueDate("today", "2026-11-05", "")).toBe("2026-11-05");
  expect(composerDueDate("tomorrow", "2026-11-05", "")).toBe("2026-11-06");
  expect(composerDueDate("2-days", "2026-11-05", "")).toBe("2026-11-07");
  expect(composerDueDate("next-week", "2026-11-05", "")).toBe("2026-11-12");
  expect(composerDueDate("pick", "2026-11-05", "2026-12-01")).toBe("2026-12-01");
  expect(composerDueDate("pick", "2026-11-05", "")).toBeNull();
});
it("prompts for a next step only on open deals with nothing left", () => {
  expect(needsNextStepPrompt({ status: "OPEN", openActivityCount: 0 })).toBe(true);
  expect(needsNextStepPrompt({ status: "OPEN", openActivityCount: 1 })).toBe(false);
  expect(needsNextStepPrompt({ status: "WON", openActivityCount: 0 })).toBe(false);
});
it("captions the stage like the mockup", () => {
  expect(stageCaption("Demo Complete", 1, 30)).toBe("Demo Complete · 1 day in this stage · 30% win chance");
  expect(stageCaption("Follow-Up", 9, 85)).toBe("Follow-Up · 9 days in this stage · 85% win chance");
});
it("overrides the Sheet's default width so the panel is full screen on phones and 560px on desktop", () => {
  // the two width classes SheetContent applies for side="right" (src/components/ui/sheet.tsx)
  const merged = cn("data-[side=right]:w-3/4 data-[side=right]:sm:max-w-sm", DEAL_PANEL_SHEET_CLASS).split(" ");
  expect(merged).not.toContain("data-[side=right]:w-3/4");
  expect(merged).not.toContain("data-[side=right]:sm:max-w-sm");
  expect(merged).toEqual(expect.arrayContaining(["data-[side=right]:w-full", "data-[side=right]:sm:max-w-[560px]"]));
});
```

The panel computes `today` with `todayDateString()` at click time (Review Focus 2: "Tomorrow" at 11:30 PM Eastern gives the next Eastern day).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/sales/panel-client.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `panel-client.ts`**, then run the test: PASS.

- [ ] **Step 4: Build the panel (mockup `renderPanel`, `composer`, `askNext`)**

- Shell: existing `Sheet` (Base UI Dialog, side right) with `className={DEAL_PANEL_SHEET_CLASS}` (never a plain `w-full`/`sm:max-w-*`, see the Interfaces note) and `showCloseButton={false}` (the header has its own); open when `?deal=` is present; closing (Esc, overlay, close button) removes `deal` with `router.replace(..., { scroll: false })` and focus returns to the card. Motion: the Sheet's 200ms slide and fade, `motion-reduce:transition-none`. `aria-labelledby` the deal name input's label.
- States: loading shows skeletons in the header (title line, meta line, stage bar) and three body rows; a 404 shows `EmptyState` "This deal is not available." / "It may have been deleted, or it belongs to someone whose deals you cannot see." / button "Close"; any other failure shows "Could not load this deal." with "Try again".
- Header (mockup `.ph`): crumb "{pipeline} → {stage}" (lucide `ArrowRight`, muted, 12px) plus a "Won" (success) or "Lost" (danger) pill when closed, and the close icon button `aria-label="Close (Esc)"`; deal name as an `<input aria-label="Deal name">` styled as the 19px heading (transparent border until hover/focus), saved on blur or Enter when changed and non-empty, Esc reverts; meta row: value button "$14,400 · $1,200/mo" (`title="Edit value"`, opens `ValueDialog` edit mode), person (lucide `User` + name), owner (`OwnerAvatar` + select `aria-label="Owner"` of members by `shortName`), then "Won" (green) and "Lost" (red) buttons when OPEN or "Reopen" when closed, all through `useDealMoves`. Stage bar (mockup `.stagebar`, chevron `clip-path`): one button per stage, `role="group" aria-label="Stage"`, current `aria-current="step"`, passed stages green, each with `title` and `aria-label` the stage name; click moves via `useDealMoves.move`; disabled when the deal is closed or `!canEdit`. Caption below from `stageCaption`.
- Read-only (`!canEdit`): an info bar "Only {owner short name} or an admin can change this deal."; every control disabled (`aria-disabled`), composer hidden.
- Body (mockup `.pb`, in order): warning bar when OPEN with no open activity: "**No next step.** Every open deal needs one." + "Schedule" (focuses the composer); territory infobar when `territoryHold`: "Territory hold ends **{Nov 12}**. A hold check is on the calendar 7 days before."; composer card with tabs (`role="tablist"`) "Activity" and "Note".
- Activity tab: six type buttons (icon only, `aria-label` and `title` the type, `aria-pressed`; icons Phone, Users, SquareCheck, Flag, Mail, Coffee); subject input placeholder "{Type}: what is the next step?" (`aria-label="Subject"`); due select `DUE_CHOICES` (default "Tomorrow"), "Pick a date" reveals `<input type="date">`; time select "Any time" + `TIME_SLOTS`; "Save activity" (disabled while saving or when "Pick a date" has no date); toast "Activity saved.". The `new-task` shortcut opens this tab with Task selected and focuses the subject; `new-email` the same with Email.
- Note tab: textarea placeholder "Write a note. Everyone on the deal can see it.", "Save note" (disabled when blank); toast "Note saved.".
- "Next steps" section: open activities by due date, each row a round check button (`aria-label="Mark done: {subject}"`, 20px visual inside a 40px hit area), type icon tile (red when overdue, amber today), subject, "{Type} · {dayLabel}{ (overdue)}"; empty "None scheduled.". Ticking uses `useActivityDone.markDone`: toast "Marked done.", then `NextStepDialog` when `needsNextStepPrompt`.
- `NextStepDialog` (mockup `askNext`): title "Schedule the next step"; text "{title} has no next activity now. Pick one so it does not stall."; radio cards from `NEXT_STEP_PRESETS` with their icons ("Call tomorrow" checked); buttons "Skip for now" / "Schedule"; toast "Next step scheduled.".
- "Details" section (mockup `.fields`, 150px label column, 120px under 640px): Organization, Person (text), Source (select `DEAL_SOURCES`), Monthly value (opens `ValueDialog`), then each `PanelField` by label: TEXT input, NUMBER input (`inputMode="decimal"`), DATE `<input type="date">`, SELECT select; empty shows muted "Add"; saved on blur/change through `setDealFieldRequest`, validated first with `normalizeFieldValue` (error under the field, `aria-describedby`).
- "History" section: heading plus a pill with lucide `Lock` and "locked" (`title="Nobody can edit or delete history"`); `groupTimelineByDay` with sticky day headers; each entry icon tile, text, "{actor short name}" (or "Sales rule" for SYSTEM) in muted 12px; note entries show the body in a warm note box (`bg-status-warning/40`, `whitespace-pre-wrap`, text only) with "Edit" for `canEdit` notes (inline textarea, "Save" / "Cancel"); "Show older" button when `nextCursor`.
- After every successful write: refetch the panel (and the first timeline page) and call `router.refresh()`.
- 375px: full screen; header wraps (Won/Lost move to their own line); stage bar 40px tall on coarse pointers with labels visually hidden (`sr-only`) but named; fields grid 120px labels; composer type buttons wrap; no horizontal scroll inside the panel.

- [ ] **Step 5: Finish gate** (`npx tsc --noEmit`, `npx eslint src scripts tests`, `npm test`): all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/panel-client.ts src/components/sales/deal-panel.tsx src/components/sales/deal-panel-header.tsx src/components/sales/activity-composer.tsx src/components/sales/next-steps.tsx src/components/sales/deal-details.tsx src/components/sales/deal-history.tsx src/components/sales/next-step-dialog.tsx src/components/sales/use-activity-done.tsx "src/app/(app)/sales/layout.tsx" tests/lib/sales/panel-client.test.ts
git commit -m "feat(sales): slide-in deal panel with activities, notes, details and history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Activities page

Load ui-ux-pro-max, impeccable and emil-design-eng first. Read `page.md` and `loading.md`.

**Files:**
- Create: `src/app/(app)/sales/activities/page.tsx`, `src/app/(app)/sales/activities/loading.tsx`
- Create: `src/lib/sales/activities-client.ts` (pure), `src/components/sales/activities-view.tsx`
- Test: `tests/lib/sales/activities-client.test.ts`

**Interfaces:**
- Consumes: `parseActivitiesQuery`, `activitiesQueryToSearch`, `ActivitiesQuery` (Task 5, `activities-query.ts`); `loadActivitiesPage`, `ActivityRow` (Task 5); `requireSalesPage`, `ShortcutsButton` (Task 6); `NextStepPill`, `OwnerAvatar`, `getActivitiesPage`, `appendPage` (Task 7); `useActivityDone` (Task 8); `ACTIVITY_TYPE_LABELS`.
- Produces: `activitiesEmptyState(query: { when: ActivitiesQuery["when"]; type: ActivitiesQuery["type"] }): { title: string; description: string; action: { label: string; href: string } }`.

- [ ] **Step 1: Write the failing test** `tests/lib/sales/activities-client.test.ts`

```ts
it.each([
  ["open", { title: "Nothing to do", description: "Activities you plan on a deal show up here.", action: { label: "Open Deals", href: "/sales/deals" } }],
  ["overdue", { title: "Nothing overdue", description: "You are all caught up.", action: { label: "See what is due today", href: "/sales/activities?when=today" } }],
  ["today", { title: "Nothing due today", description: "Plan your next calls from the Deals board.", action: { label: "Open Deals", href: "/sales/deals" } }],
  ["done", { title: "Nothing done yet", description: "Tick an activity's circle when it is done and it lands here.", action: { label: "See what is to do", href: "/sales/activities" } }],
] as const)("empty state for %s", (when, expected) => expect(activitiesEmptyState({ when, type: "all" })).toEqual(expected));
it("offers to clear a type filter", () =>
  expect(activitiesEmptyState({ when: "open", type: "MEETING" })).toEqual({
    title: "No meeting activities here",
    description: "Other types may still have work waiting.",
    action: { label: "Show all types", href: "/sales/activities" },
  }));
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/sales/activities-client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `activities-client.ts`**, then run the test: PASS.

- [ ] **Step 4: Build the page (mockup `viewActivities`)**

- `page.tsx`: `requireSalesPage()`, `await searchParams`, `parseActivitiesQuery`, `loadActivitiesPage(actor, query, new Date())`, render `<ActivitiesView />`.
- Header: h1 "Activities", sub "Calls, meetings and tasks across all your deals."; right side Everyone | Just me (only when `canSeeEveryone`) and `ShortcutsButton`.
- Filters: segmented "To do" / "Overdue" / "Today" / "Done" (`aria-pressed`), and "All" plus six icon-only type buttons (`aria-label` and `title` the type name). Changes update the URL with `router.replace("?" + activitiesQueryToSearch({ ...query, ...patch, cursor: null }), { scroll: false })`.
- Table (mockup columns Done, Subject, Deal, Due, Owner): Done cell is the round check button (`aria-label="Mark done: {subject}"`, stops row click) or a success pill with a check for done rows; Subject with the type icon; Deal title; Due via `NextStepPill` (or muted "Done"); Owner avatar. Row click opens the deal panel (`?deal=<id>` on this page). Ticking uses `useActivityDone` (toast "Marked done.", next-step prompt). "Show more" (when `nextCursor`) calls `getActivitiesPage({ ...query, cursor: nextCursor })` and appends with `appendPage`, with the same loading, failure and reset-on-new-server-rows behaviour as Task 7's list view (Decision 33).
- Empty: `EmptyState` with lucide `CalendarCheck` and `activitiesEmptyState(query)`, the action as a link button.
- 375px: rows become stacked cards (mockup `.t.cards`) with the check at top left, labels "Deal:", "Due:", "Owner:"; filter rows wrap; the check keeps a 40px hit area.
- `loading.tsx`: header skeleton, two segmented-control skeletons, then six `RowSkeleton withAvatar` rows inside a bordered box (the existing tasks loading pattern).

- [ ] **Step 5: Finish gate** (`npx tsc --noEmit`, `npx eslint src scripts tests`, `npm test`): all pass.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/sales/activities/page.tsx" "src/app/(app)/sales/activities/loading.tsx" src/lib/sales/activities-client.ts src/components/sales/activities-view.tsx tests/lib/sales/activities-client.test.ts
git commit -m "feat(sales): activities page with filters and the next-step prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Plan finish gate (controller)

- [ ] Run `npx tsc --noEmit`, `npx eslint src scripts tests`, `npm test`, `npm run build:ci`. Expected: all exit 0 (tsc only pre-existing `.next/`/`scratch/` errors); record the test count.
- [ ] `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` on dev: empty migration.
- [ ] `git show --stat` for every Plan 2 commit: none contains `scratch/`, `"Sales Module Handoff/"`, `SECURITY_AUDIT.md`, `src/lib/email.ts`, `src/app/api/me/notification-preferences/test-email/`, `SESSION_NOTES.md`, or `docs/` other than this plan.
- [ ] `grep -rn "notify\|slack" src/lib/sales src/app/api/sales src/app/api/cron/sales-no-show src/components/sales` finds nothing.
- [ ] Click-through on dev (controller only, `SLACK_BOT_TOKEN` blanked through a temporary `.env.development.local`, deleted after), at 375px, 768px and 1280px, light and dark: a member without Sales sees no Sales group, the page source of `/dashboard` for them contains neither "Sales" nor "/sales", and they get 404 on `/sales/deals`, `/sales/activities` and `/sales/deals?deal=<id>`; the board, list with "Show more", filters, Everyone/Just me, remembered view (Board and Everyone clicks from a bare `/sales/deals` stick); the deal panel is full screen at 375px and 560px wide at 1280px; mouse drag, keyboard drag (Space, arrows, Space) and the long-press menu; $0 to Proposal Sent opens the value dialog; Won/Lost drop zones and Undo; No Show adds the reschedule call; the panel (rename, value, owner, stage bar, composer, Mark done and the next-step prompt, custom fields, territory hold infobar, history with a note, read-only view for a non-owner); Activities filters and "Show more"; `/`, `n`, `e`, `t`, `Esc`, `?`; Team page delete refusal toast; no horizontal page scroll anywhere; console free of new errors.
- [ ] Update `SESSION_NOTES.md` (not committed): Plan 2 done, what Plan 3 picks up (Leads, Contacts, files, dashboard, settings incl. Ruling 24 and per-stage rotting days, HighLevel, bots UI). Do not push.

---

## Plan review rulings

An independent review raised 10 issues (all Important). Each was checked against the code and the spec before changing the plan. None was wrong, so none is rejected; all 10 are folded into the tasks above. Where the plan went further than the suggested fix, or chose between the offered options, the reason is here.

1. **Panel width (Task 8).** Confirmed: `twMerge("data-[side=right]:w-3/4 data-[side=right]:sm:max-w-sm", "w-full sm:max-w-[560px]")` keeps both pairs, and the attribute selector wins. Fixed as suggested, with the class string held in `DEAL_PANEL_SHEET_CLASS` and a merge test so a later edit cannot quietly bring the bug back.
2. **Card order (Tasks 2, 7).** Took the recommended option: newest in stage first (Decision 31). It keeps a just-moved card visible in a full column, which matters more for dragging than having idle deals on top; the list view and the rotting pill still surface idle deals.
3. **"Show more" (Tasks 2, 5, 7, 9).** Fixed as suggested (two GET routes, two api-client fetchers, append on the client). Added: a client-safe `activities-query.ts` with `activitiesQueryToSearch`, because Task 9's filter links and `getActivitiesPage` both need a serializer that the server-only `activities-page.ts` cannot provide; and `appendPage` dedupes by id, since a refresh can shift a row across the page boundary.
4. **Activities visibility (Tasks 5, 3).** Fixed as suggested, including the optional part: an owner change moves the old owner's open activities on the deal. Recorded as `movedActivityIds` on the single `owner_changed` row (same transaction) rather than one row per activity, so the timeline still reads "Owner changed to Ben S." once. Without the move, the sidebar's due count (which filters by activity owner) would keep counting to-dos on a deal its owner can no longer open.
5. **Sidebar secrecy (Task 6).** Fixed, slightly stricter than suggested: the prop is the generic `navGroup` with neutral icon keys (`board`, `calendar`) instead of `salesNav` with `deals`/`activities`, because prop names and object keys survive minification, so `salesNav` would itself name Sales in the bundle Robert downloads. The guard test bans `/sales/i` and `/deals/i` in the sidebar and top bar.
6. **Missing Popover and AlertDialog (Task 7).** Took the second option: the existing `DropdownMenu` radio groups for Filter and the existing `Dialog` for the delete confirm. Nothing in the mockup needs a free-form popover, and it keeps Task 7 from adding ui primitives no other screen uses. The "every created file is staged" rule is now a Global Constraint, with a `git status` check in Task 7's gate.
7. **Saved-view race (Task 7).** Fixed as suggested with `nextBoardQuery` and its test.
8. **CSRF (Task 2 and every mutating route).** Fixed as suggested. Spec 3.4 says "CSRF token", while 18.3 (the later, implementation-level section) settles on "SameSite cookies + `Origin` header check"; the plan follows 18.3. Extended to Plan 1's four cookie-session mutating handlers (settings PATCH, bots POST, bot PATCH and POST), which had the same gap, and enforced by a guard test over every `route.ts` under `src/app/api/sales/`. A missing `Origin` passes (non-browser clients; SameSite=Lax still covers browsers), an `Origin` of `null` is refused.
9. **Deletion attempts (Task 3).** Fixed as suggested and listed in the panel timeline. `archiveDeal` checks visibility itself instead of using `findDealForEdit`; otherwise a non-owner who can see the deal would get "Only the deal owner..." before the delete check and no row would be written. Refused attempts on deals the person cannot see stay 404 with no row, so random ids cannot fill the log.
10. **Organization and person history (Task 3).** Fixed as suggested; the person's row also carries `organizationId`. Picking an existing organization or person writes no extra row.
