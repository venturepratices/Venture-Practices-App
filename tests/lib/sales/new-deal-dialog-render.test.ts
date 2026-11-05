import { createElement, Fragment, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { cn } from "@/lib/utils";

// Add deal's Person and Organization pickers (C6). Their popups were exactly
// as wide as the input and every option truncated, so "Add new person: Dana
// Q." read "Add new person: Da…". The popups and the dialog are portals, which
// a server render leaves out, so the dialog and the combobox parts render in
// place here: what this checks is the classes and markup Add deal gives them.

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

describe("Add deal's Person and Organization pickers (server render)", () => {
  it("open a popup at least as wide as the box, with room for long names", () => {
    const popups = [...render().matchAll(/data-slot="combobox-content" class="([^"]*)"/g)].map((match) => match[1]);
    expect(popups).toHaveLength(2);
    for (const popup of popups) {
      // The shared popup is exactly the anchor's width; Add deal's override must win over it.
      const merged = classList(cn("w-(--anchor-width)", popup));
      expect(merged).toContain("min-w-(--anchor-width)");
      expect(merged).not.toContain("w-(--anchor-width)");
    }
  });

  it("keep that width while the person types (M2)", () => {
    // `w-max` sized the popup to its widest option, so its right edge grew with
    // every key pressed and moved again when search results arrived. The width
    // must not depend on the options; it stays within the room on screen.
    for (const popup of [...render().matchAll(/data-slot="combobox-content" class="([^"]*)"/g)].map((match) => match[1])) {
      const widths = classList(cn("w-(--anchor-width)", popup)).filter((name) => /^w-/.test(name));
      expect(widths).toHaveLength(1);
      expect(widths[0]).not.toMatch(/^w-(max|fit|min|auto)$/);
      expect(widths[0]).toContain("var(--available-width)");
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
