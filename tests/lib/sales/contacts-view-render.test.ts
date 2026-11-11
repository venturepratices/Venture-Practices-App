import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ContactsPageData, OrganizationRow, PersonRow } from "@/lib/sales/contacts-page";

// A server render of the Contacts page with canned data (Mockup v2 `viewContacts`,
// `#s=contacts`, `#s=contacts-orgs`, `#s=contacts-search-empty`,
// `#s=contacts-empty`). Node has no browser, so this cannot click anything;
// it proves the header, tabs, table and empty states render without throwing
// and carry the words, labels, links and classes the plan asks for. Dialogs
// are portals, which a server render leaves out, so they render in place here.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/sales/contacts",
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

const { ContactsView } = await import("@/components/sales/contacts-view");

const clean = (html: string) => html.replaceAll("<!-- -->", "");

const SARAH: PersonRow = {
  kind: "person",
  id: "p1",
  name: "Sarah K.",
  organizationName: "Oak Creek Dental",
  openDeals: 2,
  ownerId: "u1",
};

const LAURA: PersonRow = {
  kind: "person",
  id: "p2",
  name: "Laura B.",
  organizationName: null,
  openDeals: 0,
  ownerId: "u1",
};

const OAK: OrganizationRow = {
  kind: "organization",
  id: "o1",
  name: "Oak Creek Dental",
  contactName: "Sarah K.",
  openDeals: 2,
  ownerId: "u1",
};

const CREST: OrganizationRow = {
  kind: "organization",
  id: "o2",
  name: "Crestview Dental",
  contactName: null,
  openDeals: 0,
  ownerId: "u2",
};

const MEMBERS = [
  { id: "u1", name: "Ben Example" },
  { id: "u2", name: "Robert Example" },
];

function peopleData(extra: Partial<ContactsPageData> = {}): ContactsPageData {
  return {
    query: { tab: "people", scope: "everyone", q: "", cursor: null },
    rows: [SARAH, LAURA],
    nextCursor: null,
    members: MEMBERS,
    canSeeEveryone: true,
    ...extra,
  };
}

function orgData(extra: Partial<ContactsPageData> = {}): ContactsPageData {
  return {
    query: { tab: "organizations", scope: "everyone", q: "", cursor: null },
    rows: [OAK, CREST],
    nextCursor: null,
    members: MEMBERS,
    canSeeEveryone: true,
    ...extra,
  };
}

const ADMIN = { userId: "u1", isAdmin: true };
const REP_OWN = { userId: "u1", isAdmin: false };

function render(data: ContactsPageData, viewer = ADMIN, openNew: "person" | "organization" | null = null): string {
  return clean(renderToString(createElement(ContactsView, { data, viewer, openNew })));
}

describe("Contacts People tab (server render)", () => {
  it("shows the header, tabs with ARIA roles, the search and the People head cells", () => {
    const html = render(peopleData());
    expect(html).toContain(">Contacts</h1>");
    expect(html).toContain("People and the practices they work at.");
    expect(html).toMatch(/<button[^>]*aria-label="Add person"[^>]*>[\s\S]*?Person<\/button>/);

    // Tablist with two tabs, correct roving tabindex and aria-selected.
    expect(html).toMatch(/role="tablist"[^>]*aria-label="Contacts"/);
    const people = /<button[^>]*role="tab"[^>]*>[\s\S]*?People<\/button>/.exec(html);
    const orgs = /<button[^>]*role="tab"[^>]*>[\s\S]*?Organizations<\/button>/.exec(html);
    expect(people).not.toBeNull();
    expect(orgs).not.toBeNull();
    expect(people![0]).toContain('aria-selected="true"');
    expect(people![0]).toMatch(/tabindex="0"|tabIndex="0"/);
    expect(orgs![0]).toContain('aria-selected="false"');
    expect(orgs![0]).toMatch(/tabindex="-1"|tabIndex="-1"/);

    // Each tab's aria-controls matches the tabpanel's id.
    const peopleControls = /aria-controls="([^"]+)"[^>]*>[\s\S]*?People/.exec(html);
    expect(peopleControls).not.toBeNull();
    const panelId = peopleControls![1];
    expect(html).toContain(`id="${panelId}"`);
    expect(html).toMatch(new RegExp(`<[^>]*id="${panelId}"[^>]*role="tabpanel"[^>]*aria-labelledby="[^"]+"`));

    expect(html).toContain('aria-label="Search people by name"');
    expect(html).toContain('placeholder="Search people"');
    for (const head of ["Name", "Organization", "Open deals", "Owner"]) {
      expect(html, head).toMatch(new RegExp(`<th[^>]*>${head}</th>`));
    }
    // sr-only Owner avatar head cell.
    expect(html).toMatch(/<th[^>]*>\s*<span class="sr-only">Owner<\/span>\s*<\/th>/);
    expect(html).toContain(">Everyone</button>");
    expect(html).toContain(">Just me</button>");
  });

  it("draws each person's row with its organization or None, open deals, owner, and the panel link", () => {
    const html = render(peopleData());
    // Sarah has an organization name.
    expect(html).toContain(">Sarah K.</a>");
    expect(html).toContain(">Oak Creek Dental<");
    // Laura has no organization: "None".
    expect(html).toContain(">None<");
    // Link opens the person panel.
    expect(html).toMatch(/<a[^>]*href="\/sales\/contacts\?person=p1"[^>]*data-person-id="p1"|<a[^>]*data-person-id="p1"[^>]*href="\/sales\/contacts\?person=p1"/);
    // Owner initials.
    expect(html).toContain(">Ben E.</span>");
    for (const label of ["Organization:", "Open deals:", "Owner:"]) expect(html, label).toContain(`${label} </span>`);
  });

  it("offers Show more when there are more people", () => {
    expect(render(peopleData({ nextCursor: "p2" }))).toContain(">Show more</button>");
    expect(render(peopleData())).not.toContain("Show more");
  });
});

describe("Contacts Organizations tab (server render)", () => {
  it("shows the Organizations head cells and the + Organization button", () => {
    const html = render(orgData());
    expect(html).toMatch(/<button[^>]*aria-label="Add organization"[^>]*>[\s\S]*?Organization<\/button>/);
    expect(html).toContain('aria-label="Search organizations by name"');
    expect(html).toContain('placeholder="Search organizations"');
    for (const head of ["Organization", "Contact", "Open deals", "Owner"]) {
      expect(html, head).toMatch(new RegExp(`<th[^>]*>${head}</th>`));
    }
    expect(html).toContain(">Oak Creek Dental</a>");
    // Crestview has no visible person: "None".
    expect(html).toContain(">None<");
    // The row link opens its organization panel and carries the data-organization-id.
    expect(html).toMatch(/<a[^>]*href="\/sales\/contacts\?tab=organizations&amp;organization=o1"[^>]*data-organization-id="o1"|<a[^>]*data-organization-id="o1"[^>]*href="\/sales\/contacts\?tab=organizations&amp;organization=o1"/);
    for (const label of ["Contact:", "Open deals:", "Owner:"]) expect(html, label).toContain(`${label} </span>`);
  });
});

describe("Contacts, see-own rep (server render)", () => {
  it("has no Everyone / Just me switch", () => {
    const html = render(peopleData({ canSeeEveryone: false, rows: [SARAH] }), REP_OWN);
    expect(html).not.toContain(">Everyone</button>");
    expect(html).not.toContain(">Just me</button>");
  });

  it("shows the empty block when there are no rows and no search, with no search box", () => {
    const html = render(peopleData({ canSeeEveryone: false, rows: [] }), REP_OWN);
    expect(html).toContain("No people yet.");
    expect(html).toContain("People are added with each deal and lead, or here by hand.");
    expect(html).toMatch(/<a[^>]*href="\/sales\/contacts\?new=person"[^>]*>[\s\S]*?Person<\/a>/);
    expect(html).not.toContain('placeholder="Search people"');
  });

  it("shows the one-line search strip when a search found nothing", () => {
    const html = render(
      peopleData({ canSeeEveryone: false, rows: [], query: { tab: "people", scope: "everyone", q: "oak", cursor: null } }),
      REP_OWN,
    );
    expect(html).toMatch(/role="status"[^>]*>[\s\S]*?No people match &quot;oak&quot;\.[\s\S]*?Clear search/);
    expect(html).toMatch(/<a[^>]*href="\/sales\/contacts"[^>]*>Clear search<\/a>/);
    expect(html).toContain('aria-label="Search people by name"');
  });

  it("never shows an email or phone number anywhere on the page", () => {
    // The fixture rows carry no email or phone; the page must not read or fabricate one.
    const html = render(peopleData({ canSeeEveryone: false, rows: [SARAH, LAURA] }), REP_OWN);
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("tel:");
  });
});
