import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { OrganizationPanelData, PersonPanelData } from "@/lib/sales/contact-panel";

// The contact panel's body (ContactPanelBody): crumb, name, meta, duplicates
// bar, Details, Deals, Leads (and People on organizations), History. Server
// render, with Base UI's dialog parts mocked in place (deal-panel-render.test
// does the same for the deal panel), and no browser (A10). The panel's data
// is Task 9's ContactPanelData; the body is a plain component and takes no
// routing or data-fetch effects at render time.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/sales/contacts",
  useSearchParams: () => new URLSearchParams(""),
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

const { ContactPanelBody } = await import("@/components/sales/contact-panel");

const NOW = new Date("2026-11-05T15:00:00.000Z");
const clean = (html: string) => html.replaceAll("<!-- -->", "");

const OWNER = { id: "u1", name: "Ben S." };

function personPanel(overrides: Partial<PersonPanelData["person"]> = {}, panel: Partial<PersonPanelData> = {}): PersonPanelData {
  return {
    kind: "person",
    person: {
      id: "p1",
      name: "Sarah K.",
      email: "sarah@oak.example",
      phone: "(512) 555-0142",
      role: "Office manager",
      organization: { id: "o1", name: "Oak Creek Dental", visible: true },
      owner: OWNER,
      createdAt: "2026-11-02T15:00:00.000Z",
      ...overrides,
    },
    deals: [
      { id: "d1", title: "Oak Creek Dental", status: "OPEN", stageName: "Demo Booked", valueCents: 1440000 },
    ],
    leads: [{ id: "l1", title: "Oak Creek Dental", status: "CONVERTED" }],
    counts: { deals: 1, leads: 1 },
    duplicates: { matches: [{ id: "p2", name: "Sarah Example" }], hiddenMatch: false },
    canEdit: true,
    canMerge: true,
    redirectedFrom: null,
    ...panel,
  };
}

function organizationPanel(
  overrides: Partial<OrganizationPanelData["organization"]> = {},
  panel: Partial<OrganizationPanelData> = {},
): OrganizationPanelData {
  return {
    kind: "organization",
    organization: {
      id: "o1",
      name: "Oak Creek Dental",
      phone: "(512) 555-0100",
      website: "https://oak.example/",
      address: "1 Market St",
      zip: "78704",
      owner: OWNER,
      createdAt: "2026-11-02T15:00:00.000Z",
      ...overrides,
    },
    people: [],
    deals: [],
    leads: [],
    counts: { people: 0, deals: 0, leads: 0 },
    duplicates: { matches: [], hiddenMatch: false },
    canEdit: true,
    canMerge: true,
    redirectedFrom: null,
    ...panel,
  };
}

describe("ContactPanelBody renders a person (server render)", () => {
  it("shows the crumb, real email/phone/organization links, the sections and the duplicate bar", () => {
    const html = clean(
      renderToString(createElement(ContactPanelBody, { data: personPanel(), now: NOW, onChanged: vi.fn(), onClose: vi.fn() })),
    );
    expect(html).toContain("Contacts");
    expect(html).toContain('href="mailto:sarah@oak.example"');
    expect(html).toContain('href="tel:5125550142"');
    // The person's organization link in the meta: carries organization=o1, and (as
    // a one-panel-at-a-time swap) names no other panel (no person= in this one href).
    const orgLink = /href="([^"]*organization=o1[^"]*)"/.exec(html);
    expect(orgLink).not.toBeNull();
    expect(orgLink![1]).not.toMatch(/\bperson=/);
    expect(html).toContain(">Details<");
    expect(html).toContain(">Deals<");
    expect(html).toContain(">Leads<");
    expect(html).toContain(">History<");
    expect(html).toContain("Converted");
    expect(html).toContain("Possible duplicate:");
    expect(html).toMatch(/>Merge</);
    // Shortcut mark belongs only to the deal panel, so the lead and contact
    // panels carry neither `data-sales-deal-panel` nor the deal panel's
    // dedicated attribute value.
    expect(html).not.toContain("data-sales-deal-panel");
  });
});

describe("ContactPanelBody renders an organization safely", () => {
  it("hides an unsafe website URL and keeps the mockup's empty-state text", () => {
    const panel = organizationPanel({ website: "javascript:alert(1)" }, {
      people: [],
      counts: { people: 0, deals: 0, leads: 0 },
    });
    const html = clean(
      renderToString(createElement(ContactPanelBody, { data: panel, now: NOW, onChanged: vi.fn(), onClose: vi.fn() })),
    );
    expect(html).not.toMatch(/href="[^"]*javascript:/);
    expect(html).toContain("javascript:alert(1)");
    expect(html).toContain("Nobody linked yet. Pick this organization on a person to add them.");
    expect(html).toContain("No deals yet with Oak Creek Dental.");
  });

  it("builds a safe website link with target=_blank and rel=noopener noreferrer", () => {
    const html = clean(
      renderToString(
        createElement(ContactPanelBody, { data: organizationPanel(), now: NOW, onChanged: vi.fn(), onClose: vi.fn() }),
      ),
    );
    expect(html).toMatch(/href="https:\/\/oak\.example\/"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  });
});

describe("ContactPanelBody respects read-only viewers", () => {
  it("drops every Add value, every edit button, and the Merge button from the duplicate bar", () => {
    const html = clean(
      renderToString(
        createElement(ContactPanelBody, {
          data: personPanel(
            { email: null, phone: null, role: null, organization: null },
            { canEdit: false, canMerge: false, duplicates: { matches: [{ id: "p2", name: "Sarah Example" }], hiddenMatch: false } },
          ),
          now: NOW,
          onChanged: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    );
    expect(html).not.toContain(">Add<");
    expect(html).toContain("Not set");
    expect(html).not.toMatch(/aria-label="Edit [a-z ]+"/i);
    expect(html).toContain("Ask an admin to merge.");
    expect(html).not.toMatch(/>Merge</);
  });
});

describe("ContactPanelBody's owner line does not repeat its label to a screen reader", () => {
  it("drops the sr-only 'Owner:' span so the visible 'Owner <name>' is said once", () => {
    const html = clean(
      renderToString(createElement(ContactPanelBody, { data: personPanel(), now: NOW, onChanged: vi.fn(), onClose: vi.fn() })),
    );
    // The visible text in the meta already says "Owner <name>", so a hidden
    // "Owner:" sr-only span before it is read twice ("Owner Owner Ben S.").
    expect(html).toContain("Owner Ben S.");
    expect(html).not.toMatch(/sr-only[^>]*>Owner:/);
  });
});

describe("ContactPanelBody opens a kept contact from an old link", () => {
  it("names the redirect in words when it happened", () => {
    const html = clean(
      renderToString(
        createElement(ContactPanelBody, {
          data: personPanel({}, { redirectedFrom: "p2" }),
          now: NOW,
          onChanged: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    );
    expect(html).toContain("The link you opened was for a contact that was merged into this one.");
  });
});

describe("ContactPanelBody keeps a hidden organization out of the link", () => {
  it("renders the organization name as text when the viewer may not see it", () => {
    const html = clean(
      renderToString(
        createElement(ContactPanelBody, {
          data: personPanel({ organization: { id: "o-hidden", name: "Bright Smile Dental", visible: false } }),
          now: NOW,
          onChanged: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    );
    expect(html).toContain("Bright Smile Dental");
    expect(html).not.toMatch(/href="[^"]*organization=o-hidden[^"]*"/);
  });
});

describe("ContactPanelBody shows list caps when there are more than 20", () => {
  it("names the real count on the meta, the People pill and the list cap line", () => {
    const people = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}` }));
    const html = clean(
      renderToString(
        createElement(ContactPanelBody, {
          data: organizationPanel({}, {
            people,
            counts: { people: 35, deals: 2, leads: 0 },
            deals: [
              { id: "d1", title: "Oak", status: "OPEN", stageName: "Demo Booked", valueCents: 1000 },
              { id: "d2", title: "Oak 2", status: "OPEN", stageName: "Demo Booked", valueCents: 2000 },
            ],
          }),
          now: NOW,
          onChanged: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    );
    expect(html).toContain("35 people");
    // The People section's count pill.
    expect(html).toMatch(/People[\s\S]*?>35</);
    expect(html).toContain("Showing 20 of 35.");
  });
});
