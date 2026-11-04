import { describe, expect, it } from "vitest";

import { resolveShortcut, SALES_SHORTCUT_EVENT, SHORTCUT_HELP } from "@/lib/sales/shortcuts";

// The Sales keyboard shortcuts (spec 16.1, Pipedrive keys): which key press
// becomes which action. Pure, so the listener component stays a thin wrapper.

const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; inEditable: boolean }> = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, inEditable: false, ...extra });

describe("resolveShortcut", () => {
  it.each([["/", "search"], ["n", "new-deal"], ["N", "new-deal"], ["?", "help"]])("%s gives %s", (k, action) =>
    expect(resolveShortcut(key(k), { dealOpen: false })).toBe(action));

  it("e and t need an open deal", () => {
    expect(resolveShortcut(key("e"), { dealOpen: false })).toBeNull();
    expect(resolveShortcut(key("t"), { dealOpen: false })).toBeNull();
    expect(resolveShortcut(key("e"), { dealOpen: true })).toBe("new-email");
    expect(resolveShortcut(key("t"), { dealOpen: true })).toBe("new-task");
  });

  it("the other keys still work with a deal open", () => {
    expect(resolveShortcut(key("/"), { dealOpen: true })).toBe("search");
    expect(resolveShortcut(key("n"), { dealOpen: true })).toBe("new-deal");
    expect(resolveShortcut(key("?"), { dealOpen: true })).toBe("help");
  });

  it("never fires while typing or with ctrl, cmd or alt", () => {
    for (const k of ["/", "n", "?", "e", "t"]) expect(resolveShortcut(key(k, { inEditable: true }), { dealOpen: true })).toBeNull();
    expect(resolveShortcut(key("n", { ctrlKey: true }), { dealOpen: false })).toBeNull();
    expect(resolveShortcut(key("/", { metaKey: true }), { dealOpen: false })).toBeNull();
    expect(resolveShortcut(key("n", { altKey: true }), { dealOpen: false })).toBeNull();
    expect(resolveShortcut(key("Escape"), { dealOpen: true })).toBeNull();
  });

  it("ignores every other key", () => {
    for (const k of ["a", "x", "Enter", " ", "ArrowLeft", "Tab", "1"]) {
      expect(resolveShortcut(key(k), { dealOpen: true }), k).toBeNull();
    }
  });
});

describe("SHORTCUT_HELP", () => {
  it("lists the help rows in the mockup's order without em dashes", () => {
    expect(SHORTCUT_HELP.map((row) => row.keys)).toEqual(["/", "n", "e", "t", "Esc", "?"]);
    expect(SHORTCUT_HELP).toEqual([
      { keys: "/", label: "Search" },
      { keys: "n", label: "New deal" },
      { keys: "e", label: "New email (in an open deal)" },
      { keys: "t", label: "New task (in an open deal)" },
      { keys: "Esc", label: "Close panel or window" },
      { keys: "?", label: "This list" },
    ]);
    for (const row of SHORTCUT_HELP) expect(row.label).not.toMatch(/—/);
  });

  it("names the window event the listener dispatches", () => {
    expect(SALES_SHORTCUT_EVENT).toBe("sales:shortcut");
  });
});
