import { loadContactsPage } from "@/lib/sales/contacts-page";
import { parseContactsQuery } from "@/lib/sales/contacts-query";
import { requireSalesPage } from "@/lib/sales/page-gate";
import { ContactsView } from "@/components/sales/contacts-view";

// The Contacts page (Decision 19): people and organizations this person may
// see (Decision 18), by name, for Everyone or Just me and a search, read from
// the URL. Gated here as well as in the Sales layout (layouts do not re-run on
// navigation). Always the first page; "Show more" fetches the rest.
// `?new=person` / `?new=organization` opens the Add dialog on arrival.
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireSalesPage();
  const params = await searchParams;
  const query = parseContactsQuery(params);
  const data = await loadContactsPage(actor, query);

  const newParam = Array.isArray(params.new) ? params.new[0] : params.new;
  const openNew = newParam === "person" ? "person" : newParam === "organization" ? "organization" : null;

  return <ContactsView data={data} viewer={{ userId: actor.userId, isAdmin: actor.isAdmin }} openNew={openNew} />;
}
