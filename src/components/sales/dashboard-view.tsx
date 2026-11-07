"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useOptimistic, useTransition } from "react";
import {
  CalendarCheck,
  ChartColumn,
  CircleCheck,
  Clock,
  History,
  List,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { ACTIVITY_TYPE_LABELS } from "@/lib/sales/constants";
import type {
  DashboardActivity,
  DashboardData,
  DashboardFollowUp,
  DashboardRecent,
  DashboardScope,
  DashboardStalled,
} from "@/lib/sales/dashboard";
import {
  dashboardDateLine,
  dashboardEmpty,
  dealCount,
  followUpCaption,
  forecastHint,
  forecastMonths,
  greeting,
  leadsInboxHref,
  noCloseDateLine,
  overdueCaption,
  stalledCaption,
  todayCaption,
  viewAllHrefs,
  wonCaption,
  type DashboardBox,
} from "@/lib/sales/dashboard-client";
import { dayLabel, daysInStage, formatMoney } from "@/lib/sales/format";
import { changePanelUrl, pageRendered, panelHref, type PanelTarget } from "@/lib/sales/panel-url";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TIMELINE_ICONS } from "@/components/sales/deal-history";
import { SEGMENT, SEGMENT_GROUP } from "@/components/sales/deals-toolbar";
import { ACTIVITY_ICONS, MUTED_TONE, NextStepPill, OwnerAvatar } from "@/components/sales/sales-pills";
import { ShortcutsButton } from "@/components/sales/shortcuts-help-dialog";

// The Sales dashboard on the client (Mockup v2 `viewHome`): a greeting with
// Everyone / Just me, four KPI tiles, the "Expected to close" forecast, and
// four boxes of work (Today and overdue, No next step, Deals in Follow-Up,
// Recent activity), 8 rows each at most. A row opens its deal or lead in its
// panel (`?deal=` or `?lead=` on this page, built by panelHref and set with the
// history API, so the dashboard is not loaded again). Tiles go two across on
// phones and four from 820px; boxes go two across from 820px, and on phones
// the to-do boxes come before the forecast.

/** Grey words, a 12px caption. */
const CAPTION = "truncate text-xs text-muted-foreground";

/** The tiles' and the forecast's big number: a long one wraps inside its box instead of widening the page. */
const BIG_NUMBER = "mt-0.5 min-w-0 text-[22px] leading-tight font-[650] tabular-nums [overflow-wrap:anywhere]";

/** The small pill shape the board's pills use (sales-pills.tsx). */
const PILL =
  "inline-flex shrink-0 items-center rounded-full px-[7px] py-0.5 text-[11px] leading-[1.4] font-semibold whitespace-nowrap";

/** "View all" and "See all" (Mockup v2's AA link ink: 5.3:1 on the light card); a 40px hit area on touch screens. */
const BOX_LINK =
  "shrink-0 rounded-sm text-[12.5px] font-semibold whitespace-nowrap text-cyan-700 underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 dark:text-sky-300 pointer-coarse:-my-2.5 pointer-coarse:inline-flex pointer-coarse:min-h-10 pointer-coarse:items-center";

/** A row's 28px icon square. */
const ROW_ICON = "flex size-7 shrink-0 items-center justify-center rounded-[7px] [&_svg]:size-4";

const OVERDUE_TONE = "bg-status-danger text-status-danger-foreground";
const TODAY_TONE = "bg-status-warning text-status-warning-foreground";

export function DashboardView({
  data,
  now: nowIso,
}: {
  data: DashboardData;
  /** The server's clock for this render, so day words match what the server counted. */
  now: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  // The pressed scope: the server's, or the one just asked for while it loads.
  const [scope, setScope] = useOptimistic(data.scope);
  const now = new Date(nowIso);
  // Each render from the server carries its own time: a new one means the boxes are fresh.
  useEffect(() => pageRendered(), [nowIso]);

  function changeScope(next: DashboardScope) {
    if (next === scope) return;
    startTransition(() => {
      setScope(next);
      router.replace(next === "mine" ? `${pathname}?scope=mine` : pathname, { scroll: false });
    });
  }

  /** This page's URL with one panel open. */
  const hrefFor = (target: PanelTarget) => panelHref(pathname, searchParams.toString(), target);
  const open = (target: PanelTarget) => changePanelUrl(hrefFor(target), "push", router);

  const names = new Map(data.members.map((member) => [member.id, member.name]));
  const ownerName = (id: string) => names.get(id) ?? "No longer in Sales";
  const hrefs = viewAllHrefs(data.scope, data.followUpPipelineKey);
  const mine = data.scope === "mine" || !data.canSeeEveryone;
  const { kpis } = data;

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-2.5">
        <div className="min-w-0">
          <h1 className="m-0 text-[21px] font-semibold">{greeting(now, data.viewerName)}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{dashboardDateLine(now)}</p>
        </div>
        <div className="flex items-center gap-2">
          {data.canSeeEveryone ? (
            <div role="group" aria-label="Whose deals" className={SEGMENT_GROUP}>
              <button type="button" aria-pressed={scope === "everyone"} onClick={() => changeScope("everyone")} className={SEGMENT}>
                Everyone
              </button>
              <button type="button" aria-pressed={scope === "mine"} onClick={() => changeScope("mine")} className={SEGMENT}>
                Just me
              </button>
            </div>
          ) : null}
          {/* No keyboard on a phone, so no shortcuts list there (as on Deals and Activities). */}
          <ShortcutsButton className="max-sm:hidden" />
        </div>
      </div>

      <div
        aria-busy={pending}
        className={cn("transition-opacity duration-200", pending && "opacity-60 motion-reduce:opacity-80")}
      >
        <dl className="mt-[18px] grid grid-cols-2 gap-3 min-[820px]:grid-cols-4">
          <Tile label="Open deals" value={String(kpis.openDeals)} caption="sales pipelines" />
          <Tile label="Pipeline value" value={formatMoney(kpis.pipelineCents)} caption="open, all stages" />
          <Tile label="Won this month" value={formatMoney(kpis.wonThisMonthCents)} caption={wonCaption(kpis.wonThisMonthCount)} />
          <Tile
            label="Overdue activities"
            value={String(kpis.overdueActivities)}
            caption={overdueCaption(kpis.overdueActivities)}
            alert={kpis.overdueActivities > 0}
          />
        </dl>

        <div className="mt-3 grid grid-cols-1 gap-3 min-[820px]:grid-cols-2">
          <Forecast forecast={data.forecast} now={now} />

          <Box
            id="dashboard-today"
            icon={CalendarCheck}
            title="Today and overdue"
            count={{ value: data.todayCount, tone: "bg-accent text-accent-foreground" }}
            viewAll={data.today.length > 0 ? hrefs.today : null}
            className="max-sm:order-1"
          >
            {data.today.length === 0 ? (
              <BoxEmpty box="today" icon={CalendarCheck} />
            ) : (
              <ul className="m-0 list-none p-0">
                {data.today.map((row) => (
                  <TodayRow key={row.id} row={row} now={now} ownerName={ownerName(row.ownerId)} href={hrefFor(row.parent)} onOpen={open} />
                ))}
              </ul>
            )}
          </Box>

          <Box
            id="dashboard-no-next-step"
            icon={TriangleAlert}
            title="No next step"
            count={{ value: data.noNextStepCount, tone: TODAY_TONE }}
            className="max-sm:order-2"
          >
            {data.noNextStep.length === 0 ? (
              <BoxEmpty box="noNextStep" icon={CircleCheck} />
            ) : (
              <>
                <ul className="m-0 list-none p-0">
                  {data.noNextStep.map((row) => (
                    <StalledRow
                      key={`${row.kind}-${row.id}`}
                      row={row}
                      now={now}
                      ownerName={ownerName(row.ownerId)}
                      href={hrefFor(row)}
                      onOpen={open}
                    />
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t px-3.5 py-[9px] text-[12.5px]">
                  <span className="text-muted-foreground">See all:</span>
                  <Link href={hrefs.noNextStep} className={BOX_LINK}>
                    Deals with no next step
                  </Link>
                  <Link href={leadsInboxHref(data.scope)} className={BOX_LINK}>
                    Leads Inbox
                  </Link>
                </div>
              </>
            )}
          </Box>

          <Box
            id="dashboard-follow-up"
            icon={Clock}
            title="Deals in Follow-Up"
            viewAll={data.followUp.length > 0 ? hrefs.followUp : null}
            className="max-sm:order-4"
          >
            {data.followUp.length === 0 ? (
              <BoxEmpty box="followUp" icon={Clock} />
            ) : (
              <ul className="m-0 list-none p-0">
                {data.followUp.map((row) => (
                  <FollowUpRow key={row.id} row={row} now={now} href={hrefFor({ kind: "deal", id: row.id })} onOpen={open} />
                ))}
              </ul>
            )}
          </Box>

          <Box id="dashboard-recent" icon={List} title="Recent activity" className="max-sm:order-4">
            {data.recent.length === 0 ? (
              <BoxEmpty box="recent" mine={mine} icon={History} />
            ) : (
              <ul className="m-0 list-none p-0">
                {data.recent.map((row) => (
                  <RecentRow key={row.id} row={row} now={now} href={hrefFor({ kind: "deal", id: row.dealId })} onOpen={open} />
                ))}
              </ul>
            )}
          </Box>
        </div>
      </div>
    </div>
  );
}

/** One KPI tile: a label, the number, and what it means in words (mockup `.kpi`). */
function Tile({ label, value, caption, alert = false }: { label: string; value: string; caption: string; alert?: boolean }) {
  return (
    <div data-alert={alert ? "true" : undefined} className="min-w-0 rounded-[10px] border bg-card px-[15px] py-[13px]">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className={cn(BIG_NUMBER, alert && "text-destructive")}>{value}</dd>
      <dd className="text-xs text-muted-foreground">{caption}</dd>
    </div>
  );
}

/** A box heading with its icon, then its count pill and "View all" when it has them (mockup `.box > h3`). */
function Box({
  id,
  icon: Icon,
  title,
  count,
  viewAll = null,
  className,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  count?: { value: number; tone: string };
  viewAll?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className={cn("min-w-0 rounded-[10px] border bg-card", className)}>
      <div className="flex min-w-0 items-center gap-2 border-b px-3.5 py-[11px]">
        <h2 id={`${id}-heading`} className="m-0 flex min-w-0 items-center gap-2 text-[13.5px] font-semibold">
          <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          {title}
        </h2>
        {count ? <span className={cn(PILL, count.tone, "ml-auto tabular-nums")}>{count.value}</span> : null}
        {viewAll ? (
          <Link href={viewAll} className={cn(BOX_LINK, count ? "ml-1.5" : "ml-auto")}>
            View all
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** An empty box: what shows up here, and a way on. */
function BoxEmpty({ box, mine = false, icon }: { box: DashboardBox; mine?: boolean; icon: LucideIcon }) {
  const empty = dashboardEmpty(box, mine);
  return (
    <EmptyState
      icon={icon}
      title={empty.title}
      description={empty.description}
      className="py-7"
      action={
        <Link href={empty.action.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-coarse:min-h-10")}>
          {empty.action.label}
        </Link>
      }
    />
  );
}

/**
 * One row of a box. The whole row opens the panel on a click; the title is the
 * real link, for the keyboard and screen readers (a plain click opens the panel
 * like the row does, with no page load; Ctrl or Cmd still opens a tab). The
 * deal panel puts focus back on the link it finds by `data-deal-id`.
 */
function PanelRow({
  target,
  href,
  onOpen,
  icon,
  title,
  linkLabel,
  caption,
  trailing,
}: {
  target: PanelTarget;
  href: string;
  onOpen: (target: PanelTarget) => void;
  icon?: React.ReactNode;
  title: React.ReactNode;
  linkLabel?: string;
  caption: string;
  trailing?: React.ReactNode;
}) {
  return (
    <li
      onClick={() => onOpen(target)}
      className="flex min-w-0 cursor-pointer items-center gap-2.5 border-b px-3.5 py-[9px] transition-colors duration-150 last:border-b-0 hover:bg-muted/50 pointer-coarse:min-h-10"
    >
      {icon}
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          scroll={false}
          aria-label={linkLabel}
          data-deal-id={target.kind === "deal" ? target.id : undefined}
          data-lead-id={target.kind === "lead" ? target.id : undefined}
          onClick={(event) => event.stopPropagation()}
          onNavigate={(event) => {
            event.preventDefault();
            onOpen(target);
          }}
          className="block truncate rounded-sm text-[13px] font-semibold underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {title}
        </Link>
        <p className={cn("m-0", CAPTION)}>{caption}</p>
      </div>
      {trailing}
    </li>
  );
}

/** "Lead" on a lead's row, where nothing else says it (mockup `.pill.p-neu`). */
function LeadPill() {
  return <span className={cn(PILL, MUTED_TONE)}>Lead</span>;
}

function TodayRow({
  row,
  now,
  ownerName,
  href,
  onOpen,
}: {
  row: DashboardActivity;
  now: Date;
  ownerName: string;
  href: string;
  onOpen: (target: PanelTarget) => void;
}) {
  const Icon = ACTIVITY_ICONS[row.type];
  // Red once its day has ended, amber while it is due today; the caption says which in words.
  const overdue = daysInStage(new Date(row.dueAt), now) > 0;
  return (
    <PanelRow
      target={row.parent}
      href={href}
      onOpen={onOpen}
      icon={
        <span aria-hidden="true" className={cn(ROW_ICON, overdue ? OVERDUE_TONE : TODAY_TONE)}>
          <Icon />
        </span>
      }
      title={
        <>
          <span className="sr-only">{ACTIVITY_TYPE_LABELS[row.type]}: </span>
          {row.subject}
        </>
      }
      caption={todayCaption(row, now)}
      trailing={
        <>
          {row.parent.kind === "lead" ? <LeadPill /> : null}
          <OwnerAvatar id={row.ownerId} name={ownerName} />
        </>
      }
    />
  );
}

function StalledRow({
  row,
  now,
  ownerName,
  href,
  onOpen,
}: {
  row: DashboardStalled;
  now: Date;
  ownerName: string;
  href: string;
  onOpen: (target: PanelTarget) => void;
}) {
  return (
    <PanelRow
      target={{ kind: row.kind, id: row.id }}
      href={href}
      onOpen={onOpen}
      icon={
        <span aria-hidden="true" className={cn(ROW_ICON, TODAY_TONE)}>
          <TriangleAlert />
        </span>
      }
      title={row.title}
      // A lead's caption starts "Lead", so its row needs no pill.
      caption={stalledCaption(row, now)}
      trailing={<OwnerAvatar id={row.ownerId} name={ownerName} />}
    />
  );
}

function FollowUpRow({
  row,
  now,
  href,
  onOpen,
}: {
  row: DashboardFollowUp;
  now: Date;
  href: string;
  onOpen: (target: PanelTarget) => void;
}) {
  return (
    <PanelRow
      target={{ kind: "deal", id: row.id }}
      href={href}
      onOpen={onOpen}
      title={row.title}
      caption={followUpCaption(row)}
      trailing={<NextStepPill next={row.next} now={now} />}
    />
  );
}

function RecentRow({
  row,
  now,
  href,
  onOpen,
}: {
  row: DashboardRecent;
  now: Date;
  href: string;
  onOpen: (target: PanelTarget) => void;
}) {
  const Icon = TIMELINE_ICONS[row.icon];
  const who = row.actorName ? ` · ${row.actorName}` : "";
  return (
    <PanelRow
      target={{ kind: "deal", id: row.dealId }}
      href={href}
      onOpen={onOpen}
      icon={
        <span aria-hidden="true" className={cn(ROW_ICON, MUTED_TONE)}>
          <Icon />
        </span>
      }
      title={row.text}
      linkLabel={`${row.dealTitle}: ${row.text}`}
      caption={`${row.dealTitle} · ${dayLabel(new Date(row.at), now)}${who}`}
    />
  );
}

/**
 * "Expected to close" (Decision 26, Mockup v2 `.fc`): open deals weighted by
 * their stage's win chance, by expected close month, and how many have no
 * date. With nothing weighted into either month, the note says how to fill it.
 */
function Forecast({ forecast, now }: { forecast: DashboardData["forecast"]; now: Date }) {
  const months = forecastMonths(now);
  const hint = forecastHint(forecast);
  return (
    <section
      aria-labelledby="dashboard-forecast-heading"
      className="min-w-0 rounded-[10px] border bg-card max-sm:order-3 min-[820px]:col-span-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-b px-3.5 py-[11px]">
        <h2 id="dashboard-forecast-heading" className="m-0 flex min-w-0 items-center gap-2 text-[13.5px] font-semibold">
          <ChartColumn aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          Expected to close
        </h2>
        <span className="ml-auto text-xs font-medium text-muted-foreground">by expected close date</span>
      </div>
      <dl className="m-0 grid grid-cols-1 sm:grid-cols-3">
        <ForecastCell label={`This month · ${months.thisMonth}`} value={formatMoney(forecast.thisMonthCents)} />
        <ForecastCell label={`Next month · ${months.nextMonth}`} value={formatMoney(forecast.nextMonthCents)} />
        <ForecastCell
          label="No close date"
          value={dealCount(forecast.noCloseDateCount)}
          spoken={noCloseDateLine(forecast.noCloseDateCount)}
          caption={hint ? null : "Set Expected close in a deal's Details to count it here."}
        />
      </dl>
      <p className="m-0 border-t px-[15px] pt-2 pb-2.5 text-xs text-muted-foreground">
        {hint ?? "Each deal counts at its stage's win chance, so a $10,000 deal at 70% adds $7,000. Lost stages count as 0%."}
      </p>
    </section>
  );
}

/** One forecast cell. `spoken`: the label and value read as one phrase ("No close date: 2 deals"). */
function ForecastCell({
  label,
  value,
  spoken,
  caption = null,
}: {
  label: string;
  value: string;
  spoken?: string;
  caption?: string | null;
}) {
  return (
    <div className="min-w-0 border-t px-[15px] py-3 first:border-t-0 sm:border-t-0 sm:border-l sm:first:border-l-0">
      <dt className="text-xs font-semibold text-muted-foreground">
        {spoken ? (
          <>
            <span aria-hidden="true">{label}</span>
            <span className="sr-only">{spoken}</span>
          </>
        ) : (
          label
        )}
      </dt>
      <dd aria-hidden={spoken ? true : undefined} className={BIG_NUMBER}>
        {value}
      </dd>
      {caption ? <dd className="text-xs text-muted-foreground">{caption}</dd> : null}
    </div>
  );
}
