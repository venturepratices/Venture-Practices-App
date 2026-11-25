import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HealthDot } from "./health-dot";
import { ExternalLink } from "./external-link";
import { SafeModeBanner } from "./safe-mode-banner";
import {
  SYNC_HEALTH_LABEL,
  SYNC_HEALTH_REASON,
  type SyncHealth,
  type SyncRow,
  type SyncSummary,
} from "@/lib/marketing/sync";
import type { MetricHealth } from "@/lib/marketing/insights";

/**
 * Map the Sync-area health scale to the shared traffic-light HealthDot. Keep
 * this mapping centralized so the UI vocabulary is consistent with Stats.
 */
function dotTone(h: SyncHealth): MetricHealth {
  switch (h) {
    case "in-sync":
      return "green";
    case "pending":
      return "yellow";
    case "mismatch":
    case "not-connected":
      return "red";
    case "not-wired":
      return "not-wired";
  }
}

const BRAND_LABEL: Record<SyncRow["brand"], string> = {
  "venture-practices": "Venture Practices",
  "practice-mailers": "Practice Mailers",
};

const STATUS_VARIANT: Record<
  SyncRow["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  draft: "secondary",
  paused: "outline",
  "not built": "outline",
};

/**
 * Marketing > Sync screen.
 *
 * READ-ONLY by design: nothing in this view mutates NitroSend, HighLevel or
 * our own database. The outer page logs the view to ActivityLog, and the
 * safe-mode banner makes the contract visible to the human reader.
 */
export function SyncView({
  rows,
  summary,
  snapshotTimestamp,
}: {
  rows: SyncRow[];
  summary: SyncSummary;
  snapshotTimestamp: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sync</h1>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              How each follow-up sequence is wired across NitroSend and
              HighLevel. Updated from a snapshot &mdash; live reads land once
              the integration keys are in place.
            </p>
          </div>
          <p
            className="text-xs text-muted-foreground tabular-nums"
            aria-label={`Snapshot taken ${snapshotTimestamp}`}
          >
            Snapshot · {snapshotTimestamp}
          </p>
        </div>

        <SafeModeBanner
          tone={summary.worst === "mismatch" ? "warning" : "default"}
          message="Read-only view. All changes to flows, lists, segments or workflows happen inside NitroSend or HighLevel directly — this page never writes to either."
        />
      </header>

      <SummaryTiles summary={summary} />

      <section aria-label="Sync rows" className="flex flex-col gap-3">
        {/* Desktop table */}
        <div
          role="table"
          aria-label="Sequence sync status"
          className="hidden overflow-hidden rounded-xl border border-border md:block"
        >
          <div
            role="row"
            className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto] items-center gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase"
          >
            <div role="columnheader">Sequence</div>
            <div role="columnheader">NitroSend flow</div>
            <div role="columnheader">NitroSend list</div>
            <div role="columnheader">HighLevel segment</div>
            <div role="columnheader">HighLevel workflow</div>
            <div role="columnheader" className="justify-self-end">
              Roll-up
            </div>
          </div>
          {rows.map((row) => (
            <DesktopRow key={row.key} row={row} />
          ))}
        </div>

        {/* Mobile card stack */}
        <div className="flex flex-col gap-3 md:hidden">
          {rows.map((row) => (
            <MobileCard key={row.key} row={row} />
          ))}
        </div>
      </section>

      <footer className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
        <h2 className="text-sm font-medium">What each status means</h2>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {(Object.keys(SYNC_HEALTH_LABEL) as SyncHealth[]).map((h) => (
            <div
              key={h}
              className="flex items-start gap-2 text-sm text-muted-foreground"
            >
              <HealthDot health={dotTone(h)} size="sm" />
              <div>
                <dt className="font-medium text-foreground">
                  {SYNC_HEALTH_LABEL[h]}
                </dt>
                <dd className="leading-snug">{SYNC_HEALTH_REASON[h]}</dd>
              </div>
            </div>
          ))}
        </dl>
      </footer>
    </div>
  );
}

function SummaryTiles({ summary }: { summary: SyncSummary }) {
  const tiles: { key: SyncHealth; label: string }[] = [
    { key: "in-sync", label: "In sync" },
    { key: "pending", label: "Pending" },
    { key: "mismatch", label: "Mismatches" },
    { key: "not-connected", label: "Not connected" },
    { key: "not-wired", label: "Not wired" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <Card key={t.key} size="sm" className="gap-2 px-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              {t.label}
            </p>
            <HealthDot health={dotTone(t.key)} size="sm" />
          </div>
          <p className="text-2xl font-semibold tabular-nums">
            {summary.counts[t.key]}
          </p>
          <p className="text-xs text-muted-foreground">
            of {summary.total} sequence{summary.total === 1 ? "" : "s"}
          </p>
        </Card>
      ))}
    </div>
  );
}

function RowHeadCell({ row }: { row: SyncRow }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <HealthDot health={dotTone(row.rollup)} size="md" />
        <span className="truncate font-medium text-foreground">
          {row.displayName}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={STATUS_VARIANT[row.status]} className="capitalize">
          {row.status}
        </Badge>
        <Badge variant="outline">{BRAND_LABEL[row.brand]}</Badge>
      </div>
    </div>
  );
}

function LinkCell({ link }: { link: SyncRow["links"][number] }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <HealthDot health={dotTone(link.health)} size="sm" />
        <span
          title={link.value}
          className="truncate text-sm text-foreground"
        >
          {link.value}
        </span>
      </div>
      {link.externalUrl ? (
        <ExternalLink
          href={link.externalUrl}
          label="Open"
          system={link.source === "highlevel" ? "HighLevel" : "NitroSend"}
        />
      ) : (
        <span className="text-xs text-muted-foreground">No external link</span>
      )}
    </div>
  );
}

function DesktopRow({ row }: { row: SyncRow }) {
  return (
    <div
      role="row"
      className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto] items-start gap-3 border-b border-border px-4 py-3 last:border-b-0"
    >
      <div role="cell">
        <RowHeadCell row={row} />
      </div>
      {row.links.map((link) => (
        <div role="cell" key={link.key} className="min-w-0">
          <LinkCell link={link} />
        </div>
      ))}
      <div role="cell" className="justify-self-end">
        <HealthDot
          health={dotTone(row.rollup)}
          size="md"
          label={SYNC_HEALTH_LABEL[row.rollup]}
        />
      </div>
    </div>
  );
}

function MobileCard({ row }: { row: SyncRow }) {
  return (
    <Card size="sm" className="gap-3 px-3">
      <div className="flex items-start justify-between gap-2">
        <RowHeadCell row={row} />
        <HealthDot
          health={dotTone(row.rollup)}
          size="md"
          label={SYNC_HEALTH_LABEL[row.rollup]}
        />
      </div>
      <dl className="flex flex-col gap-3">
        {row.links.map((link) => (
          <div key={link.key} className="flex flex-col gap-1">
            <dt className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              {link.label}
            </dt>
            <dd>
              <LinkCell link={link} />
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
