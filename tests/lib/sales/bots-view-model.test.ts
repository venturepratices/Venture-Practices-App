import { describe, expect, it } from "vitest";

import * as vm from "@/lib/sales/bots-view-model";
import type { BotView } from "@/lib/sales/bots-screen";

// The small pure helpers behind the Bots screen: plain words for every bot,
// and the form's rules. No database, no browser.

const NOW = "2026-11-13T12:00:00.000Z";
const PIPES = [
  { key: "direct-mail", name: "Direct Mail" },
  { key: "consulting", name: "Consulting" },
];

function makeBot(overrides: Partial<BotView> = {}): BotView {
  return {
    id: "b1",
    name: "Muse",
    actingFor: { id: "p1", name: "Ben E." },
    scopes: ["read", "notes", "activities"],
    pipelineKeys: [],
    allPipelines: true,
    ownDealsOnly: true,
    keyLast4: "x9Qa",
    enabled: true,
    mustRotate: false,
    offReason: null,
    offAt: null,
    createdAt: "2026-11-01T12:00:00.000Z",
    lastUsedAt: null,
    lastUsedIp: null,
    rotatedAt: null,
    expiresAt: "2027-01-30T12:00:00.000Z",
    callsToday: 0,
    ...overrides,
  };
}

describe("plain words for a bot", () => {
  it("names the role, or Custom", () => {
    expect(vm.roleLabel(["read"])).toBe("Read only");
    expect(vm.roleLabel(["notes", "read", "activities"])).toBe("Helper");
    expect(vm.roleLabel(["read", "move"])).toBe("Custom");
  });

  it("lists permissions in plain words and skips unknown ones", () => {
    expect(vm.permissionSummary(["read", "notes", "delete"])).toBe("See deals and leads, Add notes");
    expect(vm.permissionSummary([])).toBe("No permissions");
  });

  it("says which pipelines", () => {
    expect(vm.pipelinesText(makeBot(), PIPES)).toBe("All pipelines");
    expect(vm.pipelinesText(makeBot({ allPipelines: false, pipelineKeys: ["consulting", "gone"] }), PIPES)).toBe("Consulting, gone");
    expect(vm.pipelinesText(makeBot({ allPipelines: false, pipelineKeys: [] }), PIPES)).toBe("No pipelines");
  });

  it("counts calls today against the limit", () => {
    expect(vm.callsTodayText(0)).toBe("0 of 2,000 calls today");
    expect(vm.callsTodayText(1999)).toBe("1,999 of 2,000 calls today");
  });

  it("says when it was last used", () => {
    expect(vm.lastUsedText(null, NOW)).toBe("Never used");
    expect(vm.lastUsedText("2026-11-13T11:59:30.000Z", NOW)).toBe("Used just now");
    expect(vm.lastUsedText("2026-11-13T11:15:00.000Z", NOW)).toBe("Used 45 minutes ago");
    expect(vm.lastUsedText("2026-11-13T09:00:00.000Z", NOW)).toBe("Used 3 hours ago");
    expect(vm.lastUsedText("2026-11-12T09:00:00.000Z", NOW)).toBe("Used 1 day ago");
  });

  it("warns when the key ends within 14 days", () => {
    expect(vm.expiryInfo("2027-01-30T12:00:00.000Z", NOW)).toEqual({ text: "Key works until Jan 30, 2027", warn: false });
    expect(vm.expiryInfo("2026-11-20T12:00:00.000Z", NOW)).toEqual({ text: "Key expires in 7 days", warn: true });
    expect(vm.expiryInfo("2026-11-14T06:00:00.000Z", NOW)).toEqual({ text: "Key expires in 1 day", warn: true });
    expect(vm.expiryInfo("2026-11-13T11:00:00.000Z", NOW)).toEqual({ text: "Key expired. Use Make a new key to use this bot again.", warn: true });
    expect(vm.expiryInfo(null, NOW)).toEqual({ text: "Key has no end date. Use Make a new key to set one.", warn: true });
  });

  it("explains its state", () => {
    expect(vm.statusInfo(makeBot())).toEqual({ label: "On", on: true, reason: null });
    expect(vm.statusInfo(makeBot({ enabled: false }))).toEqual({ label: "Off", on: false, reason: null });
    expect(vm.statusInfo(makeBot({ enabled: false, offReason: "it went over its call limit." }))).toEqual({
      label: "Off",
      on: false,
      reason: "The app turned it off because it went over its call limit.",
    });
    expect(vm.statusInfo(makeBot({ enabled: false, mustRotate: true })).reason).toMatch(/backup/);
  });
});

describe("recent activity in plain words", () => {
  const item = (action: string, entityType: string, detail: string | null = null) => ({ id: "a", at: NOW, action, entityType, entityId: "x", detail });

  it("says what the bot did", () => {
    expect(vm.describeActivity(item("note_added", "SalesDeal"))).toBe("Added a note to a deal");
    expect(vm.describeActivity(item("activity_added", "SalesLead"))).toBe("Added a call, meeting or task to a lead");
    expect(vm.describeActivity(item("stage_changed", "SalesDeal"))).toBe("Moved a deal to another stage");
    expect(vm.describeActivity(item("created", "SalesLead"))).toBe("Created a lead");
    expect(vm.describeActivity(item("auto_turned_off", "BotToken", "it went over its call limit."))).toBe(
      "Turned off by the app: it went over its call limit.",
    );
    expect(vm.describeActivity(item("something_new", "SalesPerson"))).toBe("Changed a contact (something new)");
  });
});

describe("the bot form", () => {
  it("starts empty with safe defaults", () => {
    expect(vm.emptyDraft()).toEqual({
      name: "",
      actingForId: "",
      role: "read",
      scopes: ["read"],
      allPipelines: false,
      pipelineKeys: [],
      ownDealsOnly: true,
      expiresInDays: 90,
    });
  });

  it("switches role presets and marks hand-picked lists as custom", () => {
    const rep = vm.pickRole(vm.emptyDraft(), "rep");
    expect(rep.scopes).toEqual(["read", "notes", "activities", "move", "create"]);
    const custom = vm.toggleScope(rep, "move");
    expect(custom).toMatchObject({ role: "custom", scopes: ["read", "notes", "activities", "create"] });
    expect(vm.toggleScope(vm.toggleScope(custom, "create"), "move").role).toBe("custom");
    expect(vm.toggleScope(vm.pickRole(vm.emptyDraft(), "helper"), "notes")).toMatchObject({ role: "custom" });
    expect(vm.toggleScope({ ...vm.emptyDraft(), role: "custom", scopes: ["read", "notes"] }, "activities").role).toBe("helper");
  });

  it("explains what is missing", () => {
    const ok = { ...vm.emptyDraft(), name: "Muse", actingForId: "p1", allPipelines: true };
    expect(vm.draftError(ok)).toBeNull();
    expect(vm.draftError({ ...ok, name: " " })).toBe("Give the bot a name.");
    expect(vm.draftError({ ...ok, actingForId: "" })).toBe("Pick who the bot works for.");
    expect(vm.draftError({ ...ok, scopes: [] })).toBe("Tick at least one permission.");
    expect(vm.draftError({ ...ok, allPipelines: false })).toBe("Pick at least one pipeline, or all pipelines.");
  });

  it("builds the create body with a role or a scope list, never both", () => {
    const draft = { ...vm.emptyDraft(), name: " Muse ", actingForId: "p1", allPipelines: true };
    expect(vm.createBody(draft, "pw")).toEqual({
      name: "Muse",
      actingForId: "p1",
      role: "read",
      allPipelines: true,
      pipelineKeys: [],
      ownDealsOnly: true,
      expiresInDays: 90,
      password: "pw",
    });
    expect(vm.createBody(vm.toggleScope(draft, "notes"), "pw")).toMatchObject({ scopes: ["read", "notes"] });
    expect(vm.createBody(vm.toggleScope(draft, "notes"), "pw")).not.toHaveProperty("role");
  });

  it("sends only what changed on an edit", () => {
    const bot = makeBot();
    const draft = vm.draftFromBot(bot);
    expect(vm.updateBody(draft, bot)).toBeNull();
    expect(vm.updateBody(vm.pickRole(draft, "rep"), bot)).toEqual({ role: "rep" });
    expect(vm.updateBody({ ...draft, allPipelines: false, pipelineKeys: ["consulting"] }, bot)).toEqual({
      allPipelines: false,
      pipelineKeys: ["consulting"],
    });
    expect(vm.updateBody({ ...draft, ownDealsOnly: false }, bot)).toEqual({ ownDealsOnly: false });
  });

  it("groups permissions by area", () => {
    expect(vm.scopesByArea().map((g) => [g.label, g.scopes.length])).toEqual([["Sales", 5]]);
  });

  it("has a fallback message when copying fails", () => {
    expect(vm.copyMessage(true)).toBe("Copied. Paste it straight into the bot's secret store.");
    expect(vm.copyMessage(false)).toMatch(/selected/);
  });
});

describe("password on an edit", () => {
  it("is needed only when the change gives more power", () => {
    const bot = makeBot({ allPipelines: false, pipelineKeys: ["direct-mail"] });
    const draft = vm.draftFromBot(bot);
    expect(vm.editNeedsPassword(draft, bot)).toBe(false);
    expect(vm.editNeedsPassword(vm.pickRole(draft, "rep"), bot)).toBe(true);
    expect(vm.editNeedsPassword(vm.pickRole(draft, "read"), bot)).toBe(false);
    expect(vm.editNeedsPassword({ ...draft, allPipelines: true }, bot)).toBe(true);
    expect(vm.editNeedsPassword({ ...draft, pipelineKeys: ["direct-mail", "consulting"] }, bot)).toBe(true);
    expect(vm.editNeedsPassword({ ...draft, ownDealsOnly: false }, bot)).toBe(true);
  });
});
