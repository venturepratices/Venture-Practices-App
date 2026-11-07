import fs from "node:fs";
import path from "node:path";

import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { LeadPanelData } from "@/lib/sales/lead-panel";
import { DEAL_PANEL_ATTRIBUTE } from "@/lib/sales/shortcuts";

// A server render of the lead panel's ready state and the convert dialogs
// (Mockup v2 `#s=lead-open`, `#s=lead-converted`, `#s=lead-open&id=1&as=rep`,
// `#s=lead-convert`, `#s=lead-convert-pickers`, `#s=leads-bulk-convert`).
// Node has no browser, so nothing is clicked and no effect runs (the History
// and the pipelines list stay in their loading states); this proves each
// state renders without throwing and carries the words, labels, links and
// controls the plan asks for. Base UI's dialog parts render through a portal,
// which a server render leaves out, so here they render in place, as in
// deal-panel-render.test.ts.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/sales/leads",
  useSearchParams: () => new URLSearchParams("scope=mine&lead=l1"),
}));

vi.mock("@base-ui/react/dialog", async () => {
  const { createElement: h, Fragment: F } = await import("react");
  type Part = { children?: ReactNode; className?: string } & Record<string, unknown>;
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
      Popup: ({ children, ...props }: Part) => h("div", { role: "dialog", "data-open": "", ...domProps(props) }, children),
      Close: ({ children }: Part) => h("button", null, children),
      Title: ({ children, ...props }: Part) => h("h2", domProps(props), children),
      Description: ({ children, ...props }: Part) => h("p", domProps(props), children),
      Trigger: ({ children }: Part) => h("button", null, children),
    },
  };
});

const { LeadPanelBody } = await import("@/components/sales/lead-panel");
const { ConvertDialog } = await import("@/components/sales/convert-dialog");

const NOW = "2026-11-05T15:00:00.000Z";

const clean = (html: string) => html.replaceAll("<!-- -->", "");
/** The page's words without tags, spaces collapsed. */
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

function lead(extra: Partial<LeadPanelData> = {}, leadExtra: Partial<LeadPanelData["lead"]> = {}): LeadPanelData {
  return {
    lead: {
      id: "l1",
      title: "Crestview Dental",
      status: "OPEN",
      source: "Check Availability form",
      createdAt: "2026-11-02T15:00:00.000Z",
      owner: { id: "b", name: "Ben S." },
      organization: { id: "o1", name: "Crestview Dental" },
      person: { id: "p1", name: "Laura B." },
      ...leadExtra,
    },
    convertedDeal: null,
    openActivities: [],
    fields: [{ key: "practice-zip", label: "Practice ZIP", fieldType: "TEXT", options: [], value: "78704" }],
    members: [
      { id: "b", name: "Ben S." },
      { id: "r", name: "Robert O." },
    ],
    canEdit: true,
    canRestore: false,
    ...extra,
  };
}

function render(data: LeadPanelData): string {
  return clean(renderToString(createElement(LeadPanelBody, { data, now: new Date(NOW), onChanged: vi.fn(), onClose: vi.fn() })));
}

describe("the lead panel (server render)", () => {
  it("an open lead with no activity, owned by the viewer: header, warning, composer, Details", () => {
    const html = render(lead());
    const text = words(html);

    expect(html).toContain(">Leads Inbox<");
    expect(html).toMatch(/<input[^>]*aria-label="Lead name"[^>]*value="Crestview Dental"/);
    expect(html).toMatch(/<button[^>]*>Convert to deal<\/button>/);
    expect(text).toContain("No next step. Call within 5 minutes of opt-in works best.");
    expect(html).toMatch(/<button[^>]*>Schedule<\/button>/);
    // Mockup v2's line under the name, with the amber age pill past two days.
    expect(text).toContain("Open lead · came in Nov 2");
    expect(html).toMatch(/>3d old</);
    // The owner, and the lead's person and organization, in the header.
    expect(html).toContain('aria-label="Owner"');
    expect(text).toContain("Laura B.");

    // The composer: Activity and Note only on a lead (no File tab), saving to the lead.
    const tabs = [...html.matchAll(/role="tab"[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]*)<\/button>/g)].map((match) => match[1]);
    expect(tabs).toEqual(["Activity", "Note"]);
    expect(html).toContain('aria-label="Add to this lead"');
    expect(html).toContain('placeholder="Write a note. Everyone who can see this lead can read it."');

    for (const label of ["Source", "Organization", "Person", "Practice ZIP", "Created"]) {
      expect(html, label).toMatch(new RegExp(`<dt[^>]*>(?:<label[^>]*>)?${label}(?:</label>)?</dt>`));
    }
    expect(html).toContain('value="78704"');
    expect(text).toContain("Nov 2, 2026");
    // Shortcuts stay off inside the lead panel (A11).
    expect(html).not.toContain(DEAL_PANEL_ATTRIBUTE);
  });

  it("offers Change and Open beside the person and organization (Mockup v2 Details)", () => {
    const html = render(lead());
    expect(html).toContain('aria-label="Change organization"');
    expect(html).toContain('aria-label="Change person"');
    // Open swaps to the contact's panel, keeping the page's own filters.
    expect(html).toContain('href="/sales/leads?scope=mine&amp;organization=o1"');
    expect(html).toContain('href="/sales/leads?scope=mine&amp;person=p1"');

    const bare = render(lead({}, { organization: null, person: null }));
    expect(bare).toContain('aria-label="Add organization"');
    expect(words(bare)).toContain("No person yet");
    expect(words(bare)).toContain("No organization yet");
  });

  it("a lead with a next step shows no warning", () => {
    const html = render(
      lead({
        openActivities: [
          { id: "a1", type: "CALL", subject: "First call", dueAt: "2026-11-05T15:00:00.000Z", hasTime: false, createdBy: "b", ownerId: "b" },
        ],
      }),
    );
    expect(html).not.toContain("No next step.");
    expect(html).toContain("First call");
  });

  it("a converted lead points at its deal, by a link that swaps the lead for the deal", () => {
    const html = render(lead({ convertedDeal: { id: "d7", title: "Oak Creek Dental" }, canEdit: false }, { status: "CONVERTED" }));
    expect(words(html)).toContain("Converted to Oak Creek Dental. Its activities and notes are on the deal now.");
    const link = html.match(/<a [^>]*href="([^"]*)"[^>]*>Open deal<\/a>/);
    expect(link).not.toBeNull();
    expect(link![1]).toContain("deal=d7");
    expect(link![1]).not.toContain("lead=");
    expect(html).toMatch(/>Converted</);
    expect(html).not.toContain('aria-label="Add to this lead"');
    expect(html).not.toMatch(/>Convert to deal<\/button>/);
  });

  it("a lead converted to a deal the viewer cannot open says so, with no link", () => {
    const html = render(lead({ convertedDeal: null, canEdit: false }, { status: "CONVERTED" }));
    expect(words(html)).toContain("Converted to a deal you cannot open.");
    expect(html).not.toContain("deal=");
  });

  it("someone else's lead seen by a rep who sees everyone: the lock line and no composer", () => {
    const html = render(lead({ canEdit: false }));
    expect(words(html)).toContain("Ben S. owns this lead. Only they or an admin can change it.");
    expect(html).not.toContain('aria-label="Add to this lead"');
    expect(html).not.toMatch(/>Convert to deal<\/button>/);
    expect(html).not.toMatch(/>Schedule<\/button>/);
    expect(html).not.toContain('aria-label="Owner"');
    expect(html).toMatch(/<input[^>]*aria-label="Lead name"[^>]*disabled=""/);
  });

  it("an archived lead offers Restore to its owner or an admin, and no composer", () => {
    const html = render(lead({ canEdit: false, canRestore: true }, { status: "ARCHIVED" }));
    expect(words(html)).toContain("This lead is archived.");
    expect(html).toMatch(/<button[^>]*>Restore<\/button>/);
    expect(html).not.toContain('aria-label="Add to this lead"');
    expect(html).not.toContain("owns this lead");

    const notMine = render(lead({ canEdit: false, canRestore: false }, { status: "ARCHIVED" }));
    expect(notMine).not.toMatch(/>Restore<\/button>/);
  });

  it("puts Convert to deal on its own line on a phone (375px)", () => {
    const html = render(lead());
    const wrapper = html.match(/<span class="([^"]*)"><button[^>]*>Convert to deal<\/button>/);
    expect(wrapper).not.toBeNull();
    expect(wrapper![1].split(/\s+/)).toContain("max-sm:w-full");
  });
});

describe("the convert dialogs (server render)", () => {
  const props = { open: true, onOpenChange: vi.fn(), onConverted: vi.fn() };
  const crestview = { id: "l1", title: "Crestview Dental", personName: "Laura B.", organizationName: "Crestview Dental" };

  it("single: the lead's own person and organization, read only, while the pipelines load", () => {
    const html = clean(renderToString(createElement(ConvertDialog, { ...props, leads: [crestview] })));
    const text = words(html);
    expect(html).toMatch(/<h2[^>]*>Convert to deal<\/h2>/);
    expect(html).toMatch(/<dt[^>]*>Person<\/dt><dd[^>]*>Laura B\.<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Organization<\/dt><dd[^>]*>Crestview Dental<\/dd>/);
    expect(text).toContain("Loading pipelines…");
    expect(html).toContain('placeholder="Optional"');
    expect(text).toContain("Value ($)");
    expect(text).toContain("It has no next step, so a first call is added for today. Notes move to the deal.");
    expect(html).toMatch(/<button[^>]*>Cancel<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Convert<\/button>/);
    // No pickers when the lead has a contact of its own (A1).
    expect(html).not.toContain("Add new");
  });

  it("single: a lead with neither person nor organization gets the Add deal pickers", () => {
    const bare = { ...crestview, personName: null, organizationName: null };
    const html = clean(renderToString(createElement(ConvertDialog, { ...props, leads: [bare] })));
    expect(words(html)).toContain("This lead has no person or organization yet. Add at least one.");
    expect(html).toMatch(/<label[^>]*>Person<\/label>/);
    expect(html).toMatch(/<label[^>]*>Organization<\/label>/);
  });

  it("bulk: lists the leads it takes, names the one it skips, and counts only the rest", () => {
    const leads = [
      crestview,
      { id: "l2", title: "Oak Creek", personName: "Dana Q.", organizationName: null },
      { id: "l3", title: "Maple Grove", personName: null, organizationName: null },
    ];
    const html = clean(renderToString(createElement(ConvertDialog, { ...props, leads })));
    const text = words(html);
    expect(html).toMatch(/<h2[^>]*>Convert leads to deals<\/h2>/);
    expect(text).toContain("Crestview Dental, Oak Creek");
    expect(text).toContain("Add a person or an organization first: Maple Grove. It stays in the inbox.");
    expect(text).toContain("Open activities and notes move with each lead. A lead with no next step gets a first call for today.");
    expect(html).toMatch(/<button[^>]*>Convert 2 leads<\/button>/);
    // Bulk asks for no value (R13).
    expect(text).not.toContain("Value ($)");
  });
});

describe("the lead panel's wiring", () => {
  const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

  it("mounts beside the deal panel in the Sales layout's Suspense", () => {
    expect(source("src/app/(app)/sales/layout.tsx")).toMatch(/<Suspense[^>]*>[\s\S]*<DealPanel \/>[\s\S]*<LeadPanel \/>[\s\S]*<\/Suspense>/);
  });

  it("the composer saves activities and notes to the parent it is given, deal or lead", () => {
    // Saving needs a click, which a server render cannot make; api-client.test.ts pins each parent's URL.
    const composer = source("src/components/sales/activity-composer.tsx");
    expect(composer).toContain("createActivityFor(parent, {");
    expect(composer).toContain("addNoteFor(parent, {");
    expect(composer).not.toMatch(/createActivityRequest|addNoteRequest|dealId/);
    expect(source("src/components/sales/lead-panel.tsx")).toContain('parent={{ kind: "lead", id: lead.id }}');
  });

  it("opens from activePanel, so one panel shows at a time, and carries no deal-panel mark", () => {
    const panel = source("src/components/sales/lead-panel.tsx");
    expect(panel).toContain("activePanel(searchParams)");
    expect(panel).not.toContain("DEAL_PANEL_ATTRIBUTE");
    expect(panel).toMatch(/\[data-lead-id=/);
    expect(source("src/components/sales/deal-panel.tsx")).toContain("activePanel(searchParams)");
  });
});
