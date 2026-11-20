import { describe, expect, it } from "vitest";

import { matchesFilterQuery, type FilterItem } from "@/lib/calls/filter-match";

// The client and tracking-number filters on the Calls page now search as you
// type, so nobody has to scroll a long list to find one name or number.

const client: FilterItem = { value: "c1", label: "Belmont Pediatric Dentistry" };
const number: FilterItem = {
  value: "+17043973212",
  label: "Unlabeled · (704) 397-3212",
  searchText: "+17043973212",
};
const named: FilterItem = {
  value: "+17042863058",
  label: "Direct Mail · (704) 286-3058",
  searchText: "+17042863058",
};

describe("matchesFilterQuery", () => {
  it("an empty search matches everything", () => {
    expect(matchesFilterQuery(client, "")).toBe(true);
    expect(matchesFilterQuery(client, "   ")).toBe(true);
  });

  it("finds a client by any part of its name, ignoring capitals", () => {
    expect(matchesFilterQuery(client, "belm")).toBe(true);
    expect(matchesFilterQuery(client, "PEDIATRIC")).toBe(true);
    expect(matchesFilterQuery(client, "dentistry")).toBe(true);
    expect(matchesFilterQuery(client, "gaston")).toBe(false);
  });

  it("finds a tracking number by its label", () => {
    expect(matchesFilterQuery(named, "direct")).toBe(true);
    expect(matchesFilterQuery(number, "direct")).toBe(false);
  });

  it("finds a number however the digits are typed", () => {
    for (const typed of ["397", "704 397", "704-397", "(704) 397", "704397", "7043973212", "+17043973212", "397-3212"]) {
      expect(matchesFilterQuery(number, typed), typed).toBe(true);
    }
  });

  it("does not match the wrong number", () => {
    expect(matchesFilterQuery(number, "286")).toBe(false);
    expect(matchesFilterQuery(number, "980")).toBe(false);
  });

  it("two typed digits are too short to match on digits alone", () => {
    expect(matchesFilterQuery(client, "70")).toBe(false);
  });

  it("a name search never matches on digits hidden in the number", () => {
    expect(matchesFilterQuery(named, "mail 286")).toBe(false);
  });
});
