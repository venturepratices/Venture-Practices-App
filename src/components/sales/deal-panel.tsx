"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useId, useRef, useState, useTransition } from "react";
import { Flag, Lock, SearchX, TriangleAlert, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { getDealPanel, getDealTimeline } from "@/lib/sales/api-client";
import { appendPage } from "@/lib/sales/board-client";
import type { DealPanelData } from "@/lib/sales/deal-panel";
import { shortName } from "@/lib/sales/format";
import { DEAL_PANEL_SHEET_CLASS, dealPanelOpen } from "@/lib/sales/panel-client";
import type { TimelineCursor } from "@/lib/sales/timeline";
import { cn, endOfDay, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityComposer, type ComposerHandle } from "@/components/sales/activity-composer";
import { DealDetails } from "@/components/sales/deal-details";
import { DealHistory, type HistoryState } from "@/components/sales/deal-history";
import { DealPanelHeader, PanelCloseButton } from "@/components/sales/deal-panel-header";
import { NextSteps } from "@/components/sales/next-steps";
import { useActivityDone } from "@/components/sales/use-activity-done";
import { useDealMoves, type MovableDeal } from "@/components/sales/use-deal-moves";

// The slide-in deal panel (mockup `renderPanel`), mounted once by the Sales
// layout and opened by `?deal=<id>` on any Sales page, like the task panel's
// `?taskId=`. Full screen on phones, 560px from the right on larger screens
// (Decision 5). It loads the deal and the first page of its history from the
// Sales routes, and after every change it saves, it loads both again and
// refreshes the page behind it. Closing (Esc, the overlay, the close button)
// takes `deal` out of the URL and puts focus back on the deal's card.

export function DealPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dealId = searchParams.get("deal");
  // "Add activity" in a card's menu opens the panel on the Activity composer.
  const startInComposer = searchParams.get("compose") === "activity";
  const titleId = useId();

  // The last deal shown stays rendered while the panel slides away.
  const [shownId, setShownId] = useState(dealId);
  if (dealId !== null && dealId !== shownId) setShownId(dealId);
  // Closing hides the panel at once (`closing` turns true straight away); the
  // URL catches up when the server answers. `closing` ends when the router
  // settles, also when a reopen of the same deal (a click on its card while
  // the close was on its way) replaced the close, so that deal opens again.
  const [closing, startClosing] = useTransition();
  const open = dealPanelOpen(dealId, closing);

  function close() {
    if (dealId === null) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("deal");
    params.delete("compose");
    const search = params.toString();
    startClosing(() => router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false }));
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        // A toast's Undo sits outside the panel; pressing it must not close the panel.
        const target = details.event?.target;
        if (details.reason === "outside-press" && target instanceof Element && target.closest("[data-sonner-toaster]")) {
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
        // Back to the deal's card, found again by id: a stage change re-draws it in another column.
        finalFocus={() => dealCard(shownId)}
        className={cn(DEAL_PANEL_SHEET_CLASS, "ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none")}
      >
        {shownId ? (
          <DealPanelBody key={shownId} dealId={shownId} titleId={titleId} startInComposer={startInComposer} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** The board card for a deal, or null (Base UI then returns focus to whatever had it before). */
function dealCard(dealId: string | null): HTMLElement | null {
  if (!dealId || typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(`[data-deal-id="${CSS.escape(dealId)}"]`);
}

/** The deal and the first page of its history, asked for together. */
function fetchDeal(dealId: string) {
  return Promise.all([getDealPanel(dealId), getDealTimeline(dealId, null)]);
}

type Loaded = Awaited<ReturnType<typeof fetchDeal>>;

type PanelLoad =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: DealPanelData; now: Date };

const BODY = "flex min-h-0 flex-1 flex-col gap-3.5 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-3.5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-[18px]";

function DealPanelBody({ dealId, titleId, startInComposer }: { dealId: string; titleId: string; startInComposer: boolean }) {
  const router = useRouter();
  const [load, setLoad] = useState<PanelLoad>({ kind: "loading" });
  const [history, setHistory] = useState<HistoryState>({ status: "loading" });
  const [cursor, setCursor] = useState<TimelineCursor | null>(null);
  // Each load takes a ticket; only the newest one's answer is shown.
  const latestLoad = useRef(0);
  const hasData = useRef(false);
  const composerRef = useRef<ComposerHandle>(null);
  const composeHandled = useRef(false);

  async function reload() {
    const ticket = ++latestLoad.current;
    const [panel, timeline] = await fetchDeal(dealId);
    showLoaded(ticket, panel, timeline);
  }

  function showLoaded(ticket: number, panel: Loaded[0], timeline: Loaded[1]) {
    if (ticket !== latestLoad.current) return;

    if (panel.ok) {
      hasData.current = true;
      setLoad({ kind: "ready", data: panel.data, now: new Date() });
    } else if (panel.status === 404) {
      // Deleted, or handed to someone whose deals this person cannot see.
      setLoad({ kind: "missing" });
      return;
    } else if (hasData.current) {
      // Keep showing what loaded before; the change itself was saved.
      toast.error(panel.error);
    } else {
      setLoad({ kind: "error", message: panel.error });
      return;
    }

    if (timeline.ok) {
      setHistory({ status: "ready", entries: timeline.data.entries, hasOlder: timeline.data.nextCursor !== null, loadingOlder: false });
      setCursor(timeline.data.nextCursor);
    } else {
      setHistory({ status: "error", message: timeline.error });
    }
  }

  const onLoaded = useEffectEvent((ticket: number, [panel, timeline]: Loaded) => showLoaded(ticket, panel, timeline));
  useEffect(() => {
    const ticket = ++latestLoad.current;
    void fetchDeal(dealId).then((loaded) => onLoaded(ticket, loaded));
  }, [dealId]);

  // Opened from "Add activity": go straight to the composer once the deal is showing.
  const ready = load.kind === "ready";
  useEffect(() => {
    if (!ready || !startInComposer || composeHandled.current) return;
    composeHandled.current = true;
    composerRef.current?.openActivity();
  }, [ready, startInComposer]);

  /** After every saved change: load the deal and its history again, and refresh the page behind. */
  function changed() {
    void reload();
    router.refresh();
  }

  async function showOlder() {
    if (history.status !== "ready" || !cursor || history.loadingOlder) return;
    const ticket = latestLoad.current;
    setHistory({ ...history, loadingOlder: true });
    const result = await getDealTimeline(dealId, cursor);
    // A reload since then started the history again from the top.
    if (ticket !== latestLoad.current) return;
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

  function retry() {
    setLoad({ kind: "loading" });
    setHistory({ status: "loading" });
    void reload();
  }

  const moves = useDealMoves(changed);
  const done = useActivityDone(changed);

  if (load.kind === "loading") return <PanelSkeleton titleId={titleId} />;

  if (load.kind === "missing" || load.kind === "error") {
    const missing = load.kind === "missing";
    return (
      <>
        <div className="flex flex-none justify-end px-4 pt-3 sm:px-[18px]">
          <PanelCloseButton />
        </div>
        <div role={missing ? undefined : "alert"} className="flex flex-1 flex-col justify-center pb-16">
          <span id={titleId} className="sr-only">
            {missing ? "This deal is not available." : "Could not load this deal."}
          </span>
          {missing ? (
            <EmptyState
              icon={SearchX}
              title="This deal is not available."
              description="It may have been deleted, or it belongs to someone whose deals you cannot see."
              action={
                <SheetClose render={<Button variant="outline" className="pointer-coarse:min-h-10" />}>Close</SheetClose>
              }
            />
          ) : (
            <EmptyState
              icon={TriangleAlert}
              title="Could not load this deal."
              description={load.message}
              action={
                <Button variant="outline" onClick={retry} className="pointer-coarse:min-h-10">
                  Try again
                </Button>
              }
            />
          )}
        </div>
      </>
    );
  }

  const { data, now } = load;
  const { deal, canEdit } = data;
  const stage = data.stages.find((option) => option.id === deal.stageId) ?? null;
  const movable: MovableDeal = {
    id: deal.id,
    title: deal.title,
    stageId: deal.stageId,
    valueCents: deal.valueCents,
    mrrCents: deal.mrrCents,
  };

  return (
    <>
      <DealPanelHeader data={data} now={now} moves={moves} titleId={titleId} onChanged={changed} />

      <div className={BODY}>
        {!canEdit ? (
          <Bar tone="info" icon={Lock}>
            Only {shortName(deal.owner.name)} or an admin can change this deal.
          </Bar>
        ) : null}

        {deal.status === "OPEN" && data.openActivities.length === 0 ? (
          <Bar
            tone="warning"
            icon={TriangleAlert}
            action={
              canEdit ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => composerRef.current?.openActivity()}
                  className="border-status-warning-foreground/30 bg-transparent text-status-warning-foreground hover:bg-status-warning-foreground/10 pointer-coarse:min-h-10"
                >
                  Schedule
                </Button>
              ) : null
            }
          >
            <strong className="font-semibold">No next step.</strong> Every open deal needs one.
          </Bar>
        ) : null}

        {data.territoryHold ? (
          <Bar tone="info" icon={Flag}>
            Territory hold ends{" "}
            <strong className="font-semibold">
              {formatDate(endOfDay(data.territoryHold.expiry), { month: "short", day: "numeric" })}
            </strong>
            . A hold check is on the calendar 7 days before.
          </Bar>
        ) : null}

        {canEdit ? <ActivityComposer ref={composerRef} dealId={deal.id} onSaved={changed} /> : null}

        <NextSteps
          activities={data.openActivities}
          now={now}
          canEdit={canEdit}
          onMarkDone={(activity) => done.markDone(activity, deal)}
        />

        <DealDetails data={data} onSaved={changed} onEditValue={() => stage && moves.editValue(movable, stage)} />

        <DealHistory
          history={history}
          now={now}
          onShowOlder={() => void showOlder()}
          onRetry={() => {
            setHistory({ status: "loading" });
            void reload();
          }}
          onSaved={changed}
        />
      </div>

      {/* Inside the panel, so these stack on top of it as nested dialogs. */}
      {moves.dialogs}
      {done.dialogs}
    </>
  );
}

/** The mockup's `.warnbar` (amber) and `.infobar` (accent) strip with an icon and an optional button on the right. */
function Bar({
  tone,
  icon: Icon,
  action,
  children,
}: {
  tone: "warning" | "info";
  icon: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-[9px] px-3 py-[9px] text-[13px]",
        tone === "warning" ? "bg-status-warning text-status-warning-foreground" : "bg-accent text-accent-foreground",
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <p className="m-0 min-w-0 flex-1">{children}</p>
      {action}
    </div>
  );
}

/** While the deal loads: the header's title, meta and stage bar, and three rows below, in their final places. */
function PanelSkeleton({ titleId }: { titleId: string }) {
  return (
    <>
      <div className="flex-none border-b px-4 pt-3 pb-3 sm:px-[18px] sm:pt-3.5" aria-busy="true">
        <span id={titleId} className="sr-only">
          Loading deal
        </span>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-3 w-40" />
          <PanelCloseButton />
        </div>
        <Skeleton className="mt-1.5 h-6 w-3/5" />
        <Skeleton className="mt-3 h-4 w-4/5" />
        <Skeleton className="mt-3 h-6 w-full rounded-[5px] pointer-coarse:h-10" />
        <Skeleton className="mt-[7px] h-3 w-1/2" />
      </div>
      <div className={BODY} aria-hidden="true">
        <Skeleton className="h-28 w-full rounded-[10px]" />
        <Skeleton className="h-12 w-full rounded-[9px]" />
        <Skeleton className="h-40 w-full rounded-[9px]" />
      </div>
    </>
  );
}
