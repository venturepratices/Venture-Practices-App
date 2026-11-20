# HighLevel lead link (Plan 3B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A new HighLevel lead lands in the Sales Leads Inbox on its own, and its owner is told in the app and on Slack, so Pipedrive's lead hand-off and text alert can be switched off.

**Architecture:** One public webhook route proves the sender with a shared secret, parses HighLevel's payload tolerantly, and creates (or finds) the lead in one transaction under the "webhook" system actor. The owner comes from the existing lead rotation. The alert goes through the existing `notify()`.

**Tech Stack:** Next.js route handler, Prisma interactive transaction, zod-free tolerant parser, vitest.

**Spec:** `Sales Module Handoff/sales-module-spec.md` section 9.1 (endpoint, header, env var, payload, dedupe, first activity, error rule). `docs/sales-pipedrive-cutover.md` step 7.

## Global Constraints

- Endpoint `POST /api/webhooks/leads/intake`; secret in header `x-shared-secret` or body `customData.secret`; env var `WEBHOOK_INBOUND_SECRET`; compared only with `safeEqualSecret` (`src/lib/secret-compare.ts`).
- No new database migration. No secret ever logged, returned, or stored.
- No em dashes in any text DJ will read. Plain words in docs.
- Lead source must be one of `DEAL_SOURCES`. First activity subject: `Reach out within 1 business day`, due the next business day, date only.
- Alert goes to the lead's owner only (a person who already has Sales access). No channel post.

## Rulings (decided here, cost if wrong in brackets)

- Wrong secret answers 401, not 200, so a broken setup shows red in HighLevel (none).
- Payload we cannot use answers 200 with `{ error }` (spec: no retry). A crash answers 500 so HighLevel retries; the lock plus dedupe make a retry safe (none).
- `text_reply` is acknowledged and ignored; not needed to replace the new-lead alert (add later if wanted).
- A repeat of an active lead creates nothing and sends no alert (a real second inquiry stays on the one open lead).
- Runaway guard: refuse with 429 after 60 webhook-created leads in 10 minutes (a real burst that big is not expected).

## Review Focus

- Same contact fired twice at the same instant: exactly one lead.
- Payload with no name, only an email or phone: still a lead, named by the email or phone.
- Wrong, missing, empty or "undefined" secret, and secret env unset: never creates anything.
- Phone typed many ways ("(980) 203-4777", "+19802034777") matches the same person.
- Friday/Saturday/Sunday arrival: first activity lands on Monday.

---

### Task 1: Parse HighLevel's payload

**Files:** Create `src/lib/sales/lead-intake-payload.ts`; Test `tests/lib/sales/lead-intake-payload.test.ts`

**Interfaces:**
- Produces: `type LeadIntake = { ghlContactId: string | null; personName: string | null; email: string | null; phone: string | null; practiceName: string | null; practiceZip: string | null; formType: string | null }`
- Produces: `parseLeadIntake(body: unknown): { kind: "lead"; intake: LeadIntake } | { kind: "ignored"; reason: string } | { kind: "invalid"; error: string }`
- Produces: `intakeSecret(body: unknown): string | null` (the `customData.secret` string)
- Produces: `leadSourceFor(formType: string | null): (typeof DEAL_SOURCES)[number]`
- Produces: `nextBusinessDay(dateString: string): string` ("YYYY-MM-DD" in, "YYYY-MM-DD" out; Fri, Sat, Sun give Monday)

- [ ] **Step 1: Write failing tests** for: spec payload shape; HighLevel default shape (`contact_id`, `first_name`, `full_name`, `postal_code`, `company_name`, nested `contact`, `customData`); key spellings ("Practice Name", `practiceName`, `practice_name`); `event` missing means lead, `text_reply` ignored, unknown event invalid; no name but email gives `personName` = email; nothing usable gives invalid; bad email dropped; long values capped; `leadSourceFor` maps referral, direct, default "Check Availability form"; `nextBusinessDay` for a Thursday, Friday, Saturday, Sunday.
- [ ] **Step 2: Run** `npx vitest run tests/lib/sales/lead-intake-payload.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the four functions. Normalize every key to lower-case letters and digits, look in the top level, then `customData`, then `contact`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sales): parse the HighLevel lead payload`

### Task 2: Create or find the lead

**Files:** Modify `src/lib/sales/leads.ts` (export `writeLeadField`, widen its `actor` to `SalesActor | SalesSystemActor`); Create `src/lib/sales/lead-intake.ts`; Test `tests/lib/sales/lead-intake.test.ts`

**Interfaces:**
- Consumes: `LeadIntake`, `leadSourceFor`, `nextBusinessDay` (Task 1); `assignLeadOwner(tx)`; `recordLeadAudit`; `recordSalesAudit`; `personKeys`, `organizationKeys`, `emailKey`, `phoneKey`, `nameKey`
- Produces: `createLeadFromIntake(intake: LeadIntake, meta: Partial<SalesRequestMeta>, now: Date): Promise<{ created: true; leadId: string; ownerId: string; title: string } | { created: false; leadId: string }>`
- Produces: `intakeRateExceeded(now: Date): Promise<boolean>`
- Produces: `notifyIntakeOwner(args: { ownerId: string; leadId: string; title: string; intake: LeadIntake }): Promise<void>`

- [ ] **Step 1: Write failing tests** with a fake transaction: creates org, person (with email and phone keys), lead, ZIP value, first activity, and one audit row per record, all as `WEBHOOK`; reuses a person found by email, then by phone; reuses an organization found by name key plus ZIP; an active lead with the same contact id (or person email or phone) returns `created: false` and writes nothing; takes the advisory lock first; the rotation turn is taken only when a lead is created; Friday arrival due Monday; `intakeRateExceeded` true at 60.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement** `createLeadFromIntake` as one `prisma.$transaction(..., { timeout: 10_000 })`: lock with `SELECT pg_advisory_xact_lock(hashtextextended(key, 0))` through `$executeRaw`, find an active lead, else match or create contacts, assign the owner, create the lead, ZIP value, and first activity, writing history with the `{ system: "webhook" }` actor. `notifyIntakeOwner` calls `notify()` with type `ASSIGNED`, entity type `Lead`, link `/sales/leads?lead=<id>`.
- [ ] **Step 4: Run** the test. Expected: PASS. Also run `tests/lib/sales/leads*.test.ts` to prove the `leads.ts` change broke nothing.
- [ ] **Step 5: Commit** `feat(sales): create a lead from a HighLevel opt-in`

### Task 3: The public route

**Files:** Create `src/app/api/webhooks/leads/intake/route.ts`; Modify `tests/lib/api-route-auth-guard.test.ts` (the `webhooks` rule's `who` text no longer says "no routes yet"); Test `tests/lib/sales/lead-intake-route.test.ts`

**Interfaces:**
- Consumes: Task 1 and Task 2 exports; `safeEqualSecret`
- Produces: `POST` handler returning `{ lead_id, created }` with 200

- [ ] **Step 1: Write failing tests** for the route: env unset gives 503 and creates nothing; wrong, missing and empty secret give 401; header secret works; `customData.secret` works; body over 32 KB gives 413; non-JSON gives 400; `text_reply` gives 200 `{ ignored: true }`; unusable payload gives 200 `{ error }`; rate guard gives 429; success gives 200 `{ lead_id, created: true }` and calls `notifyIntakeOwner` once; a repeat gives `created: false` and no alert; a thrown database error gives 500 with no detail in the body.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement** the handler (`runtime = "nodejs"`, `dynamic = "force-dynamic"`): size check, JSON parse, secret check with the answer used, rate guard, parse, create, alert after the transaction, never echo the body.
- [ ] **Step 4: Run** the route test and `tests/lib/api-route-auth-guard.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sales): HighLevel lead webhook route`

### Task 4: Docs, env, and gates

**Files:** Modify `.env.example`, `docs/credentials.md`, `docs/sales-pipedrive-cutover.md` (step 7 points to the new guide); Create `docs/sales-highlevel-lead-link.md` (plain words: the Vercel step, the HighLevel workflow step with the exact fields, the key's safety checklist, how to test, how to switch off, how to go back)

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run** `npx tsc --noEmit`, `npx eslint` on changed files, full `npx vitest run`, `npm run build:ci`, `npm run check:sales-secrecy`. Expected: all clean.
- [ ] **Step 3: Commit** `docs(sales): HighLevel lead link guide and env`
