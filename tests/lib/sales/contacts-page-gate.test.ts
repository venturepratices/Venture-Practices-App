import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SalesActor } from "@/lib/sales/access";

// The Contacts page gates itself (layouts do not re-run on navigation) before
// it reads anything, reads the URL through the shared parser, and opens the
// Add dialog for `?new=person` / `?new=organization`.

const requireSalesPage = vi.fn();
const loadContactsPage = vi.fn();

vi.mock("@/lib/sales/page-gate", () => ({ requireSalesPage: () => requireSalesPage() }));
vi.mock("@/lib/sales/contacts-page", () => ({
  loadContactsPage: (...args: unknown[]) => loadContactsPage(...args),
}));
vi.mock("@/components/sales/contacts-view", () => ({ ContactsView: () => null }));

const { default: ContactsPage } = await import("@/app/(app)/sales/contacts/page");

const actor: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };

beforeEach(() => {
  requireSalesPage.mockReset();
  loadContactsPage.mockReset();
});

describe("Contacts page", () => {
  it("reads nothing for someone without Sales access", async () => {
    requireSalesPage.mockRejectedValue(new Error("next:not-found"));
    await expect(
      ContactsPage({ searchParams: Promise.resolve({ tab: "organizations", scope: "mine" }) }),
    ).rejects.toThrow("next:not-found");
    expect(loadContactsPage).not.toHaveBeenCalled();
  });

  it("loads the Organizations tab Just me and opens Add organization", async () => {
    requireSalesPage.mockResolvedValue(actor);
    const data = { rows: [] };
    loadContactsPage.mockResolvedValue(data);

    const element = await ContactsPage({
      searchParams: Promise.resolve({ tab: "organizations", scope: "mine", new: "organization" }),
    });

    expect(loadContactsPage).toHaveBeenCalledWith(actor, {
      tab: "organizations",
      scope: "mine",
      q: "",
      cursor: null,
    });
    expect(Object.keys(element.props).sort()).toEqual(["data", "openNew", "viewer"]);
    expect(element.props.data).toBe(data);
    expect(element.props.viewer).toEqual({ userId: "r", isAdmin: false });
    expect(element.props.openNew).toBe("organization");
  });

  it("opens Add person for new=person and ignores anything else", async () => {
    requireSalesPage.mockResolvedValue({ ...actor, isAdmin: true });
    loadContactsPage.mockResolvedValue({ rows: [] });

    const person = await ContactsPage({ searchParams: Promise.resolve({ new: "person" }) });
    expect(person.props.openNew).toBe("person");
    expect(person.props.viewer).toEqual({ userId: "r", isAdmin: true });

    loadContactsPage.mockClear();
    const bogus = await ContactsPage({ searchParams: Promise.resolve({ new: "bogus" }) });
    expect(bogus.props.openNew).toBeNull();
    expect(loadContactsPage).toHaveBeenCalledWith(
      { ...actor, isAdmin: true },
      { tab: "people", scope: "everyone", q: "", cursor: null },
    );
  });
});
