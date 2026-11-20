"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { Download, PhoneMissed, Phone, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPillBase } from "@/components/ui/status-pill";
import { StatCard } from "@/components/ui/stat-card";
import {
  callsQueryToSearch,
  rangeLabel,
  type CallsQuery,
  type CallsRange,
  type CallsStatus,
} from "@/lib/calls/query";
import type { CallsListRow, CallsPageData } from "@/lib/calls/data";
import type { FilterItem } from "@/lib/calls/filter-match";
import { SearchableFilter } from "@/components/calls/searchable-filter";
import { TrackingNameEditor } from "@/components/calls/tracking-name-editor";

const RANGE_ITEMS: Array<{ value: CallsRange; label: string }> = [
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 14 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "This month" },
];

const STATUS_ITEMS: Array<{ value: CallsStatus; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "answered", label: "Answered only" },
  { value: "missed", label: "Missed only" },
  { value: "first", label: "First-time only" },
  { value: "repeat", label: "Repeat only" },
];

export function CallsView({
  data,
  query,
  now,
  lockedClient = false,
  canNameNumbers = false,
}: {
  data: CallsPageData;
  query: CallsQuery;
  now: string;
  /** On a client's own Calls tab the client is fixed, so the Client filter and column are hidden. */
  lockedClient?: boolean;
  /** Show "+ Add name" on each tracking number (people who can manage HighLevel). */
  canNameNumbers?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [range, setRange] = useOptimistic<CallsRange>(query.range);
  const [clientId, setClientId] = useOptimistic<string | null>(query.clientId);
  const [tracking, setTracking] = useOptimistic<string | null>(query.trackingNumber);
  const [status, setStatus] = useOptimistic<CallsStatus>(query.status);
  const [page, setPage] = useOptimistic<number>(query.page);

  function navigate(next: CallsQuery) {
    const search = callsQueryToSearch(next);
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  function change(patch: Partial<CallsQuery>, resetPage = true) {
    startTransition(() => {
      const next: CallsQuery = {
        range: patch.range ?? range,
        clientId: patch.clientId !== undefined ? patch.clientId : clientId,
        trackingNumber: patch.trackingNumber !== undefined ? patch.trackingNumber : tracking,
        status: patch.status ?? status,
        page: patch.page ?? (resetPage ? 1 : page),
      };
      setRange(next.range);
      setClientId(next.clientId);
      setTracking(next.trackingNumber);
      setStatus(next.status);
      setPage(next.page);
      navigate(next);
    });
  }

  const totalPages = Math.max(1, Math.ceil(data.totalRows / data.pageSize));
  const firstRow = data.totalRows === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const lastRow = Math.min(firstRow + data.rows.length - 1, data.totalRows);

  const totalClientCount = clientId ? 1 : data.clientOptions.length;

  const clientItems: FilterItem[] = data.clientOptions.map((c) => ({ value: c.id, label: c.name }));
  const trackingItems: FilterItem[] = data.trackingOptions.map((t) => ({
    value: t.number,
    label: `${t.label ?? "Unlabeled"} · ${formatPhone(t.number)}`,
    searchText: t.number,
  }));
  // A number in the address that is not in the list still shows as chosen.
  if (tracking && !trackingItems.some((i) => i.value === tracking)) {
    trackingItems.push({ value: tracking, label: formatPhone(tracking), searchText: tracking });
  }

  const exportHref = `/api/calls/export?${callsQueryToSearch({ ...query, page: 1 })}`;

  return (
    <div className={cn("space-y-6", pending && "opacity-90 transition-opacity")}>
      <header>
        {lockedClient ? null : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Reporting
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Calls</h1>
          </>
        )}
        <p className={cn("text-sm text-muted-foreground", lockedClient ? null : "mt-1")}>
          {rangeLabel(range)}
          {data.lastSyncedAt ? ` · updated ${timeAgo(data.lastSyncedAt, new Date(now))}` : ""}
        </p>
      </header>

      {/* Stat tiles */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total calls"
          tone="primary"
          icon={Phone}
          value={<span>{data.stats.totalCalls}</span>}
          trend={{ direction: "flat", label: `across ${totalClientCount} client${totalClientCount === 1 ? "" : "s"}` }}
        />
        <StatCard
          label="Answered"
          icon={Phone}
          value={<span className="text-status-success-foreground">{data.stats.answered}</span>}
          trend={{ direction: "flat", label: `${pct(data.stats.answered, data.stats.totalCalls)}% of calls` }}
        />
        <StatCard
          label="Missed"
          icon={PhoneMissed}
          value={<span className="text-status-warning-foreground">{data.stats.missed}</span>}
          trend={{ direction: "flat", label: `${pct(data.stats.missed, data.stats.totalCalls)}% of calls` }}
        />
        <StatCard
          label="First-time callers"
          value={<span>{data.stats.firstTimeCallers}</span>}
          trend={{ direction: "flat", label: `${data.stats.repeatCallers} repeat` }}
        />
      </section>

      {/* Filters */}
      <Card>
        <CardContent className={cn("grid gap-3 p-4 sm:grid-cols-2", lockedClient ? "lg:grid-cols-3" : "lg:grid-cols-4")}>
          {/* Every filter is type-to-search, so nobody scrolls to find one, and
              each shows the NAME ("Last 14 days", the client's name) and
              never the raw value ("14d", the client's id). */}
          <PlainField label="Date range">
            <SearchableFilter
              items={RANGE_ITEMS}
              value={range}
              onChange={(next) => {
                if (next) change({ range: next as CallsRange });
              }}
              placeholder="Date range"
              emptyText="No matching range."
              ariaLabel="Date range"
              allowClear={false}
            />
          </PlainField>
          {lockedClient ? null : (
            <PlainField label="Client">
              <SearchableFilter
                items={clientItems}
                value={clientId}
                onChange={(next) => change({ clientId: next })}
                placeholder={`All clients (${data.clientOptions.length})`}
                emptyText="No clients found."
                ariaLabel="Client"
              />
            </PlainField>
          )}
          <PlainField label="Tracking number">
            <SearchableFilter
              items={trackingItems}
              value={tracking}
              onChange={(next) => change({ trackingNumber: next })}
              placeholder="All numbers"
              emptyText="No numbers found."
              ariaLabel="Tracking number"
            />
          </PlainField>
          <PlainField label="Status">
            <SearchableFilter
              items={STATUS_ITEMS}
              value={status}
              onChange={(next) => {
                if (next) change({ status: next as CallsStatus });
              }}
              placeholder="Status"
              emptyText="No matching status."
              ariaLabel="Status"
              allowClear={false}
            />
          </PlainField>
        </CardContent>
      </Card>

      {/* Campaign breakdown */}
      {data.stats.byTrackingNumber.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-baseline justify-between">
              <CardTitle className="text-sm">Calls by tracking number</CardTitle>
              <span className="text-xs text-muted-foreground">Answered / total</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pb-4">
            {data.stats.byTrackingNumber.map((t) => {
              // Exact counts from each call's own status (a call that was
              // neither answered nor missed, like a voicemail, is in neither).
              const answeredInGroup = t.answered;
              const missedInGroup = t.missed;
              const maxCount = data.stats.byTrackingNumber[0]?.count ?? 1;
              const rowWidth = Math.max(10, Math.round((t.count / maxCount) * 100));
              const aPct = (answeredInGroup / t.count) * 100;
              const mPct = (missedInGroup / t.count) * 100;
              return (
                <div key={t.number}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <TrackingNameEditor
                      number={t.number}
                      label={t.label}
                      phoneText={formatPhone(t.number)}
                      canEdit={canNameNumbers && t.number !== "(unknown)"}
                    />
                    <div className="tabular-nums text-muted-foreground">
                      <span className="font-semibold text-foreground">{answeredInGroup}</span> / {t.count}
                    </div>
                  </div>
                  <div
                    className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-muted"
                    style={{ width: `${rowWidth}%` }}
                    aria-label={`${t.label ?? t.number}: ${answeredInGroup} answered, ${missedInGroup} missed`}
                  >
                    <div className="bg-primary" style={{ width: `${aPct}%` }} />
                    <div className="bg-amber-500 dark:bg-amber-400" style={{ width: `${mPct}%` }} />
                  </div>
                </div>
              );
            })}
            <div className="flex gap-4 border-t pt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-sm bg-primary" />
                Answered
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-sm bg-amber-500 dark:bg-amber-400" />
                Missed
              </span>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Call list */}
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-2 border-b pb-3">
          <CardTitle className="text-sm">All calls</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              {data.totalRows === 0 ? "No calls match these filters" : `Showing ${firstRow}–${lastRow} of ${data.totalRows}`}
            </span>
            <a
              href={exportHref}
              download
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Download className="size-3.5" />
              Export CSV
            </a>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {data.rows.length === 0 ? (
            <div className="p-10">
              <EmptyState
                icon={Phone}
                title="No calls in this window."
                description="Try a longer date range, a different client, or clearing the status filter."
              />
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <Th>Time</Th>
                      <Th>Caller</Th>
                      {lockedClient ? null : <Th>Client</Th>}
                      <Th>Tracking</Th>
                      <Th>Status</Th>
                      <Th>Caller type</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                        <Td className="whitespace-nowrap text-muted-foreground tabular-nums">{formatCallTime(r.lastCallAt, new Date(now))}</Td>
                        <Td>
                          <CallerCell row={r} />
                        </Td>
                        {lockedClient ? null : (
                          <Td>
                            <Link href={`/clients/${r.clientId}/calls`} className="text-primary underline-offset-4 hover:underline">
                              {r.clientName}
                            </Link>
                          </Td>
                        )}
                        <Td>
                          <TrackingCell row={r} />
                        </Td>
                        <Td>
                          <StatusCell row={r} />
                        </Td>
                        <Td>
                          <CallerTypeCell row={r} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="divide-y md:hidden">
                {data.rows.map((r) => (
                  <li key={r.id} className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CallerCell row={r} />
                      </div>
                      <StatusCell row={r} />
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>
                        {lockedClient ? null : (
                          <Link href={`/clients/${r.clientId}/calls`} className="text-primary underline-offset-4 hover:underline">
                            {r.clientName}
                          </Link>
                        )}
                        {r.trackingLabel ? `${lockedClient ? "" : " · "}${r.trackingLabel}` : null}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{formatCallTime(r.lastCallAt, new Date(now))}</span>
                        <CallerTypeCell row={r} />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {data.totalRows > data.pageSize ? (
            <div className="flex items-center justify-between border-t bg-muted/30 p-3 text-xs text-muted-foreground">
              <span>Page {data.page} of {totalPages}</span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={data.page <= 1}
                  onClick={() => change({ page: data.page - 1 }, false)}
                >
                  <ChevronLeft className="size-3.5" />
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={data.page >= totalPages}
                  onClick={() => change({ page: data.page + 1 }, false)}
                >
                  Next
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

// -------------------- tiny row-level cells --------------------

function CallerCell({ row }: { row: CallsListRow }) {
  const name = row.contactName && row.contactName.trim().length > 0 ? row.contactName : null;
  const phone = row.callerPhone ? formatPhone(row.callerPhone) : null;
  return (
    <div className="min-w-0">
      <div className="truncate font-medium">{name ?? phone ?? "Unknown caller"}</div>
      {name && phone ? (
        <div className="truncate text-xs text-muted-foreground">{phone}</div>
      ) : !name && !phone ? (
        <div className="text-xs text-muted-foreground">No number on file</div>
      ) : null}
    </div>
  );
}

function TrackingCell({ row }: { row: CallsListRow }) {
  if (!row.trackingNumber) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="min-w-0">
      <div className="truncate text-sm">{row.trackingLabel ?? "Unlabeled"}</div>
      <div className="truncate text-xs text-muted-foreground">{formatPhone(row.trackingNumber)}</div>
    </div>
  );
}

function StatusCell({ row }: { row: CallsListRow }) {
  if (row.statusGroup === "answered") return <StatusPillBase tone="success" label="Answered" />;
  if (row.statusGroup === "missed") return <StatusPillBase tone="warning" label="Missed" />;
  return <StatusPillBase tone="slate" label={row.status ?? "Unknown"} />;
}

function CallerTypeCell({ row }: { row: CallsListRow }) {
  return row.callerType === "first-time" ? (
    <StatusPillBase tone="blue" label="First-time" />
  ) : (
    <StatusPillBase tone="slate" label="Repeat" />
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-left font-medium">{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3 align-middle", className)}>{children}</td>;
}

// A filter's label and box. A plain div, not a <label>: the type-to-search
// filters hold their own buttons (clear, open), and inside a <label> one click
// would count twice.
function PlainField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

// -------------------- helpers --------------------

function pct(n: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((n / total) * 100);
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

function formatCallTime(d: Date | null, now: Date): string {
  if (!d) return "—";
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const sameDayToday = d.toDateString() === now.toDateString();
  if (sameDayToday) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const dayDiff = Math.floor((now.getTime() - new Date(d.toDateString()).getTime()) / (24 * 60 * 60 * 1000));
  const timeOfDay = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (dayDiff === 1) return `Yesterday, ${timeOfDay}`;
  if (dayDiff < 7) return `${d.toLocaleDateString(undefined, { weekday: "short" })}, ${timeOfDay}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function timeAgo(d: Date, now: Date): string {
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

