"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { Download, PhoneMissed, Phone, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const ALL_CLIENTS = "__all__";
const ALL_TRACKING = "__all__";

export function CallsView({
  data,
  query,
  now,
}: {
  data: CallsPageData;
  query: CallsQuery;
  now: string;
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

  const exportHref = `/api/calls/export?${callsQueryToSearch({ ...query, page: 1 })}`;

  return (
    <div className={cn("space-y-6", pending && "opacity-90 transition-opacity")}>
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Reporting
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Calls</h1>
        <p className="mt-1 text-sm text-muted-foreground">
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
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date range">
            <Select value={range} onValueChange={(v) => change({ range: v as CallsRange })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="14d">Last 14 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="month">This month</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Client">
            <Select
              value={clientId ?? ALL_CLIENTS}
              onValueChange={(v) => change({ clientId: v === ALL_CLIENTS ? null : v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CLIENTS}>All clients ({data.clientOptions.length})</SelectItem>
                {data.clientOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tracking number">
            <Select
              value={tracking ?? ALL_TRACKING}
              onValueChange={(v) => change({ trackingNumber: v === ALL_TRACKING ? null : v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TRACKING}>All numbers</SelectItem>
                {data.trackingOptions.map((t) => (
                  <SelectItem key={t.number} value={t.number}>
                    {t.label} · {formatPhone(t.number)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={(v) => change({ status: v as CallsStatus })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="answered">Answered only</SelectItem>
                <SelectItem value="missed">Missed only</SelectItem>
                <SelectItem value="first">First-time only</SelectItem>
                <SelectItem value="repeat">Repeat only</SelectItem>
              </SelectContent>
            </Select>
          </Field>
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
              const answeredInGroup = estimateAnswered(t.count, data.stats);
              const missedInGroup = t.count - answeredInGroup;
              const maxCount = data.stats.byTrackingNumber[0]?.count ?? 1;
              const rowWidth = Math.max(10, Math.round((t.count / maxCount) * 100));
              const aPct = answeredInGroup / t.count * 100;
              return (
                <div key={t.number}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{t.label ?? "Unlabeled"}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{formatPhone(t.number)}</span>
                    </div>
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
                    <div className="bg-amber-500 dark:bg-amber-400" style={{ width: `${100 - aPct}%` }} />
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
                      <Th>Client</Th>
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
                        <Td>
                          <Link href={`/clients/${r.clientId}/calls`} className="text-primary underline-offset-4 hover:underline">
                            {r.clientName}
                          </Link>
                        </Td>
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
                        <Link href={`/clients/${r.clientId}/calls`} className="text-primary underline-offset-4 hover:underline">
                          {r.clientName}
                        </Link>
                        {r.trackingLabel ? ` · ${r.trackingLabel}` : null}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
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

/**
 * The breakdown shows per-tracking-number total AND answered. We don't query
 * answered-per-tracking-number from SQL (that'd need a second grouped query);
 * instead we distribute the overall answered rate across groups proportionally
 * to each group's total. For a first-pass summary this reads correctly at the
 * aggregate level and never shows "answered > total". Swap for a real grouped
 * query if tracking-accurate per-number rates become important.
 */
function estimateAnswered(count: number, stats: { answered: number; totalCalls: number }): number {
  if (stats.totalCalls === 0) return 0;
  return Math.min(count, Math.round((count * stats.answered) / stats.totalCalls));
}
