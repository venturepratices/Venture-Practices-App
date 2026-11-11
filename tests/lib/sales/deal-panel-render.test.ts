import { createElement, createRef, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ComposerHandle } from "@/components/sales/activity-composer";
import type { DealPanelData, PanelFile } from "@/lib/sales/deal-panel";
import type { HistoryState } from "@/components/sales/deal-history";
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

const { DealPanel, DealPanelContent } = await import("@/components/sales/deal-panel");
const { ActivityComposer } = await import("@/components/sales/activity-composer");
const { FileUploadTab } = await import("@/components/sales/file-upload-tab");
const { Sheet } = await import("@/components/ui/sheet");

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

  it("offers an Activity, a Note and a File tab on deals (Task 24)", () => {
    const html = renderToString(createElement(ActivityComposer, { parent: { kind: "deal", id: "d1" }, onSaved: vi.fn() }));
    // Each tab button sits under `role="tab"` and holds its name as its last text node.
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]);
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toMatch(/Activity/);
    expect(tabs[1]).toMatch(/Note/);
    expect(tabs[2]).toMatch(/File/);
  });

  it("leaves the File tab off a lead composer", () => {
    const html = renderToString(createElement(ActivityComposer, { parent: { kind: "lead", id: "l1" }, onSaved: vi.fn() }));
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]);
    expect(tabs).toHaveLength(2);
    expect(tabs.join(" ")).not.toMatch(/\bFile\b/);
  });
});

// --- Task 24: DealPanelContent renders Files, Details with pickers and Expected close ---

const STAGES_T24 = [
  {
    id: "s1",
    key: "new",
    name: "New Lead",
    position: 0,
    probability: 10,
    isWon: false,
    isLost: false,
    requiresValue: false,
    isNoShow: false,
    rottingDays: 14,
  },
];

const PIPELINE_T24 = { id: "p1", key: "direct-mail", name: "Direct Mail", kind: "SALES" as const };
const MEMBERS_T24 = [
  { id: "u1", name: "Ben S." },
  { id: "u2", name: "Dana Q." },
];

function makePanel(overrides: Partial<DealPanelData> = {}): DealPanelData {
  return {
    deal: {
      id: "d1",
      title: "Oak Creek Dental",
      status: "OPEN",
      valueCents: 1440000,
      mrrCents: 120000,
      stageId: "s1",
      stageEnteredAt: "2026-10-30T15:00:00.000Z",
      lostReason: null,
      lostComment: null,
      source: null,
      owner: MEMBERS_T24[0],
      organization: { id: "o1", name: "Oak Creek Dental" },
      person: { id: "pe1", name: "Sarah K." },
      expectedCloseDate: null,
    },
    pipeline: PIPELINE_T24,
    stages: STAGES_T24,
    openActivities: [],
    fields: [],
    members: MEMBERS_T24,
    canEdit: true,
    territoryHold: null,
    files: [],
    ...overrides,
  };
}

const NOW_T24 = new Date("2026-11-05T15:00:00.000Z");
const readyHistory: HistoryState = { status: "ready", entries: [], hasOlder: false, loadingOlder: false };

function renderContent(data: DealPanelData) {
  const ref = createRef<ComposerHandle>();
  // The mocked Base UI dialog renders children only when the root is open.
  return renderToString(
    createElement(
      Sheet,
      { open: true },
      createElement(DealPanelContent, {
        data,
        now: NOW_T24,
        history: readyHistory,
        titleId: "t",
        composerRef: ref,
        onChanged: vi.fn(),
        onShowOlder: vi.fn(),
        onRetryHistory: vi.fn(),
      }),
    ),
  );
}

describe("Deal panel Files section (Task 24)", () => {
  function file(overrides: Partial<PanelFile>): PanelFile {
    return {
      id: "f1",
      name: "contract.pdf",
      sizeBytes: 1572864,
      contentType: "application/pdf",
      stageName: "Proposal Sent",
      uploadedBy: "Ben S.",
      createdAt: "2026-11-05T14:00:00.000Z",
      canRemove: false,
      ...overrides,
    };
  }

  it("lists a deal's files with a count pill, Download links and one Remove button per removable file", () => {
    const data = makePanel({
      files: [
        file({ id: "f1", name: "contract.pdf", canRemove: true }),
        file({ id: "f2", name: "proposal.pdf", canRemove: false }),
      ],
    });
    const html = renderContent(data);
    expect(html).toContain("Files");
    // Count pill with 2.
    expect(html).toMatch(/>2</);
    expect(html).toContain('href="/api/sales/files/f1"');
    expect(html).toMatch(/aria-label="Download contract\.pdf"/);
    expect(html).toMatch(/download/);
    // Exactly one Remove button (only f1 is removable).
    const removes = html.match(/aria-label="Remove [^"]+"/g) ?? [];
    expect(removes).toHaveLength(1);
    expect(removes[0]).toBe('aria-label="Remove contract.pdf"');
  });

  it("puts the Files section after Next steps and before Details", () => {
    const html = renderContent(makePanel({ files: [file({})] }));
    const nextSteps = html.indexOf("Next steps");
    const files = html.indexOf(">Files<");
    const details = html.indexOf(">Details<");
    expect(nextSteps).toBeGreaterThan(-1);
    expect(files).toBeGreaterThan(nextSteps);
    expect(details).toBeGreaterThan(files);
  });

  it("shows the empty line and an Add a file button when the person may edit", () => {
    const html = renderContent(makePanel({ canEdit: true, files: [] }));
    expect(html).toContain("No files yet. Add the signed contract or the final proposal once the client has it.");
    expect(html).toContain("Add a file");
  });

  it("drops the Add a file button when the person cannot edit", () => {
    const html = renderContent(makePanel({ canEdit: false, files: [] }));
    expect(html).toContain("No files yet. Add the signed contract or the final proposal once the client has it.");
    expect(html).not.toContain("Add a file");
  });
});

describe("Deal panel Details with editable Organization, Person and Expected close (Task 24)", () => {
  it("labels Organization, Person and Expected close", () => {
    const html = renderContent(makePanel());
    expect(html).toContain(">Organization<");
    expect(html).toContain(">Person<");
    expect(html).toContain(">Expected close<");
  });

  it("says Add when no expected close date is set", () => {
    const html = renderContent(makePanel({ deal: { ...makePanel().deal, expectedCloseDate: null } }));
    expect(html).toContain(">Add<");
  });

  it("reads a stored Expected close as a short date", () => {
    const html = renderContent(makePanel({ deal: { ...makePanel().deal, expectedCloseDate: "2026-11-30" } }));
    expect(html).toContain("Nov 30, 2026");
  });
});

describe("FileUploadTab layout (Task 24)", () => {
  it("has a visually-hidden focusable file input whose description is the rules line", () => {
    const html = renderToString(createElement(FileUploadTab, { dealId: "d1", onUploaded: vi.fn() }));
    // The input is focusable: sr-only (not `hidden`), and points at the hint.
    const match = html.match(/<input[^>]*type="file"[^>]*>/);
    expect(match).not.toBeNull();
    const inputTag = match![0];
    expect(inputTag).toMatch(/class="[^"]*sr-only/);
    expect(inputTag).not.toMatch(/\shidden(\s|>)/);
    const described = inputTag.match(/aria-describedby="([^"]+)"/);
    expect(described).not.toBeNull();
    // That id names a block that holds the "PDF, Word, Excel, PNG or JPG. Up to 4 MB." line.
    const hintId = described![1];
    expect(html).toMatch(new RegExp(`id="${hintId}"[^>]*>[\\s\\S]*?PDF, Word, Excel, PNG or JPG\\. Up to 4 MB\\.`));
  });
});
