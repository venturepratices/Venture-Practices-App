"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  ArrowRight,
  Building2,
  CalendarClock,
  ChevronRight,
  CircleCheck,
  Dot,
  FileText,
  Flag,
  FolderKanban,
  History,
  Link2,
  ListChecks,
  Lock,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  Tag,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { PriorityPill } from "@/components/tasks/priority-pill";
import { StatusPill } from "@/components/tasks/status-pill";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { useIsTruncated } from "@/lib/use-is-truncated";
import {
  categoryOf,
  type ChangeValue,
  type TaskActivityCategory,
  type TaskActivityEvent,
  type TaskActivityIcon,
  type TaskChange,
  type TaskChangeField,
} from "@/lib/task-activity";
import { stripHtml } from "@/lib/text-format";
import { APP_TIME_ZONE, cn, todayDateString } from "@/lib/utils";

type Tone = "neutral" | "primary" | "blue" | "orange" | "violet" | "amber" | "emerald" | "teal" | "sky";

// Ring + glyph color for the timeline dots; each tone is one kind of event,
// so a skim down the rail reads by color before any text.
const DOT_TONE: Record<Tone, string> = {
  neutral: "border-border text-muted-foreground",
  primary: "border-primary/60 text-primary",
  blue: "border-blue-500/60 text-blue-600 dark:text-blue-400",
  orange: "border-orange-500/60 text-orange-600 dark:text-orange-400",
  violet: "border-violet-500/60 text-violet-600 dark:text-violet-400",
  amber: "border-amber-500/60 text-amber-600 dark:text-amber-400",
  emerald: "border-emerald-500/60 text-emerald-600 dark:text-emerald-400",
  teal: "border-teal-500/60 text-teal-600 dark:text-teal-400",
  sky: "border-sky-500/60 text-sky-600 dark:text-sky-400",
};

const CHIP_TONE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary/15 text-primary",
  blue: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  orange: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  violet: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  teal: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  sky: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
};

const TEXT_ICON: Record<TaskActivityIcon, { icon: LucideIcon; tone: Tone }> = {
  comment: { icon: MessageSquare, tone: "primary" },
  created: { icon: Plus, tone: "neutral" },
  auto: { icon: Repeat, tone: "sky" },
  archived: { icon: Archive, tone: "neutral" },
  status: { icon: RefreshCw, tone: "blue" },
  priority: { icon: Flag, tone: "orange" },
  assignees: { icon: UserPlus, tone: "violet" },
  deadline: { icon: CalendarClock, tone: "amber" },
  link: { icon: Link2, tone: "emerald" },
  subtask: { icon: ListChecks, tone: "teal" },
  subtaskDone: { icon: CircleCheck, tone: "teal" },
  edit: { icon: Pencil, tone: "neutral" },
  other: { icon: Dot, tone: "neutral" },
};

const CHANGE_ICON: Record<TaskChangeField, { icon: LucideIcon; tone: Tone }> = {
  title: { icon: Pencil, tone: "neutral" },
  description: { icon: FileText, tone: "neutral" },
  status: { icon: RefreshCw, tone: "blue" },
  priority: { icon: Flag, tone: "orange" },
  assignees: { icon: UserPlus, tone: "violet" },
  client: { icon: Building2, tone: "neutral" },
  occurrence: { icon: Repeat, tone: "neutral" },
  deadline: { icon: CalendarClock, tone: "amber" },
  relatedTo: { icon: Tag, tone: "neutral" },
  project: { icon: FolderKanban, tone: "neutral" },
  private: { icon: Lock, tone: "neutral" },
};

function iconFor(event: TaskActivityEvent): { icon: LucideIcon; tone: Tone } {
  if (event.kind === "comment") return TEXT_ICON.comment;
  if (event.kind === "text") return TEXT_ICON[event.icon];
  const { change } = event;
  if (change.field === "assignees" && !change.added?.length && change.removed?.length) {
    return { icon: UserMinus, tone: "violet" };
  }
  return CHANGE_ICON[change.field];
}

const FILTERS: { key: TaskActivityCategory; label: string }[] = [
  { key: "comments", label: "Comments" },
  { key: "status", label: "Status & priority" },
  { key: "assignees", label: "Assignees" },
  { key: "deadline", label: "Due date" },
  { key: "links", label: "Links" },
  { key: "subtasks", label: "Subtasks" },
  { key: "edits", label: "Other edits" },
];

// Enough to cover a normal task in one screen; a very busy one reveals the
// rest on request instead of rendering hundreds of rows up front.
const PAGE_SIZE = 40;

// ---------- Dates (always in the app's timezone, same as the rest of the app) ----------

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}

function shiftDayKey(key: string, days: number) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function shortDay(key: string, withYear: boolean) {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function dayHeading(key: string, today: string) {
  const withYear = key.slice(0, 4) !== today.slice(0, 4);
  if (key === today) return `Today · ${shortDay(key, false)}`;
  if (key === shiftDayKey(today, -1)) return `Yesterday · ${shortDay(key, false)}`;
  return shortDay(key, withYear);
}

function timeOfDay(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: APP_TIME_ZONE, hour: "numeric", minute: "2-digit" });
}

function compactWhen(iso: string, today: string) {
  const key = dayKey(iso);
  if (key === today) return timeOfDay(iso);
  if (key === shiftDayKey(today, -1)) return "Yesterday";
  return shortDay(key, key.slice(0, 4) !== today.slice(0, 4));
}

// ---------- Pieces ----------

function ValueChip({ value, muted }: { value: string; muted?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-md bg-muted px-1.5 py-px align-baseline text-xs font-medium",
        muted ? "text-muted-foreground line-through decoration-muted-foreground/50" : "text-foreground"
      )}
    >
      <TruncateTooltip text={value} />
    </span>
  );
}

function Arrow() {
  return <ArrowRight aria-label="to" className="mx-1 inline size-3 align-[-1px] text-muted-foreground" />;
}

// Same immediate-hover-tooltip behavior as TruncateTooltip, but for a line
// built from rich children (chips, bold, mentions) rather than a plain
// string — the tooltip re-renders the same children rather than a `text`
// prop, since there's no single string that represents the whole sentence.
function TruncatedNode({ className, children }: { className?: string; children: ReactNode }) {
  const { ref, truncated } = useIsTruncated<HTMLSpanElement>();
  const line = (
    <span ref={ref} className={cn("truncate", className)}>
      {children}
    </span>
  );

  if (!truncated) return line;

  return (
    <TooltipProvider delay={0}>
      <Tooltip>
        <TooltipTrigger render={line} />
        <TooltipContent side="top" align="start" className="max-w-sm whitespace-normal">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function StatusValue({ value }: { value: ChangeValue | null }) {
  if (!value) return <ValueChip value="None" muted />;
  return (
    <StatusPill
      option={{ label: value.label, tone: value.tone ?? "neutral", color: value.color }}
      className="px-2 py-0.5 align-baseline text-[11px]"
    />
  );
}

function PriorityValue({ value }: { value: ChangeValue | null }) {
  if (!value) return <ValueChip value="No priority" />;
  return (
    <PriorityPill option={{ label: value.label, color: value.color ?? "#71717a" }} className="px-2 py-0.5 align-baseline text-[11px]" />
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>;
}

function ChangeSentence({ change }: { change: TaskChange }) {
  const from = change.from?.label ?? null;
  const to = change.to?.label ?? null;
  switch (change.field) {
    case "status":
      return (
        <>
          changed status <StatusValue value={change.from} />
          <Arrow />
          <StatusValue value={change.to} />
        </>
      );
    case "priority":
      return (
        <>
          changed priority <PriorityValue value={change.from} />
          <Arrow />
          <PriorityValue value={change.to} />
        </>
      );
    case "assignees": {
      const added = change.added ?? [];
      const removed = change.removed ?? [];
      return (
        <>
          {added.length > 0 ? (
            <>
              assigned <Strong>{added.join(", ")}</Strong>
            </>
          ) : null}
          {added.length > 0 && removed.length > 0 ? <span className="text-muted-foreground"> and </span> : null}
          {removed.length > 0 ? (
            <>
              unassigned <Strong>{removed.join(", ")}</Strong>
            </>
          ) : null}
        </>
      );
    }
    case "deadline":
      if (!from && to) {
        return (
          <>
            set the due date to <ValueChip value={to} />
          </>
        );
      }
      if (from && !to) {
        return (
          <>
            removed the due date <ValueChip value={from} muted />
          </>
        );
      }
      return (
        <>
          moved the due date <ValueChip value={from ?? "None"} />
          <Arrow />
          <ValueChip value={to ?? "None"} />
        </>
      );
    case "title":
      return (
        <>
          renamed this task to <Strong>&ldquo;{to}&rdquo;</Strong>
        </>
      );
    case "description":
      return <>edited the description</>;
    case "client":
      return (
        <>
          moved this task from <ValueChip value={from ?? "Internal / Agency"} />
          <Arrow />
          <ValueChip value={to ?? "Internal / Agency"} />
        </>
      );
    case "occurrence":
      return (
        <>
          changed repeat <ValueChip value={from ?? "None"} />
          <Arrow />
          <ValueChip value={to ?? "None"} />
        </>
      );
    case "relatedTo":
      return (
        <>
          changed Related to <ValueChip value={from ?? "None"} />
          <Arrow />
          <ValueChip value={to ?? "None"} />
        </>
      );
    case "project":
      if (!to) {
        return (
          <>
            removed this task from the project <Strong>{from}</Strong>
          </>
        );
      }
      return from ? (
        <>
          moved this task from <ValueChip value={from} />
          <Arrow />
          <ValueChip value={to} />
        </>
      ) : (
        <>
          added this task to the project <Strong>{to}</Strong>
        </>
      );
    case "private":
      return to === "Private" ? <>made this task private</> : <>made this task visible to everyone</>;
  }
}

function CommentPreview({ html }: { html: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = stripHtml(html).length > 220;
  return (
    <div className="mt-1.5 rounded-md border-l-2 border-primary/30 bg-muted/50 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
      <RichTextContent html={html} className={cn("whitespace-pre-wrap", isLong && !expanded && "line-clamp-3")} />
      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

function EventLine({ event }: { event: TaskActivityEvent }) {
  const automatic = event.kind === "text" && event.automatic;
  return (
    <>
      {event.actorName && !automatic ? <span className="font-semibold text-foreground">{event.actorName} </span> : null}
      <span className={automatic ? "italic text-muted-foreground" : "text-muted-foreground"}>
        {event.kind === "comment" ? "commented" : event.kind === "change" ? <ChangeSentence change={event.change} /> : event.text}
      </span>
    </>
  );
}

// ---------- Full timeline (the Activity tab) ----------

export function TaskActivityTimeline({ events }: { events: TaskActivityEvent[] | null }) {
  const [filter, setFilter] = useState<TaskActivityCategory | "all">("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const counts = useMemo(() => {
    const result: Partial<Record<TaskActivityCategory, number>> = {};
    for (const event of events ?? []) {
      const category = categoryOf(event);
      if (category) result[category] = (result[category] ?? 0) + 1;
    }
    return result;
  }, [events]);

  const filtered = useMemo(
    () => (events ?? []).filter((event) => filter === "all" || categoryOf(event) === filter),
    [events, filter]
  );
  const today = todayDateString();

  const groups = useMemo(() => {
    const result: { key: string; events: TaskActivityEvent[] }[] = [];
    for (const event of filtered.slice(0, visibleCount)) {
      const key = dayKey(event.createdAt);
      const last = result[result.length - 1];
      if (last && last.key === key) last.events.push(event);
      else result.push({ key, events: [event] });
    }
    return result;
  }, [filtered, visibleCount]);

  if (events === null) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Loading activity...</p>;
  }
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <History className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">No activity yet</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Comments, status changes, due-date moves and other updates to this task will show up here.
        </p>
      </div>
    );
  }

  const available = FILTERS.filter((f) => (counts[f.key] ?? 0) > 0);
  const hidden = filtered.length - Math.min(visibleCount, filtered.length);

  function chooseFilter(next: TaskActivityCategory | "all") {
    setFilter(next);
    setVisibleCount(PAGE_SIZE);
  }

  return (
    <div className="space-y-4">
      {available.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter activity">
          <FilterChip label="All" count={events.length} active={filter === "all"} onClick={() => chooseFilter("all")} />
          {available.map((f) => (
            <FilterChip
              key={f.key}
              label={f.label}
              count={counts[f.key] ?? 0}
              active={filter === f.key}
              onClick={() => chooseFilter(f.key)}
            />
          ))}
        </div>
      ) : null}

      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.key}>
            <h4 className="mb-1 flex items-center gap-3 pl-9 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {dayHeading(group.key, today)}
              <span className="h-px flex-1 bg-border" />
            </h4>
            <ol className="relative before:absolute before:bottom-4 before:left-[11px] before:top-4 before:w-0.5 before:rounded-full before:bg-border">
              {group.events.map((event) => {
                const { icon: Icon, tone } = iconFor(event);
                return (
                  <li key={event.id} className="relative grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-x-3 py-1.5">
                    <span
                      className={cn(
                        "relative z-[1] flex size-6 items-center justify-center rounded-full border-2 bg-popover",
                        DOT_TONE[tone]
                      )}
                    >
                      <Icon className="size-3" />
                    </span>
                    <div className="min-w-0 pt-0.5 text-[13px] leading-6">
                      <EventLine event={event} />
                      {event.kind === "comment" ? <CommentPreview html={event.body} /> : null}
                    </div>
                    <time
                      dateTime={event.createdAt}
                      title={new Date(event.createdAt).toLocaleString("en-US", { timeZone: APP_TIME_ZONE })}
                      className="whitespace-nowrap pt-1 font-mono text-[11px] tabular-nums text-muted-foreground"
                    >
                      {timeOfDay(event.createdAt)}
                    </time>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
          className="w-full rounded-md border border-dashed py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          Show older activity ({hidden} more)
        </button>
      ) : null}
    </div>
  );
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.97]",
        active
          ? "border-foreground bg-foreground text-background"
          : "bg-popover text-muted-foreground hover:border-foreground/30 hover:text-foreground"
      )}
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

// ---------- Compact digest (bottom of the Details tab) ----------

export function TaskActivityDigest({ events, onSeeAll }: { events: TaskActivityEvent[] | null; onSeeAll: () => void }) {
  // Comments are already shown in full right above this on the Details tab,
  // so the digest is for everything else that changed.
  const recent = (events ?? []).filter((event) => event.kind !== "comment").slice(0, 3);
  if (!events || events.length === 0) return null;
  const today = todayDateString();

  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <History className="size-3.5" />
          Recent activity
        </span>
        <button
          type="button"
          onClick={onSeeAll}
          className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:underline"
        >
          See all {events.length}
          <ChevronRight className="size-3.5" />
        </button>
      </div>
      {recent.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">Only comments so far.</p>
      ) : (
        <ul>
          {recent.map((event) => {
            const { icon: Icon, tone } = iconFor(event);
            return (
              <li key={event.id} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 py-1 text-[13px]">
                <span className={cn("flex size-5 items-center justify-center rounded-full", CHIP_TONE[tone])}>
                  <Icon className="size-3" />
                </span>
                <TruncatedNode className="block min-w-0">
                  <EventLine event={event} />
                </TruncatedNode>
                <time dateTime={event.createdAt} className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
                  {compactWhen(event.createdAt, today)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
