import fs from "node:fs";
import path from "node:path";

import { createElement, Fragment, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { LeadRow, LeadsPageData } from "@/lib/sales/leads-page";

// A server render of the Leads Inbox with canned data (Mockup v2 `#s=leads`,
// `#s=leads-sel`, `#s=new-lead`, `#s=leads-delete`). Node has no browser, so
// this cannot click anything; it proves the header, table, phone cards, bulk
// bar and dialogs render without throwing and carry the words, labels, links
// and classes the plan asks for. Dialogs are portals, which a server render
// leaves out, so they render in place here.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/sales/leads",
  useSearchParams: () => new URLSearchParams(""),
}));

type Slot = { className?: string; children?: ReactNode; role?: string };

vi.mock("@/components/ui/dialog", async () => {
  const { createElement: h, Fragment: F } = await import("react");
  const part =
    (slot: string) =>
    ({ className, children, role }: Slot) =>
      h("div", { "data-slot": slot, className, role }, children);
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? h(F, null, children) : null),
    DialogContent: part("dialog-content"),
    DialogHeader: part("dialog-header"),
    DialogTitle: part("dialog-title"),
    DialogDescription: part("dialog-description"),
    DialogFooter: part("dialog-footer"),
  };
});

const { LeadsView, LeadRowView, SelectAllBox } = await import("@/components/sales/leads-view");
const { LeadsBulkBar, DeleteLeadsDialog } = await import("@/components/sales/lead-bulk-dialogs");
const { NewLeadDialog } = await import("@/components/sales/new-lead-dialog");

const NOW = "2026-11-05T15:00:00.000Z";

const clean = (html: string) => html.replaceAll("<!-- -->", "");

const CRESTVIEW: LeadRow = {
  id: "l1",
  title: "Crestview Dental",
  source: "Check Availability form",
  createdAt: "2026-11-02T15:00:00.000Z",
  ownerId: "u1",
  personName: "Laura B.",
  organizationName: "Crestview Dental",
  zip: "78704",
  next: { type: "CALL", subject: "First call", dueAt: "2026-11-05T15:00:00.000Z", hasTime: false },
};

// Another rep's lead, from today, with nothing planned.
const MAPLE: LeadRow = {
  id: "l2",
  title: "Maple Grove Dental",
  source: "Referral",
  createdAt: "2026-11-05T13:00:00.000Z",
  ownerId: "u2",
  personName: null,
  organizationName: "Maple Grove Dental",
  zip: null,
  next: null,
};

const MEMBERS = [
  { id: "u1", name: "Ben Example" },
  { id: "u2", name: "Robert Example" },
];

function data(extra: Partial<LeadsPageData> = {}): LeadsPageData {
  return {
    query: { scope: "everyone", q: "", cursor: null },
    rows: [CRESTVIEW, MAPLE],
    nextCursor: null,
    members: MEMBERS,
    canSeeEveryone: true,
    assignment: { mode: "ROUND_ROBIN", names: ["Ben E.", "Robert E."], fallbackName: null },
    ...extra,
  };
}

const REP = { userId: "u1", isAdmin: false };
const ADMIN = { userId: "u1", isAdmin: true };

function renderView(pageData: LeadsPageData, viewer = REP, openNew = false): string {
  return clean(renderToString(createElement(LeadsView, { data: pageData, viewer, now: NOW, openNew })));
}

const classLists = (html: string) => [...html.matchAll(/class="([^"]*)"/g)].map((match) => match[1].split(/\s+/));

describe("Leads Inbox (server render)", () => {
  it("shows the header, the search and the table head", () => {
    const html = renderView(data());
    expect(html).toContain(">Leads Inbox</h1>");
    expect(html).toContain("New opt-ins land here first. Convert the good ones to deals.");
    expect(html).toMatch(/<button[^>]*aria-label="Add lead"[^>]*>.*?Lead<\/button>/);
    expect(html).toContain('aria-label="Search leads by name, practice or person"');
    expect(html).toContain('placeholder="Search leads"');
    for (const head of ["Lead", "Source", "Created", "Owner", "Next step"]) {
      expect(html, head).toMatch(new RegExp(`<th[^>]*>${head}</th>`));
    }
    expect(html).toContain('aria-label="Whose leads"');
    expect(html).toContain(">Everyone</button>");
    expect(html).toContain(">Just me</button>");
  });

  it("ticks only the leads the viewer may change, from the header or the phone strip", () => {
    const html = renderView(data());
    const selectAll = [...html.matchAll(/aria-label="Select all shown leads you can change"/g)];
    // The header box, and the same box in the strip above the cards on phones.
    expect(selectAll).toHaveLength(2);
    // An element whose classes hold exactly `sm:hidden` (not `max-sm:hidden`) holding the box, above the cards.
    const strip = [...html.matchAll(/<(\w+)[^>]*class="([^"]*)"[^>]*>/g)].find((tag) => {
      if (!tag[2].split(/\s+/).includes("sm:hidden")) return false;
      const inside = html.slice(tag.index, html.indexOf(`</${tag[1]}>`, tag.index));
      return inside.includes('aria-label="Select all shown leads you can change"');
    });
    expect(strip).toBeDefined();
    expect(strip!.index).toBeLessThan(html.indexOf("<tbody"));
    expect(html).toContain('aria-label="Select Crestview Dental"');
    // Another rep's lead has no box for someone who is not an admin.
    expect(html).not.toContain('aria-label="Select Maple Grove Dental"');
  });

  it("gives an admin a box on every lead", () => {
    const html = renderView(data(), ADMIN);
    expect(html).toContain('aria-label="Select Crestview Dental"');
    expect(html).toContain('aria-label="Select Maple Grove Dental"');
  });

  it("shows nothing to tick when no shown lead can be changed", () => {
    const html = renderView(data({ rows: [MAPLE] }));
    expect(html).not.toContain("Select all shown leads you can change");
    expect(html).toContain('<span class="sr-only">Select</span>');
  });

  it("draws each lead's row: person and ZIP, age, owner, next step and the panel link", () => {
    const html = renderView(data());
    expect(html).toContain("Laura B. · ZIP 78704");
    expect(html).toMatch(/<span class="[^"]*\bbg-status-warning\b[^"]*">3d old<\/span>/);
    // Today's lead is not old.
    expect(html).not.toContain("0d old");
    expect(html).toMatch(/<a[^>]*href="\/sales\/leads\?lead=l1"[^>]*data-lead-id="l1"|<a[^>]*data-lead-id="l1"[^>]*href="\/sales\/leads\?lead=l1"/);
    expect(html).toContain("Nov 2");
    expect(html).toContain("Today");
    expect(html).toContain('aria-label="Owner: Ben Example"');
    expect(html).toContain(">Ben E.</span>");
    expect(html).toContain("No next step");
    for (const label of ["Source:", "Created:", "Owner:", "Next:"]) expect(html, label).toContain(`${label} </span>`);
  });

  it("names who gets new leads, and who can change that", () => {
    expect(renderView(data())).toContain(
      "New leads are shared out round-robin between Ben E. and Robert E. An admin can change this in Sales settings.",
    );
    expect(renderView(data(), ADMIN)).toContain(
      "New leads are shared out round-robin between Ben E. and Robert E. Change it in Sales settings.",
    );
  });

  it("has no Everyone / Just me for someone who sees only their own leads", () => {
    const html = renderView(data({ canSeeEveryone: false, rows: [CRESTVIEW] }));
    expect(html).not.toContain(">Everyone</button>");
    expect(html).not.toContain(">Just me</button>");
  });

  it("offers Show more when there are more leads", () => {
    expect(renderView(data({ nextCursor: "l2" }))).toContain(">Show more</button>");
    expect(renderView(data())).not.toContain("Show more");
  });

  it("says Inbox zero with a way to add one, and nothing else", () => {
    const html = renderView(data({ rows: [] }));
    expect(html).toContain("Inbox zero.");
    expect(html).toContain("New Check Availability opt-ins will show up here. Add one by hand if a lead calls in.");
    expect(html).toMatch(/<a[^>]*href="\/sales\/leads\?new=1"[^>]*>.*?Add a lead<\/a>/);
    expect(html).not.toContain("Search leads");
    expect(html).not.toContain("New leads are shared out");
  });

  it("says when the search found nothing, with a way back", () => {
    const html = renderView(data({ rows: [], query: { scope: "everyone", q: "oak", cursor: null } }));
    expect(html).toMatch(/role="status"[^>]*>[\s\S]*?No leads match &quot;oak&quot;\.[\s\S]*?Clear search/);
    expect(html).toMatch(/<a[^>]*href="\/sales\/leads"[^>]*>Clear search<\/a>/);
    expect(html).toContain('aria-label="Search leads by name, practice or person"');
    expect(html).toContain("New leads are shared out");
  });

  it("says when Just me is empty, with a way to everyone's", () => {
    const html = renderView(data({ rows: [], query: { scope: "mine", q: "", cursor: null } }));
    expect(html).toContain("No leads of yours right now.");
    expect(html).toContain("New leads that come to you will show up here.");
    expect(html).toMatch(/<a[^>]*href="\/sales\/leads"[^>]*>Show everyone&#x27;s leads<\/a>/);
  });

  it("keeps every scroller relative and has no bulk bar until something is ticked", () => {
    const html = renderView(data());
    expect(html).not.toContain('aria-label="Selected leads"');
    const scrollers = classLists(html).filter((classes) => classes.some((name) => /overflow(?:-[xy])?-auto$/.test(name)));
    expect(scrollers.length).toBeGreaterThanOrEqual(1);
    for (const classes of scrollers) expect(classes).toContain("relative");
  });
});

describe("select-all box", () => {
  it("is half-ticked when some shown leads are ticked", () => {
    const render = (state: "none" | "some" | "all") =>
      clean(renderToString(createElement(SelectAllBox, { state, onToggle: vi.fn() })));
    expect(render("some")).toContain('aria-checked="mixed"');
    expect(render("all")).toContain('aria-checked="true"');
    expect(render("none")).toContain('aria-checked="false"');
    expect(render("some")).toContain('aria-label="Select all shown leads you can change"');
  });
});

describe("LeadsBulkBar", () => {
  const handlers = () => ({
    onConvert: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    onClear: vi.fn(),
    assign: { members: MEMBERS, ownerIds: ["u1", "u1"], viewer: ADMIN, onPick: vi.fn() },
  });

  const render = (props: Partial<Parameters<typeof LeadsBulkBar>[0]> & { count: number; isAdmin: boolean }) =>
    clean(renderToString(createElement(LeadsBulkBar, { ...handlers(), ...props })));

  it("names the count and every action on the accent fill, sticking to the top on phones", () => {
    const html = render({ count: 2, isAdmin: true });
    const bar = /<div role="region" aria-label="Selected leads" class="([^"]*)"/.exec(html);
    expect(bar).not.toBeNull();
    const classes = bar![1].split(/\s+/);
    for (const name of ["bg-accent", "text-accent-foreground", "max-sm:sticky", "max-sm:top-0", "max-sm:z-10", "max-sm:shadow"]) {
      expect(classes, name).toContain(name);
    }
    expect(html).toMatch(/role="status"[^>]*>2 selected</);
    for (const label of ["Convert to deal", "Assign to…", "Archive", "Delete", "Clear"]) {
      expect(html, label).toMatch(new RegExp(`<button[^>]*>${label}</button>`));
    }
    expect(html).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*>Assign to…<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>/);
  });

  it("leaves Delete to admins and Convert to the caller that gives it", () => {
    expect(render({ count: 2, isAdmin: false })).not.toContain(">Delete</button>");
    expect(render({ count: 2, isAdmin: true, onConvert: undefined })).not.toContain("Convert to deal");
  });

  it("turns Convert off past 25 leads and everything but Clear past 100", () => {
    const thirty = render({ count: 30, isAdmin: true });
    expect(thirty).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="[^"]+"[^>]*>Convert to deal<\/button>/);
    expect(thirty).toContain("Convert works on up to 25 leads at a time. Untick some to convert them.");
    expect(thirty).not.toMatch(/<button[^>]*disabled=""[^>]*>Archive<\/button>/);

    const many = render({ count: 120, isAdmin: true });
    for (const label of ["Convert to deal", "Assign to…", "Archive", "Delete"]) {
      expect(many, label).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`));
    }
    expect(many).not.toMatch(/<button[^>]*disabled=""[^>]*>Clear<\/button>/);
    expect(many).toContain("Pick 100 leads or fewer at a time. Untick some to go on.");
  });

  it("turns every action but Clear off while one runs", () => {
    const html = render({ count: 2, isAdmin: true, busy: true });
    for (const label of ["Convert to deal", "Assign to…", "Archive", "Delete"]) {
      expect(html, label).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`));
    }
  });
});

describe("a ticked row", () => {
  const renderRow = (selected: boolean) =>
    clean(
      renderToString(
        createElement(
          "table",
          null,
          createElement(
            "tbody",
            null,
            createElement(LeadRowView, {
              row: CRESTVIEW,
              selected,
              now: new Date(NOW),
              ownerName: "Ben Example",
              onToggle: vi.fn(),
              selectable: true,
              href: "/sales/leads?lead=l1",
              onOpen: vi.fn(),
            }),
          ),
        ),
      ),
    );

  it("grey words stay readable on a ticked row", () => {
    const html = renderRow(true);
    const row = /<tr[^>]*class="([^"]*)"/.exec(html);
    expect(row![1].split(/\s+/)).toContain("bg-accent");
    expect(html).toContain('aria-checked="true"');
    for (const classes of classLists(html)) expect(classes).not.toContain("text-muted-foreground");
    expect(html).toContain("text-slate-600");
  });

  it("an unticked row tints on hover only", () => {
    const row = /<tr[^>]*class="([^"]*)"/.exec(renderRow(false));
    const classes = row![1].split(/\s+/);
    expect(classes).not.toContain("bg-accent");
    expect(classes).toContain("hover:bg-muted/50");
  });

  it("its source keeps grey words on MUTED_TEXT", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "components", "sales", "leads-view.tsx"), "utf8");
    const start = source.indexOf("export function LeadRowView");
    expect(start, "function LeadRowView in leads-view.tsx").toBeGreaterThanOrEqual(0);
    const next = source.slice(start + 1).search(/^(?:export )?function /m);
    const body = next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
    expect(body).not.toContain("text-muted-foreground");
    expect(body).toContain("MUTED_TEXT");
  });
});

describe("Add lead", () => {
  const render = (viewer = REP) =>
    clean(
      renderToString(
        createElement(
          Fragment,
          null,
          createElement(NewLeadDialog, {
            open: true,
            onOpenChange: vi.fn(),
            members: MEMBERS,
            viewer,
            assignment: { mode: "ROUND_ROBIN", names: ["Ben E.", "Robert E."], fallbackName: null },
            onCreated: vi.fn(),
          }),
        ),
      ),
    );

  it("asks for the person or organization, source, ZIP, owner and first activity", () => {
    const html = render();
    expect(html).toContain(">Add lead<");
    for (const label of ["Person", "Organization", "Source", "Practice ZIP", "Owner", "First activity"]) {
      expect(html, label).toMatch(new RegExp(`<label[^>]*>${label}</label>`));
    }
    expect(html).toContain('placeholder="Sarah K."');
    expect(html).toContain('placeholder="Practice name"');
    expect(html).toMatch(/<input[^>]*placeholder="Optional"[^>]*>/);
    expect(html).toContain("Added by hand");
    expect(html).toContain("Call today");
    expect(html).toMatch(/<button[^>]*>Cancel<\/button>/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save<\/button>/);
    // No error until Save is pressed with nobody named.
    expect(html).not.toContain("Add a person or an organization.");
  });

  it("shows someone who is not an admin as the owner, unchangeable", () => {
    const html = render();
    expect(html).toContain("Ben E. (you)");
    expect(html).toMatch(/<button[^>]*aria-labelledby="[^"]*-owner"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-labelledby="[^"]*-owner"/);
  });

  it("lets an admin pick the owner", () => {
    const html = render(ADMIN);
    expect(html).toContain("Ben E. (you)");
    expect(html).not.toMatch(/<button[^>]*aria-labelledby="[^"]*-owner"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-labelledby="[^"]*-owner"/);
  });
});

describe("Delete leads", () => {
  it("names the leads, says it cannot be undone and puts Cancel first", () => {
    const html = clean(
      renderToString(
        createElement(DeleteLeadsDialog, {
          open: true,
          onOpenChange: vi.fn(),
          titles: ["Crestview Dental", "Maple Grove Dental"],
          deleting: false,
          onConfirm: vi.fn(),
        }),
      ),
    );
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("Delete 2 leads?");
    expect(html).toContain("Crestview Dental, Maple Grove Dental");
    expect(html).toContain("They leave the Leads Inbox for good. The history keeps a record. This cannot be undone.");
    expect(html).toContain("To put a lead aside and keep the option to bring it back, use Archive instead.");
    expect(html.indexOf(">Cancel</button>")).toBeLessThan(html.indexOf(">Delete 2 leads</button>"));
  });
});
