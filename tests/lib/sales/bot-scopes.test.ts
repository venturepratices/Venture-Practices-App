import { describe, expect, it } from "vitest";

import {
  BOT_CAPS,
  BOT_KEY_MAX_DAYS,
  BOT_LIMITS,
  BOT_RISK_LABELS,
  BOT_ROLE_OPTIONS,
  BOT_ROLE_PRESETS,
  BOT_ROLES,
  BOT_SCOPE_AREAS,
  BOT_SCOPE_CATALOGUE,
  BOT_SCOPE_LIST,
  BOT_SCOPES,
  isCatalogueScope,
} from "@/lib/sales/bot-scopes";

// The permission catalogue: the one list of what a bot key may ever be allowed
// to do. The screen, the routes and the key check all read it.

const FORBIDDEN = /delete|remove|erase|export|download|setting|admin|password|key/i;

describe("the permission catalogue", () => {
  it("has one entry for every scope, in the standard order", () => {
    expect(BOT_SCOPE_LIST.map((scope) => scope.key)).toEqual([...BOT_SCOPES]);
    expect(Object.keys(BOT_SCOPE_CATALOGUE).sort()).toEqual([...BOT_SCOPES].sort());
  });

  it("contains no permission to delete, export or change settings", () => {
    for (const scope of BOT_SCOPE_LIST) {
      expect(scope.key).not.toMatch(FORBIDDEN);
      expect(scope.label).not.toMatch(FORBIDDEN);
    }
  });

  it("gives every permission a label, a plain sentence, a known area and a risk level", () => {
    const areas = BOT_SCOPE_AREAS.map((area) => area.key);
    for (const scope of BOT_SCOPE_LIST) {
      expect(scope.label.length).toBeGreaterThan(2);
      expect(scope.description).toMatch(/^[A-Z].{10,}\.$/);
      expect(areas).toContain(scope.area);
      expect(Object.keys(BOT_RISK_LABELS)).toContain(scope.risk);
    }
  });

  it("only knows its own scopes", () => {
    expect(isCatalogueScope("read")).toBe(true);
    expect(isCatalogueScope("delete")).toBe(false);
    expect(isCatalogueScope("export")).toBe(false);
    expect(isCatalogueScope("constructor")).toBe(false);
    expect(isCatalogueScope("")).toBe(false);
  });

  it("names the Sales area in plain words", () => {
    expect(BOT_SCOPE_AREAS).toEqual([{ key: "sales", label: "Sales" }]);
  });

  it("is plain ASCII with no long dashes", () => {
    const text = JSON.stringify([BOT_SCOPE_LIST, BOT_ROLE_OPTIONS, BOT_RISK_LABELS]);
    expect(text).toMatch(/^[\x20-\x7e]*$/);
  });
});

describe("role presets", () => {
  it("are labelled Read only, Helper and Rep, in that order", () => {
    expect(BOT_ROLE_OPTIONS.map((role) => [role.key, role.label])).toEqual([
      ["read", "Read only"],
      ["helper", "Helper"],
      ["rep", "Rep"],
    ]);
    expect(BOT_ROLE_OPTIONS.map((role) => role.key)).toEqual([...BOT_ROLES]);
  });

  it("only use catalogued scopes and match the presets", () => {
    for (const role of BOT_ROLE_OPTIONS) {
      expect(role.scopes.every(isCatalogueScope)).toBe(true);
      expect(role.scopes).toEqual(BOT_ROLE_PRESETS[role.key]);
      expect(role.description).toMatch(/\.$/);
    }
  });
});

describe("limits", () => {
  it("keeps the agreed numbers", () => {
    expect(BOT_LIMITS).toEqual({ perMinute: 60, perDay: 2000 });
    expect(BOT_KEY_MAX_DAYS).toBe(90);
    expect(BOT_CAPS).toEqual({ perPerson: 2, total: 10 });
  });
});
