"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { getDealListPage } from "@/lib/sales/api-client";
import type { DealListPage } from "@/lib/sales/board";
import type { BoardQuery } from "@/lib/sales/board-query";
import { appendPage } from "@/lib/sales/board-client";
import { formatMoney, shortName } from "@/lib/sales/format";
import { Button } from "@/components/ui/button";
import { NextStepPill, OwnerAvatar } from "@/components/sales/sales-pills";

// The Deals list view (mockup list table): every deal matching the filters,
// most recently changed first, 50 at a time. "Show more" fetches the next page
// and appends it (Decision 33); the URL never carries a page. Under 640px each
// row becomes a stacked card with labels (mockup `.t.cards`).

const CELL = "px-3 py-[9px] align-middle max-sm:block max-sm:border-0 max-sm:px-0 max-sm:py-0.5";
const HEAD = "border-b bg-muted/40 px-3 py-[9px] text-left text-[11.5px] font-semibold whitespace-nowrap text-muted-foreground";

/** "Person:" and the like, shown only where rows are stacked cards. */
function CardLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground sm:hidden">{children} </span>;
}

type ShownPage = { source: DealListPage; rows: DealListPage["rows"]; nextCursor: string | null; loading: boolean };

export function DealsList({
  list,
  query,
  pipelineKey,
  now,
  ownerNames,
  dealHref,
  onOpen,
}: {
  list: DealListPage;
  query: BoardQuery;
  /** The pipeline the page resolved to, so "Show more" asks for the same one even from a bare /sales/deals. */
  pipelineKey: string;
  now: Date;
  ownerNames: Map<string, string>;
  dealHref: (dealId: string) => string;
  onOpen: (dealId: string) => void;
}) {
  // The rows shown and the next cursor start again from the server's first
  // page whenever it sends a new one (a filter change or a refresh), adjusted
  // during render rather than in an effect.
  const [page, setPage] = useState<ShownPage>({ source: list, rows: list.rows, nextCursor: list.nextCursor, loading: false });
  if (page.source !== list) {
    setPage({ source: list, rows: list.rows, nextCursor: list.nextCursor, loading: false });
  }

  async function showMore() {
    const { source, nextCursor } = page;
    if (!nextCursor || page.loading) return;
    setPage((current) => (current.source === source ? { ...current, loading: true } : current));
    const result = await getDealListPage({ ...query, pipeline: pipelineKey, cursor: nextCursor });
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
      <div className="overflow-x-auto rounded-[10px] border bg-card">
        <table className="w-full border-collapse text-[13px] max-sm:block">
          <thead className="max-sm:hidden">
            <tr>
              <th className={HEAD}>
                <span className="sr-only">Owner</span>
              </th>
              <th className={HEAD}>Deal</th>
              <th className={HEAD}>Person</th>
              <th className={HEAD}>Stage</th>
              <th className={HEAD}>Value</th>
              <th className={HEAD}>Next activity</th>
              <th className={HEAD}>Owner</th>
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {page.rows.map((row) => {
              const ownerName = ownerNames.get(row.ownerId);
              const owner = ownerName ?? "No longer in Sales";
              return (
                <tr
                  key={row.id}
                  onClick={() => onOpen(row.id)}
                  className="cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/60 max-sm:relative max-sm:block max-sm:py-2.5 max-sm:pr-3 max-sm:pl-10"
                >
                  <td className="w-px px-3 py-[9px] align-middle max-sm:absolute max-sm:top-3 max-sm:left-3 max-sm:p-0">
                    <OwnerAvatar id={row.ownerId} name={owner} />
                  </td>
                  <td className={`${CELL} font-semibold`}>
                    <Link
                      href={dealHref(row.id)}
                      scroll={false}
                      onClick={(event) => event.stopPropagation()}
                      className="rounded-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {row.title}
                    </Link>
                  </td>
                  <td className={CELL}>
                    <CardLabel>Person:</CardLabel>
                    {row.personName ?? <span className="text-muted-foreground">None</span>}
                  </td>
                  <td className={CELL}>
                    <CardLabel>Stage:</CardLabel>
                    {row.stageName}
                  </td>
                  <td className={`${CELL} tabular-nums`}>
                    <CardLabel>Value:</CardLabel>
                    {formatMoney(row.valueCents)}
                  </td>
                  <td className={CELL}>
                    <CardLabel>Next:</CardLabel>
                    <NextStepPill next={row.next} now={now} />
                  </td>
                  <td className={`${CELL} text-muted-foreground`}>
                    <CardLabel>Owner:</CardLabel>
                    {ownerName ? shortName(ownerName) : owner}
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
