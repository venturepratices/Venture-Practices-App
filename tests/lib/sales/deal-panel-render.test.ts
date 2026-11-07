import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DEAL_PANEL_ATTRIBUTE, topModalSurface } from "@/lib/sales/shortcuts";

// The deal panel's window carries DEAL_PANEL_ATTRIBUTE (F1): the shortcuts
// find the open window on top with topModalSurface, and only that mark tells
// them the deal panel is open, so `e` and `t` work in it. Lose the mark and
// the open panel counts as "some other window": `e` and `t` stop working
// everywhere, while shortcuts.test.ts (a stand-in document) stays green.
// Base UI's dialog parts render through a portal, which a server render leaves
// out, so here they render in place; the app's own Sheet (sheet.tsx) is real,
// so this follows the attribute from DealPanel through SheetContent onto the
// window element.

// The page's query string; a test may point it elsewhere before rendering.
const url = vi.hoisted(() => ({ search: "pipeline=direct-mail&deal=d1" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/sales/deals",
  useSearchParams: () => new URLSearchParams(url.search),
}));

vi.mock("@base-ui/react/dialog", async () => {
  const { createElement: h, Fragment: F } = await import("react");
  type Part = { children?: ReactNode; className?: string } & Record<string, unknown>;
  /** Only what lands on the element: class, data-* and aria-* (Base UI's own options, such as finalFocus, do not). */
  const domProps = ({ className, ...rest }: Part) => ({
    className,
    ...Object.fromEntries(Object.entries(rest).filter(([name]) => /^(data|aria)-/.test(name) || name === "role")),
  });
  const passThrough = ({ children }: Part) => h(F, null, children);
  return {
    Dialog: {
      Root: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? h(F, null, children) : null),
      Portal: passThrough,
      Backdrop: () => null,
      // Base UI gives an open popup role="dialog" and data-open.
      Popup: ({ children, ...props }: Part) => h("div", { role: "dialog", "data-open": "", ...domProps(props) }, children),
      Close: ({ children }: Part) => h("button", null, children),
      Title: ({ children, ...props }: Part) => h("h2", domProps(props), children),
      Description: ({ children, ...props }: Part) => h("p", domProps(props), children),
      Trigger: ({ children }: Part) => h("button", null, children),
    },
  };
});

const { DealPanel } = await import("@/components/sales/deal-panel");
const { ActivityComposer } = await import("@/components/sales/activity-composer");

/** The opening tags of the rendered page, as a stand-in document for topModalSurface. */
function documentOf(html: string) {
  const elements = [...html.matchAll(/<([a-z][\w-]*)([^>]*)>/g)].map(([, , attrs]) => {
    const names = new Map([...attrs.matchAll(/\s([\w-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? ""]));
    return { names, hasAttribute: (name: string) => names.has(name) };
  });
  return {
    querySelectorAll(selectors: string) {
      // The selector topModalSurface asks for: an open dialog or alertdialog.
      expect(selectors).toBe('[role="dialog"][data-open], [role="alertdialog"][data-open]');
      return elements.filter((el) => ["dialog", "alertdialog"].includes(el.names.get("role") ?? "") && el.names.has("data-open"));
    },
  };
}

describe("the deal panel's window (server render)", () => {
  it("carries the mark the shortcuts look for, so the open panel counts as the deal panel", () => {
    const html = renderToString(createElement(DealPanel));
    expect(html).toMatch(new RegExp(`<div[^>]*data-slot="sheet-content"[^>]*\\s${DEAL_PANEL_ATTRIBUTE}=""`));
    expect(topModalSurface(documentOf(html))).toBe("deal-panel");
  });
});

describe("one panel at a time (Decision 35, Task 7)", () => {
  it("opens only for the panel activePanel names: an empty deal id names none, so a lead beside it wins", () => {
    url.search = "deal=&lead=l1";
    try {
      expect(renderToString(createElement(DealPanel))).not.toContain('data-slot="sheet-content"');
    } finally {
      url.search = "pipeline=direct-mail&deal=d1";
    }
    expect(renderToString(createElement(DealPanel))).toContain('data-slot="sheet-content"');
  });
});

describe("the deal panel's composer saves to its deal", () => {
  it("names the deal it adds to, and keeps the deal's note line", () => {
    const html = renderToString(createElement(ActivityComposer, { parent: { kind: "deal", id: "d1" }, onSaved: vi.fn() }));
    expect(html).toContain('aria-label="Add to this deal"');
    expect(html).toContain('placeholder="Write a note. Everyone on the deal can see it."');
  });
});
