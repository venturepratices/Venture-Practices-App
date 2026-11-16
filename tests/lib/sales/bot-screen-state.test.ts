import { describe, expect, it, vi } from "vitest";

import * as state from "@/lib/sales/bot-screen-state";

// The Bots screen's click rules as small pure functions. The project has no
// browser test setup (no jsdom, no Testing Library) and this fix adds no new
// packages, so the rules the buttons follow are tested here directly.

describe("the one-time key box", () => {
  it("keeps Done disabled until 'I have saved it' is ticked", () => {
    expect(state.canCloseReveal(false)).toBe(false);
    expect(state.canCloseReveal(true)).toBe(true);
  });

  it("blocks every key action while a key is on screen, or while bot keys are paused", () => {
    expect(state.keyActionBlocked({ keyOnScreen: true, paused: false })).toBe("Save the key first.");
    expect(state.keyActionBlocked({ keyOnScreen: false, paused: true })).toBe("Bot keys are switched off.");
    expect(state.keyActionBlocked({ keyOnScreen: false, paused: false })).toBeNull();
  });

  it("never lets a second key replace one that is not saved yet", () => {
    const first = { botId: "b1", botName: "Muse", secret: "one" };
    const second = { botId: "b2", botName: "Grok", secret: "two" };
    expect(state.showKey(null, first)).toEqual({ shown: first, refused: false });
    expect(state.showKey(first, second)).toEqual({ shown: first, refused: true });
  });

  it("copies the key, or selects it when the clipboard refuses", async () => {
    const ok = await state.copyKey("k", { writeText: async () => {} });
    expect(ok).toEqual({ copied: true, message: "Copied. Paste it straight into the bot's secret store." });
    const refused = await state.copyKey("k", { writeText: async () => Promise.reject(new Error("NotAllowedError")) });
    expect(refused.copied).toBe(false);
    expect(refused.message).toMatch(/selected/);
    expect((await state.copyKey("k", undefined)).copied).toBe(false);
  });
});

describe("delete needs the inline confirm", () => {
  it("goes ask, then confirm; Keep it goes back", () => {
    expect(state.deleteStep("idle", "delete")).toBe("asking");
    expect(state.deleteStep("asking", "keep")).toBe("idle");
    expect(state.deleteStep("asking", "confirm")).toBe("deleting");
    expect(state.deleteStep("idle", "confirm")).toBe("idle");
  });
});

describe("sending the form", () => {
  it("sends once for a double click", () => {
    const gate = state.submitGate();
    expect(gate.start()).toBe(true);
    expect(gate.start()).toBe(false);
    gate.finish();
    expect(gate.start()).toBe(true);
  });

  it("asks for the password on create, and on an edit that gives more power", () => {
    expect(state.passwordProblem({ needsPassword: true, password: "" })).toBe("Type your password to do this.");
    expect(state.passwordProblem({ needsPassword: true, password: "pw" })).toBeNull();
    expect(state.passwordProblem({ needsPassword: false, password: "" })).toBeNull();
  });

  it("warns before leaving while a key is on screen", () => {
    const event = { preventDefault: vi.fn(), returnValue: undefined as unknown };
    state.warnBeforeLeaving(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.returnValue).toBe("");
  });
});
