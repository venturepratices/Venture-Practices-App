"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { List } from "lucide-react";

import { barPercents, compactMoney, niceScale } from "@/lib/sales/insights-client";
import { formatMoney } from "@/lib/sales/format";
import { cn } from "@/lib/utils";

// The four Insights charts (Decision 27, Mockup v2): a card wrapper with its
// own Table toggle, horizontal bars (funnel and activities), and SVG columns
// (won per month) and an SVG line (cycle days per month). CSS and inline SVG
// only, no chart library. One series colour, read from the theme through the
// --primary token (CHART_SERIES_TOKEN in insights-client.ts, chosen with the
// dataviz skill). Every mark is focusable with role="img" and an aria-label
// sentence, so a keyboard user and a screen-reader user read the same number.
//
// The series is painted with three Tailwind utilities, written as static
// literal class strings below so Tailwind 4's content scanner picks them up.
// (A dynamic class built through template-literal interpolation never reaches
// the generated CSS, and the stroke on the line chart would default to "none"
// in production.) If CHART_SERIES_TOKEN ever changes from "primary", update
// these three strings too, and the contrast test in insights-client.test.ts
// keeps the token and the classes in step.
//
// Columns and the line draw at a built-in width of 560 (`viewBox="0 0 560 H"`,
// `className="block h-auto w-full"`), so the server render scales down below
// 560 and no horizontal page scroll at 375px. On mount a ResizeObserver reads
// the figure's real width, and the SVG is re-rendered at that width so the
// axis labels stay 11px and the columns stay a fixed pixel width. This keeps
// the server HTML stable for the server-render tests.

/** The built-in width the server draws at: w-full scales it down at 375px. */
const BASE_WIDTH = 560;
/** Below 34px per band the x-axis labels every other month, as the mockup does. */
const DENSE_BAND_PX = 34;

/** Tailwind utilities for the one series colour. Must be static literal
 * strings: see the file header for why. */
const CHART_FILL = "fill-primary";
const CHART_STROKE = "stroke-primary";
const CHART_BG = "bg-primary";

/** The muted grey a chart's grid, axis text and caption use, in both themes. */
const CHART_MUTED = "text-muted-foreground";

/**
 * A chart card: heading, sub, headline, an optional "Table" toggle and an
 * always-mounted screen-reader table under it. When the toggle is pressed, the
 * chart is hidden and the table is shown in place; when empty, the card shows
 * the empty state instead of either.
 */
export function ChartCard({
  id,
  title,
  sub,
  headline,
  tools,
  chart,
  table,
  empty,
}: {
  id: string;
  title: string;
  sub: string;
  headline: ReactNode;
  tools?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  empty?: { title: string; body: string; action: { label: string; href: string } };
}) {
  const headingId = `insights-${id}-heading`;
  const [tableOn, setTableOn] = useState(false);
  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-[10px] border bg-card"
    >
      <div className="flex flex-wrap items-start gap-2 border-b px-3.5 py-[11px]">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="m-0 text-[13.5px] font-semibold">
            {title}
          </h2>
          <p className={cn("mt-0.5 text-[12px]", CHART_MUTED)}>{sub}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {tools}
          {empty ? null : (
            <button
              type="button"
              aria-pressed={tableOn}
              onClick={() => setTableOn((previous) => !previous)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-card px-2 text-[12px] font-medium whitespace-nowrap text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-accent aria-pressed:font-semibold pointer-coarse:h-10 pointer-coarse:min-w-10 [&_svg]:size-3.5"
            >
              <List aria-hidden="true" />
              Table
            </button>
          )}
        </div>
      </div>

      {empty ? (
        <div className="flex flex-col items-start gap-2 px-3.5 py-5">
          <b className="text-[14px] font-semibold">{empty.title}</b>
          <p className={cn("m-0 max-w-[48ch] text-[13px]", CHART_MUTED)}>{empty.body}</p>
          <a
            href={empty.action.href}
            className="mt-1 inline-flex h-8 items-center rounded-md border bg-card px-2.5 text-[13px] font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-10"
          >
            {empty.action.label}
          </a>
        </div>
      ) : (
        <>
          <div className="flex min-w-0 flex-col gap-1 px-3.5 pt-3">{headline}</div>
          <div className={cn("px-3.5 pt-2 pb-3", tableOn && "sr-only")} aria-hidden={tableOn || undefined}>
            {chart}
          </div>
          <div className={cn(tableOn ? "px-3.5 pb-3" : "sr-only")}>{table}</div>
        </>
      )}
    </section>
  );
}

/**
 * A row of horizontal bars (the funnel and the activities chart), one per
 * entry. The bar's width is barPercents of its row's count; a zero count draws
 * no bar. Every bar is a tabbable role="img" with its aria-label, so the chart
 * reads the same as its table.
 */
export function HorizontalBars({
  rows,
}: {
  rows: { key: string; label: ReactNode; value: ReactNode; count: number; ariaLabel: string }[];
}) {
  const widths = barPercents(rows.map((row) => row.count));
  return (
    <ol className="m-0 flex flex-col gap-[7px] p-0">
      {rows.map((row, i) => (
        <li key={row.key} className="flex min-w-0 items-center gap-2">
          <span className={cn("w-[108px] shrink-0 truncate text-[13px]", CHART_MUTED)}>{row.label}</span>
          <span className="relative flex min-w-0 flex-1 items-center">
            <span
              className="relative h-[10px] min-w-0 shrink-0 rounded-full"
              style={{ width: `${widths[i]}%` }}
            >
              {row.count > 0 ? (
                <span
                  tabIndex={0}
                  role="img"
                  aria-label={row.ariaLabel}
                  title={row.ariaLabel}
                  className={cn(
                    "absolute inset-0 rounded-full outline-none transition-opacity focus-visible:ring-3 focus-visible:ring-ring/50 hover:opacity-85",
                    CHART_BG,
                  )}
                />
              ) : null}
            </span>
            <span className="ml-auto pl-2 text-[12px] tabular-nums whitespace-nowrap">{row.value}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

type MonthColumnRow = {
  month: string;
  label: string;
  long: string;
  current: boolean;
  valueCents: number;
  count: number;
};

/** The columns chart (Deals won over time). Width measured client-side. */
export function MonthColumns({ rows }: { rows: MonthColumnRow[] }) {
  const { ref, width } = useMeasuredWidth();
  return (
    <div ref={ref}>
      <ColumnsSvg rows={rows} width={width} />
    </div>
  );
}

function ColumnsSvg({ rows, width }: { rows: MonthColumnRow[]; width: number }) {
  const height = 200;
  const margin = { top: 22, right: 6, bottom: 24, left: 46 };
  const plotWidth = Math.max(80, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;
  const maxDollars = Math.max(...rows.map((row) => row.valueCents / 100), 1);
  const { step, top } = niceScale(maxDollars, 3);
  const band = plotWidth / Math.max(rows.length, 1);
  const barWidth = Math.min(24, Math.max(6, band * 0.6));
  const y = (value: number) => margin.top + plotHeight - (value / top) * plotHeight;
  const maxIndex = rows.reduce((best, row, i) => (row.valueCents > rows[best].valueCents ? i : best), 0);
  const every = band < DENSE_BAND_PX ? 2 : 1;
  const last = rows.length - 1;

  const grid: ReactNode[] = [];
  for (let value = 0; value <= top + 1e-9; value += step) {
    const yy = y(value);
    grid.push(
      <g key={`g${value}`}>
        <line x1={margin.left} x2={margin.left + plotWidth} y1={yy} y2={yy} className="stroke-border" strokeWidth={1} />
        <text x={margin.left - 8} y={yy + 4} textAnchor="end" className={cn("text-[11px] tabular-nums", CHART_MUTED)}>
          {compactMoney(value * 100)}
        </text>
      </g>,
    );
  }

  return (
    <svg
      role="presentation"
      focusable="false"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block h-auto w-full"
    >
      {grid}
      {rows.map((row, i) => {
        const cx = margin.left + band * i + band / 2;
        const bx = cx - barWidth / 2;
        const dollars = row.valueCents / 100;
        const h = (dollars / top) * plotHeight;
        const yy = margin.top + plotHeight - h;
        const radius = Math.min(4, h, barWidth / 2);
        const deals = `${row.count} ${row.count === 1 ? "deal" : "deals"}`;
        const whenWords = `${row.long}${row.current ? " so far" : ""}`;
        return (
          <g key={row.month}>
            {h > 0 ? (
              <path
                d={`M${bx},${margin.top + plotHeight}V${yy + radius}Q${bx},${yy} ${bx + radius},${yy}H${bx + barWidth - radius}Q${bx + barWidth},${yy} ${bx + barWidth},${yy + radius}V${margin.top + plotHeight}Z`}
                className={CHART_FILL}
              />
            ) : null}
            <rect
              x={margin.left + band * i}
              y={margin.top}
              width={band}
              height={plotHeight}
              fill="transparent"
              tabIndex={0}
              role="img"
              aria-label={`${whenWords}: ${formatMoney(row.valueCents)}, ${deals}`}
              className="cursor-default outline-none focus-visible:stroke-ring focus-visible:[stroke-width:2]"
            />
            {i === maxIndex && row.valueCents > 0 ? (
              <text
                x={cx}
                y={yy - 7}
                textAnchor="middle"
                className="fill-foreground text-[11.5px] font-semibold tabular-nums"
              >
                {compactMoney(row.valueCents)}
              </text>
            ) : null}
            {(last - i) % every === 0 ? (
              <text x={cx} y={height - 6} textAnchor="middle" className={cn("text-[11px] tabular-nums", CHART_MUTED)}>
                {row.label}
              </text>
            ) : null}
          </g>
        );
      })}
      <line
        x1={margin.left}
        x2={margin.left + plotWidth}
        y1={margin.top + plotHeight}
        y2={margin.top + plotHeight}
        className="stroke-input"
        strokeWidth={1}
      />
    </svg>
  );
}

type MonthLineRow = {
  month: string;
  label: string;
  long: string;
  current: boolean;
  days: number | null;
  count: number;
};

/** The line chart (Average deal cycle time). Width measured client-side. */
export function MonthLine({ rows }: { rows: MonthLineRow[] }) {
  const { ref, width } = useMeasuredWidth();
  return (
    <div ref={ref}>
      <LineSvg rows={rows} width={width} />
    </div>
  );
}

function LineSvg({ rows, width }: { rows: MonthLineRow[]; width: number }) {
  const height = 200;
  const margin = { top: 22, right: 58, bottom: 24, left: 34 };
  const plotWidth = Math.max(80, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;
  const values = rows.map((row) => row.days).filter((value): value is number => value !== null);
  const max = Math.max(...values, 10);
  const { step, top } = niceScale(max, 3);
  const band = plotWidth / Math.max(rows.length, 1);
  const x = (i: number) => margin.left + band * i + band / 2;
  const y = (value: number) => margin.top + plotHeight - (value / top) * plotHeight;
  const every = band < DENSE_BAND_PX ? 2 : 1;
  const last = rows.length - 1;

  let path = "";
  let pen = false;
  rows.forEach((row, i) => {
    if (row.days === null) {
      pen = false;
      return;
    }
    path += (pen ? "L" : "M") + x(i).toFixed(1) + "," + y(row.days).toFixed(1);
    pen = true;
  });

  const grid: ReactNode[] = [];
  for (let value = 0; value <= top + 1e-9; value += step) {
    const yy = y(value);
    grid.push(
      <g key={`g${value}`}>
        <line x1={margin.left} x2={margin.left + plotWidth} y1={yy} y2={yy} className="stroke-border" strokeWidth={1} />
        <text x={margin.left - 8} y={yy + 4} textAnchor="end" className={cn("text-[11px] tabular-nums", CHART_MUTED)}>
          {value}
        </text>
      </g>,
    );
  }

  const lastKnownIndex = rows.map((row) => row.days !== null).lastIndexOf(true);

  return (
    <svg
      role="presentation"
      focusable="false"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block h-auto w-full"
    >
      {grid}
      <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className={CHART_STROKE} />
      {rows.map((row, i) => {
        if (row.days === null) {
          if ((last - i) % every === 0) {
            return (
              <text
                key={`l${row.month}`}
                x={x(i)}
                y={height - 6}
                textAnchor="middle"
                className={cn("text-[11px] tabular-nums", CHART_MUTED)}
              >
                {row.label}
              </text>
            );
          }
          return null;
        }
        const lone =
          (i === 0 || rows[i - 1].days === null) && (i === last || rows[i + 1].days === null);
        const deals = `${row.count} ${row.count === 1 ? "deal" : "deals"} won`;
        const whenWords = `${row.long}${row.current ? " so far" : ""}`;
        return (
          <g key={row.month}>
            {lone ? (
              <circle cx={x(i)} cy={y(row.days)} r={3.5} className={cn(CHART_FILL, "stroke-card")} strokeWidth={2} />
            ) : null}
            <circle
              cx={x(i)}
              cy={y(row.days)}
              r={10}
              fill="transparent"
              tabIndex={0}
              role="img"
              aria-label={`${whenWords}: ${row.days} days, ${deals}`}
              className="cursor-default outline-none focus-visible:stroke-ring focus-visible:[stroke-width:2]"
            />
            {(last - i) % every === 0 ? (
              <text x={x(i)} y={height - 6} textAnchor="middle" className={cn("text-[11px] tabular-nums", CHART_MUTED)}>
                {row.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {lastKnownIndex >= 0 ? (
        <g>
          <circle
            cx={x(lastKnownIndex)}
            cy={y(rows[lastKnownIndex].days as number)}
            r={4.5}
            className={cn(CHART_FILL, "stroke-card")}
            strokeWidth={2}
          />
          <text
            x={x(lastKnownIndex) + 10}
            y={y(rows[lastKnownIndex].days as number) + 4}
            className="fill-foreground text-[11.5px] font-semibold tabular-nums"
          >
            {rows[lastKnownIndex].days} days
          </text>
        </g>
      ) : null}
      <line
        x1={margin.left}
        x2={margin.left + plotWidth}
        y1={margin.top + plotHeight}
        y2={margin.top + plotHeight}
        className="stroke-input"
        strokeWidth={1}
      />
    </svg>
  );
}

/**
 * The width to draw the SVG at: the built-in 560 on the server and the first
 * client render, the figure's real width after mount. Keeps the server HTML
 * stable (the render tests read the viewBox) and scales axis text up and down
 * with the figure.
 */
function useMeasuredWidth(): { ref: React.RefObject<HTMLDivElement | null>; width: number } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(BASE_WIDTH);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const next = Math.max(240, Math.round(entry.contentRect.width));
      setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
