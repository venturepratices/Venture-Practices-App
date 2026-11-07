import { contactsQueryToSearch, type ContactsQuery } from "@/lib/sales/contacts-query";

// Pure helpers for the Contacts page (no prisma, no server imports: the server
// modules above are read for their types only). Wording follows Mockup v2
// where it draws the same thing (ruling P3A-X3), else the plan's strings.

const CONTACTS_PATH = "/sales/contacts";

type ContactsEmptyState = {
  title: string;
  /** None for a search that found nothing: that shows as one line with its action. */
  description: string | null;
  action: { label: string; href: string };
};

/** A Contacts URL for a query (no cursor). */
function contactsHref(query: ContactsQuery): string {
  const search = contactsQueryToSearch(query);
  return search ? `${CONTACTS_PATH}?${search}` : CONTACTS_PATH;
}

/** "people" / "organizations" without "s"-free grammar quirks: the whole-list word Mockup v2 uses. */
function tabWord(tab: ContactsQuery["tab"]): "people" | "organizations" {
  return tab;
}

/**
 * What an empty Contacts tab says (Mockup v2 `viewContacts`). A search that
 * found nothing wins and offers to clear it (keeping the tab and scope); Just
 * me offers everyone's; otherwise the tab is truly empty and offers Add.
 */
export function contactsEmptyState(query: ContactsQuery): ContactsEmptyState {
  const people = query.tab === "people";
  const word = tabWord(query.tab);

  if (query.q) {
    return {
      title: `No ${word} match "${query.q}".`,
      description: null,
      action: { label: "Clear search", href: contactsHref({ ...query, q: "", cursor: null }) },
    };
  }

  if (query.scope === "mine") {
    return {
      title: people ? "No people of yours yet." : "No organizations of yours yet.",
      description: people ? "People you own show up here." : "Organizations you own show up here.",
      action: {
        label: "Show everyone's",
        href: contactsHref({ ...query, scope: "everyone", cursor: null }),
      },
    };
  }

  const kind = people ? "person" : "organization";
  return {
    title: people ? "No people yet." : "No organizations yet.",
    description: people
      ? "People are added with each deal and lead, or here by hand."
      : "Practices are added with each deal and lead, or here by hand.",
    action: {
      label: people ? "Person" : "Organization",
      href: `${contactsHref({ ...query, cursor: null })}${
        contactsQueryToSearch({ ...query, cursor: null }) ? "&" : "?"
      }new=${kind}`,
    },
  };
}
