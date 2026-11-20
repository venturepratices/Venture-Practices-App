import { DEAL_SOURCES } from "@/lib/sales/constants";
import { addDaysToDateString } from "@/lib/utils";

// Reading what HighLevel's workflow sends when a lead opts in. HighLevel's
// payload shape depends on how each workflow is set up (its default fields sit
// at the top level, the ones typed in "Custom Data" under `customData`, the
// contact under `contact`) and the same field gets spelled many ways, so every
// key is matched by its lower-case letters and digits only. Pure and
// client-safe: no database, no server-only imports.

export type LeadIntake = {
  ghlContactId: string | null;
  personName: string | null;
  email: string | null;
  phone: string | null;
  practiceName: string | null;
  practiceZip: string | null;
  formType: string | null;
};

export type ParsedIntake =
  | { kind: "lead"; intake: LeadIntake }
  | { kind: "ignored"; reason: string }
  | { kind: "invalid"; error: string };

const NAME_MAX = 200;
const EMAIL_MAX = 254;
const PHONE_MAX = 40;
const ZIP_MAX = 20;
const FORM_MAX = 100;
const CONTACT_ID_MAX = 100;
/** Fewer digits than this is not a phone number. */
const PHONE_MIN_DIGITS = 7;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALIASES = {
  event: ["event"],
  contactId: ["ghlcontactid", "contactid"],
  firstName: ["firstname"],
  lastName: ["lastname"],
  fullName: ["fullname", "name", "contactname"],
  email: ["email", "emailaddress"],
  phone: ["phone", "phonenumber", "mobile", "mobilephone"],
  practiceName: ["practicename", "companyname", "company", "businessname", "practice"],
  practiceZip: ["practicezip", "postalcode", "zip", "zipcode", "practicepostalcode"],
  formType: ["formtype", "formname", "formsource", "form", "contactsource", "source"],
  secret: ["secret"],
} as const;

type Bag = Map<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keyOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The object's keys by their lower-case letters and digits; the first of two spellings wins. */
function bagOf(value: unknown): Bag {
  const bag: Bag = new Map();
  if (!isRecord(value)) return bag;
  for (const [name, entry] of Object.entries(value)) {
    const key = keyOf(name);
    if (!bag.has(key)) bag.set(key, entry);
  }
  return bag;
}

/** The text of a string or a number; anything else (an object, a flag) is not text. Blank is null. */
function textOf(value: unknown): string | null {
  const text = typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** The first alias (in the order given) found in any bag (in the order given) that holds text. */
function pick(bags: Bag[], aliases: readonly string[], max?: number): string | null {
  for (const alias of aliases) {
    for (const bag of bags) {
      const text = textOf(bag.get(alias));
      if (text) return max ? text.slice(0, max) : text;
    }
  }
  return null;
}

function bagsOf(body: Record<string, unknown>): { top: Bag; custom: Bag; contact: Bag; search: Bag[] } {
  const top = bagOf(body);
  const custom = bagOf(top.get("customdata"));
  const contact = bagOf(top.get("contact"));
  return { top, custom, contact, search: [top, custom, contact] };
}

/** `customData.secret` (or a top-level `secret`), for senders that cannot set a header. Null when absent. */
export function intakeSecret(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const { top, custom } = bagsOf(body);
  return pick([custom, top], ALIASES.secret);
}

function validEmail(email: string | null): string | null {
  return email && email.length <= EMAIL_MAX && EMAIL_SHAPE.test(email) ? email : null;
}

function validPhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.replace(/[^0-9]/g, "").length >= PHONE_MIN_DIGITS ? phone.slice(0, PHONE_MAX) : null;
}

const EVENT_LIST = "opt_in, get_started or text_reply";

/**
 * What a HighLevel request is. A new lead needs someone to name: a person, an
 * email, a phone number or a practice. A text reply is acknowledged and left
 * alone. Values are trimmed and capped; an email that is not one and a phone
 * number that is too short are dropped rather than refusing the lead.
 */
export function parseLeadIntake(body: unknown): ParsedIntake {
  if (!isRecord(body)) return { kind: "invalid", error: "The request body must be a JSON object." };
  const { top, custom, contact, search } = bagsOf(body);

  const rawEvent = pick([top, custom], ALIASES.event, 40);
  const event = rawEvent ? rawEvent.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") : "opt_in";
  if (event === "text_reply") return { kind: "ignored", reason: "A text reply does not make a lead." };
  if (event !== "opt_in" && event !== "get_started") {
    return { kind: "invalid", error: `Unknown event. Send ${EVENT_LIST}.` };
  }

  const email = validEmail(pick(search, ALIASES.email));
  const phone = validPhone(pick(search, ALIASES.phone));
  const first = pick(search, ALIASES.firstName);
  const last = pick(search, ALIASES.lastName);
  const named = [first, last].filter(Boolean).join(" ") || pick(search, ALIASES.fullName);
  const personName = (named ?? email ?? phone)?.slice(0, NAME_MAX) ?? null;
  const practiceName = pick(search, ALIASES.practiceName, NAME_MAX);

  if (!personName && !practiceName) {
    return { kind: "invalid", error: "Send a name, an email, a phone number or a practice name." };
  }

  return {
    kind: "lead",
    intake: {
      ghlContactId: pick(search, ALIASES.contactId, CONTACT_ID_MAX) ?? pick([contact], ["id"], CONTACT_ID_MAX),
      personName,
      email,
      phone,
      practiceName,
      practiceZip: pick(search, ALIASES.practiceZip, ZIP_MAX),
      formType: pick(search, ALIASES.formType, FORM_MAX),
    },
  };
}

/** The Source a lead gets: a referral or direct-inquiry form says so; every other form is the Check Availability form. */
export function leadSourceFor(formType: string | null): (typeof DEAL_SOURCES)[number] {
  const text = (formType ?? "").toLowerCase();
  if (text.includes("referral")) return "Referral";
  if (text.includes("direct")) return "Direct inquiry";
  return "Check Availability form";
}

/** The day after `dateString` that is not a Saturday or Sunday, both "YYYY-MM-DD". */
export function nextBusinessDay(dateString: string): string {
  let day = addDaysToDateString(dateString, 1);
  for (;;) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return day;
    day = addDaysToDateString(day, 1);
  }
}
