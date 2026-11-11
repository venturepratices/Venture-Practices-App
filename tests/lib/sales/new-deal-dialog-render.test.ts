import fs from "node:fs";
import path from "node:path";

import { createElement, Fragment, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { cn } from "@/lib/utils";

// Add deal's Person and Organization pickers (C6, M2, K1). Every option was
// truncated, so "Add new person: Dana Q." read "Add new person: Da…"; options
// now wrap inside a popup exactly as wide as the box. The popups and the dialog
// are portals, which a server render leaves out, so the dialog and the combobox
// parts render in place here: what this checks is the classes and markup Add
// deal gives them.

const choices = vi.hoisted(() => [
  { key: "person:p1", kind: "existing" as const, id: "p1", name: "Dr. Alexandria M.", detail: "Bright Smile Family and Cosmetic Dentistry" },
  { key: "new", kind: "new" as const, name: "Dana Q." },
]);

type Slot = { className?: string; children?: ReactNode };

vi.mock("@/components/ui/dialog", async () => {
  const { createElement: h, Fragment: F } = await import("react");
  const part = (slot: string) => ({ className, children }: Slot) => h("div", { "data-slot": slot, className }, children);
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? h(F, null, children) : null),
    DialogContent: part("dialog-content"),
    DialogHeader: part("dialog-header"),
    DialogTitle: part("dialog-title"),
    DialogDescription: part("dialog-description"),
    DialogFooter: part("dialog-footer"),
  };
});

vi.mock("@/components/ui/combobox", async () => {
  const { createElement: h, Fragment: F } = await import("react");
  const part = (slot: string) => ({ className, children }: Slot) => h("div", { "data-slot": slot, className }, children);
  return {
    Combobox: ({ children }: Slot) => h(F, null, children),
    ComboboxInputGroup: part("combobox-input-group"),
    ComboboxInput: () => h("input"),
    ComboboxTrigger: part("combobox-trigger"),
    ComboboxContent: part("combobox-content"),
    ComboboxEmpty: part("combobox-empty"),
    // The list's child is a function of each option, as Base UI calls it.
    ComboboxList: ({ children }: { children: (choice: (typeof choices)[number]) => ReactNode }) =>
      h("div", { "data-slot": "combobox-list" }, choices.map(children)),
    ComboboxItem: part("combobox-item"),
  };
});

const { NewDealDialog } = await import("@/components/sales/new-deal-dialog");

function render() {
  return renderToString(
    createElement(
      Fragment,
      null,
      createElement(NewDealDialog, {
        open: true,
        onOpenChange: vi.fn(),
        pipelines: [{ id: "p1", key: "direct-mail", name: "Direct Mail", kind: "SALES" }],
        currentPipelineId: "p1",
        members: [{ id: "u1", name: "Ben S." }],
        viewer: { userId: "u1", isAdmin: false },
        onCreated: vi.fn(),
      }),
    ),
  ).replaceAll("<!-- -->", "");
}

const classList = (value: string) => value.split(/\s+/).filter(Boolean);

// The shared popup's own classes (src/components/ui/combobox.tsx), which Add
// deal's classes merge over in the real ComboboxContent.
const COMBOBOX_SOURCE = fs.readFileSync(path.join(process.cwd(), "src", "components", "ui", "combobox.tsx"), "utf8");
const SHARED_POPUP = /data-slot="combobox-content"\s+className=\{cn\(\s*"([^"]*)"/.exec(COMBOBOX_SOURCE)?.[1] ?? "";

/** Each picker's popup classes as the browser gets them: the shared ones with Add deal's (if any) merged over. */
function popups(): string[][] {
  return [...render().matchAll(/data-slot="combobox-content"(?: class="([^"]*)")?/g)].map((match) =>
    classList(cn(SHARED_POPUP, match[1] ?? "")),
  );
}

const isWidth = (name: string) => /^(?:min-|max-)?w-/.test(name);

describe("Add deal's Person and Organization pickers (server render)", () => {
  it("reads the shared popup's width: exactly the box it opens from", () => {
    expect(classList(SHARED_POPUP).filter(isWidth)).toEqual(["w-(--anchor-width)"]);
  });

  it("open a popup exactly as wide as the box (K1)", () => {
    // M2's fixed 22rem popup was 344px under a 206px Organization box at
    // 1280px and ran 124px past the dialog's right edge; at 375px it was wider
    // than its box on both sides. The popup is the box's width and nothing else.
    const merged = popups();
    expect(merged).toHaveLength(2);
    for (const classes of merged) {
      expect(classes.filter(isWidth)).toEqual(["w-(--anchor-width)"]);
    }
  });

  it("keep that width while the person types (M2)", () => {
    // `w-max` sized the popup to its widest option, so its right edge grew with
    // every key pressed and moved again when search results arrived. No width
    // may follow the options.
    for (const classes of popups()) {
      expect(classes.filter((name) => /^(?:min-|max-)?w-(?:max|fit|min|auto)$/.test(name))).toEqual([]);
    }
  });

  it("wraps a long option instead of cutting it off", () => {
    const html = render();
    expect(html).toMatch(/<span class="([^"]*)">Add new person: Dana Q\.<\/span>/);
    expect(html).toMatch(/<span class="([^"]*)">Add new organization: Dana Q\.<\/span>/);
    for (const text of ["Add new person: Dana Q.", "Add new organization: Dana Q.", "Dr. Alexandria M.", "Bright Smile Family and Cosmetic Dentistry"]) {
      const spans = [...html.matchAll(new RegExp(`<span class="([^"]*)">${text.replace(/[.]/g, "\\.")}</span>`, "g"))];
      expect(spans.length, text).toBeGreaterThan(0);
      for (const [, classes] of spans) {
        expect(classList(classes), text).not.toContain("truncate");
        expect(classList(classes), text).toContain("[overflow-wrap:anywhere]");
      }
    }
  });
});
