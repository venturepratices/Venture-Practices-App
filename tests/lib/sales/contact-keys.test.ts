import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { emailKey, nameKey, organizationKeys, personKeys, phoneKey } from "@/lib/sales/contact-keys";

// The stored keys that let Contacts spot the same person or practice typed two
// ways (Decision 17). The app writes them on every create and edit; the Plan 3A
// migration backfills rows that already exist with the same rules in SQL.

describe("contact keys", () => {
  it("keys match however the details were typed", () => {
    expect(emailKey(" Sarah@Oak.COM ")).toBe("sarah@oak.com");
    expect(emailKey("\tsarah@oak.com\n")).toBe("sarah@oak.com");
    // Only ASCII whitespace is trimmed, the same set the SQL backfill trims.
    expect(emailKey(" a@b.example")).toBe(" a@b.example");
    expect(emailKey("\f\va@b.example\r")).toBe("a@b.example");
    expect(emailKey("  ")).toBeNull();
    expect(emailKey("")).toBeNull();
    expect(emailKey(null)).toBeNull();
    expect(emailKey(undefined)).toBeNull();

    for (const phone of [
      "(512) 555-0142",
      "+1 512.555.0142",
      "1-512-555-0142",
      "5125550142",
      "512-555-0142 x23",
      "+1 512 555 0142 ext. 5",
    ]) {
      expect(phoneKey(phone), phone).toBe("5125550142");
    }
    expect(phoneKey("555-0142")).toBe("5550142");
    expect(phoneKey("12345")).toBeNull();
    expect(phoneKey("ext")).toBeNull();
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey(undefined)).toBeNull();

    for (const name of ["Oak Creek Dental", "oak-creek dental.", "OAK CREEK DENTAL"]) {
      expect(nameKey(name), name).toBe("oakcreekdental");
    }
    expect(nameKey("O'Brien Dental")).toBe("obriendental");
    expect(nameKey("OBrien Dental")).toBe("obriendental");
    expect(nameKey("Dr. Sarah K.")).toBe("drsarahk");
    expect(nameKey("  ")).toBeNull();
    expect(nameKey("--")).toBeNull();
  });

  it("gives a person all three keys and an organization its name key", () => {
    expect(personKeys({ name: "Sarah K.", email: " Sarah@Oak.COM ", phone: "+1 (512) 555-0142" })).toEqual({
      nameKey: "sarahk",
      emailKey: "sarah@oak.com",
      phoneKey: "5125550142",
    });
    expect(personKeys({ name: "Mark T.", email: null, phone: null })).toEqual({
      nameKey: "markt",
      emailKey: null,
      phoneKey: null,
    });
    expect(organizationKeys({ name: "Oak-Creek Dental." })).toEqual({ nameKey: "oakcreekdental" });
  });

  it("the migration backfills with the same rules", () => {
    const sql = readFileSync(
      join(process.cwd(), "prisma", "migrations", "20261107000001_sales_leads_contacts", "migration.sql"),
      "utf8",
    );

    // The person UPDATE names its table `p`; the organization UPDATE needs no alias.
    expect(sql).toContain(String.raw`NULLIF(lower(regexp_replace(p."email", '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g')), '')`);
    expect(sql).toContain(String.raw`WHEN length(k.d) < 7 THEN NULL`);
    expect(sql).toContain(String.raw`WHEN length(k.d) >= 11 AND left(k.d, 1) = '1' THEN left(substr(k.d, 2), 10)`);
    expect(sql).toContain(String.raw`ELSE left(k.d, 10) END`);
    expect(sql).toContain(String.raw`regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g')`);
    expect(sql).toContain(String.raw`NULLIF(regexp_replace(lower(p."name"), '[^a-z0-9]', '', 'g'), '')`);
    expect(sql).toContain(String.raw`NULLIF(regexp_replace(lower("name"), '[^a-z0-9]', '', 'g'), '')`);
  });
});
