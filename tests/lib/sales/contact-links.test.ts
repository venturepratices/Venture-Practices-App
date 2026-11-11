import { describe, expect, it } from "vitest";

import { mailtoHref, normalizeWebsite, safeWebHref, telHref } from "@/lib/sales/contact-links";

// The only links a contact's website, email and phone may become (spec 18.4,
// A4): a website must be a real http or https address, an email a plain
// `mailto:` and a phone a `tel:` of its digits. Anything else gives no link.

describe("normalizeWebsite", () => {
  it("adds https to a bare address and keeps an http one as typed", () => {
    expect(normalizeWebsite("oakcreekdental.com")).toBe("https://oakcreekdental.com/");
    expect(normalizeWebsite("  oakcreekdental.com  ")).toBe("https://oakcreekdental.com/");
    expect(normalizeWebsite("http://oak.example/path")).toBe("http://oak.example/path");
  });

  it.each([
    ["javascript:alert(1)"],
    ["ftp://oak.example"],
    [""],
    ["   "],
    ["https://"],
    ["oak"],
    ["https://bank.example@evil.example/"],
  ])("refuses %j", (input) => {
    expect(normalizeWebsite(input)).toBeNull();
  });
});

describe("safeWebHref", () => {
  it("gives a link only for a stored http or https address", () => {
    expect(safeWebHref("https://oak.example/")).toBe("https://oak.example/");
    expect(safeWebHref("http://oak.example/path")).toBe("http://oak.example/path");
  });

  it.each([["javascript:alert(1)"], ["oakcreekdental.com"], ["data:text/html,hi"], [""]])("gives no link for %j", (stored) => {
    expect(safeWebHref(stored)).toBeNull();
  });

  it("gives no link for no website", () => {
    expect(safeWebHref(null)).toBeNull();
  });
});

describe("mailtoHref", () => {
  it("makes a mailto link of a plain address", () => {
    expect(mailtoHref("sarah@oak.example")).toBe("mailto:sarah@oak.example");
  });

  it.each([["not an email"], ["a@b.example?subject=x"], ["a@b.example#x"], ["sarah@oak"], [""]])("gives no link for %j", (email) => {
    expect(mailtoHref(email)).toBeNull();
  });

  it("gives no link for no email", () => {
    expect(mailtoHref(null)).toBeNull();
  });
});

describe("telHref", () => {
  it("dials the digits, keeping a leading plus", () => {
    expect(telHref("(512) 555-0142")).toBe("tel:5125550142");
    expect(telHref("+1 512 555 0142")).toBe("tel:+15125550142");
  });

  it.each([["abc"], ["555"], ["+1 555"], [""]])("gives no link for %j", (phone) => {
    expect(telHref(phone)).toBeNull();
  });

  it("gives no link for no phone", () => {
    expect(telHref(null)).toBeNull();
  });
});
