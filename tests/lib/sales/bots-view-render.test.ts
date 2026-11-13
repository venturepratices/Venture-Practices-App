import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BotsScreenData, BotView } from "@/lib/sales/bots-screen";

// A server render of the Bots screen with fixed data, one per state. Node has
// no browser, so nothing is clicked here; the parts with their own state
// (the key reveal, the form) render on their own with fixed props.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/sales/settings/bots",
}));

const { BotsView } = await import("@/components/sales/bots-view");
const { BotKeyReveal, RevealFailed } = await import("@/components/sales/bot-key-reveal");
const { BotEditor } = await import("@/components/sales/bot-editor");

const clean = (html: string) => html.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");

const BOT: BotView = {
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
  expiresAt: "2026-11-19T12:00:00.000Z",
  callsToday: 0,
};

function data(overrides: Partial<BotsScreenData> = {}): BotsScreenData {
  return {
    bots: [],
    members: [{ id: "p1", name: "Ben E." }, { id: "p2", name: "Sarah K." }],
    pipelines: [{ key: "direct-mail", name: "Direct Mail" }],
    botsEnabled: true,
    appUrl: "https://app.example.com",
    now: "2026-11-13T12:00:00.000Z",
    ...overrides,
  };
}

const render = (d: BotsScreenData) => clean(renderToString(createElement(BotsView, { data: d })));

describe("BotsView", () => {
  it("no bots yet: explains and offers New bot", () => {
    const html = render(data());
    expect(html).toContain("No bots yet");
    expect(html).toContain("New bot");
    expect(html).not.toContain("Bot keys are paused");
  });

  it("a bot row says everything in plain words", () => {
    const html = render(data({ bots: [BOT] }));
    for (const text of ["Muse", "Works for Ben E.", "Helper", "See deals and leads, Add notes, Add calls, meetings and tasks", "All pipelines", "Only Ben E.'s own deals and leads", "Never used", "0 of 2,000 calls today", "On", "Key expires in 6 days", "Turn off", "Rotate key", "Delete", "Recent activity", "Edit"]) {
      expect(html, text).toContain(text);
    }
  });

  it("shows only the last 4 characters of the key", () => {
    expect(render(data({ bots: [BOT] }))).toMatch(/Key ending in <span[^>]*>x9Qa<\/span>/);
  });

  it("says why the app turned a bot off", () => {
    const html = render(data({ bots: [{ ...BOT, enabled: false, offReason: "it went over its call limit in 5 different minutes today." }] }));
    expect(html).toContain("The app turned it off because it went over its call limit");
    expect(html).toContain("Turn on");
  });

  it("shows the paused notice when bot keys are switched off", () => {
    expect(render(data({ botsEnabled: false }))).toContain("Bot keys are paused");
  });

  it("guardrails say what a bot can never do, the limits, and that it can be turned off", () => {
    const html = render(data());
    for (const text of ["never delete, export or change settings", "60 calls a minute", "2,000 a day", "only for the person it works for", "only in the pipelines you pick", "turn it off at any time", "Every action is logged"]) {
      expect(html, text).toContain(text);
    }
  });

  it("How to connect: steps, address and header format, never a real key", () => {
    const html = render(data({ bots: [BOT] }));
    expect(html).toContain("Authorization: Bearer &lt;key&gt;");
    expect(html).toContain("https://app.example.com/api/sales/deals");
    expect(html).toContain("POST");
    expect(html).not.toMatch(/vpb_[A-Za-z0-9_-]{8,}/);
  });

  it("buttons are real buttons, 44px tall on touch", () => {
    const html = render(data({ bots: [BOT] }));
    expect(html).toMatch(/<button[^>]*type="button"[^>]*pointer-coarse:min-h-11/);
    expect(html).toContain('aria-live="polite"');
  });
});

describe("BotKeyReveal", () => {
  const SECRET = "vpb_FAKEKEYFORTHERENDERTEST000000000000000000000";
  const html = clean(renderToString(createElement(BotKeyReveal, { secret: SECRET, botName: "Muse", onDone: () => {} })));

  it("shows the key once with copy, a saved tick and a disabled Done", () => {
    expect(html).toContain(SECRET);
    expect(html).toContain("This is the only time you will see it");
    expect(html).toContain("Copy key");
    expect(html).toContain("I have saved it");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Done<\/button>/);
    expect(html).toContain('aria-live="polite"');
  });
});

describe("RevealFailed", () => {
  it("says a key was made but could not be shown, and to rotate", () => {
    const html = clean(renderToString(createElement(RevealFailed, { botName: "Muse" })));
    expect(html).toContain("A key was made for Muse");
    expect(html).toContain("Rotate key");
  });
});

describe("BotEditor", () => {
  const html = clean(
    renderToString(createElement(BotEditor, { mode: "create", members: data().members, pipelines: data().pipelines, onCancel: () => {}, onSaved: () => {} })),
  );

  it("has the fields, roles, grouped permissions with plain words and risk marks", () => {
    for (const text of ["Name", "Works for", "Sarah K.", "Read only", "Helper", "Rep", "Sales", "Move deals between stages", "Higher risk", "Low risk", "All pipelines", "Direct Mail", "Key lasts", "Your password"]) {
      expect(html, text).toContain(text);
    }
    expect(html).toMatch(/type="password"[^>]*autoComplete="current-password"|autoComplete="current-password"[^>]*type="password"/i);
  });
});
