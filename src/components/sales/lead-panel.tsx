"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, useTransition } from "react";
import { Archive, ArrowRightLeft, Building2, Check, Lock, SearchX, TriangleAlert, User, X } from "lucide-react";
import { toast } from "sonner";

import { getLeadPanel, getLeadTimeline, setLeadArchivedRequest, updateLeadRequest, type ApiResult } from "@/lib/sales/api-client";
import { appendPage } from "@/lib/sales/board-client";
import { TITLE_MAX } from "@/lib/sales/constants";
import { leadCameIn, leadNotice, leadReadOnlyLine, lockNotes, type LeadNotice } from "@/lib/sales/convert-client";
import { endSentence, shortName } from "@/lib/sales/format";
import type { LeadPanelData } from "@/lib/sales/lead-panel";
import { bulkToast, isOldLead, leadAgeDays } from "@/lib/sales/leads-client";
import { DEAL_PANEL_SHEET_CLASS } from "@/lib/sales/panel-client";
import { activePanel, changePanelUrl, panelHref, refreshAfterWrite } from "@/lib/sales/panel-url";
import type { TimelineCursor, TimelinePage } from "@/lib/sales/timeline";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityComposer, type ComposerHandle } from "@/components/sales/activity-composer";
import { ConvertDialog, type ConvertLead, type ConvertResult } from "@/components/sales/convert-dialog";
import { DealHistory, type HistoryState } from "@/components/sales/deal-history";
import { PanelCloseButton } from "@/components/sales/deal-panel-header";
import { NoticeBar, PANEL_BODY } from "@/components/sales/deal-panel";
import { LeadDetails } from "@/components/sales/lead-details";
import { NextSteps } from "@/components/sales/next-steps";
import { OwnerAvatar } from "@/components/sales/sales-pills";
import { useActivityDone } from "@/components/sales/use-activity-done";

// The slide-in lead panel (Mockup v2 `#s=lead-open`, Decision 9), mounted once
// by the Sales layout beside the deal panel and opened by `?lead=<id>` on any
// Sales page. It follows the deal panel: the same Sheet and width, the same
// load states, the same guard for a toast's Undo. Header: "Leads Inbox", the
// name (edited in place), person, organization, owner and "Convert to deal".
// Body: a notice (no next step, converted, archived), the composer (Activity,
// Note), Next steps, Details and History. The lead owner or an admin changes
// an open lead; everyone else, and every converted or archived lead, reads
// it. It carries no deal-panel mark, so the Sales shortcuts stay off inside
// it (A11). After every saved change it loads the lead and its history again
// and refreshes the page behind it.

export function LeadPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // One panel at a time: a deal named in the same URL wins (Decision 35).
  const target = activePanel(searchParams);
  const leadId = target?.kind === "lead" ? target.id : null;
  const titleId = useId();

  // The last lead shown stays rendered while the panel slides away.
  const [shownId, setShownId] = useState(leadId);
  if (leadId !== null && leadId !== shownId) setShownId(leadId);
  // As in the deal panel: closing hides the panel at once, and the URL catches up.
  const [closing, startClosing] = useTransition();
  const open = leadId !== null && !closing;

  function close() {
    if (leadId === null) return;
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
        // Back to the lead's row (Leads Inbox, Activities, the dashboard), found again by id.
        finalFocus={() => leadRow(shownId)}
        className={cn(DEAL_PANEL_SHEET_CLASS, "ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none")}
      >
        {shownId ? <LeadPanelLoader key={shownId} leadId={shownId} titleId={titleId} onClose={close} /> : null}
      </SheetContent>
    </Sheet>
  );
}

/** The first link to this lead on the page, or null (Base UI then returns focus to whatever had it before). */
function leadRow(leadId: string | null): HTMLElement | null {
  if (!leadId || typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(`[data-lead-id="${CSS.escape(leadId)}"]`);
}

type PanelLoad =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: LeadPanelData; now: Date };

/** Loads the lead, shows its loading, missing and error states, and the panel once it is here. */
function LeadPanelLoader({ leadId, titleId, onClose }: { leadId: string; titleId: string; onClose: () => void }) {
  const router = useRouter();
  const [load, setLoad] = useState<PanelLoad>({ kind: "loading" });
  // Each load takes a ticket; only the newest one's answer is shown.
  const latestLoad = useRef(0);
  const hasData = useRef(false);

  function show(ticket: number, result: ApiResult<LeadPanelData>) {
    if (ticket !== latestLoad.current) return;
    if (result.ok) {
      hasData.current = true;
      setLoad({ kind: "ready", data: result.data, now: new Date() });
    } else if (result.status === 404) {
      // Deleted, or handed to someone whose leads this person cannot see.
      setLoad({ kind: "missing" });
    } else if (hasData.current) {
      // Keep showing what loaded before; the change itself was saved.
      toast.error(result.error);
    } else {
      setLoad({ kind: "error", message: result.error });
    }
  }

  async function reload() {
    const ticket = ++latestLoad.current;
    show(ticket, await getLeadPanel(leadId));
  }

  const onLoaded = useEffectEvent((ticket: number, result: ApiResult<LeadPanelData>) => show(ticket, result));
  useEffect(() => {
    const ticket = ++latestLoad.current;
    void getLeadPanel(leadId).then((result) => onLoaded(ticket, result));
  }, [leadId]);

  /** After every saved change: load the lead again, and refresh the page behind. */
  function changed() {
    void reload();
    refreshAfterWrite(router);
  }

  if (load.kind === "loading") return <LeadPanelSkeleton titleId={titleId} />;

  if (load.kind === "missing" || load.kind === "error") {
    const missing = load.kind === "missing";
    return (
      <>
        <div className="flex flex-none justify-end px-4 pt-3 sm:px-[18px]">
          <PanelCloseButton />
        </div>
        <div role={missing ? undefined : "alert"} className="flex flex-1 flex-col justify-center pb-16">
          <span id={titleId} className="sr-only">
            {missing ? "This lead is not available." : "Could not load this lead."}
          </span>
          {missing ? (
            <EmptyState
              icon={SearchX}
              title="This lead is not available."
              description="It may have been deleted, or it belongs to someone whose leads you cannot see."
              action={
                <SheetClose render={<Button variant="outline" className="pointer-coarse:min-h-10" />}>Close</SheetClose>
              }
            />
          ) : (
            <EmptyState
              icon={TriangleAlert}
              title="Could not load this lead."
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

  return (
    <>
      {/* The panel's name. Pointing the panel at the name box would call it "Lead name" in Chrome. */}
      <h2 id={titleId} className="sr-only">
        {load.data.lead.title}
      </h2>
      <LeadPanelBody data={load.data} now={load.now} onChanged={changed} onClose={onClose} />
    </>
  );
}

const PILL = "inline-flex shrink-0 items-center gap-1 rounded-full px-[7px] py-0.5 text-[11px] leading-[1.4] font-semibold whitespace-nowrap [&_svg]:size-3";

/** A small button on a notice bar, in the bar's own ink (the deal panel's Schedule). */
const BAR_ACTION = {
  warning:
    "border-status-warning-foreground/30 bg-transparent text-status-warning-foreground hover:bg-status-warning-foreground/10 pointer-coarse:min-h-10",
  info: "border-accent-foreground/30 bg-transparent text-accent-foreground hover:bg-accent-foreground/10 pointer-coarse:min-h-10",
} as const;

/** The notice's icon by what the lead is: converted, archived, or open with no next step. */
const NOTICE_ICONS = { CONVERTED: ArrowRightLeft, ARCHIVED: Archive, OPEN: TriangleAlert } as const;

/**
 * The lead panel once the lead has loaded: header, notice, composer, Next
 * steps, Details and History, plus the convert dialog. History loads here,
 * and again each time the lead is loaded again after a change.
 */
export function LeadPanelBody({
  data,
  now,
  onChanged,
  onClose,
}: {
  data: LeadPanelData;
  now: Date;
  /** After a change is saved: load the lead again and refresh the page behind. */
  onChanged: () => void;
  /** Closes the panel (the header's close button). */
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { lead, canEdit } = data;
  const composerRef = useRef<ComposerHandle>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const done = useActivityDone(onChanged);

  const [history, setHistory] = useState<HistoryState>({ status: "loading" });
  const [cursor, setCursor] = useState<TimelineCursor | null>(null);
  const latestHistory = useRef(0);

  function showHistory(ticket: number, result: ApiResult<TimelinePage>) {
    if (ticket !== latestHistory.current) return;
    if (result.ok) {
      setHistory({ status: "ready", entries: result.data.entries, hasOlder: result.data.nextCursor !== null, loadingOlder: false });
      setCursor(result.data.nextCursor);
    } else {
      setHistory({ status: "error", message: result.error });
    }
  }

  function loadHistory() {
    const ticket = ++latestHistory.current;
    void getLeadTimeline(lead.id, null).then((result) => showHistory(ticket, result));
  }

  const onHistory = useEffectEvent((ticket: number, result: ApiResult<TimelinePage>) => showHistory(ticket, result));
  // Each load of the lead (a new `data`) brings its history again from the top; what shows stays until it lands.
  useEffect(() => {
    const ticket = ++latestHistory.current;
    void getLeadTimeline(data.lead.id, null).then((result) => onHistory(ticket, result));
  }, [data]);

  async function showOlder() {
    if (history.status !== "ready" || !cursor || history.loadingOlder) return;
    const ticket = latestHistory.current;
    setHistory({ ...history, loadingOlder: true });
    const result = await getLeadTimeline(lead.id, cursor);
    if (ticket !== latestHistory.current) return;
    if (!result.ok) {
      toast.error(result.error);
      setHistory((current) => (current.status === "ready" ? { ...current, loadingOlder: false } : current));
      return;
    }
    setHistory((current) =>
      current.status === "ready"
        ? { status: "ready", entries: appendPage(current.entries, result.data.entries), hasOlder: result.data.nextCursor !== null, loadingOlder: false }
        : current,
    );
    setCursor(result.data.nextCursor);
  }

  // A converted or archived lead's notes can no longer be edited (Task 6), so they offer no Edit.
  const shownHistory: HistoryState =
    history.status === "ready" ? { ...history, entries: lockNotes(history.entries, lead.status) } : history;

  async function restore() {
    if (restoring) return;
    setRestoring(true);
    const result = await setLeadArchivedRequest(lead.id, false);
    setRestoring(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast(bulkToast("restore", 1));
    onChanged();
  }

  const dealHref = (dealId: string) => panelHref(pathname, searchParams.toString(), { kind: "deal", id: dealId });

  function converted(result: ConvertResult) {
    if (!result.dealId) {
      onChanged();
      return;
    }
    // The deal takes the lead's place in the panel; the page behind comes back fresh with it.
    refreshAfterWrite(router);
    changePanelUrl(dealHref(result.dealId), "replace", router);
  }

  // The dialog keeps the lead as it was when it opened.
  const convertLeads = useMemo<ConvertLead[]>(
    () => [
      {
        id: data.lead.id,
        title: data.lead.title,
        personName: data.lead.person?.name ?? null,
        organizationName: data.lead.organization?.name ?? null,
        openActivities: data.openActivities,
      },
    ],
    [data],
  );

  const notice = leadNotice(data);

  return (
    <>
      <LeadPanelHeader data={data} now={now} onChanged={onChanged} onClose={onClose} onConvert={() => setConvertOpen(true)} />

      <div className={PANEL_BODY}>
        {notice ? (
          <Notice
            notice={notice}
            status={lead.status}
            dealHref={data.convertedDeal ? dealHref(data.convertedDeal.id) : null}
            restoring={restoring}
            onSchedule={() => composerRef.current?.openActivity()}
            onRestore={() => void restore()}
            onOpenDeal={(href) => changePanelUrl(href, "push", router)}
          />
        ) : null}

        {lead.status === "OPEN" && !canEdit ? (
          <p className="m-0 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <Lock aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="min-w-0">{leadReadOnlyLine(shortName(lead.owner.name))}</span>
          </p>
        ) : null}

        {canEdit ? <ActivityComposer ref={composerRef} parent={{ kind: "lead", id: lead.id }} onSaved={onChanged} /> : null}

        {/* A converted lead's open steps moved to its deal. */}
        {lead.status !== "CONVERTED" ? (
          <NextSteps
            activities={data.openActivities}
            now={now}
            canEdit={canEdit}
            onMarkDone={(activity) => done.markDone(activity, { kind: "lead", id: lead.id, title: lead.title })}
          />
        ) : null}

        <LeadDetails data={data} onSaved={onChanged} />

        <DealHistory
          history={shownHistory}
          now={now}
          onShowOlder={() => void showOlder()}
          onRetry={() => {
            setHistory({ status: "loading" });
            loadHistory();
          }}
          onSaved={onChanged}
        />
      </div>

      {/* Inside the panel, so these stack on top of it as nested dialogs. */}
      {done.dialogs}
      {canEdit ? <ConvertDialog open={convertOpen} onOpenChange={setConvertOpen} leads={convertLeads} onConverted={converted} /> : null}
    </>
  );
}

/** The notice bar at the top of the body, with its one action: Schedule, Restore or Open deal. */
function Notice({
  notice,
  status,
  dealHref,
  restoring,
  onSchedule,
  onRestore,
  onOpenDeal,
}: {
  notice: LeadNotice;
  status: LeadPanelData["lead"]["status"];
  dealHref: string | null;
  restoring: boolean;
  onSchedule: () => void;
  onRestore: () => void;
  onOpenDeal: (href: string) => void;
}) {
  const tone = notice.tone;
  let action: React.ReactNode = null;
  if (notice.action === "schedule") {
    action = (
      <Button size="sm" variant="outline" onClick={onSchedule} className={BAR_ACTION[tone]}>
        Schedule
      </Button>
    );
  } else if (notice.action === "restore") {
    action = (
      <Button size="sm" variant="outline" onClick={onRestore} disabled={restoring} className={BAR_ACTION[tone]}>
        Restore
      </Button>
    );
  } else if (notice.action === "open-deal" && dealHref) {
    action = (
      <Link
        href={dealHref}
        scroll={false}
        // The deal's panel takes the lead's place with no page load; Ctrl or Cmd still opens a tab.
        onNavigate={(event) => {
          event.preventDefault();
          onOpenDeal(dealHref);
        }}
        className={cn(buttonVariants({ size: "sm", variant: "outline" }), BAR_ACTION[tone])}
      >
        Open deal
      </Link>
    );
  }

  // "No next step." leads in bold (Mockup v2 `.warnbar b`).
  const [head, ...rest] = notice.text.split(/(?<=\.) /);
  const Icon = NOTICE_ICONS[status];

  return (
    <NoticeBar tone={tone} icon={Icon} action={action}>
      {tone === "warning" ? (
        <>
          <strong className="font-semibold">{head}</strong> {rest.join(" ")}
        </>
      ) : (
        notice.text
      )}
    </NoticeBar>
  );
}

/**
 * The top of the lead panel (Mockup v2 `leadPanel` `.ph`): "Leads Inbox", the
 * name (edited in place by the owner or an admin), the person and the
 * organization, the owner, and "Convert to deal"; then when it came in. On a
 * phone the meta row wraps and Convert takes its own line.
 */
function LeadPanelHeader({
  data,
  now,
  onChanged,
  onClose,
  onConvert,
}: {
  data: LeadPanelData;
  now: Date;
  onChanged: () => void;
  onClose: () => void;
  onConvert: () => void;
}) {
  const { lead, canEdit } = data;
  const open = lead.status === "OPEN";
  const days = leadAgeDays(lead.createdAt, now);

  return (
    <header className="flex-none border-b px-4 pt-3 pb-3 sm:px-[18px] sm:pt-3.5">
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <p className="m-0 truncate">Leads Inbox</p>
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

      <LeadTitleInput leadId={lead.id} title={lead.title} canEdit={canEdit} onSaved={onChanged} />

      <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[13px]">
        {lead.status === "CONVERTED" ? (
          <span className={cn(PILL, "bg-status-success text-status-success-foreground")}>
            <Check aria-hidden="true" strokeWidth={3} />
            Converted
          </span>
        ) : null}

        <span className="inline-flex min-w-0 items-center gap-1.5">
          <User aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">Person: </span>
          {lead.person ? (
            <span className="truncate">{lead.person.name}</span>
          ) : (
            <span className="text-muted-foreground">{open ? "No person yet" : "No person"}</span>
          )}
        </span>

        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Building2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">Organization: </span>
          {lead.organization ? (
            <span className="truncate">{lead.organization.name}</span>
          ) : (
            <span className="text-muted-foreground">{open ? "No organization yet" : "No organization"}</span>
          )}
        </span>

        {canEdit ? (
          <LeadOwnerPicker data={data} onChanged={onChanged} />
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-flex">
              <OwnerAvatar id={lead.owner.id} name={lead.owner.name} />
            </span>
            <span className="sr-only">Owner: </span>
            {shortName(lead.owner.name)}
          </span>
        )}

        {canEdit ? (
          <span className="ml-auto flex max-sm:ml-0 max-sm:w-full">
            <Button size="sm" onClick={onConvert} className="max-sm:flex-1 pointer-coarse:min-h-10">
              Convert to deal
            </Button>
          </span>
        ) : null}
      </div>

      {open ? (
        <p className="mt-[7px] mb-0 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
          {leadCameIn(lead.createdAt, now)}
          {isOldLead(days) ? <span className={cn(PILL, "bg-status-warning text-status-warning-foreground")}>{days}d old</span> : null}
        </p>
      ) : null}
    </header>
  );
}

/**
 * The lead's name as a heading-sized box with no border until hover or focus,
 * as on the deal panel. Saved when the box is left or Enter is pressed, if it
 * changed and is not blank; Esc puts the saved name back (a second Esc closes
 * the panel).
 */
function LeadTitleInput({
  leadId,
  title,
  canEdit,
  onSaved,
}: {
  leadId: string;
  title: string;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  // A reload brought a different stored name: show it.
  const [stored, setStored] = useState(title);
  if (title !== stored) {
    setStored(title);
    setDraft(title);
  }

  async function commit() {
    const next = draft.trim();
    if (next === "") {
      setDraft(title);
      return;
    }
    if (next === title || saving) return;
    setSaving(true);
    const result = await updateLeadRequest(leadId, { title: next });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      setDraft(title);
      return;
    }
    onSaved();
  }

  return (
    <input
      aria-label="Lead name"
      value={draft}
      maxLength={TITLE_MAX}
      autoComplete="off"
      spellCheck={false}
      disabled={!canEdit}
      aria-disabled={!canEdit || undefined}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape" && draft !== title) {
          event.preventDefault();
          event.stopPropagation();
          setDraft(title);
        }
      }}
      className="mt-1 -ml-[3px] block w-[calc(100%+3px)] min-w-0 truncate rounded-[5px] border border-transparent bg-transparent px-[3px] py-px text-[19px] leading-snug font-semibold text-foreground outline-none transition-colors enabled:hover:border-input focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
    />
  );
}

/** The owner's avatar and a compact list of Sales members. A new owner takes the lead's open to-dos (Decision 12). */
function LeadOwnerPicker({ data, onChanged }: { data: LeadPanelData; onChanged: () => void }) {
  const { lead, members } = data;
  const [saving, setSaving] = useState(false);
  // Someone who lost Sales access can still own old leads; keep them in the list so the box names them.
  const options = members.some((member) => member.id === lead.owner.id) ? members : [lead.owner, ...members];
  const items = Object.fromEntries(options.map((member) => [member.id, shortName(member.name)]));

  async function change(next: unknown) {
    if (typeof next !== "string" || next === lead.owner.id || saving) return;
    setSaving(true);
    const result = await updateLeadRequest(lead.id, { ownerId: next });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast(endSentence(`Owner changed to ${items[next] ?? "the new owner"}`));
    onChanged();
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="inline-flex">
        <OwnerAvatar id={lead.owner.id} name={lead.owner.name} />
      </span>
      <Select items={items} value={lead.owner.id} onValueChange={(next) => void change(next)} disabled={saving}>
        <SelectTrigger aria-label="Owner" className="h-7 gap-1 px-1.5 text-[13px] disabled:opacity-100 pointer-coarse:h-10">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((member) => (
            <SelectItem key={member.id} value={member.id} className="pointer-coarse:min-h-10">
              {shortName(member.name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  );
}

/** While the lead loads: the header's crumb, name and meta, and three blocks below, in their final places. */
function LeadPanelSkeleton({ titleId }: { titleId: string }) {
  return (
    <>
      <div className="flex-none border-b px-4 pt-3 pb-3 sm:px-[18px] sm:pt-3.5" aria-busy="true">
        <span id={titleId} className="sr-only">
          Loading lead
        </span>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-3 w-24" />
          <PanelCloseButton />
        </div>
        <Skeleton className="mt-1.5 h-6 w-3/5" />
        <Skeleton className="mt-3 h-4 w-4/5" />
        <Skeleton className="mt-[9px] h-3 w-1/3" />
      </div>
      <div className={PANEL_BODY} aria-hidden="true">
        <Skeleton className="h-12 w-full rounded-[9px]" />
        <Skeleton className="h-28 w-full rounded-[10px]" />
        <Skeleton className="h-40 w-full rounded-[9px]" />
      </div>
    </>
  );
}
