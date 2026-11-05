import { describe, expect, it } from "vitest";

import {
  announceShortcut,
  isTypingTarget,
  resolveShortcut,
  SALES_SHORTCUT_EVENT,
  SHORTCUT_HELP,
  shortcutListener,
  topModalSurface,
} from "@/lib/sales/shortcuts";

// The Sales keyboard shortcuts (spec 16.1, Pipedrive keys): which key press
// becomes which action. Pure, so the listener component stays a thin wrapper.

const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; inEditable: boolean }> = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, inEditable: false, ...extra });

describe("resolveShortcut", () => {
  // `surface` is the topmost open window: none, the deal panel, or any other (Add deal, Value, Lost, next step, help).
  it.each([["/", "search"], ["n", "new-deal"], ["N", "new-deal"], ["?", "help"]])("%s gives %s", (k, action) =>
    expect(resolveShortcut(key(k), { surface: null })).toBe(action));

  it("e and t need the deal panel open", () => {
    expect(resolveShortcut(key("e"), { surface: null })).toBeNull();
    expect(resolveShortcut(key("t"), { surface: null })).toBeNull();
    expect(resolveShortcut(key("e"), { surface: "deal-panel" })).toBe("new-email");
    expect(resolveShortcut(key("t"), { surface: "deal-panel" })).toBe("new-task");
  });

  it("in the open deal panel only e and t work: /, n and ? belong to the page behind it", () => {
    // n used to stack Add deal on the panel, / to focus the board search behind it, ? to stack the help.
    for (const k of ["/", "n", "?"]) expect(resolveShortcut(key(k), { surface: "deal-panel" }), k).toBeNull();
  });

  it("no shortcut runs under any other open window", () => {
    for (const k of ["/", "n", "?", "e", "t"]) expect(resolveShortcut(key(k), { surface: "other" }), k).toBeNull();
  });

  it("never fires while typing or with ctrl, cmd or alt", () => {
    for (const k of ["/", "n", "?", "e", "t"]) {
      expect(resolveShortcut(key(k, { inEditable: true }), { surface: null })).toBeNull();
      expect(resolveShortcut(key(k, { inEditable: true }), { surface: "deal-panel" })).toBeNull();
    }
    expect(resolveShortcut(key("n", { ctrlKey: true }), { surface: null })).toBeNull();
    expect(resolveShortcut(key("/", { metaKey: true }), { surface: null })).toBeNull();
    expect(resolveShortcut(key("n", { altKey: true }), { surface: null })).toBeNull();
    expect(resolveShortcut(key("e", { ctrlKey: true }), { surface: "deal-panel" })).toBeNull();
    expect(resolveShortcut(key("Escape"), { surface: "deal-panel" })).toBeNull();
  });

  it("ignores every other key", () => {
    for (const k of ["a", "x", "Enter", " ", "ArrowLeft", "Tab", "1"]) {
      expect(resolveShortcut(key(k), { surface: null }), k).toBeNull();
      expect(resolveShortcut(key(k), { surface: "deal-panel" }), k).toBeNull();
    }
  });
});

// A stand-in document for topModalSurface: querySelectorAll answers selector
// lists of attribute tests (`[role="dialog"][data-open]`) over the elements
// given, in document order, as the real one does.
type FakeElement = Record<string, string>;

function matchesCompound(attrs: FakeElement, selector: string): boolean {
  const tests = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
  if (tests.map((test) => test[0]).join("") !== selector) throw new Error(`The stand-in cannot read the selector ${selector}`);
  return tests.every(([, name, value]) => (value === undefined ? name in attrs : attrs[name] === value));
}

function fakeDocument(elements: FakeElement[]) {
  return {
    querySelectorAll(selectors: string) {
      const list = selectors.split(",").map((part) => part.trim());
      return elements
        .filter((attrs) => list.some((selector) => matchesCompound(attrs, selector)))
        .map((attrs) => ({ hasAttribute: (name: string) => name in attrs }));
    },
  };
}

const PANEL_OPEN = { role: "dialog", "data-open": "", "data-sales-deal-panel": "" };
const DIALOG_OPEN = { role: "dialog", "data-open": "" };

describe("topModalSurface", () => {
  it("is null with no window open, or one only closing", () => {
    expect(topModalSurface(fakeDocument([]))).toBeNull();
    expect(topModalSurface(fakeDocument([{ role: "dialog", "data-closed": "", "data-sales-deal-panel": "" }]))).toBeNull();
    // An open menu is not a window: keys inside it are typing (isTypingTarget).
    expect(topModalSurface(fakeDocument([{ role: "menu", "data-open": "" }]))).toBeNull();
  });

  it("names the deal panel when it is the open window on top", () => {
    expect(topModalSurface(fakeDocument([PANEL_OPEN]))).toBe("deal-panel");
  });

  it("names any other window, also one opened over the panel (Value, Lost, next step)", () => {
    expect(topModalSurface(fakeDocument([DIALOG_OPEN]))).toBe("other");
    expect(topModalSurface(fakeDocument([PANEL_OPEN, DIALOG_OPEN]))).toBe("other");
    expect(topModalSurface(fakeDocument([{ role: "alertdialog", "data-open": "" }]))).toBe("other");
  });
});

describe("announceShortcut and shortcutListener", () => {
  it("says nobody took it when no screen listens (so the key is left to the browser)", () => {
    expect(announceShortcut(new EventTarget(), "search")).toBe(false);
  });

  it("runs the listener for its action and says it was taken", () => {
    const target = new EventTarget();
    let runs = 0;
    target.addEventListener(SALES_SHORTCUT_EVENT, shortcutListener("search", () => void runs++));
    expect(announceShortcut(target, "search")).toBe(true);
    expect(runs).toBe(1);
  });

  it("leaves the key alone when the listener has nothing to do (returns false)", () => {
    const target = new EventTarget();
    target.addEventListener(SALES_SHORTCUT_EVENT, shortcutListener("new-task", () => false));
    expect(announceShortcut(target, "new-task")).toBe(false);
  });

  it("ignores other actions", () => {
    const target = new EventTarget();
    let runs = 0;
    target.addEventListener(SALES_SHORTCUT_EVENT, shortcutListener("help", () => void runs++));
    expect(announceShortcut(target, "search")).toBe(false);
    expect(runs).toBe(0);
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
