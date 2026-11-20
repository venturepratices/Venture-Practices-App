import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import type { SalesActivityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { DEAL_SOURCES, LOST_REASONS } from "@/lib/sales/constants";
import { nameKey, personKeys } from "@/lib/sales/contact-keys";
import { ensureSalesSeed } from "@/lib/sales/seed";
import { addDaysToDateString, endOfDay, todayDateString, zonedDateTime } from "@/lib/utils";

/** The prefix every demo row starts with, so a clean-up can always find them. */
export const TEST_PREFIX = "TEST ";

// Practice data for the Revenue Team. Everything is clearly dummy: every
// name, title and subject starts with "TEST ", emails are on example.com, phones
// are in the 555-01xx range. Run through the admin-only API route
// /api/sales/admin/demo-data (POST = seed, DELETE = remove).
//
// Safe to run twice: each row is looked up by its own name, title or subject
// first, and only what is missing is made. It runs as ONE database transaction,
// so a failure part way leaves nothing behind.
//
// The Deals board, Activities and Marketing Inbox read plain rows. Notes and the
// History tab read the locked history log (SalesAuditLog), so each new row also
// gets the history lines the app itself would have written, dated to match.
// Those lines are marked requestId "sandbox-seed". The database refuses to
// delete history rows (by design), so a clean-up leaves them behind; they point
// at rows that no longer exist and show nowhere.

// ---------------------------------------------------------------------------
// Dates. Everything is set relative to "today in app time" (America/New_York).
// ---------------------------------------------------------------------------

const TODAY = todayDateString();
const dayString = (offsetDays: number) => addDaysToDateString(TODAY, offsetDays);
/** A moment `ago` days back (negative = in the future) at a wall-clock time in app time. */
const moment = (ago: number, time = "09:30") => zonedDateTime(dayString(-ago), time);
/** An all-day due date: the end of that day in app time, which is how the app stores "no time chosen". */
const endOfDayAgo = (ago: number) => endOfDay(dayString(-ago));

type Owner = "dj" | "ben" | "andrea";

// ---------------------------------------------------------------------------
// The practice data
// ---------------------------------------------------------------------------

const ORGS: { name: string; street: string; zip: string; slug: string; owner: Owner }[] = [
  { name: "TEST Maple Grove Dental", street: "101 Example Ave", zip: "28105", slug: "maplegrove", owner: "dj" },
  { name: "TEST Bright Smiles Family Dentistry", street: "212 Sample Street", zip: "28078", slug: "brightsmiles", owner: "ben" },
  { name: "TEST Oak Creek Orthodontics", street: "33 Practice Lane", zip: "28212", slug: "oakcreek", owner: "dj" },
  { name: "TEST Lakeside Dental Care", street: "480 Lakeview Drive", zip: "28277", slug: "lakeside", owner: "andrea" },
  { name: "TEST Pinecrest Pediatric Dentistry", street: "59 Pinecrest Road", zip: "28203", slug: "pinecrest", owner: "ben" },
  { name: "TEST Summit Dental Group", street: "600 Summit Boulevard", zip: "28226", slug: "summit", owner: "dj" },
  { name: "TEST Riverbend Smiles", street: "71 Riverbend Court", zip: "28269", slug: "riverbend", owner: "ben" },
  { name: "TEST Harbor View Dental", street: "88 Harbor Way", zip: "28036", slug: "harborview", owner: "dj" },
  { name: "TEST Cedar Park Dentistry", street: "9 Cedar Park Circle", zip: "28104", slug: "cedarpark", owner: "ben" },
  { name: "TEST Willow Lane Dental", street: "145 Willow Lane", zip: "28270", slug: "willowlane", owner: "dj" },
  { name: "TEST Northgate Orthodontics", street: "2020 Northgate Plaza", zip: "28262", slug: "northgate", owner: "ben" },
  { name: "TEST Sunrise Family Dental", street: "17 Sunrise Terrace", zip: "28210", slug: "sunrise", owner: "andrea" },
];

// Phones: (704) 555-0101 to 0112 for the practices, 0113 to 0128 for people.
const orgPhone = (i: number) => `(704) 555-01${String(1 + i).padStart(2, "0")}`;
const personPhone = (i: number) => `(704) 555-01${String(13 + i).padStart(2, "0")}`;

const PEOPLE: { first: string; last: string; org: number; role: string }[] = [
  { first: "Sarah", last: "K", org: 0, role: "Practice owner" },
  { first: "Mark", last: "D", org: 0, role: "Office manager" },
  { first: "Priya", last: "N", org: 1, role: "Dentist" },
  { first: "Tom", last: "R", org: 1, role: "Office manager" },
  { first: "Elena", last: "V", org: 2, role: "Orthodontist" },
  { first: "James", last: "W", org: 2, role: "Marketing director" },
  { first: "Carla", last: "M", org: 3, role: "Practice owner" },
  { first: "Devon", last: "S", org: 3, role: "Front desk lead" },
  { first: "Hannah", last: "L", org: 4, role: "Dentist" },
  { first: "Omar", last: "F", org: 5, role: "Practice owner" },
  { first: "Grace", last: "T", org: 6, role: "Office manager" },
  { first: "Victor", last: "B", org: 7, role: "Practice owner" },
  { first: "Nina", last: "P", org: 8, role: "Dentist" },
  { first: "Luis", last: "G", org: 9, role: "Office manager" },
  { first: "Megan", last: "C", org: 10, role: "Practice owner" },
  { first: "Aaron", last: "H", org: 11, role: "Orthodontist" },
];
const personName = (i: number) => `${TEST_PREFIX}${PEOPLE[i].first} ${PEOPLE[i].last}.`;
const orgShort = (i: number) => ORGS[i].name.slice(TEST_PREFIX.length);

type PipelineKey = "direct-mail" | "new-mover-mail" | "marketing-agency";
const PIPELINE_LABEL: Record<PipelineKey, string> = {
  "direct-mail": "Direct Mail",
  "new-mover-mail": "New Mover Mail",
  "marketing-agency": "Marketing Agency",
};

type DealSeed = {
  ref: string;
  pipeline: PipelineKey;
  /** Stage key (kebab-case of the stage name, see src/lib/sales/seed-data.ts). */
  stage: string;
  org: number;
  /** Index into PEOPLE; the practice's first person when left out. */
  person?: number;
  owner: Owner;
  createdAgo: number;
  /** Days ago the deal entered its current stage; the day it was created when left out. */
  enteredAgo?: number;
  valueCents?: number;
  mrrCents?: number;
  source: (typeof DEAL_SOURCES)[number];
  /** Days from today; negative = in the past; null = no close date. */
  closeIn: number | null;
  won?: { ago: number };
  lost?: { ago: number; reason: (typeof LOST_REASONS)[number]; comment: string };
  /** Custom field values by field key. A "+N" value on a date field means N days from today. */
  fields?: Record<string, string>;
  /** Made by converting this lead (LEADS[ref]). */
  fromLead?: string;
};

const DEALS: DealSeed[] = [
  // Direct Mail
  { ref: "D01", pipeline: "direct-mail", stage: "new-opt-in", org: 0, owner: "dj", createdAgo: 5, source: "Check Availability form", closeIn: 45 },
  { ref: "D02", pipeline: "direct-mail", stage: "new-opt-in", org: 1, owner: "ben", createdAgo: 3, source: "Check Availability form", closeIn: 50 },
  { ref: "D03", pipeline: "direct-mail", stage: "appointment-scheduled", org: 2, owner: "dj", createdAgo: 12, enteredAgo: 4, source: "Referral", closeIn: 30 },
  { ref: "D04", pipeline: "direct-mail", stage: "appointment-scheduled", org: 3, owner: "andrea", createdAgo: 9, enteredAgo: 6, source: "Direct inquiry", closeIn: 35 },
  { ref: "D05", pipeline: "direct-mail", stage: "no-show", org: 4, owner: "ben", createdAgo: 15, enteredAgo: 1, source: "Check Availability form", closeIn: 40 },
  { ref: "D06", pipeline: "direct-mail", stage: "demo-complete", org: 5, owner: "dj", createdAgo: 20, enteredAgo: 11, source: "Outbound", closeIn: 25, fields: { "how-would-you-like-to-start": "Not sure yet" } },
  { ref: "D07", pipeline: "direct-mail", stage: "demo-complete", org: 6, owner: "ben", createdAgo: 18, enteredAgo: 7, source: "Referral", closeIn: 20 },
  {
    ref: "D08", pipeline: "direct-mail", stage: "proposal-sent", org: 7, owner: "dj", createdAgo: 30, enteredAgo: 8,
    valueCents: 450000, mrrCents: 37500, source: "Check Availability form", closeIn: 14,
    fields: { "target-start-date": "+40", "mailing-count": "3", "how-would-you-like-to-start": "90-day trial" },
  },
  // The one that sits too long in its stage: 34 days in Follow-Up (a stage turns amber at 14).
  { ref: "D09", pipeline: "direct-mail", stage: "follow-up", org: 8, owner: "ben", createdAgo: 41, enteredAgo: 34, valueCents: 360000, mrrCents: 30000, source: "Direct inquiry", closeIn: 9 },
  {
    ref: "D10", pipeline: "direct-mail", stage: "contract-signed", org: 9, owner: "dj", createdAgo: 33, enteredAgo: 3,
    valueCents: 480000, mrrCents: 40000, source: "Referral", closeIn: -3, won: { ago: 3 },
    fields: { "target-start-date": "+20", "mailing-count": "6", "mailing-number": "1", "how-would-you-like-to-start": "Full program" },
  },
  { ref: "D11", pipeline: "direct-mail", stage: "sent-to-onboarding", org: 10, owner: "ben", createdAgo: 40, enteredAgo: 12, valueCents: 390000, mrrCents: 32500, source: "Check Availability form", closeIn: -12, won: { ago: 12 } },
  {
    ref: "D12", pipeline: "direct-mail", stage: "follow-up", org: 11, owner: "dj", createdAgo: 37, enteredAgo: 15, valueCents: 420000, mrrCents: 35000,
    source: "Direct inquiry", closeIn: null, lost: { ago: 6, reason: "Price", comment: "Went with a cheaper local printer." },
  },
  // New Mover Mail
  { ref: "N01", pipeline: "new-mover-mail", stage: "new-lead-check-availability", org: 5, owner: "ben", createdAgo: 2, source: "Check Availability form", closeIn: 55 },
  { ref: "N02", pipeline: "new-mover-mail", stage: "new-lead-check-availability", org: 1, person: 3, owner: "dj", createdAgo: 4, source: "Check Availability form", closeIn: 48, fromLead: "L7" },
  { ref: "N03", pipeline: "new-mover-mail", stage: "demo-scheduled", org: 7, owner: "ben", createdAgo: 10, enteredAgo: 3, source: "Referral", closeIn: 28 },
  { ref: "N04", pipeline: "new-mover-mail", stage: "demo-scheduled", org: 2, person: 5, owner: "andrea", createdAgo: 8, enteredAgo: 5, source: "Direct inquiry", closeIn: 33 },
  {
    ref: "N05", pipeline: "new-mover-mail", stage: "proposal-sent", org: 9, owner: "ben", createdAgo: 28, enteredAgo: 9,
    valueCents: 540000, mrrCents: 45000, source: "Referral", closeIn: 12, fields: { "mailing-count": "4" },
  },
  { ref: "N06", pipeline: "new-mover-mail", stage: "follow-up", org: 3, person: 7, owner: "dj", createdAgo: 25, enteredAgo: 6, valueCents: 300000, mrrCents: 25000, source: "Check Availability form", closeIn: 6 },
  { ref: "N07", pipeline: "new-mover-mail", stage: "deal-won", org: 10, owner: "andrea", createdAgo: 41, enteredAgo: 26, valueCents: 360000, mrrCents: 30000, source: "Check Availability form", closeIn: -26, won: { ago: 26 } },
  // Marketing Agency Services
  { ref: "M01", pipeline: "marketing-agency", stage: "discovery-call-booked", org: 4, owner: "dj", createdAgo: 3, source: "Direct inquiry", closeIn: 60 },
  { ref: "M02", pipeline: "marketing-agency", stage: "discovery-call-booked", org: 6, owner: "ben", createdAgo: 6, source: "Outbound", closeIn: 58 },
  { ref: "M03", pipeline: "marketing-agency", stage: "discovery-call-completed", org: 0, person: 1, owner: "andrea", createdAgo: 13, enteredAgo: 5, source: "Referral", closeIn: 45 },
  { ref: "M04", pipeline: "marketing-agency", stage: "disc-and-values-debrief-scheduled", org: 8, owner: "ben", createdAgo: 22, enteredAgo: 4, source: "Outbound", closeIn: 32 },
  {
    ref: "M05", pipeline: "marketing-agency", stage: "proposal-sent", org: 11, owner: "dj", createdAgo: 29, enteredAgo: 7,
    valueCents: 1800000, mrrCents: 150000, source: "Referral", closeIn: 21,
    fields: { "engagement-type": "Growth strategy", term: "6", "fee-structure": "Monthly retainer", "target-start-date": "+35" },
  },
  {
    ref: "M06", pipeline: "marketing-agency", stage: "deal-lost-nurture", org: 2, owner: "ben", createdAgo: 38, enteredAgo: 9, valueCents: 1200000, mrrCents: 100000,
    source: "Direct inquiry", closeIn: null, lost: { ago: 9, reason: "Not ready yet", comment: "Revisit in the spring." },
  },
];
const dealTitle = (d: DealSeed) => `${TEST_PREFIX}${orgShort(d.org)} - ${PIPELINE_LABEL[d.pipeline]}`;

type LeadSeed = {
  ref: string;
  /** Title; a converted lead uses the title of the deal it became. */
  title: string;
  owner: Owner;
  createdAgo: number;
  source: (typeof DEAL_SOURCES)[number];
  org?: number;
  person?: number;
  status?: "CONVERTED" | "ARCHIVED";
  convertedDeal?: string;
  fields?: Record<string, string>;
};

const LEADS: LeadSeed[] = [
  {
    ref: "L1", title: "TEST Check Availability: Evergreen Dental", owner: "dj", createdAgo: 1, source: "Check Availability form",
    fields: { "form-source": "Check Availability", "practice-zip": "28105", "practice-name": "Evergreen Dental" },
  },
  {
    ref: "L2", title: "TEST Check Availability: Lakeview Family Dentistry", owner: "ben", createdAgo: 2, source: "Check Availability form",
    fields: { "form-source": "Check Availability", "practice-zip": "28078", "practice-name": "Lakeview Family Dentistry" },
  },
  { ref: "L3", title: "TEST Referral: Riverbend Smiles", owner: "andrea", createdAgo: 4, source: "Referral", org: 6, person: 10, fields: { "form-source": "Referral" } },
  {
    ref: "L4", title: "TEST Direct inquiry: Hillcrest Dental", owner: "dj", createdAgo: 6, source: "Direct inquiry",
    fields: { "form-source": "Direct inquiry", "practice-zip": "28212" },
  },
  { ref: "L5", title: "TEST Outbound: Cedar Park follow-up", owner: "ben", createdAgo: 9, source: "Outbound", org: 8, person: 12 },
  { ref: "L6", title: "TEST Added by hand: Parkway Orthodontics", owner: "andrea", createdAgo: 12, source: "Added by hand" },
  { ref: "L7", title: "", owner: "dj", createdAgo: 5, source: "Check Availability form", org: 1, person: 3, status: "CONVERTED", convertedDeal: "N02" },
  { ref: "L8", title: "TEST Outbound: Spam-looking inquiry", owner: "ben", createdAgo: 20, source: "Outbound", status: "ARCHIVED" },
];

type ActivitySeed = {
  /** The deal (D.., N.., M..) or lead (L..) it is on. */
  on: string;
  type: SalesActivityType;
  subject: string;
  /** Days ago it is due; negative = in the future. */
  dueAgo: number;
  /** Wall-clock time in app time; omitted = an all-day activity (hasTime false). */
  time?: string;
  /** Days ago it was ticked done. */
  doneAgo?: number;
  createdBy?: "rule:no-show";
  /** Also still points at the lead it came from (a converted lead's call moved to the deal). */
  alsoLead?: string;
};

const ACTIVITIES: ActivitySeed[] = [
  // Overdue
  { on: "D08", type: "CALL", subject: "TEST Call: follow up on the proposal", dueAgo: 3, time: "10:00" },
  { on: "D09", type: "CALL", subject: "TEST Call: try a different contact at the practice", dueAgo: 8, time: "14:00" },
  { on: "D06", type: "EMAIL", subject: "TEST Email: send the pricing sheet", dueAgo: 1, time: "16:00" },
  { on: "L2", type: "EMAIL", subject: "TEST Email: ask which ZIP codes they mail to", dueAgo: 2 },
  // Due today
  { on: "D03", type: "MEETING", subject: "TEST Meeting: demo with the office team", dueAgo: 0, time: "14:00" },
  { on: "D01", type: "TASK", subject: "TEST Task: send the welcome packet", dueAgo: 0 },
  { on: "D05", type: "CALL", subject: "TEST Reschedule the missed demo", dueAgo: 0, createdBy: "rule:no-show" },
  { on: "N02", type: "CALL", subject: "TEST Call: first call after conversion", dueAgo: 0, alsoLead: "L7" },
  { on: "L3", type: "CALL", subject: "TEST Call: first contact with the practice", dueAgo: 0, time: "11:00" },
  // Upcoming
  { on: "D07", type: "LUNCH", subject: "TEST Lunch: meet the practice owner", dueAgo: -5, time: "12:00" },
  { on: "N05", type: "DEADLINE", subject: "TEST Deadline: proposal expires", dueAgo: -3 },
  { on: "N06", type: "EMAIL", subject: "TEST Email: send the contract draft", dueAgo: -4, time: "10:00" },
  { on: "N03", type: "CALL", subject: "TEST Call: confirm the demo time", dueAgo: -1, time: "15:00" },
  { on: "M01", type: "CALL", subject: "TEST Call: prep for the discovery call", dueAgo: -1, time: "09:30" },
  { on: "M04", type: "MEETING", subject: "TEST Meeting: DISC and values debrief", dueAgo: -2, time: "11:00" },
  { on: "M05", type: "TASK", subject: "TEST Task: send the engagement letter", dueAgo: -6 },
  { on: "L1", type: "TASK", subject: "TEST Task: look up the practice online", dueAgo: -1 },
  { on: "L5", type: "MEETING", subject: "TEST Meeting: coffee with the practice owner", dueAgo: -4, time: "10:00" },
  // Done (these feed the "Activities completed per person" chart)
  { on: "D10", type: "CALL", subject: "TEST Call: intro call", dueAgo: 5, time: "11:00", doneAgo: 5 },
  { on: "D11", type: "MEETING", subject: "TEST Meeting: kickoff call", dueAgo: 14, time: "13:00", doneAgo: 14 },
  { on: "D01", type: "EMAIL", subject: "TEST Email: sent the welcome email", dueAgo: 1, time: "09:00", doneAgo: 1 },
  { on: "D02", type: "CALL", subject: "TEST Call: quick check in", dueAgo: 2, time: "10:30", doneAgo: 2 },
  { on: "D12", type: "CALL", subject: "TEST Call: ask why they went elsewhere", dueAgo: 6, time: "15:00", doneAgo: 6 },
  { on: "N07", type: "TASK", subject: "TEST Task: hand over to onboarding", dueAgo: 26, doneAgo: 26 },
  { on: "D06", type: "MEETING", subject: "TEST Meeting: demo for Summit Dental Group", dueAgo: 11, time: "14:00", doneAgo: 11 },
  { on: "D07", type: "MEETING", subject: "TEST Meeting: demo for Riverbend Smiles", dueAgo: 7, time: "11:30", doneAgo: 7 },
  { on: "D08", type: "MEETING", subject: "TEST Meeting: proposal walkthrough", dueAgo: 9, time: "10:00", doneAgo: 9 },
  { on: "M03", type: "CALL", subject: "TEST Call: discovery call", dueAgo: 5, time: "13:30", doneAgo: 5 },
];

type NoteSeed = {
  on: string;
  kind: "deal" | "lead" | "person" | "organization";
  body: string;
  /** For a person or organization note: the index in PEOPLE / ORGS. */
  index?: number;
  ago: number;
  pinned?: boolean;
};

const NOTES: NoteSeed[] = [
  { on: "D08", kind: "deal", body: "TEST note: asked about pricing for 3 locations", ago: 9, pinned: true },
  { on: "D03", kind: "deal", body: "TEST note: office manager prefers calls after 2 PM", ago: 10 },
  { on: "D09", kind: "deal", body: "TEST note: went quiet after the proposal, try a different contact", ago: 20 },
  { on: "M05", kind: "deal", body: "TEST note: wants a 6 month term, talk through the fee structure", ago: 7 },
  { on: "D10", kind: "deal", body: "TEST note: signed on a call, start date set for next month", ago: 3, pinned: true },
  { on: "L3", kind: "lead", body: "TEST note: referred by a current client", ago: 4 },
  { on: "person", kind: "person", index: 0, body: "TEST note: best reached on her cell, not the front desk", ago: 15 },
  { on: "org", kind: "organization", index: 0, body: "TEST note: two locations, the second office opens in the spring", ago: 14 },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export type DemoSeedSummary = {
  made: {
    organizations: number;
    people: number;
    leads: number;
    deals: number;
    activities: number;
    notes: number;
    customFieldValues: number;
    auditRows: number;
    teamMembers: number;
  };
  today: string;
};

/**
 * Add TEST * demo rows to the Revenue Team. Admin-triggered. Idempotent:
 * each row is looked up by its own name, title or subject first, so a re-run
 * only fills in what is missing.
 */
export async function seedDemoData(): Promise<DemoSeedSummary> {
  // Make sure the Sales pipelines, stages and custom fields exist first. Safe to
  // re-run: ensureSalesSeed only adds what is missing.
  await ensureSalesSeed();

  const summary = await prisma.$transaction(
    async (tx) => {
      const made = { organizations: 0, people: 0, leads: 0, deals: 0, activities: 0, notes: 0, customFieldValues: 0, auditRows: 0, teamMembers: 0 };
      const auditRows: Prisma.SalesAuditLogCreateManyInput[] = [];

      // --- Owners: real dev team members who can use Sales (admins pass automatically) ---
      const eligible = await tx.teamMember.findMany({
        where: { OR: [{ isAdmin: true }, { canUseSales: true }] },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      });
      const byName = (name: string) => eligible.find((m) => m.name === name)?.id;
      const preferred: Record<Owner, string | undefined> = { dj: byName("DJ"), ben: byName("Ben"), andrea: byName("Andrea") };
      const found = Object.values(preferred).filter((v): v is string => !!v);
      let pool = found.length >= 2 ? found : eligible.map((m) => m.id);
      if (pool.length < 2) {
        // Only one person can use Sales: add one dummy rep with the least privilege that still lets them own deals.
        const repEmail = "test-sales-rep@example.com";
        let rep = await tx.teamMember.findUnique({ where: { email: repEmail }, select: { id: true } });
        if (!rep) {
          // A random password nobody knows, so this account cannot be signed into.
          const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
          rep = await tx.teamMember.create({
            data: { name: "TEST Sales Rep", email: repEmail, passwordHash, canUseSales: true, mustChangePassword: true },
            select: { id: true },
          });
          made.teamMembers += 1;
        }
        pool = [...pool, rep.id];
      }
      const ownerId = (key: Owner): string => preferred[key] ?? pool[["dj", "ben", "andrea"].indexOf(key) % pool.length];
      console.log(`Owners: ${[...new Set((["dj", "ben", "andrea"] as Owner[]).map(ownerId))].length} different people will own the practice data.`);

      // --- Pipelines, stages, custom fields (must already exist: seed-sales.ts makes them) ---
      const pipelines = await tx.salesPipeline.findMany({
        where: { key: { in: Object.keys(PIPELINE_LABEL) }, archivedAt: null },
        include: { stages: { where: { archivedAt: null } } },
      });
      const pipelineByKey = new Map(pipelines.map((p) => [p.key, p]));
      for (const key of Object.keys(PIPELINE_LABEL)) {
        if (!pipelineByKey.has(key)) throw new Error(`Pipeline "${key}" is missing. Run: npx tsx scripts/seed-sales.ts`);
      }
      const stageFor = (pipeline: PipelineKey, stageKey: string) => {
        const stage = pipelineByKey.get(pipeline)!.stages.find((s) => s.key === stageKey);
        if (!stage) throw new Error(`Stage "${stageKey}" is missing from pipeline "${pipeline}".`);
        return stage;
      };
      const firstStageOf = (pipeline: PipelineKey) => [...pipelineByKey.get(pipeline)!.stages].sort((a, b) => a.position - b.position)[0];
      const fields = new Map((await tx.salesCustomField.findMany({ where: { archivedAt: null } })).map((f) => [f.key, f]));
      const fieldFor = (key: string) => {
        const field = fields.get(key);
        if (!field) throw new Error(`Custom field "${key}" is missing. Run: npx tsx scripts/seed-sales.ts`);
        return field;
      };

      // --- When each practice first appears: as old as its oldest deal (+1 day), at most 42 days ---
      const orgCreatedAgo = ORGS.map((_, i) =>
        Math.min(42, Math.max(...DEALS.filter((d) => d.org === i).map((d) => d.createdAgo), 6) + 1),
      );

      // --- Organizations ---
      const existingOrgs = new Map(
        (await tx.salesOrganization.findMany({ where: { name: { startsWith: TEST_PREFIX } }, select: { id: true, name: true } })).map((o) => [o.name, o.id]),
      );
      const orgId: string[] = [];
      for (const [i, org] of ORGS.entries()) {
        const have = existingOrgs.get(org.name);
        if (have) {
          orgId[i] = have;
          continue;
        }
        const createdAt = moment(orgCreatedAgo[i], "08:45");
        const row = await tx.salesOrganization.create({
          data: {
            name: org.name,
            ownerId: ownerId(org.owner),
            address: `${org.street}, Anytown, NC ${org.zip}`,
            website: `https://${org.slug}.example.com`,
            phone: orgPhone(i),
            zip: org.zip,
            nameKey: nameKey(org.name),
            createdAt,
            updatedAt: createdAt,
          },
          select: { id: true },
        });
        orgId[i] = row.id;
        made.organizations += 1;
        auditRows.push(audit(ownerId(org.owner), "SalesOrganization", row.id, "created", createdAt, undefined, { name: org.name, ownerId: ownerId(org.owner), organizationId: null }));
      }

      // --- People ---
      const existingPeople = new Map(
        (await tx.salesPerson.findMany({ where: { name: { startsWith: TEST_PREFIX } }, select: { id: true, name: true } })).map((p) => [p.name, p.id]),
      );
      const personId: string[] = [];
      for (const [i, person] of PEOPLE.entries()) {
        const name = personName(i);
        const have = existingPeople.get(name);
        if (have) {
          personId[i] = have;
          continue;
        }
        const owner = ORGS[person.org].owner;
        const email = `test.${person.first.toLowerCase()}.${person.last.toLowerCase()}@example.com`;
        const phone = personPhone(i);
        const createdAt = moment(orgCreatedAgo[person.org], "09:15");
        const row = await tx.salesPerson.create({
          data: {
            name,
            organizationId: orgId[person.org],
            ownerId: ownerId(owner),
            email,
            phone,
            role: person.role,
            ...personKeys({ name, email, phone }),
            createdAt,
            updatedAt: createdAt,
          },
          select: { id: true },
        });
        personId[i] = row.id;
        made.people += 1;
        auditRows.push(audit(ownerId(owner), "SalesPerson", row.id, "created", createdAt, undefined, { name, ownerId: ownerId(owner), organizationId: orgId[person.org] }));
      }
      const firstPersonOfOrg = (org: number) => PEOPLE.findIndex((p) => p.org === org);

      // --- Deals ---
      const existingDeals = new Map(
        (await tx.salesDeal.findMany({ where: { title: { startsWith: TEST_PREFIX } }, select: { id: true, title: true } })).map((d) => [d.title, d.id]),
      );
      type Parent = { id: string; owner: string; personId: string | null; createdAt: Date; createdAgo: number; isNew: boolean };
      const dealRows = new Map<string, Parent>();
      const dealCreatedAt = (d: DealSeed) => moment(d.createdAgo, "09:30");
      // The deal comes first; a converted lead is made afterwards and points at it.
      for (const d of DEALS) {
        const title = dealTitle(d);
        const owner = ownerId(d.owner);
        const person = d.person ?? firstPersonOfOrg(d.org);
        const have = existingDeals.get(title);
        if (have) {
          dealRows.set(d.ref, { id: have, owner, personId: personId[person], createdAt: dealCreatedAt(d), createdAgo: d.createdAgo, isNew: false });
          continue;
        }
        const stage = stageFor(d.pipeline, d.stage);
        const createdAt = dealCreatedAt(d);
        const stageEnteredAt = moment(d.enteredAgo ?? d.createdAgo, d.enteredAgo === undefined ? "09:30" : "10:15");
        const wonAt = d.won ? moment(d.won.ago, "15:20") : null;
        const lostAt = d.lost ? moment(d.lost.ago, "16:05") : null;
        const updatedAt = new Date(Math.max(createdAt.getTime(), stageEnteredAt.getTime(), wonAt?.getTime() ?? 0, lostAt?.getTime() ?? 0));
        const row = await tx.salesDeal.create({
          data: {
            title,
            pipelineId: pipelineByKey.get(d.pipeline)!.id,
            stageId: stage.id,
            ownerId: owner,
            personId: personId[person],
            organizationId: orgId[d.org],
            valueCents: d.valueCents ?? 0,
            mrrCents: d.mrrCents ?? 0,
            status: d.won ? "WON" : d.lost ? "LOST" : "OPEN",
            lostReason: d.lost?.reason ?? null,
            lostComment: d.lost?.comment ?? null,
            source: d.source,
            stageEnteredAt,
            wonAt,
            lostAt,
            expectedCloseDate: d.closeIn === null ? null : endOfDay(dayString(d.closeIn)),
            createdAt,
            updatedAt,
          },
          select: { id: true },
        });
        dealRows.set(d.ref, { id: row.id, owner, personId: personId[person], createdAt, createdAgo: d.createdAgo, isNew: true });
        made.deals += 1;

        const first = firstStageOf(d.pipeline);
        auditRows.push(
          audit(owner, "SalesDeal", row.id, "created", createdAt, undefined, {
            title,
            pipelineId: pipelineByKey.get(d.pipeline)!.id,
            stageId: first.id,
            stageName: first.name,
            ownerId: owner,
            valueCents: d.valueCents ?? 0,
            mrrCents: d.mrrCents ?? 0,
            organizationId: orgId[d.org],
            personId: personId[person],
            source: d.source,
            ...(d.fromLead ? { fromLeadId: "(set below)" } : {}),
          }),
        );
        if (stage.id !== first.id) {
          auditRows.push(
            audit(owner, "SalesDeal", row.id, "stage_changed", stageEnteredAt,
              { stageId: first.id, stageName: first.name, stageEnteredAt: createdAt.toISOString() },
              { stageId: stage.id, stageName: stage.name }),
          );
        }
        if (d.won) auditRows.push(audit(owner, "SalesDeal", row.id, "status_changed", wonAt!, { status: "OPEN" }, { status: "WON" }));
        if (d.lost) {
          auditRows.push(
            audit(owner, "SalesDeal", row.id, "status_changed", lostAt!, { status: "OPEN" }, { status: "LOST", lostReason: d.lost.reason, lostComment: d.lost.comment }),
          );
        }
      }

      // --- Leads ---
      const existingLeads = new Map(
        (await tx.salesLead.findMany({ where: { title: { startsWith: TEST_PREFIX } }, select: { id: true, title: true } })).map((l) => [l.title, l.id]),
      );
      const leadRows = new Map<string, Parent>();
      for (const l of LEADS) {
        const title = l.convertedDeal ? dealTitle(DEALS.find((d) => d.ref === l.convertedDeal)!) : l.title;
        const owner = ownerId(l.owner);
        const createdAt = moment(l.createdAgo, "08:10");
        const person = l.person !== undefined ? personId[l.person] : null;
        const org = l.org !== undefined ? orgId[l.org] : null;
        const have = existingLeads.get(title);
        if (have) {
          leadRows.set(l.ref, { id: have, owner, personId: person, createdAt, createdAgo: l.createdAgo, isNew: false });
          continue;
        }
        const convertedDealRow = l.convertedDeal ? dealRows.get(l.convertedDeal) : undefined;
        const row = await tx.salesLead.create({
          data: {
            title,
            personId: person,
            organizationId: org,
            ownerId: owner,
            source: l.source,
            status: l.status ?? "OPEN",
            convertedDealId: convertedDealRow?.id ?? null,
            createdAt,
            updatedAt: createdAt,
          },
          select: { id: true },
        });
        leadRows.set(l.ref, { id: row.id, owner, personId: person, createdAt, createdAgo: l.createdAgo, isNew: true });
        made.leads += 1;
        auditRows.push(audit(owner, "SalesLead", row.id, "created", createdAt, undefined, { title, ownerId: owner, source: l.source, organizationId: org, personId: person }));
        if (l.status === "CONVERTED" && convertedDealRow) {
          auditRows.push(audit(owner, "SalesLead", row.id, "converted", convertedDealRow.createdAt, undefined, { dealId: convertedDealRow.id }));
        }
        if (l.status === "ARCHIVED") {
          auditRows.push(audit(owner, "SalesLead", row.id, "status_changed", moment(15, "11:00"), { status: "OPEN" }, { status: "ARCHIVED" }));
        }
      }
      // The deal made from a lead says which lead it came from in its history.
      for (const l of LEADS.filter((x) => x.convertedDeal)) {
        const deal = dealRows.get(l.convertedDeal!);
        const lead = leadRows.get(l.ref);
        if (!deal?.isNew || !lead) continue;
        const row = auditRows.find((r) => r.entityType === "SalesDeal" && r.entityId === deal.id && r.action === "created");
        if (row && row.after && typeof row.after === "object") (row.after as Record<string, unknown>).fromLeadId = lead.id;
      }

      // --- Activities ---
      const parentOf = (ref: string) => (ref.startsWith("L") ? { lead: leadRows.get(ref) } : { deal: dealRows.get(ref) });
      const existingActivities = new Set(
        (await tx.salesActivity.findMany({ where: { subject: { startsWith: TEST_PREFIX } }, select: { subject: true } })).map((a) => a.subject),
      );
      for (const a of ACTIVITIES) {
        if (existingActivities.has(a.subject)) continue;
        const parent = parentOf(a.on);
        const deal = "deal" in parent ? parent.deal : undefined;
        const lead = "lead" in parent ? parent.lead : undefined;
        const base = deal ?? lead;
        if (!base) throw new Error(`Activity "${a.subject}" is on ${a.on}, which does not exist.`);
        const dueAt = a.time ? moment(a.dueAgo, a.time) : endOfDayAgo(a.dueAgo);
        const doneAt = a.doneAgo !== undefined ? moment(a.doneAgo, a.time ?? "17:00") : null;
        // Made about a day after its deal or lead, never before it, and at least a day before it is due or done.
        const lowest = Math.max(1, (a.doneAgo ?? Math.max(a.dueAgo, 0)) + 1);
        const createdAgo = lowest > base.createdAgo ? base.createdAgo : Math.min(base.createdAgo, Math.max(lowest, base.createdAgo - 1));
        const createdAt = moment(createdAgo, "11:00");
        const row = await tx.salesActivity.create({
          data: {
            type: a.type,
            subject: a.subject,
            dueAt,
            hasTime: a.time !== undefined,
            doneAt,
            ownerId: base.owner,
            dealId: deal?.id ?? null,
            leadId: lead?.id ?? (a.alsoLead ? leadRows.get(a.alsoLead)?.id ?? null : null),
            personId: base.personId,
            createdBy: a.createdBy ?? base.owner,
            createdAt,
            updatedAt: doneAt ?? createdAt,
          },
          select: { id: true },
        });
        made.activities += 1;
        const entity = deal ? { type: "SalesDeal", id: deal.id } : { type: "SalesLead", id: lead!.id };
        auditRows.push(
          audit(a.createdBy ? null : base.owner, entity.type, entity.id, "activity_added", createdAt, undefined, {
            activityId: row.id, type: a.type, subject: a.subject, dueAt: dueAt.toISOString(), hasTime: a.time !== undefined, createdBy: a.createdBy ?? base.owner,
          }),
        );
        if (doneAt) {
          auditRows.push(audit(base.owner, entity.type, entity.id, "activity_done", doneAt, undefined, { activityId: row.id, type: a.type, subject: a.subject }));
        }
      }

      // --- Notes ---
      const existingNotes = new Set(
        (await tx.salesNote.findMany({ where: { body: { startsWith: "TEST note:" } }, select: { body: true } })).map((n) => n.body),
      );
      for (const n of NOTES) {
        if (existingNotes.has(n.body)) continue;
        const createdAt = moment(n.ago, "13:40");
        let data: Prisma.SalesNoteUncheckedCreateInput;
        let author: string;
        let entity: { type: string; id: string } | null = null;
        if (n.kind === "deal") {
          const deal = dealRows.get(n.on);
          if (!deal) throw new Error(`Note is on ${n.on}, which does not exist.`);
          author = deal.owner;
          data = { body: n.body, authorId: author, dealId: deal.id, pinned: n.pinned ?? false, createdAt, updatedAt: createdAt };
          entity = { type: "SalesDeal", id: deal.id };
        } else if (n.kind === "lead") {
          const lead = leadRows.get(n.on);
          if (!lead) throw new Error(`Note is on ${n.on}, which does not exist.`);
          author = lead.owner;
          data = { body: n.body, authorId: author, leadId: lead.id, pinned: n.pinned ?? false, createdAt, updatedAt: createdAt };
          entity = { type: "SalesLead", id: lead.id };
        } else if (n.kind === "person") {
          author = ownerId(ORGS[PEOPLE[n.index!].org].owner);
          data = { body: n.body, authorId: author, personId: personId[n.index!], pinned: n.pinned ?? false, createdAt, updatedAt: createdAt };
        } else {
          author = ownerId(ORGS[n.index!].owner);
          data = { body: n.body, authorId: author, organizationId: orgId[n.index!], pinned: n.pinned ?? false, createdAt, updatedAt: createdAt };
        }
        const row = await tx.salesNote.create({ data, select: { id: true } });
        made.notes += 1;
        // Only deals and leads show note text (through "Note added" in History); contact panels show no notes.
        if (entity) auditRows.push(audit(author, entity.type, entity.id, "note_added", createdAt, undefined, { noteId: row.id }));
      }

      // --- Custom field values ---
      for (const d of DEALS) {
        const deal = dealRows.get(d.ref);
        if (!deal || !d.fields) continue;
        for (const [key, raw] of Object.entries(d.fields)) {
          const field = fieldFor(key);
          const value = field.fieldType === "DATE" && raw.startsWith("+") ? dayString(Number(raw.slice(1))) : raw;
          const exists = await tx.salesCustomFieldValue.findFirst({ where: { fieldId: field.id, dealId: deal.id }, select: { id: true } });
          if (exists) continue;
          await tx.salesCustomFieldValue.create({ data: { fieldId: field.id, dealId: deal.id, value, createdAt: deal.createdAt, updatedAt: deal.createdAt } });
          made.customFieldValues += 1;
        }
      }
      for (const l of LEADS) {
        const lead = leadRows.get(l.ref);
        if (!lead || !l.fields) continue;
        for (const [key, value] of Object.entries(l.fields)) {
          const field = fieldFor(key);
          const exists = await tx.salesCustomFieldValue.findFirst({ where: { fieldId: field.id, leadId: lead.id }, select: { id: true } });
          if (exists) continue;
          await tx.salesCustomFieldValue.create({ data: { fieldId: field.id, leadId: lead.id, value, createdAt: lead.createdAt, updatedAt: lead.createdAt } });
          made.customFieldValues += 1;
        }
      }

      // --- History lines for what was made (newest rows only; a re-run adds none) ---
      if (auditRows.length > 0) {
        await tx.salesAuditLog.createMany({ data: auditRows });
        made.auditRows = auditRows.length;
      }

      return { made };
    },
    { timeout: 180_000, maxWait: 30_000 },
  );

  return { made: summary.made, today: TODAY };
}

/** One history row, dated to match the data. `actor` null = a rule (SYSTEM). Marked so it can be told apart. */
function audit(
  actor: string | null,
  entityType: string,
  entityId: string,
  action: string,
  at: Date,
  before: object | undefined,
  after: object | undefined,
): Prisma.SalesAuditLogCreateManyInput {
  return {
    at,
    actorType: actor ? "USER" : "SYSTEM",
    actorId: actor,
    entityType,
    entityId,
    action,
    before: before as Prisma.InputJsonObject | undefined,
    after: after as Prisma.InputJsonObject | undefined,
    requestId: "demo-seed",
    userAgent: "demo-seed",
  };
}
