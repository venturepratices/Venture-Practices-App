"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useId, useRef, useState, useTransition } from "react";
import { Folder, Plus, Search, User, Users } from "lucide-react";
import { toast } from "sonner";

import { getContactRowsPage } from "@/lib/sales/api-client";
import { appendPage } from "@/lib/sales/board-client";
import { shortName } from "@/lib/sales/format";
import type { ContactsPageData, ContactRow, OrganizationRow, PersonRow } from "@/lib/sales/contacts-page";
import { contactsEmptyState } from "@/lib/sales/contacts-client";
import {
  contactsQueryToSearch,
  parseContactsQuery,
  type ContactKind,
  type ContactsQuery,
} from "@/lib/sales/contacts-query";
import { changePanelUrl, pageRendered, panelHref, refreshAfterWrite } from "@/lib/sales/panel-url";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SEGMENT, SEGMENT_GROUP } from "@/components/sales/deals-toolbar";
import { NewOrganizationDialog, NewPersonDialog } from "@/components/sales/new-contact-dialogs";
import { MUTED_TEXT, OwnerAvatar } from "@/components/sales/sales-pills";
import { useSalesShortcut } from "@/components/sales/sales-shortcuts";
import { ShortcutsButton } from "@/components/sales/shortcuts-help-dialog";

// The Contacts page on the client (Mockup v2 `viewContacts`, Decision 19): the
// header with "+ Person" / "+ Organization", the People / Organizations tabs,
// the search and Everyone / Just me, and the rows by name. A search, tab or
// scope change replaces the URL (never with a page cursor); "Show more"
// appends the next page; a row opens its contact panel (`?person=` /
// `?organization=`, built by panelHref and set with the history API, so the
// page is not loaded again). Under 640px each row becomes a stacked card with
// labels, and the table head is hidden.

type Viewer = { userId: string; isAdmin: boolean };
type ContactsPatch = Partial<Omit<ContactsQuery, "cursor">>;

const SEARCH_DEBOUNCE_MS = 300;

const CELL = "px-3 py-[9px] align-middle max-sm:block max-sm:border-0 max-sm:px-0 max-sm:py-0.5";
const HEAD = "border-b bg-muted/40 px-3 py-[9px] text-left text-[11.5px] font-semibold whitespace-nowrap text-muted-foreground";
// The mockup's text link (Clear search): AA on the card and the strip in both themes.
const TEXT_LINK =
  "rounded-sm font-semibold text-cyan-700 underline underline-offset-2 outline-none hover:decoration-current focus-visible:ring-3 focus-visible:ring-ring/50 dark:text-sky-300 pointer-coarse:-my-2.5 pointer-coarse:inline-flex pointer-coarse:min-h-10 pointer-coarse:items-center";

const TABS: readonly { tab: ContactsQuery["tab"]; label: string; icon: typeof User }[] = [
  { tab: "people", label: "People", icon: User },
  { tab: "organizations", label: "Organizations", icon: Folder },
];

export function ContactsView({
  data,
  viewer,
  openNew,
}: {
  data: ContactsPageData;
  viewer: Viewer;
  /** `?new=person` / `?new=organization`: open the add dialog on arrival. */
  openNew: ContactKind | null;
}) {
  // The signed-in person, kept in the signature for Task 23 (admins see Merge).
  void viewer;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  // What the search and the switch show: the server's query, or, while a change loads, the one just asked for.
  const [controls, setControls] = useState(data.query);
  // Every render from the server (new rows) tells the browser the panel URLs now point at a fresh page.
  useEffect(() => pageRendered(), [data]);
  // Sync controls when the server sends a new query.
  const [seenQuery, setSeenQuery] = useState(data.query);
  if (data.query !== seenQuery) {
    setSeenQuery(data.query);
    setControls(data.query);
  }

  const peopleTabId = useId();
  const orgTabId = useId();
  const peoplePanelId = useId();
  const orgPanelId = useId();

  // Which Add dialog is open, driven by ?new= and by the buttons.
  const [newOpen, setNewOpen] = useState<ContactKind | null>(openNew);
  const [seenOpenNew, setSeenOpenNew] = useState(openNew);
  if (openNew !== seenOpenNew) {
    setSeenOpenNew(openNew);
    if (openNew) setNewOpen(openNew);
  }

  // The rows shown and the next cursor start again from the server's first
  // page whenever it sends a new one (a filter change or a refresh).
  const [page, setPage] = useState({ source: data, rows: data.rows, nextCursor: data.nextCursor, loading: false });
  if (page.source !== data) {
    setPage({ source: data, rows: data.rows, nextCursor: data.nextCursor, loading: false });
  }

  const ownerNames = new Map(data.members.map((member) => [member.id, member.name]));

  function navigate(patch: ContactsPatch) {
    const next: ContactsQuery = { ...controls, ...patch, cursor: null };
    const search = contactsQueryToSearch(next);
    startTransition(() => {
      setControls(next);
      router.replace(search ? `?${search}` : pathname, { scroll: false });
    });
  }

  // The panel link carries the current tab, scope and search (read from the
  // server query, so `?new=` is not dragged along and tests have a stable URL).
  const baseSearch = contactsQueryToSearch(data.query);
  /** This page's URL with the contact panel open. */
  const contactHref = (row: ContactRow) => panelHref(pathname, baseSearch, { kind: row.kind, id: row.id });
  const openContact = (row: ContactRow) => changePanelUrl(contactHref(row), "push", router);

  /** The Add dialog's open-state change, also clears `?new=` from the URL. */
  function setNewContact(kind: ContactKind | null) {
    setNewOpen(kind);
    if (!kind && searchParams.has("new")) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("new");
      const search = params.toString();
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    }
  }

  function onCreated(contact: { id: string; name: string }, kind: ContactKind) {
    refreshAfterWrite(router);
    changePanelUrl(panelHref(pathname, searchParams.toString(), { kind, id: contact.id }), "push", router);
  }

  async function showMore() {
    const { source, nextCursor } = page;
    if (!nextCursor || page.loading) return;
    setPage((current) => (current.source === source ? { ...current, loading: true } : current));
    const result = await getContactRowsPage({ ...source.query, cursor: nextCursor });
    if (!result.ok) toast.error(result.error);
    // A page that arrives after the list was replaced belongs to the old filter: drop it.
    setPage((current) => {
      if (current.source !== source) return current;
      if (!result.ok) return { ...current, loading: false };
      return { ...current, rows: appendPage(current.rows, result.data.rows), nextCursor: result.data.nextCursor, loading: false };
    });
  }

  // The search box shows what was typed, and sends it 300ms after typing stops.
  const searchRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(controls.q);
  const [typing, setTyping] = useState(false);
  const [syncedQ, setSyncedQ] = useState(controls.q);
  if (controls.q !== syncedQ) {
    setSyncedQ(controls.q);
    if (!typing && parseContactsQuery({ q: text }).q !== controls.q) setText(controls.q);
  }

  const settleSearch = useEffectEvent((value: string) => {
    setTyping(false);
    const q = parseContactsQuery({ q: value }).q;
    if (q !== controls.q) navigate({ q });
  });

  useEffect(() => {
    if (!typing) return;
    const timer = setTimeout(() => settleSearch(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, typing]);

  useSalesShortcut("search", () => {
    const box = searchRef.current;
    if (!box) return false;
    box.focus();
    box.select();
  });

  const people = data.query.tab === "people";
  const addKind: ContactKind = people ? "person" : "organization";
  const addLabel = people ? "Person" : "Organization";
  const panelId = people ? peoplePanelId : orgPanelId;
  const word = people ? "people" : "organizations";

  const empty = contactsEmptyState(data.query);
  // Nothing at all on this tab (no search, no Just me reason): the empty block alone, as Mockup v2 draws it.
  const trulyEmpty = page.rows.length === 0 && !data.query.q && data.query.scope === "everyone";

  function activateTab(tab: ContactsQuery["tab"]) {
    if (tab === controls.tab) return;
    navigate({ tab });
  }

  function onTabKey(current: ContactsQuery["tab"], event: React.KeyboardEvent<HTMLButtonElement>) {
    const index = TABS.findIndex((candidate) => candidate.tab === current);
    if (index < 0) return;
    const key = event.key;
    let target: number | null = null;
    if (key === "ArrowLeft") target = (index + TABS.length - 1) % TABS.length;
    else if (key === "ArrowRight") target = (index + 1) % TABS.length;
    else if (key === "Home") target = 0;
    else if (key === "End") target = TABS.length - 1;
    if (target === null) return;
    event.preventDefault();
    const targetTab = TABS[target].tab;
    const id = targetTab === "people" ? peopleTabId : orgTabId;
    const button = document.getElementById(id) as HTMLButtonElement | null;
    button?.focus();
  }

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-2.5">
        <div>
          <h1 className="m-0 text-[21px] font-semibold">Contacts</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">People and the practices they work at.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* No keyboard on a phone, so no shortcuts list there (as on Deals and Leads). */}
          <ShortcutsButton className="max-sm:hidden" />
          <Button
            onClick={() => setNewContact(addKind)}
            aria-label={people ? "Add person" : "Add organization"}
            className="pointer-coarse:h-10"
          >
            <Plus aria-hidden="true" />
            {addLabel}
          </Button>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Contacts"
        className="mt-3.5 inline-flex shrink-0 rounded-lg border bg-card p-0.5 pointer-coarse:p-0"
      >
        {TABS.map(({ tab, label, icon: Icon }) => {
          const active = tab === data.query.tab;
          const id = tab === "people" ? peopleTabId : orgTabId;
          const controlsId = tab === "people" ? peoplePanelId : orgPanelId;
          return (
            <button
              key={tab}
              id={id}
              role="tab"
              type="button"
              aria-selected={active}
              aria-controls={controlsId}
              tabIndex={active ? 0 : -1}
              onKeyDown={(event) => onTabKey(tab, event)}
              onClick={() => activateTab(tab)}
              className={cn(
                SEGMENT,
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5",
                "aria-selected:bg-accent aria-selected:font-semibold aria-selected:text-accent-foreground",
              )}
            >
              <Icon aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>

      {trulyEmpty ? null : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative w-[240px] max-sm:w-full max-sm:basis-full">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchRef}
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              placeholder={`Search ${word}`}
              aria-label={`Search ${word} by name`}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setTyping(true);
              }}
              className="peer w-full pr-8 pl-8 pointer-coarse:h-10"
            />
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-[5px] border border-b-2 bg-card px-1.5 font-sans text-[11px] text-muted-foreground peer-[:not(:placeholder-shown)]:hidden max-[820px]:hidden pointer-coarse:hidden"
            >
              /
            </kbd>
          </div>
          {data.canSeeEveryone ? (
            <div role="group" aria-label="Whose contacts" className={SEGMENT_GROUP}>
              <button
                type="button"
                aria-pressed={controls.scope === "everyone"}
                onClick={() => controls.scope !== "everyone" && navigate({ scope: "everyone" })}
                className={SEGMENT}
              >
                Everyone
              </button>
              <button
                type="button"
                aria-pressed={controls.scope === "mine"}
                onClick={() => controls.scope !== "mine" && navigate({ scope: "mine" })}
                className={SEGMENT}
              >
                Just me
              </button>
            </div>
          ) : null}
        </div>
      )}

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={people ? peopleTabId : orgTabId}
        aria-busy={pending}
        className={cn("mt-3 transition-opacity duration-200", pending && "opacity-60 motion-reduce:opacity-80")}
      >
        {page.rows.length === 0 ? (
          data.query.q ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[10px] border bg-muted/40 px-3 py-2 text-[13px]"
            >
              <Search aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{empty.title}</span>
              <Link href={empty.action.href} scroll={false} className={TEXT_LINK}>
                {empty.action.label}
              </Link>
            </div>
          ) : (
            <div className="rounded-[10px] border bg-card">
              <EmptyState
                icon={people ? Users : Folder}
                title={empty.title}
                description={empty.description ?? undefined}
                action={
                  <Link
                    href={empty.action.href}
                    scroll={false}
                    onNavigate={
                      // From the empty state: open the dialog here instead of loading the page again.
                      empty.action.href.includes("new=")
                        ? (event) => {
                            event.preventDefault();
                            setNewContact(addKind);
                          }
                        : undefined
                    }
                    className={cn(
                      buttonVariants({ variant: empty.action.href.includes("new=") ? "default" : "outline" }),
                      "pointer-coarse:min-h-10",
                    )}
                  >
                    {empty.action.href.includes("new=") ? <Plus aria-hidden="true" /> : null}
                    {empty.action.label}
                  </Link>
                }
              />
            </div>
          )
        ) : (
          <div className="flex flex-col">
            <div className="relative overflow-x-auto rounded-[10px] border bg-card">
              <table aria-label={people ? "People" : "Organizations"} className="w-full border-collapse text-[13px] max-sm:block">
                <thead className="max-sm:hidden">
                  <tr>
                    <th className={cn(HEAD, "w-px")}>
                      <span className="sr-only">Owner</span>
                    </th>
                    <th className={HEAD}>{people ? "Name" : "Organization"}</th>
                    <th className={HEAD}>{people ? "Organization" : "Contact"}</th>
                    <th className={HEAD}>Open deals</th>
                    <th className={HEAD}>Owner</th>
                  </tr>
                </thead>
                <tbody className="max-sm:block">
                  {page.rows.map((row) =>
                    row.kind === "person" ? (
                      <PersonRowView
                        key={row.id}
                        row={row}
                        ownerName={ownerNames.get(row.ownerId) ?? null}
                        href={contactHref(row)}
                        onOpen={() => openContact(row)}
                      />
                    ) : (
                      <OrganizationRowView
                        key={row.id}
                        row={row}
                        ownerName={ownerNames.get(row.ownerId) ?? null}
                        href={contactHref(row)}
                        onOpen={() => openContact(row)}
                      />
                    ),
                  )}
                </tbody>
              </table>
            </div>
            {page.nextCursor ? (
              <div className="mt-2.5 flex justify-center">
                <Button variant="outline" onClick={showMore} disabled={page.loading} className="pointer-coarse:min-h-10">
                  {page.loading ? "Loading" : "Show more"}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <NewPersonDialog
        open={newOpen === "person"}
        onOpenChange={(open) => (open ? setNewContact("person") : setNewContact(null))}
        onCreated={(contact) => {
          setNewContact(null);
          onCreated(contact, "person");
        }}
      />
      <NewOrganizationDialog
        open={newOpen === "organization"}
        onOpenChange={(open) => (open ? setNewContact("organization") : setNewContact(null))}
        onCreated={(contact) => {
          setNewContact(null);
          onCreated(contact, "organization");
        }}
      />
    </div>
  );
}

/**
 * One People row: a table row on wider screens, a stacked card with labels
 * under 640px. A click anywhere opens the person; the name is the real link.
 */
function PersonRowView({
  row,
  ownerName,
  href,
  onOpen,
}: {
  row: PersonRow;
  ownerName: string | null;
  href: string;
  onOpen: () => void;
}) {
  const owner = ownerName ?? "No longer in Sales";
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/50 max-sm:relative max-sm:block max-sm:py-2.5 max-sm:pr-3 max-sm:pl-3"
    >
      <td className="w-px px-3 py-[9px] align-middle max-sm:hidden">
        <OwnerAvatar id={row.ownerId} name={owner} />
      </td>
      <td className={cn(CELL, "font-semibold")}>
        <Link
          href={href}
          scroll={false}
          data-person-id={row.id}
          onClick={(event) => event.stopPropagation()}
          onNavigate={(event) => {
            event.preventDefault();
            onOpen();
          }}
          className="rounded-sm [overflow-wrap:anywhere] outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {row.name}
        </Link>
      </td>
      <td className={cn(CELL)}>
        <RowLabel>Organization:</RowLabel>
        {row.organizationName ? (
          <span>{row.organizationName}</span>
        ) : (
          <span className={MUTED_TEXT}>None</span>
        )}
      </td>
      <td className={cn(CELL, "whitespace-nowrap tabular-nums")}>
        <RowLabel>Open deals:</RowLabel>
        {row.openDeals}
      </td>
      <td className={cn(CELL, "whitespace-nowrap")}>
        <RowLabel>Owner:</RowLabel>
        <span className="inline-flex items-center gap-1.5 align-middle">
          <OwnerAvatar id={row.ownerId} name={owner} className="sm:hidden" />
          <span className={cn(MUTED_TEXT)}>{ownerName ? shortName(ownerName) : owner}</span>
        </span>
      </td>
    </tr>
  );
}

function OrganizationRowView({
  row,
  ownerName,
  href,
  onOpen,
}: {
  row: OrganizationRow;
  ownerName: string | null;
  href: string;
  onOpen: () => void;
}) {
  const owner = ownerName ?? "No longer in Sales";
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/50 max-sm:relative max-sm:block max-sm:py-2.5 max-sm:pr-3 max-sm:pl-3"
    >
      <td className="w-px px-3 py-[9px] align-middle max-sm:hidden">
        <OwnerAvatar id={row.ownerId} name={owner} />
      </td>
      <td className={cn(CELL, "font-semibold")}>
        <Link
          href={href}
          scroll={false}
          data-organization-id={row.id}
          onClick={(event) => event.stopPropagation()}
          onNavigate={(event) => {
            event.preventDefault();
            onOpen();
          }}
          className="rounded-sm [overflow-wrap:anywhere] outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {row.name}
        </Link>
      </td>
      <td className={cn(CELL)}>
        <RowLabel>Contact:</RowLabel>
        {row.contactName ? (
          <span>{row.contactName}</span>
        ) : (
          <span className={MUTED_TEXT}>None</span>
        )}
      </td>
      <td className={cn(CELL, "whitespace-nowrap tabular-nums")}>
        <RowLabel>Open deals:</RowLabel>
        {row.openDeals}
      </td>
      <td className={cn(CELL, "whitespace-nowrap")}>
        <RowLabel>Owner:</RowLabel>
        <span className="inline-flex items-center gap-1.5 align-middle">
          <OwnerAvatar id={row.ownerId} name={owner} className="sm:hidden" />
          <span className={cn(MUTED_TEXT)}>{ownerName ? shortName(ownerName) : owner}</span>
        </span>
      </td>
    </tr>
  );
}

/** "Organization:", "Open deals:", "Owner:" labels, shown only where rows are stacked cards. */
function RowLabel({ children }: { children: React.ReactNode }) {
  return <span className={cn("text-xs font-normal sm:hidden", MUTED_TEXT)}>{children} </span>;
}
