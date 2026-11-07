"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useId, useRef, useState, useTransition } from "react";
import {
  Building2,
  Check,
  Info,
  Merge,
  Plus,
  SearchX,
  TriangleAlert,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  getContactPanel,
  getContactTimeline,
  type ApiResult,
} from "@/lib/sales/api-client";
import { appendPage } from "@/lib/sales/board-client";
import type {
  ContactLinkedDeal,
  ContactLinkedLead,
  ContactPanelData,
  OrganizationPanelData,
  PersonPanelData,
} from "@/lib/sales/contact-panel";
import {
  DUPLICATE_HIDDEN_TEXT,
  duplicateNotice,
  contactMetaCount,
  listCapLine,
  type DuplicateNotice,
} from "@/lib/sales/contacts-client";
import type { ContactKind } from "@/lib/sales/contacts-query";
import { endSentence, formatMoney, shortName } from "@/lib/sales/format";
import { DEAL_PANEL_SHEET_CLASS } from "@/lib/sales/panel-client";
import { activePanel, changePanelUrl, panelHref, refreshAfterWrite } from "@/lib/sales/panel-url";
import type { TimelineCursor, TimelinePage } from "@/lib/sales/timeline";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { OrganizationDetails, PersonDetails } from "@/components/sales/contact-details";
import { DealHistory, type HistoryState } from "@/components/sales/deal-history";
import { PANEL_BODY } from "@/components/sales/deal-panel";
import { PanelCloseButton } from "@/components/sales/deal-panel-header";
import { MergeDialog } from "@/components/sales/merge-dialog";
import { SECTION_HEADING } from "@/components/sales/next-steps";
import { MUTED_TEXT, MUTED_TONE, OwnerAvatar } from "@/components/sales/sales-pills";

// The slide-in contact panel (Mockup v2 `personPanel`, `orgPanel`, Decision
// 19), mounted once by the Sales layout beside the deal and lead panels and
// opened by `?person=<id>` or `?organization=<id>` on any Sales page. Follows
// the deal panel: same Sheet and width, same load states, same guard for a
// toast's Undo. Header: "Contacts", the name (read-only header; details are
// edited in Details), the meta (organization/role for a person, people count
// and ZIP for an organization, plus the owner), then the duplicate bar when
// there is one, Details, Deals, Leads (and People on organizations), and
// History. Carries no deal-panel mark, so the Sales shortcuts stay off
// inside it (A11). After every saved change it loads the contact and its
// history again and refreshes the page behind.

const NEW_DEAL_HREF = "/sales/deals?new=1";

export function ContactPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // One panel at a time: the deal, then the lead, then the person or organization wins (Decision 35).
  const target = activePanel(searchParams);
  const current =
    target && (target.kind === "person" || target.kind === "organization")
      ? { kind: target.kind, id: target.id }
      : null;
  const titleId = useId();

  // The last contact shown stays rendered while the panel slides away.
  const [shown, setShown] = useState<{ kind: ContactKind; id: string } | null>(current);
  if (current && (shown === null || current.id !== shown.id || current.kind !== shown.kind)) {
    setShown(current);
  }
  const [closing, startClosing] = useTransition();
  const open = current !== null && !closing;

  function close() {
    if (current === null) return;
    startClosing(() => changePanelUrl(panelHref(pathname, searchParams.toString(), null), "replace", router));
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        // A toast's Undo sits outside the panel; pressing it must not close the panel.
        const pressed = details.event?.target;
        if (details.reason === "outside-press" && pressed instanceof Element && pressed.closest("[data-sonner-toaster]")) {
          details.cancel();
          return;
        }
        close();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-labelledby={titleId}
        // Back to the contact's row (Contacts page, organization's People list, lead or deal panel).
        finalFocus={() => contactRow(shown)}
        className={cn(DEAL_PANEL_SHEET_CLASS, "ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none")}
      >
        {shown ? <ContactPanelLoader key={`${shown.kind}:${shown.id}`} kind={shown.kind} id={shown.id} titleId={titleId} onClose={close} /> : null}
      </SheetContent>
    </Sheet>
  );
}

/** The first row for this contact on the page, or null (Base UI then returns focus to whatever had it before). */
function contactRow(target: { kind: ContactKind; id: string } | null): HTMLElement | null {
  if (!target || typeof document === "undefined") return null;
  const attr = target.kind === "person" ? "data-person-id" : "data-organization-id";
  return document.querySelector<HTMLElement>(`[${attr}="${CSS.escape(target.id)}"]`);
}

type PanelLoad =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ContactPanelData; now: Date };

/** Loads the contact, shows its loading, missing and error states, and the panel once it is here. */
function ContactPanelLoader({
  kind,
  id,
  titleId,
  onClose,
}: {
  kind: ContactKind;
  id: string;
  titleId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [load, setLoad] = useState<PanelLoad>({ kind: "loading" });
  // Each load takes a ticket; only the newest one's answer is shown.
  const latestLoad = useRef(0);
  const hasData = useRef(false);

  function show(ticket: number, result: ApiResult<ContactPanelData>) {
    if (ticket !== latestLoad.current) return;
    if (result.ok) {
      hasData.current = true;
      setLoad({ kind: "ready", data: result.data, now: new Date() });
      // An old link that opened the contact it was merged into: swap the URL to the kept id.
      if (result.data.redirectedFrom) {
        const keptKind: ContactKind = result.data.kind;
        const keptId = result.data.kind === "person" ? result.data.person.id : result.data.organization.id;
        const href = panelHref(pathname, searchParams.toString(), { kind: keptKind, id: keptId });
        changePanelUrl(href, "replace", router);
      }
    } else if (result.status === 404) {
      setLoad({ kind: "missing" });
    } else if (hasData.current) {
      toast.error(result.error);
    } else {
      setLoad({ kind: "error", message: result.error });
    }
  }

  async function reload() {
    const ticket = ++latestLoad.current;
    show(ticket, await getContactPanel(kind, id));
  }

  const onLoaded = useEffectEvent((ticket: number, result: ApiResult<ContactPanelData>) => show(ticket, result));
  useEffect(() => {
    const ticket = ++latestLoad.current;
    void getContactPanel(kind, id).then((result) => onLoaded(ticket, result));
  }, [kind, id]);

  function changed() {
    void reload();
    refreshAfterWrite(router);
  }

  if (load.kind === "loading") return <ContactPanelSkeleton titleId={titleId} />;

  if (load.kind === "missing" || load.kind === "error") {
    const missing = load.kind === "missing";
    return (
      <>
        <div className="flex flex-none justify-end px-4 pt-3 sm:px-[18px]">
          <PanelCloseButton />
        </div>
        <div role={missing ? undefined : "alert"} className="flex flex-1 flex-col justify-center pb-16">
          <span id={titleId} className="sr-only">
            {missing ? "This contact is not available." : "Could not load this contact."}
          </span>
          {missing ? (
            <EmptyState
              icon={SearchX}
              title="This contact is not available."
              description="It may have been deleted, or it belongs to someone whose contacts you cannot see."
              action={
                <SheetClose render={<Button variant="outline" className="pointer-coarse:min-h-10" />}>Close</SheetClose>
              }
            />
          ) : (
            <EmptyState
              icon={TriangleAlert}
              title="Could not load this contact."
              description={load.message}
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setLoad({ kind: "loading" });
                    void reload();
                  }}
                  className="pointer-coarse:min-h-10"
                >
                  Try again
                </Button>
              }
            />
          )}
        </div>
      </>
    );
  }

  const name = load.data.kind === "person" ? load.data.person.name : load.data.organization.name;
  return (
    <>
      <h2 id={titleId} className="sr-only">
        {name}
      </h2>
      <ContactPanelBody data={load.data} now={load.now} onChanged={changed} onClose={onClose} />
    </>
  );
}

/** The contact panel once it has loaded: header, duplicates bar, Details, linked rows, History. */
export function ContactPanelBody({
  data,
  now,
  onChanged,
  onClose,
}: {
  data: ContactPanelData;
  now: Date;
  /** After a change is saved: load the contact again and refresh the page behind. */
  onChanged: () => void;
  /** Closes the panel (the header's close button). */
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [history, setHistory] = useState<HistoryState>({ status: "loading" });
  const [cursor, setCursor] = useState<TimelineCursor | null>(null);
  const latestHistory = useRef(0);
  const contactId = data.kind === "person" ? data.person.id : data.organization.id;

  function showHistory(ticket: number, result: ApiResult<TimelinePage>) {
    if (ticket !== latestHistory.current) return;
    if (result.ok) {
      setHistory({
        status: "ready",
        entries: result.data.entries,
        hasOlder: result.data.nextCursor !== null,
        loadingOlder: false,
      });
      setCursor(result.data.nextCursor);
    } else {
      setHistory({ status: "error", message: result.error });
    }
  }

  function loadHistory() {
    const ticket = ++latestHistory.current;
    void getContactTimeline(data.kind, contactId, null).then((result) => showHistory(ticket, result));
  }

  const onHistory = useEffectEvent((ticket: number, result: ApiResult<TimelinePage>) => showHistory(ticket, result));
  // `data` identity changes on every reload, so the effect reruns on every change; `contactId` tracks that.
  useEffect(() => {
    const ticket = ++latestHistory.current;
    void getContactTimeline(data.kind, contactId, null).then((result) => onHistory(ticket, result));
  }, [data, contactId]);

  async function showOlder() {
    if (history.status !== "ready" || !cursor || history.loadingOlder) return;
    const ticket = latestHistory.current;
    setHistory({ ...history, loadingOlder: true });
    const result = await getContactTimeline(data.kind, contactId, cursor);
    if (ticket !== latestHistory.current) return;
    if (!result.ok) {
      toast.error(result.error);
      setHistory((current) => (current.status === "ready" ? { ...current, loadingOlder: false } : current));
      return;
    }
    setHistory((current) =>
      current.status === "ready"
        ? {
            status: "ready",
            entries: appendPage(current.entries, result.data.entries),
            hasOlder: result.data.nextCursor !== null,
            loadingOlder: false,
          }
        : current,
    );
    setCursor(result.data.nextCursor);
  }

  const notice = duplicateNotice(data.duplicates, data.canMerge);
  const [merging, setMerging] = useState<{ keepId: string; dropId: string } | null>(null);

  function openMerge(dropId: string) {
    setMerging({ keepId: contactId, dropId });
  }

  function onMerged(kept: { id: string; name: string }) {
    // Swap the panel URL to the kept id and reload the page behind.
    refreshAfterWrite(router);
    const href = panelHref(pathname, searchParams.toString(), { kind: data.kind, id: kept.id });
    changePanelUrl(href, "replace", router);
  }

  return (
    <>
      <ContactPanelHeader data={data} onClose={onClose} />
      <div className={PANEL_BODY}>
        {data.redirectedFrom ? (
          <div role="status" className="flex items-start gap-2 rounded-[9px] bg-accent px-3 py-[9px] text-[13px] text-accent-foreground">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">The link you opened was for a contact that was merged into this one.</span>
          </div>
        ) : null}

        {notice ? (
          <DuplicateBar notice={notice} kind={data.kind} canMerge={data.canMerge} onMerge={openMerge} />
        ) : null}

        {data.kind === "person" ? (
          <PersonDetails data={data} onChanged={onChanged} />
        ) : (
          <OrganizationDetails data={data} onChanged={onChanged} />
        )}

        {data.kind === "organization" ? <PeopleList data={data} /> : null}

        <DealsList data={data} />

        <LeadsList data={data} />

        <DealHistory
          history={history}
          now={now}
          onShowOlder={() => void showOlder()}
          onRetry={() => {
            setHistory({ status: "loading" });
            loadHistory();
          }}
          onSaved={onChanged}
        />
      </div>

      {data.canMerge && merging ? (
        <MergeDialog
          open
          onOpenChange={(open) => {
            if (!open) setMerging(null);
          }}
          kind={data.kind}
          keepId={merging.keepId}
          dropId={merging.dropId}
          onMerged={(kept) => {
            setMerging(null);
            onMerged(kept);
          }}
        />
      ) : null}
    </>
  );
}

// --- Header ---

function ContactPanelHeader({ data, onClose }: { data: ContactPanelData; onClose: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const name = data.kind === "person" ? data.person.name : data.organization.name;

  return (
    <header className="flex-none border-b px-4 pt-3 pb-3 sm:px-[18px] sm:pt-3.5">
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <p className="m-0 truncate">Contacts</p>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close (Esc)"
          title="Close (Esc)"
          className="-mr-1.5 ml-auto size-[30px] shrink-0 pointer-coarse:size-10"
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      <p className="m-0 mt-1.5 truncate text-[19px] leading-snug font-semibold text-foreground">{name}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[13px]">
        {data.kind === "person" ? <PersonMeta data={data} pathname={pathname} searchParams={searchParams} /> : <OrganizationMeta data={data} />}
      </div>
    </header>
  );
}

function PersonMeta({
  data,
  pathname,
  searchParams,
}: {
  data: PersonPanelData;
  pathname: string;
  searchParams: URLSearchParams;
}) {
  const router = useRouter();
  const { person } = data;
  const organization = person.organization;
  const orgHref =
    organization && organization.visible
      ? panelHref(pathname, searchParams.toString(), { kind: "organization", id: organization.id })
      : null;

  return (
    <>
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <Building2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="sr-only">Organization: </span>
        {organization ? (
          orgHref ? (
            <Link
              href={orgHref}
              scroll={false}
              onNavigate={(event) => {
                event.preventDefault();
                changePanelUrl(orgHref, "push", router);
              }}
              className="truncate rounded-sm font-medium text-cyan-700 underline underline-offset-2 outline-none hover:decoration-current focus-visible:ring-3 focus-visible:ring-ring/50 dark:text-sky-300"
            >
              {organization.name}
            </Link>
          ) : (
            <span className="truncate">{organization.name}</span>
          )
        ) : (
          <span className="text-muted-foreground">No organization</span>
        )}
      </span>

      {person.role ? (
        <span className={cn("inline-flex min-w-0 items-center gap-1.5 truncate", MUTED_TEXT)}>
          <span className="sr-only">Role: </span>
          {person.role}
        </span>
      ) : null}

      <OwnerLine ownerName={person.owner.name} ownerId={person.owner.id} />
    </>
  );
}

function OrganizationMeta({ data }: { data: OrganizationPanelData }) {
  const { organization, counts } = data;

  return (
    <>
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <User aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="sr-only">People: </span>
        <span>{contactMetaCount(counts.people)}</span>
      </span>

      {organization.zip ? (
        <span className={cn("inline-flex min-w-0 items-center gap-1.5", MUTED_TEXT)}>
          <span className="sr-only">ZIP: </span>
          ZIP {organization.zip}
        </span>
      ) : null}

      <OwnerLine ownerName={organization.owner.name} ownerId={organization.owner.id} />
    </>
  );
}

function OwnerLine({ ownerName, ownerId }: { ownerName: string; ownerId: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="inline-flex">
        <OwnerAvatar id={ownerId} name={ownerName} />
      </span>
      <span className="sr-only">Owner: </span>
      Owner {shortName(ownerName)}
    </span>
  );
}

// --- Duplicate bar ---

function DuplicateBar({
  notice,
  kind,
  canMerge,
  onMerge,
}: {
  notice: DuplicateNotice;
  kind: ContactKind;
  canMerge: boolean;
  onMerge: (dropId: string) => void;
}) {
  if (notice.kind === "hidden") {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-[9px] bg-status-warning px-3 py-[9px] text-[13px] text-status-warning-foreground"
      >
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0">{DUPLICATE_HIDDEN_TEXT}</span>
      </div>
    );
  }

  // Mockup v2 shows only the first visible match name with a Merge button.
  const first = notice.matches[0];
  const openPanelHref = (id: string) => `?${kind === "person" ? "person" : "organization"}=${encodeURIComponent(id)}`;

  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-x-2 gap-y-2 rounded-[9px] bg-status-warning px-3 py-[9px] text-[13px] text-status-warning-foreground"
    >
      <Merge aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">{notice.label}</strong>{" "}
        <MatchLinks matches={notice.matches} kind={kind} openPanelHref={openPanelHref} />
        {notice.tail ? <> {notice.tail}</> : null}
      </span>
      {canMerge && first ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onMerge(first.id)}
          className="ml-auto max-sm:ml-0 max-sm:w-full border-status-warning-foreground/30 bg-transparent text-status-warning-foreground hover:bg-status-warning-foreground/10 pointer-coarse:min-h-10"
        >
          Merge
        </Button>
      ) : null}
    </div>
  );
}

function MatchLinks({
  matches,
  kind,
  openPanelHref,
}: {
  matches: { id: string; name: string }[];
  kind: ContactKind;
  openPanelHref: (id: string) => string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <>
      {matches.map((match, index) => {
        const href = panelHref(pathname, searchParams.toString(), { kind, id: match.id });
        return (
          <span key={match.id}>
            <Link
              href={href}
              scroll={false}
              onNavigate={(event) => {
                event.preventDefault();
                changePanelUrl(href, "push", router);
              }}
              className="rounded-sm font-semibold underline underline-offset-2 outline-none hover:decoration-current focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {match.name}
            </Link>
            {index < matches.length - 1 ? ", " : "."}
            {index === matches.length - 1 && matches.length < openPanelHref.length ? null : null}
          </span>
        );
      })}
    </>
  );
}

// --- Sections ---

function SectionHead({ label, count }: { label: string; count: number | null }) {
  return (
    <h3 className={cn(SECTION_HEADING, "normal-case")}>
      <span className="text-[11.5px] font-bold tracking-[0.06em] uppercase">{label}</span>
      {count !== null && count > 0 ? (
        <span className={cn("ml-1 inline-flex items-center rounded-full px-[7px] py-0.5 text-[10.5px] font-semibold tracking-normal", MUTED_TONE)}>
          {count}
        </span>
      ) : null}
    </h3>
  );
}

function DealsList({ data }: { data: ContactPanelData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { deals, counts } = data;
  const name = data.kind === "person" ? data.person.name : data.organization.name;

  const empty =
    data.kind === "person"
      ? endSentence(`No deals yet. Add one when ${name} books a demo`)
      : endSentence(`No deals yet with ${name}`);

  return (
    <section className="grid gap-2">
      <SectionHead label="Deals" count={counts.deals} />
      {deals.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-x-2.5 gap-y-2 rounded-[9px] border border-dashed bg-muted/30 px-3 py-[9px] text-[13px]">
          <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{empty}</span>
          <Link
            href={NEW_DEAL_HREF}
            className={cn(
              buttonVariants({ size: "sm", variant: "outline" }),
              "pointer-coarse:min-h-10",
            )}
          >
            <Plus aria-hidden="true" className="size-4" />
            Deal
          </Link>
        </div>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {deals.map((deal) => (
              <li key={deal.id}>
                <DealRow deal={deal} pathname={pathname} searchParams={searchParams} router={router} />
              </li>
            ))}
          </ul>
          {listCap(deals.length, counts.deals)}
        </>
      )}
    </section>
  );
}

function LeadsList({ data }: { data: ContactPanelData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { leads, counts } = data;

  const empty =
    data.kind === "person"
      ? "No leads. Opt-ins from this person show up here."
      : "No leads. Opt-ins from this practice show up here.";

  return (
    <section className="grid gap-2">
      <SectionHead label="Leads" count={counts.leads} />
      {leads.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {leads.map((lead) => (
              <li key={lead.id}>
                <LeadRow lead={lead} pathname={pathname} searchParams={searchParams} router={router} />
              </li>
            ))}
          </ul>
          {listCap(leads.length, counts.leads)}
        </>
      )}
    </section>
  );
}

function PeopleList({ data }: { data: OrganizationPanelData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { people, counts } = data;

  return (
    <section className="grid gap-2">
      <SectionHead label="People" count={counts.people} />
      {people.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">
          Nobody linked yet. Pick this organization on a person to add them.
        </p>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {people.map((person) => {
              const href = panelHref(pathname, searchParams.toString(), { kind: "person", id: person.id });
              return (
                <li key={person.id}>
                  <Link
                    href={href}
                    scroll={false}
                    onNavigate={(event) => {
                      event.preventDefault();
                      changePanelUrl(href, "push", router);
                    }}
                    className="flex min-h-10 items-center gap-2 rounded-[9px] border bg-card px-3 py-[7px] text-[13px] outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <User aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate font-semibold">{person.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {listCap(people.length, counts.people)}
        </>
      )}
    </section>
  );
}

function DealRow({
  deal,
  pathname,
  searchParams,
  router,
}: {
  deal: ContactLinkedDeal;
  pathname: string;
  searchParams: URLSearchParams;
  router: ReturnType<typeof useRouter>;
}) {
  const href = panelHref(pathname, searchParams.toString(), { kind: "deal", id: deal.id });
  return (
    <Link
      href={href}
      scroll={false}
      onNavigate={(event) => {
        event.preventDefault();
        changePanelUrl(href, "push", router);
      }}
      className="flex min-h-10 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[9px] border bg-card px-3 py-[7px] text-[13px] outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="min-w-0 flex-1 truncate font-semibold">{deal.title}</span>
      <span className={cn("text-[11.5px]", MUTED_TEXT)}>{deal.stageName}</span>
      <span className="tabular-nums font-semibold">{formatMoney(deal.valueCents)}</span>
      {deal.status === "WON" ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-status-success px-[7px] py-0.5 text-[11px] font-semibold text-status-success-foreground">
          <Check aria-hidden="true" className="size-3" strokeWidth={3} />
          Won
        </span>
      ) : deal.status === "LOST" ? (
        <span className="inline-flex items-center rounded-full bg-status-danger px-[7px] py-0.5 text-[11px] font-semibold text-status-danger-foreground">
          Lost
        </span>
      ) : null}
    </Link>
  );
}

function LeadRow({
  lead,
  pathname,
  searchParams,
  router,
}: {
  lead: ContactLinkedLead;
  pathname: string;
  searchParams: URLSearchParams;
  router: ReturnType<typeof useRouter>;
}) {
  const href = panelHref(pathname, searchParams.toString(), { kind: "lead", id: lead.id });
  return (
    <Link
      href={href}
      scroll={false}
      onNavigate={(event) => {
        event.preventDefault();
        changePanelUrl(href, "push", router);
      }}
      className="flex min-h-10 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[9px] border bg-card px-3 py-[7px] text-[13px] outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="min-w-0 flex-1 truncate font-semibold">{lead.title}</span>
      {lead.status === "CONVERTED" ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-status-success px-[7px] py-0.5 text-[11px] font-semibold text-status-success-foreground">
          <Check aria-hidden="true" className="size-3" strokeWidth={3} />
          Converted
        </span>
      ) : lead.status === "ARCHIVED" ? (
        <span className={cn("inline-flex items-center rounded-full px-[7px] py-0.5 text-[11px] font-semibold", MUTED_TONE)}>
          Archived
        </span>
      ) : null}
    </Link>
  );
}

function listCap(shown: number, total: number) {
  const line = listCapLine(shown, total);
  if (!line) return null;
  return <p className="m-0 text-[11.5px] text-muted-foreground">{line}</p>;
}

/** While the contact loads: the header's crumb, name and meta, and three blocks below, in their final places. */
function ContactPanelSkeleton({ titleId }: { titleId: string }) {
  return (
    <>
      <div className="flex-none border-b px-4 pt-3 pb-3 sm:px-[18px] sm:pt-3.5" aria-busy="true">
        <span id={titleId} className="sr-only">
          Loading contact
        </span>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-3 w-20" />
          <PanelCloseButton />
        </div>
        <Skeleton className="mt-1.5 h-6 w-3/5" />
        <Skeleton className="mt-3 h-4 w-4/5" />
      </div>
      <div className={PANEL_BODY} aria-hidden="true">
        <Skeleton className="h-28 w-full rounded-[9px]" />
        <Skeleton className="h-28 w-full rounded-[9px]" />
        <Skeleton className="h-40 w-full rounded-[9px]" />
      </div>
    </>
  );
}
