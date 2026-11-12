// Pure mappers for the one-time Pipedrive import: one Pipedrive record in, the
// fields of one app row out. No Prisma, no network, no clock. The import date
// is always passed in as `fallback`, so the same record gives the same answer
// every time and the tests can state exact values.
//
// What a mapper returns. Each of mapPerson, mapOrganization, mapDeal, mapLead,
// mapActivity and mapNote gives either
//   { pipedriveId, fields, links, issues }   (plus `customFields` for deals and leads)
//   { skip: true, reason }                   (deleted or empty records the app should not get)
// - `pipedriveId` is the record's own Pipedrive id (a number; a text UUID for leads).
// - `fields` holds only values for the app row itself: text, numbers, Dates,
//   booleans. It never holds the id of an app row, because the mapper cannot
//   know one yet.
// - `links` holds the RAW Pipedrive ids of the records this one points at
//   (owner, person, organization, deal, lead, stage, pipeline), as numbers, or
//   as text for a lead. The engine turns them into app row ids, and drops a link
//   (with an issue) when the other record was not copied. A link that is absent
//   in Pipedrive is null.
// - `issues` is plain-words sentences for the import report. Anything the
//   mapper had to guess, shorten, replace or leave out is listed there.
//
// Shapes were checked against Pipedrive's docs, not guessed. Deals, persons,
// organizations and activities come from API v2: plain numeric ids, RFC 3339
// timestamps ("2024-07-01T05:46:33Z"), emails and phones as arrays of
// { value, primary, label }, custom fields under `custom_fields`. Notes and
// leads come from API v1: a note's times look like "2019-12-09 13:59:21", a
// lead's like "2020-10-14T11:30:36.551Z", and a lead's id is a UUID. All
// Pipedrive times are UTC. The input types below list only the fields read.
// Fields Pipedrive may leave out are optional and nullable.

import type { SalesActivityType, SalesDealStatus, SalesLeadStatus } from "@/generated/prisma/enums";
import {
  ACTIVITY_TYPES,
  DEAL_SOURCES,
  HAND_MADE_SOURCE,
  LOST_COMMENT_MAX,
  LOST_REASONS,
  MAX_DEAL_CENTS,
  NOTE_MAX_CHARS,
  SUBJECT_MAX,
  TITLE_MAX,
} from "@/lib/sales/constants";
import { normalizeWebsite } from "@/lib/sales/contact-links";
import { emailKey, nameKey, phoneKey } from "@/lib/sales/contact-keys";
import { isValidDateString } from "@/lib/sales/format";
import { endOfDay } from "@/lib/utils";

// --- Limits the app's own forms enforce (src/lib/sales/contacts-edit.ts, deals.ts) ---

const EMAIL_MAX = 254;
const PHONE_MAX = 40;
const ROLE_MAX = 100;
const ADDRESS_MAX = 500;
const WEBSITE_MAX = 500;
/** The longest value a custom field may hold when someone edits it in the app. */
const CUSTOM_VALUE_MAX = 2_000;

// --- Raw Pipedrive input ---

/**
 * A link to another record. API v2 sends a plain number; some v1 replies nest it
 * as `{ value: 123 }`. Both are read.
 */
export type PipedriveRef = number | { value?: number | null } | null;

/** One email or phone entry of a person (API v2). */
export type PipedriveContactPoint = { value?: string | null; primary?: boolean | null; label?: string | null };

/** A person from `GET /api/v2/persons`. */
export interface PipedrivePerson {
  id: number;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  owner_id?: PipedriveRef;
  org_id?: PipedriveRef;
  add_time?: string | null;
  is_deleted?: boolean | null;
  emails?: PipedriveContactPoint[] | null;
  phones?: PipedriveContactPoint[] | null;
  job_title?: string | null;
}

/** An organization from `GET /api/v2/organizations`. */
export interface PipedriveOrganization {
  id: number;
  name?: string | null;
  owner_id?: PipedriveRef;
  add_time?: string | null;
  is_deleted?: boolean | null;
  address?: { value?: string | null; postal_code?: string | null } | null;
  website?: string | null;
}

/** A deal from `GET /api/v2/deals`. `status` is open, won, lost or deleted. */
export interface PipedriveDeal {
  id: number;
  title?: string | null;
  owner_id?: PipedriveRef;
  person_id?: PipedriveRef;
  org_id?: PipedriveRef;
  pipeline_id?: PipedriveRef;
  stage_id?: PipedriveRef;
  value?: number | null;
  currency?: string | null;
  add_time?: string | null;
  stage_change_time?: string | null;
  status?: string | null;
  is_deleted?: boolean | null;
  is_archived?: boolean | null;
  archive_time?: string | null;
  lost_reason?: string | null;
  close_time?: string | null;
  won_time?: string | null;
  lost_time?: string | null;
  /** "YYYY-MM-DD". */
  expected_close_date?: string | null;
  /** Field key (a 40 character hash) to value. Values are text, numbers, arrays of option ids, or objects with a `value`. */
  custom_fields?: Record<string, unknown> | null;
}

/**
 * A lead from `GET /api/v1/leads`. Its id is a UUID. Its custom fields are not
 * nested: they sit at the top level under their 40 character hash keys, in the
 * same format as v1 deals, which is why this type allows any other key.
 */
export interface PipedriveLead {
  id: string;
  title?: string | null;
  owner_id?: PipedriveRef;
  person_id?: PipedriveRef;
  organization_id?: PipedriveRef;
  source_name?: string | null;
  is_archived?: boolean | null;
  add_time?: string | null;
  update_time?: string | null;
  [customFieldKey: string]: unknown;
}

/** An activity from `GET /api/v2/activities`. `type` is the type's key ("call", "meeting", ...). */
export interface PipedriveActivity {
  id: number;
  subject?: string | null;
  type?: string | null;
  done?: boolean | null;
  /** "YYYY-MM-DD". */
  due_date?: string | null;
  /** "HH:MM" in UTC, or empty or null when the activity has no time. */
  due_time?: string | null;
  marked_as_done_time?: string | null;
  add_time?: string | null;
  /** HTML. */
  note?: string | null;
  public_description?: string | null;
  owner_id?: PipedriveRef;
  deal_id?: PipedriveRef;
  /** A lead's UUID. */
  lead_id?: string | { value?: string | null } | null;
  person_id?: PipedriveRef;
  org_id?: PipedriveRef;
  is_deleted?: boolean | null;
}

/** A note from `GET /api/v1/notes`. `content` is HTML. `user_id` is the author. */
export interface PipedriveNote {
  id: number;
  content?: string | null;
  deal_id?: PipedriveRef;
  person_id?: PipedriveRef;
  org_id?: PipedriveRef;
  /** A lead's UUID. */
  lead_id?: string | { value?: string | null } | null;
  user_id?: PipedriveRef;
  add_time?: string | null;
  active_flag?: boolean | null;
  pinned_to_deal_flag?: boolean | null;
  pinned_to_person_flag?: boolean | null;
  pinned_to_organization_flag?: boolean | null;
}

// --- What the mappers return ---

/** A record the app should not get, and why (a deleted deal, an empty note). */
export type MapSkip = { skip: true; reason: string };

export type MappedPerson = {
  pipedriveId: number;
  fields: {
    name: string;
    email: string | null;
    phone: string | null;
    role: string | null;
    /** Duplicate keys, the same rules the app uses (src/lib/sales/contact-keys.ts). */
    emailKey: string | null;
    phoneKey: string | null;
    nameKey: string | null;
    createdAt: Date;
  };
  links: { ownerPipedriveUserId: number | null; organizationPipedriveId: number | null };
  issues: string[];
};

export type MappedOrganization = {
  pipedriveId: number;
  fields: {
    name: string;
    address: string | null;
    website: string | null;
    zip: string | null;
    nameKey: string | null;
    createdAt: Date;
  };
  links: { ownerPipedriveUserId: number | null };
  issues: string[];
};

export type MappedDeal = {
  pipedriveId: number;
  fields: {
    title: string;
    /** Integer cents, never above MAX_DEAL_CENTS. */
    valueCents: number;
    status: SalesDealStatus;
    /** One of the app's lost reasons; null when Pipedrive had none or the deal is not lost. */
    lostReason: string | null;
    /** Pipedrive's own words, kept here when its reason is not one of the app's. */
    lostComment: string | null;
    stageEnteredAt: Date;
    wonAt: Date | null;
    lostAt: Date | null;
    /** The end of that day in app time, the way the app stores a close date. */
    expectedCloseDate: Date | null;
    archivedAt: Date | null;
    createdAt: Date;
  };
  links: {
    ownerPipedriveUserId: number | null;
    personPipedriveId: number | null;
    organizationPipedriveId: number | null;
    stagePipedriveId: number | null;
    pipelinePipedriveId: number | null;
  };
  /** Custom field values as plain text, keyed by the raw Pipedrive field key. Empty and null values are left out. */
  customFields: Record<string, string>;
  issues: string[];
};

export type MappedLead = {
  /** The lead's UUID. */
  pipedriveId: string;
  fields: {
    title: string;
    source: string;
    status: SalesLeadStatus;
    archivedAt: Date | null;
    createdAt: Date;
  };
  links: {
    ownerPipedriveUserId: number | null;
    personPipedriveId: number | null;
    organizationPipedriveId: number | null;
  };
  /** Custom field values as plain text, keyed by the raw Pipedrive field key. Empty and null values are left out. */
  customFields: Record<string, string>;
  issues: string[];
};

export type MappedActivity = {
  pipedriveId: number;
  fields: {
    type: SalesActivityType;
    subject: string;
    dueAt: Date;
    hasTime: boolean;
    doneAt: Date | null;
    /** Plain text. */
    note: string | null;
    createdAt: Date;
  };
  links: {
    ownerPipedriveUserId: number | null;
    dealPipedriveId: number | null;
    /** The lead's UUID. */
    leadPipedriveId: string | null;
    personPipedriveId: number | null;
    organizationPipedriveId: number | null;
  };
  issues: string[];
};

export type MappedNote = {
  pipedriveId: number;
  fields: {
    /** Plain text, never HTML. */
    body: string;
    pinned: boolean;
    createdAt: Date;
  };
  links: {
    /** The note's author. */
    ownerPipedriveUserId: number | null;
    dealPipedriveId: number | null;
    /** The lead's UUID. */
    leadPipedriveId: string | null;
    personPipedriveId: number | null;
    organizationPipedriveId: number | null;
  };
  issues: string[];
};

// --- Small helpers ---

/** Control characters that no text field may hold. Tab, line feed and carriage return are not among them. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** One line of trimmed text: any control character, newlines included, becomes a space. Anything that is not text is "". */
function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001F\u007F]+/g, " ").trim() : "";
}

/** Cuts text at `max` characters without leaving half of an emoji, so the database never gets a broken character. */
function cut(text: string, max: number): string {
  let end = text.slice(0, max);
  const last = end.charCodeAt(end.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) end = end.slice(0, -1);
  return end;
}

/** The text, cut to `max` characters with an issue when it was longer. */
function clip(text: string, max: number, what: string, issues: string[]): string {
  if (text.length <= max) return text;
  issues.push(`The ${what} was longer than ${max.toLocaleString("en-US")} characters, so the end was cut off.`);
  return cut(text, max).trimEnd();
}

/** Text for a sentence: quoted, and short enough not to flood the report. */
function quoted(text: string): string {
  return `"${text.length > 60 ? `${text.slice(0, 60)}...` : text}"`;
}

/** A Pipedrive record id: a whole number above 0, plain or nested as `{ value }`. Anything else is null. */
function refId(ref: unknown): number | null {
  const raw = ref !== null && typeof ref === "object" ? (ref as { value?: unknown }).value : ref;
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : null;
}

/** A lead's UUID, plain or nested as `{ value }`. Anything else is null. */
function leadRef(ref: unknown): string | null {
  const raw = ref !== null && typeof ref === "object" ? (ref as { value?: unknown }).value : ref;
  return clean(raw) || null;
}

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/i;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/**
 * A Pipedrive timestamp as a Date: "2026-11-05 14:30:00" (v1) and
 * "2026-11-05T14:30:00Z" (v2) are both UTC. A bare date is midnight UTC. The
 * calendar day is checked first because the Date constructor quietly turns
 * "2026-02-30" into 2 March. Null when it cannot be read.
 */
function parseUtc(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = TIMESTAMP.exec(value.trim());
  if (!match) return null;
  const [, day, hour = "00", minute = "00", second = "00", fraction = "", zone = "Z"] = match;
  if (!isValidDateString(day)) return null;
  const date = new Date(`${day}T${hour}:${minute}:${second}${fraction}${zone.toUpperCase()}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** When the row was created: Pipedrive's add_time, else the import date with an issue. */
function createdAtOf(addTime: unknown, fallback: Date, issues: string[]): Date {
  const parsed = parseUtc(addTime);
  if (parsed) return parsed;
  issues.push("The created date was missing or unreadable, so the import date was used.");
  return fallback;
}

/** A deal's, lead's or activity's one-line name: trimmed, never blank, never past `max`. `thing` is "deal", `field` is "title" or "subject". */
function titleOf(value: unknown, max: number, thing: string, field: string, blankName: string, issues: string[]): string {
  const text = clean(value);
  if (text === "") {
    issues.push(`The ${thing} had no ${field}, so it was called ${blankName}.`);
    return blankName;
  }
  return clip(text, max, `${thing} ${field}`, issues);
}

const NO_ID = "The record had no usable id in Pipedrive.";

// --- Money ---

/**
 * A deal value as integer cents. A missing, unreadable or negative value is $0
 * with an issue. A currency other than USD keeps the number as dollars (no
 * conversion rate is known) and says which currency it was. A value above the
 * cap is set to the cap.
 */
export function centsFromValue(
  value: number | null | undefined,
  currency: string | null | undefined,
): { cents: number; issues: string[] } {
  const issues: string[] = [];
  if (value === null || value === undefined) {
    return { cents: 0, issues: ["The deal had no value, so it was set to $0."] };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { cents: 0, issues: ["The deal value was not a number, so it was set to $0."] };
  }
  if (value < 0) {
    return { cents: 0, issues: [`The deal value was negative (${value}), so it was set to $0.`] };
  }
  const code = clean(currency).toUpperCase();
  if (code !== "" && code !== "USD") {
    issues.push(`The deal value is in ${code}. The number was kept as dollars with no conversion.`);
  }
  const cents = Math.round(value * 100);
  if (cents > MAX_DEAL_CENTS) {
    const cap = (MAX_DEAL_CENTS / 100).toLocaleString("en-US");
    issues.push(`The deal value was above $${cap}, so it was set to $${cap}.`);
    return { cents: MAX_DEAL_CENTS, issues };
  }
  return { cents, issues };
}

// --- Activity type and timing ---

const KNOWN_TYPES: ReadonlySet<string> = new Set(ACTIVITY_TYPES.map((type) => type.toLowerCase()));

/** One of the app's six activity types by its Pipedrive key (any case). Anything else is a Task with an issue. */
export function mapActivityType(typeKey: string | null | undefined): { type: SalesActivityType; issues: string[] } {
  const key = clean(typeKey);
  if (key === "") return { type: "TASK", issues: ["The activity had no type, so it became a Task."] };
  if (KNOWN_TYPES.has(key.toLowerCase())) return { type: key.toUpperCase() as SalesActivityType, issues: [] };
  return { type: "TASK", issues: [`The activity type ${quoted(key)} is not one the app has, so it became a Task.`] };
}

/**
 * When an activity is due and when it was done. Pipedrive's due date and time
 * are UTC, so a date with a time is that exact moment. A date with no time is
 * due by the end of that day in app time, the way the app stores it
 * (activityDueAt in src/lib/sales/format.ts), and `hasTime` is false. A missing
 * due date or done time becomes `fallback` with an issue.
 */
export function mapActivityTiming(
  a: { due_date?: string | null; due_time?: string | null; marked_as_done_time?: string | null; done?: boolean | null },
  fallback: Date,
): { dueAt: Date; hasTime: boolean; doneAt: Date | null; issues: string[] } {
  const issues: string[] = [];
  let dueAt = fallback;
  let hasTime = false;

  const day = clean(a.due_date);
  if (day === "") {
    issues.push("The activity had no due date, so the import date was used.");
  } else if (!isValidDateString(day)) {
    issues.push(`The due date ${quoted(day)} is not a real date, so the import date was used.`);
  } else {
    const time = clean(a.due_time);
    const match = time === "" ? null : TIME_OF_DAY.exec(time);
    if (match) {
      dueAt = new Date(`${day}T${match[1]}:${match[2]}:${match[3] ?? "00"}.000Z`);
      hasTime = true;
    } else {
      dueAt = endOfDay(day);
      if (time !== "") issues.push(`The due time ${quoted(time)} could not be read, so the activity is due by the end of that day.`);
    }
  }

  // A done time only counts on an activity that is done: Pipedrive can keep a stale one after a reopen.
  let doneAt: Date | null = null;
  if (a.done === true) {
    const doneText = clean(a.marked_as_done_time);
    doneAt = parseUtc(doneText);
    if (doneAt === null) {
      doneAt = fallback;
      issues.push(
        doneText === ""
          ? "The activity was done but had no done time, so the import date was used."
          : `The done time ${quoted(doneText)} could not be read, so the import date was used.`,
      );
    }
  }

  return { dueAt, hasTime, doneAt, issues };
}

// --- HTML to plain text ---

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
};

/** One entity as text. An unknown name stays as typed; a number that is not a valid character is dropped. */
function decodeEntity(whole: string, decimal?: string, hex?: string, name?: string): string {
  if (name !== undefined) return ENTITIES[name.toLowerCase()] ?? whole;
  const code = decimal !== undefined ? Number(decimal) : parseInt(hex ?? "", 16);
  const isControl = code < 32 && code !== 9 && code !== 10 && code !== 13;
  const isSurrogate = code >= 0xd800 && code <= 0xdfff;
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || isControl || isSurrogate || code === 0x7f) return "";
  return String.fromCodePoint(code);
}

/** Tags that start a new line in plain text: a paragraph, a list item, a heading. */
const BLOCK_TAGS = "p|div|h[1-6]|li|tr|blockquote|pre";
/** A mark for "start a new line here unless one just started". Control characters were removed first, so none can be real. */
const SOFT_BREAK = "\u0001";

/**
 * HTML as plain text. Scripts, styles and comments go with their contents, every
 * other tag goes, `<br>`, paragraphs and list items keep their line breaks, and
 * the common entities are decoded. Entities are decoded last and once, so an
 * encoded tag ("&lt;script&gt;") stays as the text it spells and nothing is
 * decoded twice. The result is stored and shown as plain text, never as HTML.
 * Text past NOTE_MAX_CHARS is cut off with an issue.
 */
export function htmlToPlainText(html: string | null | undefined): { text: string; issues: string[] } {
  const issues: string[] = [];
  if (typeof html !== "string" || html === "") return { text: "", issues };

  let text = html
    .replace(CONTROL_CHARS, "")
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
    // A tag body may not hold "<", so a "<a" with no ">" stops at the next "<" instead of every one rescanning the rest of the text.
    .replace(/<br\b[^<>]*>/gi, "\n")
    .replace(new RegExp(`<(?:${BLOCK_TAGS})\\b[^<>]*>`, "gi"), SOFT_BREAK)
    .replace(new RegExp(`</(?:${BLOCK_TAGS})\\s*>`, "gi"), "\n")
    .replace(/<\/?[a-zA-Z][^<>]*>|<[!?][^<>]*>/g, "")
    .replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,9}));/g, decodeEntity);

  text = text
    // Every run of spaces, tabs and non-breaking spaces becomes one space first. That keeps the steps after it fast on a note padded with thousands of spaces.
    .replace(/[^\S\n]+/g, " ")
    // A soft break right after a line break (or at the start) adds nothing; anywhere else it is a line break.
    .replace(new RegExp(` ?${SOFT_BREAK}`, "g"), SOFT_BREAK)
    .replace(new RegExp(`(^|\\n)${SOFT_BREAK}+`, "g"), "$1")
    .replace(new RegExp(`${SOFT_BREAK}+`, "g"), "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length > NOTE_MAX_CHARS) {
    issues.push(`The text was longer than ${NOTE_MAX_CHARS.toLocaleString("en-US")} characters, so the end was cut off.`);
    text = cut(text, NOTE_MAX_CHARS);
  }
  return { text, issues };
}

// --- Emails and phones ---

/** The main email or phone of a list: the one marked primary, else the first with something in it. Null when none. */
export function primaryOf(list: { value?: string | null; primary?: boolean | null }[] | null | undefined): string | null {
  const filled = (list ?? [])
    .map((entry) => ({ value: clean(entry?.value), primary: entry?.primary === true }))
    .filter((entry) => entry.value !== "");
  return (filled.find((entry) => entry.primary) ?? filled[0])?.value ?? null;
}

/** Looks like an address someone could write to: one @, text around it, a dot in the domain, no spaces. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** How many entries differ from the chosen one once typing differences (case, punctuation) are ignored. */
function extrasCount(values: string[], chosen: string | null, keyOf: (value: string) => string): number {
  const chosenKey = chosen === null ? null : keyOf(chosen);
  const others = new Set(values.map(keyOf));
  if (chosenKey !== null) others.delete(chosenKey);
  return others.size;
}

function extrasIssue(count: number, what: "email address" | "phone number"): string[] {
  if (count === 0) return [];
  const plural = count === 1 ? what : what === "email address" ? "email addresses" : "phone numbers";
  return [`The person had ${count} other ${plural} that ${count === 1 ? "was" : "were"} not copied (the app keeps one).`];
}

// --- Custom fields ---

/**
 * One custom field value as plain text, or null when it holds nothing. Numbers
 * and dates become text. A single option arrives as its option id (the engine
 * knows the option names). A multiple choice arrives as ids joined with ", ". A
 * money, address, date range or time value is an object with a `value`, and the
 * `value` is what is read.
 */
function customValueText(raw: unknown): string | null {
  if (typeof raw === "string") return clean(raw) || null;
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw === "boolean") return String(raw);
  if (Array.isArray(raw)) {
    const parts = raw.map(customValueText).filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (raw !== null && typeof raw === "object" && "value" in raw) return customValueText((raw as { value: unknown }).value);
  return null;
}

function customFieldsOf(entries: Iterable<[string, unknown]>, issues: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, raw] of entries) {
    const text = customValueText(raw);
    if (text !== null) result[key] = clip(text, CUSTOM_VALUE_MAX, "custom field value", issues);
  }
  return result;
}

/** A custom field key in Pipedrive: 40 hex characters. Helper keys such as "<key>_currency" are longer, so they never match. */
const CUSTOM_FIELD_KEY = /^[0-9a-f]{40}$/;

// --- Person and organization ---

/** A person. No name becomes the email, else the phone, else "Unnamed contact", each with an issue. */
export function mapPerson(person: PipedrivePerson, fallback: Date): MappedPerson | MapSkip {
  const pipedriveId = refId(person.id);
  if (pipedriveId === null) return { skip: true, reason: NO_ID };
  if (person.is_deleted === true) return { skip: true, reason: "The person was deleted in Pipedrive." };
  const issues: string[] = [];

  // The app keeps one email and one phone, so the main ones are copied and the rest are counted in the report.
  const emailEntries = (person.emails ?? []).map((entry) => ({ value: clean(entry?.value), primary: entry?.primary === true }));
  const filledEmails = emailEntries.filter((entry) => entry.value !== "");
  const goodEmails = filledEmails.filter((entry) => entry.value.length <= EMAIL_MAX && EMAIL_SHAPE.test(entry.value));
  for (const entry of filledEmails) {
    if (!goodEmails.includes(entry)) issues.push(`${quoted(entry.value)} is not an email address, so it was not copied.`);
  }
  const email = primaryOf(goodEmails);
  issues.push(...extrasIssue(extrasCount(goodEmails.map((e) => e.value), email, (v) => emailKey(v) ?? v), "email address"));

  const phoneValues = (person.phones ?? []).map((entry) => ({ value: clean(entry?.value), primary: entry?.primary === true }));
  const phoneText = primaryOf(phoneValues);
  const otherPhones = phoneValues.map((entry) => entry.value).filter((value) => value !== "");
  issues.push(...extrasIssue(extrasCount(otherPhones, phoneText, (v) => phoneKey(v) ?? v), "phone number"));
  const phone = phoneText === null ? null : clip(phoneText, PHONE_MAX, "phone number", issues);

  let name = clean(person.name) || [clean(person.first_name), clean(person.last_name)].filter(Boolean).join(" ");
  if (name === "") {
    if (email !== null) {
      name = email;
      issues.push("The person had no name, so the email address was used as the name.");
    } else if (phone !== null) {
      name = phone;
      issues.push("The person had no name, so the phone number was used as the name.");
    } else {
      name = "Unnamed contact";
      issues.push("The person had no name, email or phone, so they were called Unnamed contact.");
    }
  }
  name = clip(name, TITLE_MAX, "name", issues);

  const roleText = clean(person.job_title);
  return {
    pipedriveId,
    fields: {
      name,
      email,
      phone,
      role: roleText === "" ? null : clip(roleText, ROLE_MAX, "job title", issues),
      emailKey: emailKey(email),
      phoneKey: phoneKey(phone),
      nameKey: nameKey(name),
      createdAt: createdAtOf(person.add_time, fallback, issues),
    },
    links: { ownerPipedriveUserId: refId(person.owner_id), organizationPipedriveId: refId(person.org_id) },
    issues,
  };
}

/** What the app accepts as a ZIP: five digits, or ZIP+4. */
const US_ZIP = /^\d{5}(-\d{4})?$/;

/** An organization. No name becomes "Unnamed organization" with an issue; a missing address or website is simply empty. */
export function mapOrganization(org: PipedriveOrganization, fallback: Date): MappedOrganization | MapSkip {
  const pipedriveId = refId(org.id);
  if (pipedriveId === null) return { skip: true, reason: NO_ID };
  if (org.is_deleted === true) return { skip: true, reason: "The organization was deleted in Pipedrive." };
  const issues: string[] = [];

  let name = clean(org.name);
  if (name === "") {
    name = "Unnamed organization";
    issues.push("The organization had no name, so it was called Unnamed organization.");
  }
  name = clip(name, TITLE_MAX, "name", issues);

  const addressText = clean(org.address?.value);
  const address = addressText === "" ? null : clip(addressText, ADDRESS_MAX, "address", issues);

  let website: string | null = null;
  const websiteText = clean(org.website);
  if (websiteText !== "") {
    website = normalizeWebsite(websiteText);
    if (website === null) issues.push(`The website ${quoted(websiteText)} is not a web address, so it was not copied.`);
    else if (website.length > WEBSITE_MAX) {
      website = null;
      issues.push(`The website was longer than ${WEBSITE_MAX} characters, so it was not copied.`);
    }
  }

  let zip: string | null = null;
  const postal = clean(org.address?.postal_code);
  if (postal !== "") {
    if (US_ZIP.test(postal)) zip = postal;
    else issues.push(`The postal code ${quoted(postal)} is not a US ZIP, so it was not copied.`);
  }

  return {
    pipedriveId,
    fields: { name, address, website, zip, nameKey: nameKey(name), createdAt: createdAtOf(org.add_time, fallback, issues) },
    links: { ownerPipedriveUserId: refId(org.owner_id) },
    issues,
  };
}

// --- Deal ---

/** The app's lost reason for Pipedrive's words: an exact match (any case), else "Other" with the words kept as the comment. */
function lostReasonOf(text: string, issues: string[]): { lostReason: string | null; lostComment: string | null } {
  if (text === "") return { lostReason: null, lostComment: null };
  const match = LOST_REASONS.find((reason) => reason.toLowerCase() === text.toLowerCase());
  if (match) return { lostReason: match, lostComment: null };
  return { lostReason: "Other", lostComment: clip(text, LOST_COMMENT_MAX, "lost reason", issues) };
}

/**
 * A deal. Won and lost come from Pipedrive's status, with their own times. A
 * deleted deal is skipped. `stageEnteredAt` is Pipedrive's stage change time,
 * else its created time. The value, title and lost reason are made safe for the
 * app (see centsFromValue and lostReasonOf), each with an issue when changed.
 */
export function mapDeal(deal: PipedriveDeal, fallback: Date): MappedDeal | MapSkip {
  const pipedriveId = refId(deal.id);
  if (pipedriveId === null) return { skip: true, reason: NO_ID };
  const statusText = clean(deal.status).toLowerCase();
  if (deal.is_deleted === true || statusText === "deleted") return { skip: true, reason: "The deal was deleted in Pipedrive." };
  const issues: string[] = [];

  let status: SalesDealStatus = "OPEN";
  if (statusText === "won") status = "WON";
  else if (statusText === "lost") status = "LOST";
  else if (statusText === "") issues.push("The deal had no status, so it was set to open.");
  else if (statusText !== "open") issues.push(`The deal status ${quoted(clean(deal.status))} is not one the app has, so it was set to open.`);

  const title = titleOf(deal.title, TITLE_MAX, "deal", "title", "Untitled deal", issues);
  const money = centsFromValue(deal.value, deal.currency);
  issues.push(...money.issues);
  const createdAt = createdAtOf(deal.add_time, fallback, issues);

  // A won or lost time only counts while the deal is won or lost: a reopened deal can keep stale ones.
  let wonAt: Date | null = null;
  let lostAt: Date | null = null;
  if (status === "WON") {
    wonAt = parseUtc(deal.won_time) ?? parseUtc(deal.close_time);
    if (wonAt === null) {
      wonAt = fallback;
      issues.push("The deal is won but had no won time, so the import date was used.");
    }
  } else if (status === "LOST") {
    lostAt = parseUtc(deal.lost_time) ?? parseUtc(deal.close_time);
    if (lostAt === null) {
      lostAt = fallback;
      issues.push("The deal is lost but had no lost time, so the import date was used.");
    }
  }
  const lost = status === "LOST" ? lostReasonOf(clean(deal.lost_reason), issues) : { lostReason: null, lostComment: null };

  let expectedCloseDate: Date | null = null;
  const closeDay = clean(deal.expected_close_date);
  if (closeDay !== "") {
    if (isValidDateString(closeDay)) expectedCloseDate = endOfDay(closeDay);
    else issues.push(`The expected close date ${quoted(closeDay)} is not a real date, so it was left empty.`);
  }

  return {
    pipedriveId,
    fields: {
      title,
      valueCents: money.cents,
      status,
      ...lost,
      stageEnteredAt: parseUtc(deal.stage_change_time) ?? createdAt,
      wonAt,
      lostAt,
      expectedCloseDate,
      archivedAt: deal.is_archived === true ? (parseUtc(deal.archive_time) ?? fallback) : null,
      createdAt,
    },
    links: {
      ownerPipedriveUserId: refId(deal.owner_id),
      personPipedriveId: refId(deal.person_id),
      organizationPipedriveId: refId(deal.org_id),
      stagePipedriveId: refId(deal.stage_id),
      pipelinePipedriveId: refId(deal.pipeline_id),
    },
    customFields: customFieldsOf(Object.entries(deal.custom_fields ?? {}), issues),
    issues,
  };
}

// --- Lead ---

/** A lead's source must be one of the app's sources; Pipedrive's own source names mostly are not, so those are "Added by hand" (the app's default). */
function leadSourceOf(sourceName: unknown): string {
  const text = clean(sourceName).toLowerCase();
  return DEAL_SOURCES.find((source) => source.toLowerCase() === text) ?? HAND_MADE_SOURCE;
}

/**
 * A lead, keyed by its UUID. An archived lead becomes ARCHIVED at its last
 * update time (Pipedrive keeps no archive time on a lead). The lead's value
 * and expected close date have no place on an app lead and are not copied.
 */
export function mapLead(lead: PipedriveLead, fallback: Date): MappedLead | MapSkip {
  const pipedriveId = leadRef(lead.id);
  if (pipedriveId === null) return { skip: true, reason: NO_ID };
  const issues: string[] = [];

  const title = titleOf(lead.title, TITLE_MAX, "lead", "title", "Untitled lead", issues);
  const archived = lead.is_archived === true;
  return {
    pipedriveId,
    fields: {
      title,
      source: leadSourceOf(lead.source_name),
      status: archived ? "ARCHIVED" : "OPEN",
      archivedAt: archived ? (parseUtc(lead.update_time) ?? fallback) : null,
      createdAt: createdAtOf(lead.add_time, fallback, issues),
    },
    links: {
      ownerPipedriveUserId: refId(lead.owner_id),
      personPipedriveId: refId(lead.person_id),
      organizationPipedriveId: refId(lead.organization_id),
    },
    customFields: customFieldsOf(
      Object.entries(lead).filter(([key]) => CUSTOM_FIELD_KEY.test(key)),
      issues,
    ),
    issues,
  };
}

// --- Activity and note ---

/**
 * An activity. Type, due date and time, and done time follow mapActivityType
 * and mapActivityTiming. The note is the activity's note as plain text, or its
 * public description when the note is empty.
 */
export function mapActivity(activity: PipedriveActivity, fallback: Date): MappedActivity | MapSkip {
  const pipedriveId = refId(activity.id);
  if (pipedriveId === null) return { skip: true, reason: NO_ID };
  if (activity.is_deleted === true) return { skip: true, reason: "The activity was deleted in Pipedrive." };
  const issues: string[] = [];

  const subject = titleOf(activity.subject, SUBJECT_MAX, "activity", "subject", "Untitled activity", issues);
  const type = mapActivityType(activity.type);
  issues.push(...type.issues);
  const timing = mapActivityTiming(activity, fallback);
  issues.push(...timing.issues);

  let note = htmlToPlainText(activity.note);
  if (note.text === "") note = htmlToPlainText(activity.public_description);
  issues.push(...note.issues);

  return {
    pipedriveId,
    fields: {
      type: type.type,
      subject,
      dueAt: timing.dueAt,
      hasTime: timing.hasTime,
      doneAt: timing.doneAt,
      note: note.text === "" ? null : note.text,
      createdAt: createdAtOf(activity.add_time, fallback, issues),
    },
    links: {
      ownerPipedriveUserId: refId(activity.owner_id),
      dealPipedriveId: refId(activity.deal_id),
      leadPipedriveId: leadRef(activity.lead_id),
      personPipedriveId: refId(activity.person_id),
      organizationPipedriveId: refId(activity.org_id),
    },
    issues,
  };
}

/**
 * A note as plain text. A note with nothing left once the HTML is removed, or
 * one Pipedrive marks as removed, is skipped. It is pinned when it is pinned
 * to anything. `ownerPipedriveUserId` in its links is the note's author.
 */
export function mapNote(note: PipedriveNote, fallback: Date): MappedNote | MapSkip {
  const pipedriveId = refId(note.id);
  if (pipedriveId === null) return { skip: true, reason: NO_ID };
  if (note.active_flag === false) return { skip: true, reason: "The note was deleted in Pipedrive." };
  const body = htmlToPlainText(note.content);
  if (body.text === "") return { skip: true, reason: "The note was empty." };
  const issues = [...body.issues];

  return {
    pipedriveId,
    fields: {
      body: body.text,
      pinned: note.pinned_to_deal_flag === true || note.pinned_to_person_flag === true || note.pinned_to_organization_flag === true,
      createdAt: createdAtOf(note.add_time, fallback, issues),
    },
    links: {
      ownerPipedriveUserId: refId(note.user_id),
      dealPipedriveId: refId(note.deal_id),
      leadPipedriveId: leadRef(note.lead_id),
      personPipedriveId: refId(note.person_id),
      organizationPipedriveId: refId(note.org_id),
    },
    issues,
  };
}
