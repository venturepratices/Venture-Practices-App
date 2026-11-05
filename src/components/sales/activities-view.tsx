"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { CalendarCheck, Check } from "lucide-react";
import { toast } from "sonner";

import { activitiesEmptyState } from "@/lib/sales/activities-client";
import type { ActivitiesPageData, ActivityRow } from "@/lib/sales/activities-page";
import { activitiesQueryToSearch, type ActivitiesQuery } from "@/lib/sales/activities-query";
import { getActivitiesPage } from "@/lib/sales/api-client";
import { appendPage, canChangeDeal } from "@/lib/sales/board-client";
import { changePanelUrl, pageRendered, refreshAfterWrite } from "@/lib/sales/panel-url";
import { ACTIVITY_TYPE_LABELS, ACTIVITY_TYPES } from "@/lib/sales/constants";
import { dueLabel, shortName } from "@/lib/sales/format";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SEGMENT, SEGMENT_GROUP } from "@/components/sales/deals-toolbar";
import { ACTIVITY_ICONS, NextStepPill, OwnerAvatar } from "@/components/sales/sales-pills";
import { ShortcutsButton } from "@/components/sales/shortcuts-help-dialog";
import { useActivityDone } from "@/components/sales/use-activity-done";

// The Activities page on the client (mockup `viewActivities`): the header with
// Everyone / Just me, the day and type filters, and the activities on deals the
// viewer may see. A filter replaces the URL (never with a page cursor); "Show
// more" appends the next page (Decision 33); a row opens its deal in the panel
// (`?deal=<id>` on this page, set with the history API so the list is not
// loaded again, panel-url.ts). The round check ticks an activity done and, when
// that leaves an open deal with nothing planned, asks for the next step. Under
// 640px each row becomes a stacked card with labels (mockup `.t.cards`).

type Viewer = { userId: string; isAdmin: boolean };
type ActivitiesPatch = Partial<Omit<ActivitiesQuery, "cursor">>;

const WHEN_OPTIONS = [
  { value: "open", label: "To do" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "done", label: "Done" },
] as const;

export function ActivitiesView({
  data,
  viewer,
  now: nowIso,
}: {
  data: ActivitiesPageData;
  viewer: Viewer;
  /** The server's clock for this render, so day colours match what the server filtered by. */
  now: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  // What the filters show: the server's query, or, while a change loads, the
  // one just asked for. A second click during the load builds on the first.
  const [controls, setControls] = useOptimistic(data.query);
  // Held here, not in the table: ticking the last row empties the list, and
  // the next-step prompt must outlive the table it was ticked in.
  const done = useActivityDone(() => refreshAfterWrite(router));
  const now = new Date(nowIso);
  // Each render from the server carries its own time: a new one means the list is fresh.
  useEffect(() => pageRendered(), [nowIso]);

  function navigate(patch: ActivitiesPatch) {
    const next: ActivitiesQuery = { ...controls, ...patch, cursor: null };
    const search = activitiesQueryToSearch(next);
    startTransition(() => {
      setControls(next);
      router.replace(search ? `?${search}` : pathname, { scroll: false });
    });
  }

  /** This page's URL with the deal panel open. */
  function dealHref(dealId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("deal", dealId);
    return `${pathname}?${params}`;
  }

  const empty = activitiesEmptyState(data.query);

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-2.5">
        <div>
          <h1 className="m-0 text-[21px] font-semibold">Activities</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Calls, meetings and tasks across all your deals.</p>
        </div>
        <div className="flex items-center gap-2">
          {data.canSeeEveryone ? (
            <div role="group" aria-label="Whose activities" className={SEGMENT_GROUP}>
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
          {/* No keyboard on a phone, so no shortcuts list there (as on the Deals toolbar). */}
          <ShortcutsButton className="max-sm:hidden" />
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2">
        <div role="group" aria-label="Which activities" className={SEGMENT_GROUP}>
          {WHEN_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={controls.when === option.value}
              onClick={() => controls.when !== option.value && navigate({ when: option.value })}
              className={SEGMENT}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Activity type" className={SEGMENT_GROUP}>
          <button
            type="button"
            aria-pressed={controls.type === "all"}
            onClick={() => controls.type !== "all" && navigate({ type: "all" })}
            className={SEGMENT}
          >
            All
          </button>
          {ACTIVITY_TYPES.map((type) => {
            const Icon = ACTIVITY_ICONS[type];
            return (
              <button
                key={type}
                type="button"
                aria-label={ACTIVITY_TYPE_LABELS[type]}
                title={ACTIVITY_TYPE_LABELS[type]}
                aria-pressed={controls.type === type}
                onClick={() => controls.type !== type && navigate({ type })}
                className={SEGMENT}
              >
                <Icon aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>

      <div
        aria-busy={pending}
        className={cn("mt-3 transition-opacity duration-200", pending && "opacity-60 motion-reduce:opacity-80")}
      >
        {data.rows.length === 0 ? (
          <div className="rounded-[10px] border bg-card">
            <EmptyState
              icon={CalendarCheck}
              title={empty.title}
              description={empty.description}
              action={
                <Link href={empty.action.href} className={cn(buttonVariants(), "pointer-coarse:min-h-10")}>
                  {empty.action.label}
                </Link>
              }
            />
          </div>
        ) : (
          <ActivitiesTable
            data={data}
            viewer={viewer}
            now={now}
            dealHref={dealHref}
            onOpen={(dealId) => changePanelUrl(dealHref(dealId), "push", router)}
            markDone={done.markDone}
          />
        )}
      </div>
      {done.dialogs}
    </div>
  );
}

const CELL = "px-3 py-[9px] align-middle max-sm:block max-sm:border-0 max-sm:px-0 max-sm:py-0.5";
const HEAD = "border-b bg-muted/40 px-3 py-[9px] text-left text-[11.5px] font-semibold whitespace-nowrap text-muted-foreground";

/** "Deal:" and the like, shown only where rows are stacked cards. */
function CardLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground sm:hidden">{children} </span>;
}

type ShownPage = { source: ActivitiesPageData; rows: ActivityRow[]; nextCursor: string | null; loading: boolean };

/**
 * Rows ticked here show as done at once. `sending` are still waiting for the
 * server. When a refresh brings new rows, only rows still sending stay ticked:
 * a done row has left the list, and a refused one comes back unticked.
 */
type Ticks = { source: ActivitiesPageData; shown: ReadonlySet<string>; sending: ReadonlySet<string> };

const NONE: ReadonlySet<string> = new Set();

function withId(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  return new Set(ids).add(id);
}

function withoutId(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids);
  next.delete(id);
  return next;
}

function ActivitiesTable({
  data,
  viewer,
  now,
  dealHref,
  onOpen,
  markDone,
}: {
  data: ActivitiesPageData;
  viewer: Viewer;
  now: Date;
  dealHref: (dealId: string) => string;
  onOpen: (dealId: string) => void;
  /** useActivityDone's markDone: ticks it, toasts, asks for a next step when needed, refreshes. */
  markDone: ReturnType<typeof useActivityDone>["markDone"];
}) {
  const ownerNames = new Map(data.members.map((member) => [member.id, member.name]));
  const tableRef = useRef<HTMLTableElement>(null);
  // The check that takes keyboard focus once a ticked row leaves the list.
  const focusAfterTick = useRef<string | null>(null);

  // The rows shown and the next cursor start again from the server's first
  // page whenever it sends a new one (a filter change or a refresh), adjusted
  // during render rather than in an effect.
  const [page, setPage] = useState<ShownPage>({ source: data, rows: data.rows, nextCursor: data.nextCursor, loading: false });
  if (page.source !== data) {
    setPage({ source: data, rows: data.rows, nextCursor: data.nextCursor, loading: false });
  }
  const [ticks, setTicks] = useState<Ticks>({ source: data, shown: NONE, sending: NONE });
  if (ticks.source !== data) {
    setTicks({ source: data, shown: new Set([...ticks.shown].filter((id) => ticks.sending.has(id))), sending: ticks.sending });
  }

  // A ticked row that left the list took keyboard focus with it: hand it to
  // the row that took its place, so ticking down the list needs no mouse.
  useEffect(() => {
    const id = focusAfterTick.current;
    if (!id) return;
    focusAfterTick.current = null;
    if (document.activeElement && document.activeElement !== document.body) return;
    tableRef.current?.querySelector<HTMLElement>(`[data-activity-check="${CSS.escape(id)}"]`)?.focus();
  }, [page.rows]);

  async function tick(row: ActivityRow) {
    if (ticks.shown.has(row.id)) return;
    const index = page.rows.findIndex((candidate) => candidate.id === row.id);
    focusAfterTick.current = (page.rows[index + 1] ?? page.rows[index - 1])?.id ?? null;
    setTicks((current) => ({ ...current, shown: withId(current.shown, row.id), sending: withId(current.sending, row.id) }));
    await markDone({ id: row.id, subject: row.subject }, { id: row.deal.id, title: row.deal.title });
    setTicks((current) => ({ ...current, sending: withoutId(current.sending, row.id) }));
  }

  async function showMore() {
    const { source, nextCursor } = page;
    if (!nextCursor || page.loading) return;
    setPage((current) => (current.source === source ? { ...current, loading: true } : current));
    const result = await getActivitiesPage({ ...source.query, cursor: nextCursor });
    if (!result.ok) toast.error(result.error);
    // A page that arrives after the list was replaced belongs to the old filters: drop it.
    setPage((current) => {
      if (current.source !== source) return current;
      if (!result.ok) return { ...current, loading: false };
      return {
        ...current,
        rows: appendPage(current.rows, result.data.rows),
        nextCursor: result.data.nextCursor,
        loading: false,
      };
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-x-auto rounded-[10px] border bg-card">
        <table ref={tableRef} aria-label="Activities" className="w-full border-collapse text-[13px] max-sm:block">
          <thead className="max-sm:hidden">
            <tr>
              <th className={cn(HEAD, "w-px")}>Done</th>
              <th className={HEAD}>Subject</th>
              <th className={HEAD}>Deal</th>
              <th className={HEAD}>Due</th>
              <th className={HEAD}>Owner</th>
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {page.rows.map((row) => {
              const ownerName = ownerNames.get(row.ownerId);
              const owner = ownerName ?? "No longer in Sales";
              const dealOwnerName = ownerNames.get(row.deal.ownerId);
              const canEdit = canChangeDeal(viewer, row.deal);
              const ticked = ticks.shown.has(row.id);
              const Icon = ACTIVITY_ICONS[row.type];
              // The hover tint stays at 50%: over 4.5:1 for the row's grey text in light (K3).
              return (
                <tr
                  key={row.id}
                  onClick={() => onOpen(row.deal.id)}
                  className={cn(
                    "cursor-pointer border-b transition-[background-color,opacity] duration-150 last:border-b-0 hover:bg-muted/50 max-sm:relative max-sm:block max-sm:py-2.5 max-sm:pr-3 max-sm:pl-10",
                    ticked && "opacity-60",
                  )}
                >
                  {/* 10px above and below: the check's 40px hit area fits the cell exactly (rows are 40px for the avatar anyway). */}
                  <td className="w-px px-3 py-2.5 align-middle max-sm:absolute max-sm:top-3 max-sm:left-3 max-sm:p-0">
                    {row.doneAt ? (
                      <span className="inline-flex items-center rounded-full bg-status-success px-[7px] py-0.5 text-status-success-foreground">
                        <Check aria-hidden="true" className="size-3" strokeWidth={3} />
                        <span className="sr-only">Done</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        data-activity-check={row.id}
                        aria-label={`Mark done: ${row.subject}`}
                        aria-disabled={!canEdit || ticked || undefined}
                        title={
                          canEdit
                            ? undefined
                            : `Only ${dealOwnerName ? shortName(dealOwnerName) : "the deal owner"} or an admin can mark this done.`
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          if (canEdit) void tick(row);
                        }}
                        // A 40px hit area around the 20px circle; the negative margin keeps the row as short as the mockup's.
                        className="group/check -m-2.5 flex size-10 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:cursor-default"
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex size-5 items-center justify-center rounded-full border-2 border-input text-transparent transition-[color,background-color,border-color,scale] duration-150 ease-out motion-reduce:transition-none",
                            canEdit && !ticked &&
                              "group-hover/check:border-green-600 group-hover/check:text-green-600 group-active/check:scale-90",
                            ticked && "border-green-700 bg-green-700 text-white",
                            !canEdit && "opacity-50",
                          )}
                        >
                          <Check className="size-3" strokeWidth={3} />
                        </span>
                      </button>
                    )}
                  </td>
                  <td className={cn(CELL, "max-sm:font-semibold")}>
                    <span className="inline-flex max-w-full items-center gap-[7px]">
                      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      <span className={cn("min-w-0 [overflow-wrap:anywhere]", ticked && "line-through")}>
                        <span className="sr-only">{ACTIVITY_TYPE_LABELS[row.type]}: </span>
                        {row.subject}
                      </span>
                    </span>
                  </td>
                  <td className={CELL}>
                    <CardLabel>Deal:</CardLabel>
                    <Link
                      href={dealHref(row.deal.id)}
                      scroll={false}
                      onClick={(event) => event.stopPropagation()}
                      // A plain click opens the panel like the row does (no page reload); Ctrl or Cmd still opens a tab.
                      onNavigate={(event) => {
                        event.preventDefault();
                        onOpen(row.deal.id);
                      }}
                      className="rounded-sm [overflow-wrap:anywhere] outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {row.deal.title}
                    </Link>
                  </td>
                  <td className={CELL}>
                    <CardLabel>Due:</CardLabel>
                    {row.doneAt ? (
                      // When it was due, then when it was done (C7): the Done list reads late or on time at a glance.
                      <>
                        {dueLabel(new Date(row.dueAt), row.hasTime, now)}
                        <span className="text-muted-foreground"> · Done {dueLabel(new Date(row.doneAt), true, now)}</span>
                      </>
                    ) : (
                      <NextStepPill next={{ type: row.type, dueAt: row.dueAt, hasTime: row.hasTime }} now={now} />
                    )}
                  </td>
                  <td className={CELL}>
                    <CardLabel>Owner:</CardLabel>
                    <span className="inline-flex items-center gap-1.5 align-middle">
                      <OwnerAvatar id={row.ownerId} name={owner} />
                      {/* Initials alone are hard to read on a card; the name sits beside them there. */}
                      <span className="text-muted-foreground sm:hidden">{ownerName ? shortName(ownerName) : owner}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {page.nextCursor ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={showMore} disabled={page.loading} className="pointer-coarse:min-h-10">
            {page.loading ? "Loading" : "Show more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
