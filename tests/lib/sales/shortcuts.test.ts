import { describe, expect, it } from "vitest";

import { isTypingTarget, resolveShortcut, SALES_SHORTCUT_EVENT, SHORTCUT_HELP } from "@/lib/sales/shortcuts";

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

// Node has no DOM, so a stand-in element answers `closest` for the two kinds of
// selector the list uses: a tag name ("input") and an exact attribute value
// ('[role="combobox"]'), walking up through its parents like the real one.
type FakeNode = { tag: string; attrs?: Record<string, string>; parent?: FakeNode };

function matchesOne(node: FakeNode, selector: string): boolean {
  const attribute = /^\[([\w-]+)="([^"]*)"\]$/.exec(selector);
  if (attribute) return node.attrs?.[attribute[1]] === attribute[2];
  if (!/^[a-z]+$/.test(selector)) throw new Error(`The stand-in cannot read the selector ${selector}`);
  return node.tag === selector;
}

function element(node: FakeNode) {
  return {
    closest(selectors: string) {
      const list = selectors.split(",").map((part) => part.trim());
      for (let at: FakeNode | undefined = node; at; at = at.parent) {
        if (list.some((selector) => matchesOne(at, selector))) return at;
      }
      return null;
    },
  };
}

describe("isTypingTarget", () => {
  it("treats text boxes and native selects as typing", () => {
    for (const tag of ["input", "textarea", "select"]) expect(isTypingTarget(element({ tag })), tag).toBe(true);
    expect(isTypingTarget(element({ tag: "div", attrs: { contenteditable: "true" } }))).toBe(true);
  });

  it("treats a closed select box (role combobox) as typing, since it jumps to an option by letter", () => {
    // The app's selects are Base UI buttons with role="combobox": `n` there picks "New Mover Mail".
    const trigger: FakeNode = { tag: "button", attrs: { role: "combobox" } };
    expect(isTypingTarget(element(trigger))).toBe(true);
    expect(isTypingTarget(element({ tag: "span", parent: trigger }))).toBe(true);
  });

  it("treats open menus and lists as typing", () => {
    expect(isTypingTarget(element({ tag: "div", attrs: { role: "menu" } }))).toBe(true);
    expect(isTypingTarget(element({ tag: "div", attrs: { role: "listbox" } }))).toBe(true);
  });

  it("leaves shortcuts on for buttons, cards and the page itself", () => {
    expect(isTypingTarget(element({ tag: "button" }))).toBe(false);
    expect(isTypingTarget(element({ tag: "div", attrs: { role: "button" } }))).toBe(false);
    expect(isTypingTarget(element({ tag: "body" }))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
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
