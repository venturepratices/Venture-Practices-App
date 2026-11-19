import { describe, expect, it } from "vitest";

import { DEAL_SOURCES } from "@/lib/sales/constants";
import { intakeSecret, leadSourceFor, nextBusinessDay, parseLeadIntake } from "@/lib/sales/lead-intake-payload";

// Reading what HighLevel sends: the spec's own shape, HighLevel's default
// workflow shape, and the many ways the same field gets spelled. Pure, no
// database. A lead is only refused when there is truly nobody to name.

function lead(body: unknown) {
  const result = parseLeadIntake(body);
  if (result.kind !== "lead") throw new Error(`expected a lead, got ${JSON.stringify(result)}`);
  return result.intake;
}

describe("parseLeadIntake: shapes", () => {
  it("reads the payload the spec describes", () => {
    expect(
      lead({
        event: "opt_in",
        ghl_contact_id: "c1",
        first_name: "Jane",
        last_name: "Doe",
        email: "Jane@Example.com",
        phone: "(980) 203-4777",
        practice_name: "Oak Creek Dental",
        practice_zip: "28210",
        form_type: "Check Availability",
        customData: { secret: "s", event: "opt_in" },
      }),
    ).toEqual({
      ghlContactId: "c1",
      personName: "Jane Doe",
      email: "Jane@Example.com",
      phone: "(980) 203-4777",
      practiceName: "Oak Creek Dental",
      practiceZip: "28210",
      formType: "Check Availability",
    });
  });

  it("reads HighLevel's default workflow payload, the top level winning over the nested contact", () => {
    expect(
      lead({
        contact_id: "abc123",
        first_name: "Sam",
        last_name: "Lee",
        full_name: "Sam Lee",
        email: "sam@x.com",
        phone: "+19802034777",
        postal_code: "28202",
        company_name: "Smile Co",
        source: "Check Availability Form",
        customData: {},
        contact: { id: "zzz" },
      }),
    ).toEqual({
      ghlContactId: "abc123",
      personName: "Sam Lee",
      email: "sam@x.com",
      phone: "+19802034777",
      practiceName: "Smile Co",
      practiceZip: "28202",
      formType: "Check Availability Form",
    });
  });

  it("falls back to the nested contact's id", () => {
    expect(lead({ first_name: "A", contact: { id: "inner1" } }).ghlContactId).toBe("inner1");
  });

  it("reads custom data keys however they are spelled, and numbers as text", () => {
    const intake = lead({
      email: "a@b.co",
      customData: { "Practice Name": "Bright Smiles", "Practice ZIP": 28203, "Form Type": "Referral form" },
    });
    expect(intake).toMatchObject({ practiceName: "Bright Smiles", practiceZip: "28203", formType: "Referral form", personName: "a@b.co" });
    expect(lead({ practiceName: "Camel Case Dental", firstName: "Cam" })).toMatchObject({ practiceName: "Camel Case Dental", personName: "Cam" });
  });

  it("builds the name from the full name when first and last are missing", () => {
    expect(lead({ full_name: "Dr. Pat Kim" }).personName).toBe("Dr. Pat Kim");
    expect(lead({ name: "Pat Kim" }).personName).toBe("Pat Kim");
  });

  it("keeps a practice with nobody named", () => {
    expect(lead({ practice_name: "Only Practice" })).toMatchObject({ personName: null, practiceName: "Only Practice" });
  });
});

describe("parseLeadIntake: events", () => {
  it("treats a missing event as a new lead", () => {
    expect(parseLeadIntake({ first_name: "A" }).kind).toBe("lead");
  });

  it.each(["opt_in", "get_started", "Opt In", "GET-STARTED"])("treats %s as a new lead", (event) => {
    expect(parseLeadIntake({ first_name: "A", event }).kind).toBe("lead");
  });

  it("ignores a text reply, wherever the event is sent", () => {
    expect(parseLeadIntake({ first_name: "A", event: "text_reply" })).toMatchObject({ kind: "ignored" });
    expect(parseLeadIntake({ first_name: "A", customData: { event: "TEXT REPLY" } })).toMatchObject({ kind: "ignored" });
  });

  it("refuses an event it does not know, and says which ones it does", () => {
    const result = parseLeadIntake({ first_name: "A", event: "bogus" });
    expect(result).toMatchObject({ kind: "invalid" });
    expect(JSON.stringify(result)).toMatch(/opt_in/);
  });
});

describe("parseLeadIntake: not enough to make a lead", () => {
  it.each([
    ["an empty object", {}],
    ["only a contact id", { ghl_contact_id: "c1" }],
    ["a bad email and nothing else", { email: "not-an-email" }],
    ["a phone number too short to be one", { phone: "12" }],
    ["blank strings", { first_name: "  ", email: "", practice_name: "" }],
    ["null", null],
    ["a string", "hello"],
    ["a list", []],
  ])("refuses %s", (_label, body) => {
    expect(parseLeadIntake(body).kind).toBe("invalid");
  });

  it("uses a phone number as the name when it is all there is", () => {
    expect(lead({ phone: "555-1234" })).toMatchObject({ personName: "555-1234", phone: "555-1234" });
  });

  it("drops a bad email but keeps the lead when something else names it", () => {
    expect(lead({ first_name: "Jo", email: "nope" })).toMatchObject({ personName: "Jo", email: null });
  });
});

describe("parseLeadIntake: sizes", () => {
  it("trims values and caps them", () => {
    const intake = lead({
      first_name: `  ${"x".repeat(500)}  `,
      practice_name: "p".repeat(300),
      practice_zip: "9".repeat(40),
      form_type: "f".repeat(300),
      ghl_contact_id: "i".repeat(300),
    });
    expect(intake.personName).toHaveLength(200);
    expect(intake.practiceName).toHaveLength(200);
    expect(intake.practiceZip).toHaveLength(20);
    expect(intake.formType).toHaveLength(100);
    expect(intake.ghlContactId).toHaveLength(100);
  });
});

describe("intakeSecret", () => {
  it("reads customData.secret, trimmed, or a top-level secret", () => {
    expect(intakeSecret({ customData: { secret: " abc " } })).toBe("abc");
    expect(intakeSecret({ secret: "top" })).toBe("top");
  });

  it.each([[null], ["text"], [{}], [{ customData: { secret: "" } }], [{ customData: "oops" }]])("finds nothing in %j", (body) => {
    expect(intakeSecret(body)).toBeNull();
  });
});

describe("leadSourceFor", () => {
  it.each([
    [null, "Check Availability form"],
    ["Check Availability", "Check Availability form"],
    ["something unrecognised", "Check Availability form"],
    ["Referral form", "Referral"],
    ["Direct inquiry", "Direct inquiry"],
  ])("maps %j to %s", (formType, expected) => {
    const source = leadSourceFor(formType);
    expect(source).toBe(expected);
    expect(DEAL_SOURCES).toContain(source);
  });
});

describe("nextBusinessDay", () => {
  it.each([
    ["2026-11-19", "2026-11-20"], // Thursday gives Friday
    ["2026-11-20", "2026-11-23"], // Friday gives Monday
    ["2026-11-21", "2026-11-23"], // Saturday gives Monday
    ["2026-11-22", "2026-11-23"], // Sunday gives Monday
    ["2026-11-27", "2026-11-30"], // a month end
    ["2026-12-31", "2027-01-01"], // a year end
  ])("%s gives %s", (day, expected) => {
    expect(nextBusinessDay(day)).toBe(expected);
  });
});
