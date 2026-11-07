"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useOptimistic, useRef, useState, useTransition } from "react";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check, Inbox, Minus, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { getLeadRowsPage, runLeadBulkRequest } from "@/lib/sales/api-client";
import { appendPage, canChangeDeal } from "@/lib/sales/board-client";
import { dayLabel, shortName } from "@/lib/sales/format";
import type { BulkLeadInput } from "@/lib/sales/lead-bulk";
import {
  bulkFailureLine,
  bulkToast,
  inboxFooterLine,
  isOldLead,
  leadAgeDays,
  leadsEmptyState,
  leadSubLine,
  NEW_LEAD_HREF,
  pruneSelection,
  selectionState,
} from "@/lib/sales/leads-client";
import type { LeadRow, LeadsPageData } from "@/lib/sales/leads-page";
import { leadsQueryToSearch, parseLeadsQuery, type LeadsQuery } from "@/lib/sales/leads-query";
import { changePanelUrl, pageRendered, panelHref, refreshAfterWrite } from "@/lib/sales/panel-url";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { ConvertDialog, type ConvertLead, type ConvertResult } from "@/components/sales/convert-dialog";
import { SEGMENT, SEGMENT_GROUP } from "@/components/sales/deals-toolbar";
import { DeleteLeadsDialog, LeadsBulkBar } from "@/components/sales/lead-bulk-dialogs";
import { NewLeadDialog } from "@/components/sales/new-lead-dialog";
import { MUTED_TEXT, NextStepPill, OwnerAvatar } from "@/components/sales/sales-pills";
import { useSalesShortcut } from "@/components/sales/sales-shortcuts";
import { ShortcutsButton } from "@/components/sales/shortcuts-help-dialog";

// The Leads Inbox on the client (Mockup v2 `#s=leads`, Decision 11): the
// header with "+ Lead", the search and Everyone / Just me, the open leads
// newest first with a tick box on each lead the viewer may change, the bulk
// bar while any are ticked, "Show more", and the line saying who gets new
// leads. A search or scope change replaces the URL (never with a page
// cursor); "Show more" appends the next page; a row opens its lead in the lead
// panel (`?lead=<id>`, built by panelHref and set with the history API, so the
// Inbox is not loaded again). Under 640px each row becomes a stacked card with
// labels, a strip above the cards holds the select-all box, and the bulk bar
// sticks to the top.

type Viewer = { userId: string; isAdmin: boolean };
type LeadsPatch = Partial<Omit<LeadsQuery, "cursor">>;
type Selection = "none" | "some" | "all";

const SEARCH_DEBOUNCE_MS = 300;
const SELECT_ALL_LABEL = "Select all shown leads you can change";

const CELL = "px-3 py-[9px] align-middle max-sm:block max-sm:border-0 max-sm:px-0 max-sm:py-0.5";
const HEAD = "border-b bg-muted/40 px-3 py-[9px] text-left text-[11.5px] font-semibold whitespace-nowrap text-muted-foreground";
const PILL = "inline-flex shrink-0 items-center rounded-full px-[7px] py-0.5 text-[11px] leading-[1.4] font-semibold whitespace-nowrap";
// The mockup's text link (Clear search): AA on the card and the strip in both themes (Task 18's link ink).
const TEXT_LINK =
  "rounded-sm font-semibold text-cyan-700 underline underline-offset-2 outline-none hover:decoration-current focus-visible:ring-3 focus-visible:ring-ring/50 dark:text-sky-300 pointer-coarse:-my-2.5 pointer-coarse:inline-flex pointer-coarse:min-h-10 pointer-coarse:items-center";

/**
 * A tick box: the app's checkbox look, plus a dash when only some are ticked
 * (the app's own Checkbox always draws a check). 28px to click on a desktop,
 * 40px on phones and touch screens, with a 20px box there (Mockup v2).
 */
function TickBox({
  label,
  checked,
  indeterminate = false,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  onCheckedChange: () => void;
}) {
  return (
    <CheckboxPrimitive.Root
      aria-label={label}
      checked={checked}
      indeterminate={indeterminate}
      onCheckedChange={onCheckedChange}
      className="peer relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-input bg-background transition-colors outline-none after:absolute after:-inset-1.5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground max-sm:size-5 max-sm:after:-inset-2.5 pointer-coarse:size-5 pointer-coarse:after:-inset-2.5 dark:bg-input/30 dark:data-checked:bg-primary dark:data-indeterminate:bg-primary"
    >
      <CheckboxPrimitive.Indicator className="grid place-content-center text-current [&>svg]:size-3.5">
        {indeterminate ? <Minus aria-hidden="true" strokeWidth={3} /> : <Check aria-hidden="true" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** "Select all shown leads you can change": ticked when all are, half-ticked (aria-checked="mixed") when some are. */
export function SelectAllBox({ state, onToggle }: { state: Selection; onToggle: () => void }) {
  return <TickBox label={SELECT_ALL_LABEL} checked={state === "all"} indeterminate={state === "some"} onCheckedChange={onToggle} />;
}

export function LeadsView({
  data,
  viewer,
  now: nowIso,
  openNew,
}: {
  data: LeadsPageData;
  viewer: Viewer;
  /** The server's clock for this render, so day colours match what the server read. */
  now: string;
  /** `?new=1`: open Add lead straight away. */
  openNew: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  // What the search and the switch show: the server's query, or, while a change loads, the one just asked for.
  const [controls, setControls] = useOptimistic(data.query);
  const now = new Date(nowIso);
  // Each render from the server carries its own time: a new one means the list is fresh.
  useEffect(() => pageRendered(), [nowIso]);

  // Add lead opens for `?new=1`, also when the Inbox is already showing (the empty Inbox's "Add a lead").
  const [newOpen, setNewOpen] = useState(openNew);
  const [seenOpenNew, setSeenOpenNew] = useState(openNew);
  if (openNew !== seenOpenNew) {
    setSeenOpenNew(openNew);
    if (openNew) setNewOpen(true);
  }

  // The rows shown and the next cursor start again from the server's first
  // page whenever it sends a new one (a filter change or a refresh); ticks of
  // leads no longer shown are let go. Adjusted during render, not in an effect.
  const [page, setPage] = useState({ source: data, rows: data.rows, nextCursor: data.nextCursor, loading: false });
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  if (page.source !== data) {
    setPage({ source: data, rows: data.rows, nextCursor: data.nextCursor, loading: false });
    setSelected(pruneSelection(selected, editableIds(data.rows, viewer)));
  }

  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // The leads the delete confirm names, kept from when it opened: the ticks clear before it has finished closing.
  const [toDelete, setToDelete] = useState<{ ids: string[]; titles: string[] }>({ ids: [], titles: [] });
  const [deleting, setDeleting] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  // The leads the convert dialog takes, kept from when it opened, as for the delete confirm.
  const [toConvert, setToConvert] = useState<ConvertLead[]>([]);

  const ownerNames = new Map(data.members.map((member) => [member.id, member.name]));
  const shownIds = editableIds(page.rows, viewer);
  const selection = selectionState(selected, shownIds);
  const ticked = page.rows.filter((row) => selected.has(row.id));

  function navigate(patch: LeadsPatch) {
    const next: LeadsQuery = { ...controls, ...patch, cursor: null };
    const search = leadsQueryToSearch(next);
    startTransition(() => {
      setControls(next);
      router.replace(search ? `?${search}` : pathname, { scroll: false });
    });
  }

  /** This page's URL with the lead panel open. */
  const leadHref = (leadId: string) => panelHref(pathname, searchParams.toString(), { kind: "lead", id: leadId });
  const openLead = (leadId: string) => changePanelUrl(leadHref(leadId), "push", router);

  function setNewLead(open: boolean) {
    setNewOpen(open);
    if (!open && searchParams.has("new")) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("new");
      const search = params.toString();
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    }
  }

  function toggle(leadId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }

  /** Ticks every shown lead the viewer may change, or unticks them when all already are. */
  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (selectionState(current, shownIds) === "all") for (const id of shownIds) next.delete(id);
      else for (const id of shownIds) next.add(id);
      return next;
    });
  }

  async function showMore() {
    const { source, nextCursor } = page;
    if (!nextCursor || page.loading) return;
    setPage((current) => (current.source === source ? { ...current, loading: true } : current));
    const result = await getLeadRowsPage({ ...source.query, cursor: nextCursor });
    if (!result.ok) toast.error(result.error);
    // A page that arrives after the list was replaced belongs to the old search: drop it.
    setPage((current) => {
      if (current.source !== source) return current;
      if (!result.ok) return { ...current, loading: false };
      return { ...current, rows: appendPage(current.rows, result.data.rows), nextCursor: result.data.nextCursor, loading: false };
    });
  }

  /**
   * Sends one bulk request and says what came of it: a refusal of the whole
   * request, or each lead that could not be changed. Answers the ids that
   * changed (null when the request was refused). The ticks clear and the page
   * refreshes either way.
   */
  async function runBulk(body: BulkLeadInput): Promise<string[] | null> {
    setBusy(true);
    const result = await runLeadBulkRequest(body);
    setBusy(false);
    setSelected(new Set());
    refreshAfterWrite(router);
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    const failure = bulkFailureLine(result.data.results);
    if (failure) toast.error(failure);
    return result.data.results.flatMap((entry) => (entry.ok ? [entry.id] : []));
  }

  async function assign(ownerId: string) {
    const changed = await runBulk({ action: "assign", ids: [...selected], ownerId });
    const owner = ownerNames.get(ownerId);
    if (changed && changed.length > 0) toast(bulkToast("assign", changed.length, owner ? shortName(owner) : undefined));
  }

  async function restore(ids: string[]) {
    const changed = await runBulk({ action: "restore", ids });
    if (changed && changed.length > 0) toast(bulkToast("restore", changed.length));
  }

  async function archive() {
    const changed = await runBulk({ action: "archive", ids: [...selected] });
    if (changed && changed.length > 0) {
      toast(bulkToast("archive", changed.length), { cancel: { label: "Undo", onClick: () => void restore(changed) } });
    }
  }

  function startConvert() {
    setToConvert(
      ticked.map((row) => ({
        id: row.id,
        title: row.title,
        personName: row.personName,
        organizationName: row.organizationName,
        // The earliest open activity is all a row knows; the single dialog names it as the next step that moves.
        openActivities: row.next ? [row.next] : [],
      })),
    );
    setConvertOpen(true);
  }

  /** The convert is over: the ticks clear and the Inbox comes back fresh; "Open the deal" (already converted) opens it here. */
  function converted(result: ConvertResult) {
    setSelected(new Set());
    refreshAfterWrite(router);
    if (result.converted === 0 && result.dealId) {
      changePanelUrl(panelHref(pathname, searchParams.toString(), { kind: "deal", id: result.dealId }), "push", router);
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    const changed = await runBulk({ action: "delete", ids: toDelete.ids });
    setDeleting(false);
    setDeleteOpen(false);
    if (changed && changed.length > 0) toast(bulkToast("delete", changed.length));
  }

  // The search box shows what was typed, and sends it 300ms after typing stops.
  // When the search changes some other way (Clear search, Back), the box
  // follows it, unless the person is mid-typing or it already means the same.
  const searchRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(controls.q);
  const [typing, setTyping] = useState(false);
  const [syncedQ, setSyncedQ] = useState(controls.q);
  if (controls.q !== syncedQ) {
    setSyncedQ(controls.q);
    if (!typing && parseLeadsQuery({ q: text }).q !== controls.q) setText(controls.q);
  }

  const settleSearch = useEffectEvent((value: string) => {
    setTyping(false);
    const q = parseLeadsQuery({ q: value }).q;
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

  const empty = leadsEmptyState(data.query, data.canSeeEveryone);
  // Nobody's open lead to show at all: the empty state alone, as Mockup v2 draws it.
  const inboxZero = page.rows.length === 0 && !data.query.q && data.query.scope === "everyone" && data.canSeeEveryone;

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-2.5">
        <div>
          <h1 className="m-0 text-[21px] font-semibold">Leads Inbox</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">New opt-ins land here first. Convert the good ones to deals.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* No keyboard on a phone, so no shortcuts list there (as on Deals and Activities). */}
          <ShortcutsButton className="max-sm:hidden" />
          <Button onClick={() => setNewOpen(true)} aria-label="Add lead" className="pointer-coarse:h-10">
            <Plus aria-hidden="true" />
            Lead
          </Button>
        </div>
      </div>

      {inboxZero ? null : (
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
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
              placeholder="Search leads"
              aria-label="Search leads by name, practice or person"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setTyping(true);
              }}
              className="peer w-full pr-8 pl-8 pointer-coarse:h-10"
            />
            {/* The `/` shortcut, shown only where there is a keyboard and nothing typed yet. */}
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-[5px] border border-b-2 bg-card px-1.5 font-sans text-[11px] text-muted-foreground peer-[:not(:placeholder-shown)]:hidden max-[820px]:hidden pointer-coarse:hidden"
            >
              /
            </kbd>
          </div>
          {data.canSeeEveryone ? (
            <div role="group" aria-label="Whose leads" className={SEGMENT_GROUP}>
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
        aria-busy={pending}
        className={cn("mt-3 transition-opacity duration-200", pending && "opacity-60 motion-reduce:opacity-80", inboxZero && "mt-3.5")}
      >
        {page.rows.length === 0 ? (
          data.query.q ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[10px] border bg-muted/40 px-3 py-2 text-[13px]"
            >
              <Search aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{empty.title}</span>
              {empty.action ? (
                <Link href={empty.action.href} scroll={false} className={TEXT_LINK}>
                  {empty.action.label}
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="rounded-[10px] border bg-card">
              <EmptyState
                icon={Inbox}
                title={empty.title}
                description={empty.description ?? undefined}
                action={
                  empty.action ? (
                    <Link
                      href={empty.action.href}
                      scroll={false}
                      // Add a lead opens the dialog here instead of loading the page again.
                      onNavigate={
                        empty.action.href === NEW_LEAD_HREF
                          ? (event) => {
                              event.preventDefault();
                              setNewOpen(true);
                            }
                          : undefined
                      }
                      className={cn(
                        buttonVariants({ variant: empty.action.href === NEW_LEAD_HREF ? "default" : "outline" }),
                        "pointer-coarse:min-h-10",
                      )}
                    >
                      {empty.action.href === NEW_LEAD_HREF ? <Plus aria-hidden="true" /> : null}
                      {empty.action.label}
                    </Link>
                  ) : undefined
                }
              />
            </div>
          )
        ) : (
          <div className="flex flex-col">
            {selected.size > 0 ? (
              <LeadsBulkBar
                count={selected.size}
                isAdmin={viewer.isAdmin}
                busy={busy}
                onConvert={startConvert}
                assign={{ members: data.members, ownerIds: ticked.map((row) => row.ownerId), viewer, onPick: (id) => void assign(id) }}
                onArchive={() => void archive()}
                onDelete={() => {
                  setToDelete({ ids: ticked.map((row) => row.id), titles: ticked.map((row) => row.title) });
                  setDeleteOpen(true);
                }}
                onClear={() => setSelected(new Set())}
              />
            ) : null}
            <div className="relative overflow-x-auto rounded-[10px] border bg-card">
              {shownIds.length > 0 ? (
                // Phones hide the table head, so its select-all box sits here above the cards.
                <label className="flex cursor-pointer items-center gap-3 border-b px-3 py-2.5 text-[13px] sm:hidden">
                  <SelectAllBox state={selection} onToggle={toggleAll} />
                  <span>{SELECT_ALL_LABEL}</span>
                </label>
              ) : null}
              <table aria-label="Leads" className="w-full border-collapse text-[13px] max-sm:block">
                <thead className="max-sm:hidden">
                  <tr>
                    <th className={cn(HEAD, "w-px")}>
                      {shownIds.length > 0 ? (
                        <span className="flex">
                          <SelectAllBox state={selection} onToggle={toggleAll} />
                        </span>
                      ) : (
                        <span className="sr-only">Select</span>
                      )}
                    </th>
                    <th className={HEAD}>Lead</th>
                    <th className={HEAD}>Source</th>
                    <th className={HEAD}>Created</th>
                    <th className={HEAD}>Owner</th>
                    <th className={HEAD}>Next step</th>
                  </tr>
                </thead>
                <tbody className="max-sm:block">
                  {page.rows.map((row) => (
                    <LeadRowView
                      key={row.id}
                      row={row}
                      selected={selected.has(row.id)}
                      now={now}
                      ownerName={ownerNames.get(row.ownerId) ?? null}
                      onToggle={toggle}
                      selectable={canChangeDeal(viewer, row)}
                      href={leadHref(row.id)}
                      onOpen={openLead}
                    />
                  ))}
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
        {inboxZero ? null : <p className="mt-2.5 text-[13px] text-muted-foreground">{inboxFooterLine(data.assignment, viewer.isAdmin)}</p>}
      </div>

      <NewLeadDialog
        open={newOpen}
        onOpenChange={setNewLead}
        members={data.members}
        viewer={viewer}
        assignment={data.assignment}
        onCreated={() => refreshAfterWrite(router)}
      />
      <ConvertDialog open={convertOpen} onOpenChange={setConvertOpen} leads={toConvert} onConverted={converted} />
      <DeleteLeadsDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        titles={toDelete.titles}
        deleting={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

/** The ids of the shown leads the viewer may change (their own, or any for an admin): only these get a tick box. */
function editableIds(rows: readonly LeadRow[], viewer: Viewer): string[] {
  return rows.flatMap((row) => (canChangeDeal(viewer, row) ? [row.id] : []));
}

/**
 * One Inbox lead: a table row on wider screens, a stacked card with labels
 * under 640px. A ticked row sits on the accent fill, so every grey word in it
 * uses MUTED_TEXT (4.5:1 there in light, P2-R14). A click anywhere opens the
 * lead; the title is the real link.
 */
export function LeadRowView({
  row,
  selected,
  now,
  ownerName,
  onToggle,
  selectable,
  href,
  onOpen,
}: {
  row: LeadRow;
  selected: boolean;
  now: Date;
  /** The owner's full name, or null when they are no longer in Sales. */
  ownerName: string | null;
  onToggle: (id: string) => void;
  /** Only the owner or an admin may tick a lead (bulk changes would refuse it anyway). */
  selectable: boolean;
  /** The Inbox with this lead's panel open. */
  href: string;
  onOpen: (id: string) => void;
}) {
  const days = leadAgeDays(row.createdAt, now);
  const subLine = leadSubLine(row);
  const owner = ownerName ?? "No longer in Sales";

  return (
    <tr
      onClick={() => onOpen(row.id)}
      className={cn(
        "cursor-pointer border-b transition-colors last:border-b-0 max-sm:relative max-sm:block max-sm:py-2.5 max-sm:pr-3 max-sm:pl-10",
        selected ? "bg-accent" : "hover:bg-muted/50",
      )}
    >
      {/* Ticking never opens the lead. */}
      <td
        onClick={(event) => event.stopPropagation()}
        className="w-px cursor-default px-3 py-[9px] align-middle max-sm:absolute max-sm:top-3 max-sm:left-3 max-sm:p-0"
      >
        {selectable ? (
          <span className="flex">
            <TickBox label={`Select ${row.title}`} checked={selected} onCheckedChange={() => onToggle(row.id)} />
          </span>
        ) : null}
      </td>
      <td className={cn(CELL, "font-semibold")}>
        <Link
          href={href}
          scroll={false}
          // The lead panel finds its way back here by this id when it closes.
          data-lead-id={row.id}
          onClick={(event) => event.stopPropagation()}
          // A plain click opens the panel like the row does (no page reload); Ctrl or Cmd still opens a tab.
          onNavigate={(event) => {
            event.preventDefault();
            onOpen(row.id);
          }}
          className="rounded-sm [overflow-wrap:anywhere] outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {row.title}
        </Link>
        {subLine ? <span className={cn("block text-xs font-normal [overflow-wrap:anywhere]", MUTED_TEXT)}>{subLine}</span> : null}
      </td>
      <td className={cn(CELL, "sm:whitespace-nowrap")}>
        <RowLabel>Source:</RowLabel>
        {row.source}
      </td>
      <td className={cn(CELL, "whitespace-nowrap", MUTED_TEXT)}>
        <RowLabel>Created:</RowLabel>
        {dayLabel(new Date(row.createdAt), now)}
        {isOldLead(days) ? <span className={cn(PILL, "ml-1.5 bg-status-warning text-status-warning-foreground")}>{days}d old</span> : null}
      </td>
      <td className={cn(CELL, "whitespace-nowrap")}>
        <RowLabel>Owner:</RowLabel>
        <span className="inline-flex items-center gap-1.5 align-middle">
          <OwnerAvatar id={row.ownerId} name={owner} />
          {/* Tablets and small laptops show the avatar only; the name stays for screen readers (Mockup v2). */}
          <span className={cn(MUTED_TEXT, "sm:max-[1100px]:sr-only")}>{ownerName ? shortName(ownerName) : owner}</span>
        </span>
      </td>
      <td className={CELL}>
        <RowLabel>Next:</RowLabel>
        <NextStepPill next={row.next} now={now} />
      </td>
    </tr>
  );
}

/** "Source:" and the like, shown only where rows are stacked cards. MUTED_TEXT: it may sit on a ticked row. */
function RowLabel({ children }: { children: React.ReactNode }) {
  return <span className={cn("text-xs font-normal sm:hidden", MUTED_TEXT)}>{children} </span>;
}
