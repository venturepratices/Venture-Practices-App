"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { ListFilter, Plus, SearchX, SquareKanban } from "lucide-react";

import { saveDefaultViewRequest } from "@/lib/sales/api-client";
import type { BoardPageData } from "@/lib/sales/board";
import { hasActiveFilters, nextBoardQuery, savedViewPatch, savedViewSummary } from "@/lib/sales/board-client";
import type { SavedBoardView } from "@/lib/sales/board-query";
import { boardQueryToSearch } from "@/lib/sales/board-query";
import { changePanelUrl, pageRendered, refreshAfterWrite } from "@/lib/sales/panel-url";
import type { SavedViewItem } from "@/lib/sales/view-preference";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DealsBoard } from "@/components/sales/deals-board";
import { DealsList } from "@/components/sales/deals-list";
import { DealsToolbar, type BoardPatch } from "@/components/sales/deals-toolbar";
import type { DealsViewer } from "@/components/sales/deal-quick-actions";
import { NewDealDialog } from "@/components/sales/new-deal-dialog";
import { useSalesShortcut } from "@/components/sales/sales-shortcuts";
import { SavedViewsMenu } from "@/components/sales/saved-views-menu";
import { useDealMoves } from "@/components/sales/use-deal-moves";

// The Deals page on the client: toolbar, board or list, and the dialogs. It
// fills the space under the top bar (the board scrolls sideways inside itself,
// never the page). Every toolbar change replaces the URL with nextBoardQuery,
// and a pipeline, view or scope change is also remembered for next time
// (Decision 13). A deal opens in the panel through `?deal=<id>`, set with the
// history API so browsing deals does not reload the board (panel-url.ts).

export function DealsView({
  data,
  viewer,
  openNew,
  now: nowIso,
  savedViews,
}: {
  data: BoardPageData;
  viewer: DealsViewer;
  /** `?new=1`: open Add deal straight away (the `n` key from another Sales page). */
  openNew: boolean;
  /** The server's clock for this render, so day colours match what the server filtered by. */
  now: string;
  /** This person's saved views with their summary lines (Decision 29). */
  savedViews: SavedViewItem[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [newDealOpen, setNewDealOpen] = useState(openNew);
  const moves = useDealMoves(() => refreshAfterWrite(router));
  // Each render from the server carries its own time: a new one means the board is fresh.
  useEffect(() => pageRendered(), [nowIso]);

  const now = new Date(nowIso);
  const { query } = data;
  // What the toolbar shows: the server's query (naming the pipeline it resolved
  // to), or, while a change loads, the query just asked for. A second click
  // during the load builds on the first instead of undoing it.
  const [controls, setControls] = useOptimistic({ ...query, pipeline: data.pipeline.key });
  const ownerNames = new Map(data.members.map((member) => [member.id, member.name]));
  const filtered = hasActiveFilters(query);
  const empty = data.totals.count === 0;

  function navigate(patch: BoardPatch) {
    const next = nextBoardQuery(controls, controls.pipeline, patch);
    startTransition(() => {
      setControls({ ...next, pipeline: next.pipeline ?? data.pipeline.key });
      router.replace(`?${boardQueryToSearch(next)}`, { scroll: false });
    });
    if (patch.pipeline !== undefined || patch.view !== undefined || patch.scope !== undefined) {
      void saveDefaultViewRequest({ pipeline: next.pipeline, view: next.view, scope: next.scope }).then((result) => {
        if (!result.ok) console.error("Could not save the Deals view:", result.error);
      });
    }
  }

  const clearFilters = () => navigate({ status: "open", next: "any", stage: null, q: "" });

  /** The stage key names a live stage of this pipeline: null when nothing is filtered or the key is stale. */
  const filteredStage = query.stage ? data.stages.find((stage) => stage.key === query.stage) ?? null : null;
  /** The summary line of the board right now, for the Save view dialog. */
  const currentSummary = savedViewSummary(
    { pipeline: query.pipeline, view: query.view, scope: query.scope, status: query.status, next: query.next, stage: query.stage, q: query.q },
    { pipeline: data.pipeline.name, stage: filteredStage?.name ?? null },
  );

  function applyView(view: SavedBoardView) {
    navigate(savedViewPatch(view, data.pipeline.key));
  }

  // Keep a local copy that matches the server's props by default; a save or
  // remove updates it at once so the menu shows the new list while the refresh
  // the write starts is still on its way (the deal panel's own pattern).
  const [savedViewsLocal, setSavedViewsLocal] = useState(savedViews);
  const [savedViewsShown, setSavedViewsShown] = useState(savedViews);
  if (savedViewsShown !== savedViews) {
    setSavedViewsShown(savedViews);
    setSavedViewsLocal(savedViews);
  }

  function onSavedViewsChanged(views: SavedBoardView[]) {
    const byName = new Map(savedViewsLocal.map((item) => [item.view.name, item]));
    setSavedViewsLocal(
      views.map((view) => {
        const existing = byName.get(view.name);
        return existing
          ? { view, summary: existing.summary }
          : {
              view,
              summary: savedViewSummary(view, {
                pipeline: data.pipelines.find((p) => p.key === view.pipeline)?.name ?? null,
                stage: view.pipeline && view.stage ? data.stages.find((s) => s.key === view.stage)?.name ?? null : null,
              }),
            };
      }),
    );
    refreshAfterWrite(router);
  }

  /** This page's URL with the deal panel open (and Add deal closed). */
  function dealHref(dealId: string, compose = false) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    params.set("deal", dealId);
    // Asks the panel to open on its Activity composer ("Add activity" in the card menu).
    if (compose) params.set("compose", "activity");
    else params.delete("compose");
    return `${pathname}?${params}`;
  }

  const openDeal = (dealId: string, compose = false) => changePanelUrl(dealHref(dealId, compose), "push", router);

  function setNewDeal(open: boolean) {
    setNewDealOpen(open);
    if (!open && searchParams.has("new")) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("new");
      const search = params.toString();
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    }
  }

  useSalesShortcut("new-deal", () => setNewDealOpen(true));

  function created(pipelineKey: string) {
    if (pipelineKey !== data.pipeline.key) navigate({ pipeline: pipelineKey });
    else refreshAfterWrite(router);
  }

  const addDealButton = (
    <Button onClick={() => setNewDealOpen(true)} className="pointer-coarse:min-h-10">
      <Plus aria-hidden="true" />
      Deal
    </Button>
  );
  // Nothing at all in this pipeline (not just filtered out): say so once, with the way to start.
  const justMine = query.scope === "mine" && data.canSeeEveryone;
  const pipelineEmpty =
    empty && !filtered ? (
      <EmptyState
        icon={SquareKanban}
        title={justMine ? `No deals of yours in ${data.pipeline.name} yet.` : `No deals in ${data.pipeline.name} yet.`}
        description={
          justMine ? "Add a deal by hand, or switch to Everyone to see the team's." : "Add a deal by hand to get started."
        }
        action={addDealButton}
        className="px-2"
      />
    ) : null;

  return (
    <div className="-m-4 flex h-[calc(100dvh-3.5rem)] min-w-0 flex-col md:-m-6">
      <h1 className="sr-only">Deals</h1>
      <DealsToolbar
        data={data}
        controls={controls}
        onNavigate={navigate}
        onNewDeal={() => setNewDealOpen(true)}
        onClearFilters={clearFilters}
        savedViewsSlot={
          <SavedViewsMenu
            items={savedViewsLocal}
            query={query}
            shownPipelineKey={data.pipeline.key}
            currentSummary={currentSummary}
            onApply={applyView}
            onSaved={onSavedViewsChanged}
          />
        }
      />

      {filteredStage ? (
        <div
          role="status"
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-4 py-2 text-[13px]"
        >
          <ListFilter aria-hidden="true" className="size-4 text-muted-foreground" />
          <span>
            Showing <b className="font-semibold">{filteredStage.name}</b> only.
          </span>
          <Button
            variant="link"
            size="sm"
            onClick={() => navigate({ stage: null })}
            className="h-auto px-0 pointer-coarse:min-h-10"
          >
            Show all stages
          </Button>
        </div>
      ) : null}

      {empty && filtered ? (
        <div
          role="status"
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-4 py-2 text-[13px]"
        >
          <SearchX aria-hidden="true" className="size-4 text-muted-foreground" />
          <span>No deals match these filters.</span>
          <Button variant="link" size="sm" onClick={clearFilters} className="h-auto px-0 pointer-coarse:min-h-10">
            Clear filters
          </Button>
        </div>
      ) : null}

      <div
        aria-busy={pending}
        className={cn(
          "flex min-h-0 flex-1 flex-col transition-opacity duration-200",
          pending && "opacity-60 motion-reduce:opacity-80",
        )}
      >
        {data.columns ? (
          <>
            <p className="shrink-0 px-4 pt-1.5 text-xs text-muted-foreground sm:hidden">
              Swipe sideways for more stages. Press and hold a deal to move it.
            </p>
            <DealsBoard
              columns={data.columns}
              now={now}
              viewer={viewer}
              ownerNames={ownerNames}
              moves={moves}
              onOpen={openDeal}
              onChanged={() => refreshAfterWrite(router)}
              onOpenList={() => navigate({ view: "list" })}
              emptyState={pipelineEmpty}
              filtered={filtered}
              justMine={justMine}
              onNewDeal={() => setNewDealOpen(true)}
            />
          </>
        ) : data.list ? (
          <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-6">
            {/* An empty filtered list has only the bar above; an empty pipeline gets its empty state. */}
            {empty ? (
              pipelineEmpty
            ) : (
              <DealsList
                list={data.list}
                query={query}
                pipelineKey={data.pipeline.key}
                now={now}
                ownerNames={ownerNames}
                dealHref={dealHref}
                onOpen={openDeal}
              />
            )}
          </div>
        ) : null}
      </div>

      {moves.dialogs}
      <NewDealDialog
        open={newDealOpen}
        onOpenChange={setNewDeal}
        pipelines={data.pipelines}
        currentPipelineId={data.pipeline.id}
        members={data.members}
        viewer={viewer}
        onCreated={created}
      />
    </div>
  );
}
