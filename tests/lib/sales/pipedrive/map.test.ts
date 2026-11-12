import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MAX_DEAL_CENTS, NOTE_MAX_CHARS, SUBJECT_MAX, TITLE_MAX } from "@/lib/sales/constants";
import {
  centsFromValue,
  htmlToPlainText,
  mapActivity,
  mapActivityTiming,
  mapActivityType,
  mapDeal,
  mapLead,
  mapNote,
  mapOrganization,
  mapPerson,
  primaryOf,
  type MapSkip,
  type PipedriveActivity,
  type PipedriveDeal,
  type PipedriveLead,
  type PipedriveNote,
  type PipedriveOrganization,
  type PipedrivePerson,
} from "@/lib/sales/pipedrive/map";

// The pure mappers behind the Pipedrive import. Fixtures follow the shapes in
// Pipedrive's own docs: API v2 for deals, persons, organizations and activities
// (plain numeric ids, ISO timestamps, emails and phones as arrays, custom
// fields under `custom_fields`), API v1 for notes and leads (notes use
// "YYYY-MM-DD HH:MM:SS", leads use ISO with milliseconds and a UUID id).
// The "import time" below is passed in, so every expectation is exact.

const FALLBACK = new Date("2026-11-12T12:00:00.000Z");

/** Narrows a mapper result to the mapped record, failing the test if it was skipped. */
function mapped<T extends object>(result: T | MapSkip): T {
  if ("skip" in result) throw new Error(`Expected a mapped record but it was skipped: ${result.reason}`);
  return result;
}

function skipped(result: object): MapSkip {
  if (!("skip" in result)) throw new Error("Expected the record to be skipped");
  return result as MapSkip;
}

describe("centsFromValue", () => {
  it("turns 1234.5 USD into 123450 cents", () => {
    expect(centsFromValue(1234.5, "USD")).toEqual({ cents: 123450, issues: [] });
  });

  it("rounds cents from a binary float correctly", () => {
    expect(centsFromValue(0.29, "USD").cents).toBe(29);
    expect(centsFromValue(1.15, "USD").cents).toBe(115);
  });

  it("treats a value of 0 as a real zero with no issue", () => {
    expect(centsFromValue(0, "USD")).toEqual({ cents: 0, issues: [] });
  });

  it("assumes dollars when Pipedrive gives no currency", () => {
    expect(centsFromValue(10, null)).toEqual({ cents: 1000, issues: [] });
    expect(centsFromValue(10, undefined)).toEqual({ cents: 1000, issues: [] });
  });

  it("gives 0 and an issue for a missing value", () => {
    const missing = centsFromValue(null, "USD");
    expect(missing.cents).toBe(0);
    expect(missing.issues).toEqual(["The deal had no value, so it was set to $0."]);
    expect(centsFromValue(undefined, "USD").cents).toBe(0);
  });

  it("gives 0 and an issue for NaN and for a negative value", () => {
    const nan = centsFromValue(Number.NaN, "USD");
    expect(nan.cents).toBe(0);
    expect(nan.issues).toHaveLength(1);
    const negative = centsFromValue(-50, "USD");
    expect(negative.cents).toBe(0);
    expect(negative.issues).toEqual(["The deal value was negative (-50), so it was set to $0."]);
  });

  it("keeps the number for a non-USD currency and names the currency in an issue", () => {
    const euro = centsFromValue(100, "EUR");
    expect(euro.cents).toBe(10000);
    expect(euro.issues).toEqual(["The deal value is in EUR. The number was kept as dollars with no conversion."]);
    expect(centsFromValue(100, "eur").issues[0]).toContain("EUR");
    expect(centsFromValue(100, "usd").issues).toEqual([]);
  });

  it("clamps 5,000,000,000 to the cap with an issue", () => {
    const huge = centsFromValue(5_000_000_000, "USD");
    expect(huge.cents).toBe(MAX_DEAL_CENTS);
    expect(huge.issues).toEqual(["The deal value was above $10,000,000, so it was set to $10,000,000."]);
  });

  it("allows exactly the cap and clamps one cent over it", () => {
    expect(centsFromValue(10_000_000, "USD")).toEqual({ cents: MAX_DEAL_CENTS, issues: [] });
    expect(centsFromValue(10_000_000.01, "USD").issues).toHaveLength(1);
  });

  it("reports both a foreign currency and the cap when both apply", () => {
    const both = centsFromValue(5_000_000_000, "EUR");
    expect(both.cents).toBe(MAX_DEAL_CENTS);
    expect(both.issues).toHaveLength(2);
  });
});

describe("mapActivityType", () => {
  it("maps the six known keys, whatever the case", () => {
    expect(mapActivityType("call")).toEqual({ type: "CALL", issues: [] });
    expect(mapActivityType("meeting")).toEqual({ type: "MEETING", issues: [] });
    expect(mapActivityType("task")).toEqual({ type: "TASK", issues: [] });
    expect(mapActivityType("deadline")).toEqual({ type: "DEADLINE", issues: [] });
    expect(mapActivityType("lunch")).toEqual({ type: "LUNCH", issues: [] });
    expect(mapActivityType("Email")).toEqual({ type: "EMAIL", issues: [] });
    expect(mapActivityType("  CALL ")).toEqual({ type: "CALL", issues: [] });
  });

  it("turns an unknown key like Site visit into a Task with an issue that names it", () => {
    const result = mapActivityType("Site visit");
    expect(result.type).toBe("TASK");
    expect(result.issues).toEqual(['The activity type "Site visit" is not one the app has, so it became a Task.']);
  });

  it("turns a missing type into a Task with an issue", () => {
    for (const missing of [null, undefined, "", "  "]) {
      const result = mapActivityType(missing);
      expect(result.type).toBe("TASK");
      expect(result.issues).toEqual(["The activity had no type, so it became a Task."]);
    }
  });
});

describe("mapActivityTiming", () => {
  it("reads a date and a time as one exact UTC moment", () => {
    const result = mapActivityTiming({ due_date: "2026-11-05", due_time: "14:30" }, FALLBACK);
    expect(result).toEqual({ dueAt: new Date("2026-11-05T14:30:00.000Z"), hasTime: true, doneAt: null, issues: [] });
  });

  it("accepts a time with seconds", () => {
    const result = mapActivityTiming({ due_date: "2026-11-05", due_time: "09:05:30" }, FALLBACK);
    expect(result.dueAt).toEqual(new Date("2026-11-05T09:05:30.000Z"));
    expect(result.hasTime).toBe(true);
  });

  it("makes a date-only activity due by the end of that day in app time, with hasTime false", () => {
    // The app is on Eastern time: 5 Nov 2026 is EST, so the day ends at 04:59:59.999 UTC on the 6th.
    const winter = mapActivityTiming({ due_date: "2026-11-05", due_time: null }, FALLBACK);
    expect(winter).toEqual({
      dueAt: new Date("2026-11-06T04:59:59.999Z"),
      hasTime: false,
      doneAt: null,
      issues: [],
    });
    // 15 Jul 2026 is EDT (UTC-4).
    const summer = mapActivityTiming({ due_date: "2026-07-15", due_time: "" }, FALLBACK);
    expect(summer.dueAt).toEqual(new Date("2026-07-16T03:59:59.999Z"));
    expect(summer.hasTime).toBe(false);
  });

  it("uses the fallback date and an issue when there is no due date", () => {
    for (const due_date of [null, undefined, "", "  "]) {
      const result = mapActivityTiming({ due_date, due_time: "10:00" }, FALLBACK);
      expect(result.dueAt).toEqual(FALLBACK);
      expect(result.hasTime).toBe(false);
      expect(result.issues).toEqual(["The activity had no due date, so the import date was used."]);
    }
  });

  it("uses the fallback date and an issue for a date that is not real", () => {
    const result = mapActivityTiming({ due_date: "2026-02-30" }, FALLBACK);
    expect(result.dueAt).toEqual(FALLBACK);
    expect(result.issues).toEqual(['The due date "2026-02-30" is not a real date, so the import date was used.']);
  });

  it("falls back to the end of the day, with an issue, for a time it cannot read", () => {
    const result = mapActivityTiming({ due_date: "2026-11-05", due_time: "25:99" }, FALLBACK);
    expect(result.dueAt).toEqual(new Date("2026-11-06T04:59:59.999Z"));
    expect(result.hasTime).toBe(false);
    expect(result.issues).toEqual(['The due time "25:99" could not be read, so the activity is due by the end of that day.']);
  });

  it("takes the done time from either Pipedrive timestamp style", () => {
    const iso = mapActivityTiming(
      { due_date: "2026-11-05", done: true, marked_as_done_time: "2026-11-05T15:00:00Z" },
      FALLBACK,
    );
    expect(iso.doneAt).toEqual(new Date("2026-11-05T15:00:00.000Z"));
    expect(iso.issues).toEqual([]);
    const spaced = mapActivityTiming(
      { due_date: "2026-11-05", done: true, marked_as_done_time: "2026-11-05 15:00:00" },
      FALLBACK,
    );
    expect(spaced.doneAt).toEqual(new Date("2026-11-05T15:00:00.000Z"));
  });

  it("uses the fallback date and an issue for a done activity with no done time", () => {
    const result = mapActivityTiming({ due_date: "2026-11-05", due_time: "14:30", done: true, marked_as_done_time: null }, FALLBACK);
    expect(result.doneAt).toEqual(FALLBACK);
    expect(result.issues).toEqual(["The activity was done but had no done time, so the import date was used."]);
  });

  it("uses the fallback date and an issue for a done time it cannot read", () => {
    const result = mapActivityTiming({ due_date: "2026-11-05", done: true, marked_as_done_time: "yesterday" }, FALLBACK);
    expect(result.doneAt).toEqual(FALLBACK);
    expect(result.issues).toHaveLength(1);
  });

  it("leaves doneAt empty for an activity that is not done, even if a stale done time is there", () => {
    expect(mapActivityTiming({ due_date: "2026-11-05", done: false }, FALLBACK).doneAt).toBeNull();
    expect(mapActivityTiming({ due_date: "2026-11-05" }, FALLBACK).doneAt).toBeNull();
    const stale = mapActivityTiming(
      { due_date: "2026-11-05", done: false, marked_as_done_time: "2026-11-05T15:00:00Z" },
      FALLBACK,
    );
    expect(stale.doneAt).toBeNull();
    expect(stale.issues).toEqual([]);
  });
});

describe("htmlToPlainText", () => {
  it("drops tags and scripts, keeps line breaks for br, p and li, and decodes entities", () => {
    const html =
      "<p>Hello &amp; welcome</p>" +
      '<script type="text/javascript">alert("x")</script>' +
      "<p>Second&nbsp;line<br>third<br/>fourth</p>" +
      "<ul><li>One</li><li>Two &lt;3</li></ul>" +
      '<p><a href="https://evil.example" onclick="steal()">a &quot;link&quot; isn&#39;t shown as HTML</a></p>';
    expect(htmlToPlainText(html)).toEqual({
      text: 'Hello & welcome\nSecond line\nthird\nfourth\nOne\nTwo <3\na "link" isn\'t shown as HTML',
      issues: [],
    });
  });

  it("removes styles, comments and an unclosed script along with their contents", () => {
    expect(htmlToPlainText("<style>p { color: red }</style>A<!-- hidden -->B").text).toBe("AB");
    expect(htmlToPlainText("Before<script>alert(1)").text).toBe("Before");
    expect(htmlToPlainText("Before<SCRIPT >alert(1)</SCRIPT >After").text).toBe("BeforeAfter");
  });

  it("decodes entities once, so an encoded tag stays plain text and nothing is decoded twice", () => {
    expect(htmlToPlainText("&lt;script&gt;alert(1)&lt;/script&gt;").text).toBe("<script>alert(1)</script>");
    expect(htmlToPlainText("&amp;lt;b&amp;gt;").text).toBe("&lt;b&gt;");
    expect(htmlToPlainText("&#65;&#x42;&apos;").text).toBe("AB'");
  });

  it("starts a new line at a paragraph that follows loose text, but never adds a blank one", () => {
    expect(htmlToPlainText("Intro<p>Next</p>").text).toBe("Intro\nNext");
    expect(htmlToPlainText("<p>a</p><p>b</p>").text).toBe("a\nb");
    expect(htmlToPlainText("<div>one</div>two<div>three</div>").text).toBe("one\ntwo\nthree");
  });

  it("keeps a bare less-than sign that is not a tag", () => {
    expect(htmlToPlainText("5 < 6 and 7 > 3").text).toBe("5 < 6 and 7 > 3");
  });

  it("tidies spaces and blank lines and removes control characters", () => {
    expect(htmlToPlainText("<p>  a   b  </p><p></p><p></p><p></p><p>c</p>").text).toBe("a b\n\nc");
    expect(htmlToPlainText("a\u0000b\u0007c").text).toBe("abc");
    expect(htmlToPlainText("line1\r\nline2").text).toBe("line1\nline2");
  });

  it("stays fast on a long note full of broken tags", () => {
    // Every "<a" with no closing ">" must not make the next one rescan the whole rest of the note.
    const started = performance.now();
    const result = htmlToPlainText("<a".repeat(50_000));
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("stays fast on a long run of spaces", () => {
    const started = performance.now();
    const result = htmlToPlainText(`<p>a${" ".repeat(200_000)}b</p>`);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(result.text).toBe("a b");
  });

  it("gives an empty text for null, undefined or nothing but tags", () => {
    expect(htmlToPlainText(null)).toEqual({ text: "", issues: [] });
    expect(htmlToPlainText(undefined)).toEqual({ text: "", issues: [] });
    expect(htmlToPlainText("<p><br></p>")).toEqual({ text: "", issues: [] });
  });

  it("cuts 60,000 characters down to the limit with an issue", () => {
    const result = htmlToPlainText(`<p>${"a".repeat(60_000)}</p><script>alert(1)</script>`);
    expect(result.text).toBe("a".repeat(NOTE_MAX_CHARS));
    expect(result.issues).toEqual(["The text was longer than 50,000 characters, so the end was cut off."]);
  });

  it("keeps exactly the limit without an issue", () => {
    const result = htmlToPlainText("b".repeat(NOTE_MAX_CHARS));
    expect(result.text).toHaveLength(NOTE_MAX_CHARS);
    expect(result.issues).toEqual([]);
  });

  it("never cuts an emoji in half", () => {
    const result = htmlToPlainText("a".repeat(NOTE_MAX_CHARS - 1) + "\u{1F600}" + "b");
    expect(result.text).toBe("a".repeat(NOTE_MAX_CHARS - 1));
    expect(result.issues).toHaveLength(1);
  });
});

describe("primaryOf", () => {
  it("returns the entry marked primary, even when it is the second one", () => {
    expect(
      primaryOf([
        { value: "first@example.com", primary: false },
        { value: "second@example.com", primary: true },
      ]),
    ).toBe("second@example.com");
  });

  it("returns the first filled-in entry when none is primary", () => {
    expect(primaryOf([{ value: "  " }, { value: " a@example.com " }, { value: "b@example.com" }])).toBe("a@example.com");
  });

  it("skips a primary entry with a blank value", () => {
    expect(primaryOf([{ value: "", primary: true }, { value: "b@example.com" }])).toBe("b@example.com");
  });

  it("returns null for nothing usable", () => {
    expect(primaryOf(null)).toBeNull();
    expect(primaryOf(undefined)).toBeNull();
    expect(primaryOf([])).toBeNull();
    expect(primaryOf([{ value: " " }])).toBeNull();
  });
});

const person = {
  id: 101,
  name: "Dr. Ana Reyes",
  first_name: "Ana",
  last_name: "Reyes",
  owner_id: 7,
  org_id: 55,
  add_time: "2026-03-02T15:04:05Z",
  update_time: "2026-04-01T09:00:00Z",
  is_deleted: false,
  emails: [
    { value: "old@oakcreek.com", primary: false, label: "work" },
    { value: " Ana.Reyes@OakCreek.com ", primary: true, label: "work" },
  ],
  phones: [{ value: "(555) 123-4567", primary: true, label: "mobile" }],
  job_title: "Owner",
};

describe("mapPerson", () => {
  it("maps a person with two emails, the second primary, to the primary values and their keys", () => {
    const result = mapped(mapPerson(person, FALLBACK));
    expect(result.pipedriveId).toBe(101);
    expect(result.fields).toEqual({
      name: "Dr. Ana Reyes",
      email: "Ana.Reyes@OakCreek.com",
      phone: "(555) 123-4567",
      role: "Owner",
      emailKey: "ana.reyes@oakcreek.com",
      phoneKey: "5551234567",
      nameKey: "dranareyes",
      createdAt: new Date("2026-03-02T15:04:05.000Z"),
    });
    expect(result.links).toEqual({ ownerPipedriveUserId: 7, organizationPipedriveId: 55 });
    // The second email cannot be stored (one email per person), so the report must say so.
    expect(result.issues).toEqual(["The person had 1 other email address that was not copied (the app keeps one)."]);
  });

  it("says nothing when the extra email is the same address typed another way", () => {
    const result = mapped(
      mapPerson(
        {
          ...person,
          emails: [
            { value: "ana@oakcreek.com", primary: true },
            { value: " ANA@oakcreek.com", primary: false },
          ],
        },
        FALLBACK,
      ),
    );
    expect(result.issues).toEqual([]);
  });

  it("notes extra phone numbers that were not copied", () => {
    const result = mapped(
      mapPerson(
        {
          ...person,
          emails: [{ value: "ana@oakcreek.com", primary: true }],
          phones: [
            { value: "555-123-4567", primary: true },
            { value: "555-987-6543", primary: false },
            { value: "555-111-2222", primary: false },
          ],
        },
        FALLBACK,
      ),
    );
    expect(result.fields.phone).toBe("555-123-4567");
    expect(result.issues).toEqual(["The person had 2 other phone numbers that were not copied (the app keeps one)."]);
  });

  it("uses the email as the name when the person has none, with an issue", () => {
    const result = mapped(
      mapPerson({ ...person, name: "  ", first_name: null, last_name: null, emails: [{ value: "front@oakcreek.com", primary: true }] }, FALLBACK),
    );
    expect(result.fields.name).toBe("front@oakcreek.com");
    expect(result.fields.nameKey).toBe("frontoakcreekcom");
    expect(result.issues).toEqual(["The person had no name, so the email address was used as the name."]);
  });

  it("uses the phone as the name when there is no name or email", () => {
    const result = mapped(
      mapPerson({ ...person, name: null, first_name: "", last_name: "", emails: [], phones: [{ value: "555-123-4567", primary: true }] }, FALLBACK),
    );
    expect(result.fields.name).toBe("555-123-4567");
    expect(result.fields.email).toBeNull();
    expect(result.fields.emailKey).toBeNull();
    expect(result.issues).toEqual(["The person had no name, so the phone number was used as the name."]);
  });

  it("calls a person with no name, email or phone Unnamed contact, with an issue", () => {
    const result = mapped(mapPerson({ id: 9, name: null, emails: null, phones: null, add_time: "2026-03-02T15:04:05Z" }, FALLBACK));
    expect(result.fields.name).toBe("Unnamed contact");
    expect(result.fields.email).toBeNull();
    expect(result.fields.phone).toBeNull();
    expect(result.fields.role).toBeNull();
    expect(result.links).toEqual({ ownerPipedriveUserId: null, organizationPipedriveId: null });
    expect(result.issues).toEqual(["The person had no name, email or phone, so they were called Unnamed contact."]);
  });

  it("builds the name from first and last name when the full name is empty", () => {
    const result = mapped(mapPerson({ ...person, name: "", first_name: " Ana ", last_name: "Reyes" }, FALLBACK));
    expect(result.fields.name).toBe("Ana Reyes");
    expect(result.issues).toHaveLength(1); // only the extra email note
  });

  it("drops an email that does not look like one and says so", () => {
    const result = mapped(mapPerson({ ...person, emails: [{ value: "n/a", primary: true }, { value: "real@oakcreek.com" }] }, FALLBACK));
    expect(result.fields.email).toBe("real@oakcreek.com");
    expect(result.issues).toEqual(['"n/a" is not an email address, so it was not copied.']);
  });

  it("uses the import date and an issue when the created time is missing or unreadable", () => {
    const missing = mapped(mapPerson({ ...person, add_time: null, emails: [{ value: "a@b.co" }] }, FALLBACK));
    expect(missing.fields.createdAt).toEqual(FALLBACK);
    expect(missing.issues).toEqual(["The created date was missing or unreadable, so the import date was used."]);
    expect(mapped(mapPerson({ ...person, add_time: "2026-13-45T00:00:00Z", emails: [] }, FALLBACK)).fields.createdAt).toEqual(FALLBACK);
  });

  it("accepts a v1 style nested id for the owner and the organization", () => {
    const result = mapped(mapPerson({ ...person, emails: [], owner_id: { value: 12 }, org_id: { value: 34 } }, FALLBACK));
    expect(result.links).toEqual({ ownerPipedriveUserId: 12, organizationPipedriveId: 34 });
  });

  it("cuts a very long name to the title limit with an issue", () => {
    const result = mapped(mapPerson({ ...person, emails: [], name: "N".repeat(TITLE_MAX + 20) }, FALLBACK));
    expect(result.fields.name).toBe("N".repeat(TITLE_MAX));
    expect(result.issues).toEqual([`The name was longer than ${TITLE_MAX} characters, so the end was cut off.`]);
  });

  it("skips a deleted person", () => {
    expect(skipped(mapPerson({ ...person, is_deleted: true }, FALLBACK)).reason).toBe("The person was deleted in Pipedrive.");
  });
});

const organization = {
  id: 55,
  name: "  Oak Creek Dental ",
  owner_id: 7,
  add_time: "2026-01-10T08:00:00Z",
  update_time: null,
  is_deleted: false,
  address: {
    value: "12 Oak St, Charlotte, NC 28202, USA",
    postal_code: "28202",
    locality: "Charlotte",
  },
  website: "oakcreekdental.com",
};

describe("mapOrganization", () => {
  it("maps name, address, website, zip and the duplicate key", () => {
    const result = mapped(mapOrganization(organization, FALLBACK));
    expect(result.pipedriveId).toBe(55);
    expect(result.fields).toEqual({
      name: "Oak Creek Dental",
      address: "12 Oak St, Charlotte, NC 28202, USA",
      website: "https://oakcreekdental.com/",
      zip: "28202",
      nameKey: "oakcreekdental",
      createdAt: new Date("2026-01-10T08:00:00.000Z"),
    });
    expect(result.links).toEqual({ ownerPipedriveUserId: 7 });
    expect(result.issues).toEqual([]);
  });

  it("imports an organization with no address, website or owner without any issue", () => {
    const result = mapped(mapOrganization({ id: 56, name: "Bare Dental", address: null, website: null, add_time: "2026-01-10T08:00:00Z" }, FALLBACK));
    expect(result.fields.address).toBeNull();
    expect(result.fields.website).toBeNull();
    expect(result.fields.zip).toBeNull();
    expect(result.links).toEqual({ ownerPipedriveUserId: null });
    expect(result.issues).toEqual([]);
  });

  it("keeps the address text and drops a postal code that is not a US ZIP, with an issue", () => {
    const result = mapped(
      mapOrganization({ ...organization, address: { value: "1 High St, London", postal_code: "SW1A 1AA" } }, FALLBACK),
    );
    expect(result.fields.address).toBe("1 High St, London");
    expect(result.fields.zip).toBeNull();
    expect(result.issues).toEqual(['The postal code "SW1A 1AA" is not a US ZIP, so it was not copied.']);
  });

  it("drops a website that is not a web address, with an issue", () => {
    const result = mapped(mapOrganization({ ...organization, website: "call us" }, FALLBACK));
    expect(result.fields.website).toBeNull();
    expect(result.issues).toEqual(['The website "call us" is not a web address, so it was not copied.']);
  });

  it("calls a nameless organization Unnamed organization, with an issue", () => {
    const result = mapped(mapOrganization({ ...organization, name: " " }, FALLBACK));
    expect(result.fields.name).toBe("Unnamed organization");
    expect(result.issues).toEqual(["The organization had no name, so it was called Unnamed organization."]);
  });

  it("skips a deleted organization", () => {
    expect(skipped(mapOrganization({ ...organization, is_deleted: true }, FALLBACK)).reason).toBe(
      "The organization was deleted in Pipedrive.",
    );
  });
});

const openDeal = {
  id: 900,
  title: "  Oak Creek Dental - Direct Mail  ",
  owner_id: 7,
  person_id: 101,
  org_id: 55,
  pipeline_id: 3,
  stage_id: 14,
  value: 1234.5,
  currency: "USD",
  add_time: "2026-03-02T15:04:05Z",
  update_time: "2026-03-20T10:00:00Z",
  stage_change_time: "2026-03-10T11:30:00Z",
  is_deleted: false,
  is_archived: false,
  status: "open",
  probability: null,
  lost_reason: null,
  close_time: null,
  won_time: null,
  lost_time: null,
  expected_close_date: "2026-12-01",
  label_ids: [],
  custom_fields: {},
};

describe("mapDeal", () => {
  it("maps an open deal with its value in cents and the raw Pipedrive ids of everything it links to", () => {
    const result = mapped(mapDeal(openDeal, FALLBACK));
    expect(result.pipedriveId).toBe(900);
    expect(result.fields).toEqual({
      title: "Oak Creek Dental - Direct Mail",
      valueCents: 123450,
      status: "OPEN",
      lostReason: null,
      lostComment: null,
      stageEnteredAt: new Date("2026-03-10T11:30:00.000Z"),
      wonAt: null,
      lostAt: null,
      // The app keeps a close date as the end of that day in app time (Eastern).
      expectedCloseDate: new Date("2026-12-02T04:59:59.999Z"),
      archivedAt: null,
      createdAt: new Date("2026-03-02T15:04:05.000Z"),
    });
    expect(result.links).toEqual({
      ownerPipedriveUserId: 7,
      personPipedriveId: 101,
      organizationPipedriveId: 55,
      stagePipedriveId: 14,
      pipelinePipedriveId: 3,
    });
    expect(result.customFields).toEqual({});
    expect(result.issues).toEqual([]);
  });

  it("maps a won deal with its won time and no lost fields", () => {
    const result = mapped(
      mapDeal({ ...openDeal, status: "won", won_time: "2026-04-01T16:00:00Z", close_time: "2026-04-01T16:00:00Z" }, FALLBACK),
    );
    expect(result.fields.status).toBe("WON");
    expect(result.fields.wonAt).toEqual(new Date("2026-04-01T16:00:00.000Z"));
    expect(result.fields.lostAt).toBeNull();
    expect(result.fields.lostReason).toBeNull();
    expect(result.issues).toEqual([]);
  });

  it("falls back to the close time, then the import date, for a won deal with no won time", () => {
    const viaClose = mapped(mapDeal({ ...openDeal, status: "won", won_time: null, close_time: "2026-04-02T09:00:00Z" }, FALLBACK));
    expect(viaClose.fields.wonAt).toEqual(new Date("2026-04-02T09:00:00.000Z"));
    expect(viaClose.issues).toEqual([]);
    const neither = mapped(mapDeal({ ...openDeal, status: "won", won_time: null, close_time: null }, FALLBACK));
    expect(neither.fields.wonAt).toEqual(FALLBACK);
    expect(neither.issues).toEqual(["The deal is won but had no won time, so the import date was used."]);
  });

  it("maps a lost deal and keeps a lost reason that matches one of the app's reasons", () => {
    const result = mapped(
      mapDeal({ ...openDeal, status: "lost", lost_time: "2026-05-01T12:00:00Z", lost_reason: " price " }, FALLBACK),
    );
    expect(result.fields.status).toBe("LOST");
    expect(result.fields.lostAt).toEqual(new Date("2026-05-01T12:00:00.000Z"));
    expect(result.fields.wonAt).toBeNull();
    expect(result.fields.lostReason).toBe("Price");
    expect(result.fields.lostComment).toBeNull();
    expect(result.issues).toEqual([]);
  });

  it("files any other lost reason under Other and keeps Pipedrive's words as the comment", () => {
    const result = mapped(
      mapDeal({ ...openDeal, status: "lost", lost_time: "2026-05-01T12:00:00Z", lost_reason: "Went with Dr. Lee next door" }, FALLBACK),
    );
    expect(result.fields.lostReason).toBe("Other");
    expect(result.fields.lostComment).toBe("Went with Dr. Lee next door");
  });

  it("leaves the lost reason empty for a lost deal that had none, and uses the import date for a missing lost time", () => {
    const result = mapped(mapDeal({ ...openDeal, status: "lost", lost_time: null, close_time: null, lost_reason: " " }, FALLBACK));
    expect(result.fields.lostReason).toBeNull();
    expect(result.fields.lostComment).toBeNull();
    expect(result.fields.lostAt).toEqual(FALLBACK);
    expect(result.issues).toEqual(["The deal is lost but had no lost time, so the import date was used."]);
  });

  it("ignores won, lost and reason values on a deal that is open again", () => {
    const result = mapped(
      mapDeal({ ...openDeal, status: "open", won_time: "2026-04-01T16:00:00Z", lost_time: "2026-05-01T12:00:00Z", lost_reason: "Price" }, FALLBACK),
    );
    expect(result.fields.wonAt).toBeNull();
    expect(result.fields.lostAt).toBeNull();
    expect(result.fields.lostReason).toBeNull();
  });

  it("uses the stage change time for stageEnteredAt, else the created time", () => {
    expect(mapped(mapDeal(openDeal, FALLBACK)).fields.stageEnteredAt).toEqual(new Date("2026-03-10T11:30:00.000Z"));
    const noChange = mapped(mapDeal({ ...openDeal, stage_change_time: null }, FALLBACK));
    expect(noChange.fields.stageEnteredAt).toEqual(new Date("2026-03-02T15:04:05.000Z"));
    expect(noChange.issues).toEqual([]);
  });

  it("skips a deleted deal, by status or by flag", () => {
    expect(skipped(mapDeal({ ...openDeal, status: "deleted" }, FALLBACK)).reason).toBe("The deal was deleted in Pipedrive.");
    expect(skipped(mapDeal({ ...openDeal, is_deleted: true }, FALLBACK)).reason).toBe("The deal was deleted in Pipedrive.");
  });

  it("treats a status it does not know as open, with an issue", () => {
    const result = mapped(mapDeal({ ...openDeal, status: "paused" }, FALLBACK));
    expect(result.fields.status).toBe("OPEN");
    expect(result.issues).toEqual(['The deal status "paused" is not one the app has, so it was set to open.']);
  });

  it("imports a deal with a null value as $0 with an issue", () => {
    const result = mapped(mapDeal({ ...openDeal, value: null }, FALLBACK));
    expect(result.fields.valueCents).toBe(0);
    expect(result.issues).toEqual(["The deal had no value, so it was set to $0."]);
  });

  it("keeps a $0 deal with no issue", () => {
    const result = mapped(mapDeal({ ...openDeal, value: 0 }, FALLBACK));
    expect(result.fields.valueCents).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it("sets a negative value to $0 with an issue", () => {
    const result = mapped(mapDeal({ ...openDeal, value: -300 }, FALLBACK));
    expect(result.fields.valueCents).toBe(0);
    expect(result.issues).toEqual(["The deal value was negative (-300), so it was set to $0."]);
  });

  it("flags a non-USD value and keeps the number", () => {
    const result = mapped(mapDeal({ ...openDeal, value: 2000, currency: "EUR" }, FALLBACK));
    expect(result.fields.valueCents).toBe(200000);
    expect(result.issues).toEqual(["The deal value is in EUR. The number was kept as dollars with no conversion."]);
  });

  it("clamps a value above the cap and says so", () => {
    const result = mapped(mapDeal({ ...openDeal, value: 5_000_000_000 }, FALLBACK));
    expect(result.fields.valueCents).toBe(MAX_DEAL_CENTS);
    expect(result.issues).toEqual(["The deal value was above $10,000,000, so it was set to $10,000,000."]);
  });

  it("cuts a title past the limit and gives a blank title a name, each with an issue", () => {
    const long = mapped(mapDeal({ ...openDeal, title: "T".repeat(TITLE_MAX + 5) }, FALLBACK));
    expect(long.fields.title).toBe("T".repeat(TITLE_MAX));
    expect(long.issues).toEqual([`The deal title was longer than ${TITLE_MAX} characters, so the end was cut off.`]);
    const blank = mapped(mapDeal({ ...openDeal, title: "   " }, FALLBACK));
    expect(blank.fields.title).toBe("Untitled deal");
    expect(blank.issues).toEqual(["The deal had no title, so it was called Untitled deal."]);
  });

  it("returns null links for a deal with no person, organization or owner", () => {
    const result = mapped(mapDeal({ ...openDeal, person_id: null, org_id: null, owner_id: undefined }, FALLBACK));
    expect(result.links.personPipedriveId).toBeNull();
    expect(result.links.organizationPipedriveId).toBeNull();
    expect(result.links.ownerPipedriveUserId).toBeNull();
  });

  it("marks an archived deal archived, at the archive time", () => {
    const result = mapped(mapDeal({ ...openDeal, is_archived: true, archive_time: "2026-06-01T00:00:00Z" }, FALLBACK));
    expect(result.fields.archivedAt).toEqual(new Date("2026-06-01T00:00:00.000Z"));
    const noTime = mapped(mapDeal({ ...openDeal, is_archived: true, archive_time: null }, FALLBACK));
    expect(noTime.fields.archivedAt).toEqual(FALLBACK);
  });

  it("returns custom field values as plain text keyed by the raw Pipedrive field key", () => {
    const result = mapped(
      mapDeal(
        {
          ...openDeal,
          custom_fields: {
            aaaa: "  Direct mail  ",
            bbbb: 42,
            cccc: { value: 500.5, currency: "USD" },
            dddd: [11, 12],
            eeee: { value: "2026-01-01", until: "2026-02-01" },
            ffff: { value: "123 Main St", route: "Main St" },
            gggg: 7,
            hhhh: null,
            iiii: "   ",
            jjjj: [],
            kkkk: {},
            llll: true,
          },
        },
        FALLBACK,
      ),
    );
    expect(result.customFields).toEqual({
      aaaa: "Direct mail",
      bbbb: "42",
      cccc: "500.5",
      dddd: "11, 12",
      eeee: "2026-01-01",
      ffff: "123 Main St",
      gggg: "7",
      llll: "true",
    });
  });
});

const lead: PipedriveLead = {
  id: "adf21080-0e10-11eb-879b-05d71fb426ec",
  title: " Oak Creek Dental ",
  owner_id: 7,
  creator_id: 7,
  label_ids: [],
  person_id: 101,
  organization_id: 55,
  source_name: "Manually created",
  origin: "ManuallyCreated",
  origin_id: null,
  channel: null,
  channel_id: null,
  is_archived: false,
  was_seen: true,
  value: { amount: 999, currency: "USD" },
  expected_close_date: null,
  next_activity_id: null,
  add_time: "2020-10-14T11:30:36.551Z",
  update_time: "2020-10-15T08:00:00.000Z",
  visible_to: "3",
  cc_email: "oak-creek-dental@pipedrivemail.com",
  dcf558aac1ae4e8c4f849ba5e668430d8df9be12: "Joker",
};

describe("mapLead", () => {
  it("maps a lead, keeping its UUID as the id and the raw ids of what it links to", () => {
    const result = mapped(mapLead(lead, FALLBACK));
    expect(result.pipedriveId).toBe("adf21080-0e10-11eb-879b-05d71fb426ec");
    expect(result.fields).toEqual({
      title: "Oak Creek Dental",
      source: "Added by hand",
      status: "OPEN",
      archivedAt: null,
      createdAt: new Date("2020-10-14T11:30:36.551Z"),
    });
    expect(result.links).toEqual({ ownerPipedriveUserId: 7, personPipedriveId: 101, organizationPipedriveId: 55 });
    expect(result.customFields).toEqual({ dcf558aac1ae4e8c4f849ba5e668430d8df9be12: "Joker" });
    expect(result.issues).toEqual([]);
  });

  it("keeps a source that is one of the app's sources and files the rest under Added by hand", () => {
    expect(mapped(mapLead({ ...lead, source_name: "referral" }, FALLBACK)).fields.source).toBe("Referral");
    expect(mapped(mapLead({ ...lead, source_name: "Website form" }, FALLBACK)).fields.source).toBe("Added by hand");
    expect(mapped(mapLead({ ...lead, source_name: null }, FALLBACK)).fields.source).toBe("Added by hand");
  });

  it("marks an archived lead archived, from the last update time", () => {
    const result = mapped(mapLead({ ...lead, is_archived: true }, FALLBACK));
    expect(result.fields.status).toBe("ARCHIVED");
    expect(result.fields.archivedAt).toEqual(new Date("2020-10-15T08:00:00.000Z"));
    const noUpdate = mapped(mapLead({ ...lead, is_archived: true, update_time: null }, FALLBACK));
    expect(noUpdate.fields.archivedAt).toEqual(FALLBACK);
  });

  it("reads only the 40-character custom field keys, so a currency or other helper key is not a field", () => {
    const result = mapped(
      mapLead(
        {
          ...lead,
          dcf558aac1ae4e8c4f849ba5e668430d8df9be12: "Joker",
          "576da0ff55f3635ae48bfe1416854dfc2d3c692a": "11,12",
          "576da0ff55f3635ae48bfe1416854dfc2d3c692b": 500,
          "576da0ff55f3635ae48bfe1416854dfc2d3c692b_currency": "USD",
          "576da0ff55f3635ae48bfe1416854dfc2d3c692c": null,
          "576da0ff55f3635ae48bfe1416854dfc2d3c692d": "",
        },
        FALLBACK,
      ),
    );
    expect(result.customFields).toEqual({
      dcf558aac1ae4e8c4f849ba5e668430d8df9be12: "Joker",
      "576da0ff55f3635ae48bfe1416854dfc2d3c692a": "11,12",
      "576da0ff55f3635ae48bfe1416854dfc2d3c692b": "500",
    });
  });

  it("gives a blank title a name and returns null links when nothing is linked", () => {
    const result = mapped(mapLead({ ...lead, title: " ", person_id: null, organization_id: null, owner_id: undefined }, FALLBACK));
    expect(result.fields.title).toBe("Untitled lead");
    expect(result.issues).toEqual(["The lead had no title, so it was called Untitled lead."]);
    expect(result.links).toEqual({ ownerPipedriveUserId: null, personPipedriveId: null, organizationPipedriveId: null });
  });
});

const activity = {
  id: 5001,
  subject: "  Follow-up call  ",
  type: "call",
  done: false,
  due_date: "2026-11-05",
  due_time: "14:30",
  duration: "00:30",
  marked_as_done_time: null,
  add_time: "2026-10-01T09:00:00Z",
  update_time: "2026-10-01T09:00:00Z",
  note: "<p>Ask about the <b>proposal</b></p>",
  public_description: null,
  owner_id: 7,
  creator_user_id: 7,
  deal_id: 900,
  lead_id: null,
  person_id: 101,
  org_id: 55,
  is_deleted: false,
};

describe("mapActivity", () => {
  it("maps a timed call on a deal with its note as plain text and the raw ids it links to", () => {
    const result = mapped(mapActivity(activity, FALLBACK));
    expect(result.pipedriveId).toBe(5001);
    expect(result.fields).toEqual({
      type: "CALL",
      subject: "Follow-up call",
      dueAt: new Date("2026-11-05T14:30:00.000Z"),
      hasTime: true,
      doneAt: null,
      note: "Ask about the proposal",
      createdAt: new Date("2026-10-01T09:00:00.000Z"),
    });
    expect(result.links).toEqual({
      ownerPipedriveUserId: 7,
      dealPipedriveId: 900,
      leadPipedriveId: null,
      personPipedriveId: 101,
      organizationPipedriveId: 55,
    });
    expect(result.issues).toEqual([]);
  });

  it("maps a date-only email activity on a lead, keeping the lead id as the UUID text", () => {
    const result = mapped(
      mapActivity(
        { ...activity, type: "Email", due_time: null, deal_id: null, lead_id: "adf21080-0e10-11eb-879b-05d71fb426ec", note: null },
        FALLBACK,
      ),
    );
    expect(result.fields.type).toBe("EMAIL");
    expect(result.fields.hasTime).toBe(false);
    expect(result.fields.dueAt).toEqual(new Date("2026-11-06T04:59:59.999Z"));
    expect(result.fields.note).toBeNull();
    expect(result.links.leadPipedriveId).toBe("adf21080-0e10-11eb-879b-05d71fb426ec");
    expect(result.links.dealPipedriveId).toBeNull();
  });

  it("imports a done activity with no done time, at the import date, with an issue", () => {
    const result = mapped(mapActivity({ ...activity, done: true, marked_as_done_time: null }, FALLBACK));
    expect(result.fields.doneAt).toEqual(FALLBACK);
    expect(result.issues).toEqual(["The activity was done but had no done time, so the import date was used."]);
  });

  it("turns an unknown type into a Task and reports it", () => {
    const result = mapped(mapActivity({ ...activity, type: "Site visit" }, FALLBACK));
    expect(result.fields.type).toBe("TASK");
    expect(result.issues).toEqual(['The activity type "Site visit" is not one the app has, so it became a Task.']);
  });

  it("uses the import date for an activity with no due date", () => {
    const result = mapped(mapActivity({ ...activity, due_date: null, due_time: null }, FALLBACK));
    expect(result.fields.dueAt).toEqual(FALLBACK);
    expect(result.fields.hasTime).toBe(false);
    expect(result.issues).toEqual(["The activity had no due date, so the import date was used."]);
  });

  it("gives a blank subject a name and cuts a long one, each with an issue", () => {
    const blank = mapped(mapActivity({ ...activity, subject: " " }, FALLBACK));
    expect(blank.fields.subject).toBe("Untitled activity");
    expect(blank.issues).toEqual(["The activity had no subject, so it was called Untitled activity."]);
    const long = mapped(mapActivity({ ...activity, subject: "S".repeat(SUBJECT_MAX + 1) }, FALLBACK));
    expect(long.fields.subject).toBe("S".repeat(SUBJECT_MAX));
    expect(long.issues).toEqual([`The activity subject was longer than ${SUBJECT_MAX} characters, so the end was cut off.`]);
  });

  it("falls back to the public description when the note is empty", () => {
    const result = mapped(mapActivity({ ...activity, note: "<p></p>", public_description: "Bring the sample kit" }, FALLBACK));
    expect(result.fields.note).toBe("Bring the sample kit");
  });

  it("strips a script out of the note and cuts a very long one", () => {
    const result = mapped(mapActivity({ ...activity, note: `<script>steal()</script>${"x".repeat(NOTE_MAX_CHARS + 1)}` }, FALLBACK));
    expect(result.fields.note).toBe("x".repeat(NOTE_MAX_CHARS));
    expect(result.issues).toEqual(["The text was longer than 50,000 characters, so the end was cut off."]);
  });

  it("returns null links for an activity attached to nothing and skips a deleted one", () => {
    const loose = mapped(
      mapActivity({ ...activity, deal_id: null, lead_id: null, person_id: null, org_id: null, owner_id: null }, FALLBACK),
    );
    expect(loose.links).toEqual({
      ownerPipedriveUserId: null,
      dealPipedriveId: null,
      leadPipedriveId: null,
      personPipedriveId: null,
      organizationPipedriveId: null,
    });
    expect(skipped(mapActivity({ ...activity, is_deleted: true }, FALLBACK)).reason).toBe(
      "The activity was deleted in Pipedrive.",
    );
  });
});

const note = {
  id: 321,
  content: "<p>Spoke with the office manager.</p>",
  deal_id: 900,
  person_id: 101,
  org_id: 55,
  lead_id: null,
  user_id: 7,
  add_time: "2019-12-09 13:59:21",
  update_time: "2019-12-09 14:26:11",
  active_flag: true,
  pinned_to_deal_flag: false,
  pinned_to_person_flag: false,
  pinned_to_organization_flag: false,
};

describe("mapNote", () => {
  it("maps a v1 note to plain text, UTC dates and raw ids", () => {
    const result = mapped(mapNote(note, FALLBACK));
    expect(result.pipedriveId).toBe(321);
    expect(result.fields).toEqual({
      body: "Spoke with the office manager.",
      pinned: false,
      createdAt: new Date("2019-12-09T13:59:21.000Z"),
    });
    expect(result.links).toEqual({
      ownerPipedriveUserId: 7,
      dealPipedriveId: 900,
      leadPipedriveId: null,
      personPipedriveId: 101,
      organizationPipedriveId: 55,
    });
    expect(result.issues).toEqual([]);
  });

  it("strips a script out of an HTML note and cuts 60,000 characters down to the limit", () => {
    const result = mapped(
      mapNote({ ...note, content: `<p>Start</p><script>alert('x')</script><p>${"y".repeat(60_000)}</p>` }, FALLBACK),
    );
    expect(result.fields.body.startsWith("Start\nyyyy")).toBe(true);
    expect(result.fields.body).toHaveLength(NOTE_MAX_CHARS);
    expect(result.fields.body).not.toContain("alert");
    expect(result.fields.body).not.toContain("<");
    expect(result.issues).toEqual(["The text was longer than 50,000 characters, so the end was cut off."]);
  });

  it("marks a note pinned when it is pinned anywhere", () => {
    expect(mapped(mapNote({ ...note, pinned_to_person_flag: true }, FALLBACK)).fields.pinned).toBe(true);
    expect(mapped(mapNote({ ...note, pinned_to_organization_flag: true }, FALLBACK)).fields.pinned).toBe(true);
    expect(mapped(mapNote({ ...note, pinned_to_deal_flag: true }, FALLBACK)).fields.pinned).toBe(true);
  });

  it("links a lead note by its UUID text and accepts v1 style nested ids", () => {
    const result = mapped(
      mapNote(
        {
          ...note,
          deal_id: { value: 77 },
          person_id: { value: 88 },
          org_id: null,
          user_id: { value: 9 },
          lead_id: "adf21080-0e10-11eb-879b-05d71fb426ec",
        },
        FALLBACK,
      ),
    );
    expect(result.links).toEqual({
      ownerPipedriveUserId: 9,
      dealPipedriveId: 77,
      leadPipedriveId: "adf21080-0e10-11eb-879b-05d71fb426ec",
      personPipedriveId: 88,
      organizationPipedriveId: null,
    });
  });

  it("skips a note with nothing left once the HTML is removed, and a removed note", () => {
    expect(skipped(mapNote({ ...note, content: "<p><br></p>" }, FALLBACK)).reason).toBe("The note was empty.");
    expect(skipped(mapNote({ ...note, content: null }, FALLBACK)).reason).toBe("The note was empty.");
    expect(skipped(mapNote({ ...note, active_flag: false }, FALLBACK)).reason).toBe("The note was deleted in Pipedrive.");
  });

  it("uses the import date and an issue when the note has no created time", () => {
    const result = mapped(mapNote({ ...note, add_time: null }, FALLBACK));
    expect(result.fields.createdAt).toEqual(FALLBACK);
    expect(result.issues).toEqual(["The created date was missing or unreadable, so the import date was used."]);
  });
});

describe("input types", () => {
  it("accept the whole documented record, not only the fields the mappers read", () => {
    // A compile-time check: the fixtures above carry every documented field, and the exported types take them as they are.
    const records: [PipedrivePerson, PipedriveOrganization, PipedriveDeal, PipedriveLead, PipedriveActivity, PipedriveNote] = [
      person,
      organization,
      openDeal,
      lead,
      activity,
      note,
    ];
    expect(records).toHaveLength(6);
  });
});

describe("determinism", () => {
  it("gives the same answer every time for the same record and import date", () => {
    expect(mapDeal(openDeal, FALLBACK)).toEqual(mapDeal(openDeal, FALLBACK));
    expect(mapNote(note, FALLBACK)).toEqual(mapNote(note, FALLBACK));
  });

  it("never reads the clock inside the mappers (the import date is always passed in)", () => {
    const source = readFileSync("src/lib/sales/pipedrive/map.ts", "utf8");
    expect(source).not.toMatch(/Date\.now\(/);
    expect(source).not.toMatch(/new Date\(\s*\)/);
  });
});
