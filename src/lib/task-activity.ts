// Shapes + pure mapping for a task's Activity tab. No Prisma import, so the
// types are safe to use from client components; the API route
// (src/app/api/tasks/[taskId]/activity/route.ts) feeds it raw rows.

export type ChangeValue = { label: string; color?: string | null; tone?: string | null };

export type TaskChangeField =
  | "title"
  | "status"
  | "priority"
  | "assignees"
  | "client"
  | "occurrence"
  | "deadline"
  | "description"
  | "relatedTo"
  | "project"
  | "private";

export type TaskChange = {
  field: TaskChangeField;
  from: ChangeValue | null;
  to: ChangeValue | null;
  // Assignee changes only — who was added/removed, so a row can read
  // "assigned Ashley" instead of a before/after list diff.
  added?: string[];
  removed?: string[];
};

// Stored on ActivityLog.details. Every key optional: which ones are set
// depends on the row's `action`.
export type TaskActivityDetails = {
  changes?: TaskChange[];
  link?: { label: string };
  subtask?: { title: string };
  subtaskCount?: number;
};

export type TaskActivityCategory = "comments" | "status" | "assignees" | "deadline" | "links" | "subtasks" | "edits";

export type TaskActivityIcon =
  | "comment"
  | "created"
  | "auto"
  | "archived"
  | "status"
  | "priority"
  | "assignees"
  | "deadline"
  | "link"
  | "subtask"
  | "subtaskDone"
  | "edit"
  | "other";

type EventBase = { id: string; actorName: string | null; createdAt: string };

export type TaskActivityEvent =
  | (EventBase & { kind: "comment"; body: string })
  | (EventBase & { kind: "change"; change: TaskChange })
  | (EventBase & { kind: "text"; text: string; icon: TaskActivityIcon; category: TaskActivityCategory | null; automatic?: boolean });

export type ActivityLogRow = {
  id: string;
  action: string;
  description: string;
  actorName: string | null;
  details: unknown;
  createdAt: Date | string;
};

export type CommentRow = {
  id: string;
  body: string;
  createdAt: Date | string;
  author: { name: string } | null;
};

export const CHANGE_CATEGORY: Record<TaskChangeField, TaskActivityCategory> = {
  title: "edits",
  status: "status",
  priority: "status",
  assignees: "assignees",
  client: "edits",
  occurrence: "edits",
  deadline: "deadline",
  description: "edits",
  relatedTo: "edits",
  project: "edits",
  private: "edits",
};

export function categoryOf(event: TaskActivityEvent): TaskActivityCategory | null {
  if (event.kind === "comment") return "comments";
  if (event.kind === "change") return CHANGE_CATEGORY[event.change.field];
  return event.category;
}

function toIso(value: Date | string) {
  return typeof value === "string" ? value : value.toISOString();
}

function stripActor(description: string, actorName: string | null) {
  if (actorName && description.startsWith(`${actorName} `)) return description.slice(actorName.length + 1);
  if (description.startsWith("Someone ")) return description.slice("Someone ".length);
  return description;
}

// Text between `prefix"` and the LAST `suffix` — the label itself may
// contain quotes, the trailing task title is what we're trimming off.
function quotedBetween(text: string, prefix: string, suffix: string): string | null {
  if (!text.startsWith(prefix)) return null;
  const end = text.lastIndexOf(suffix);
  if (end <= prefix.length) return null;
  return text.slice(prefix.length, end);
}

// Rows written before ActivityLog.details existed carry only
// `${name} updated "${title}": status changed to X, deadline changed to Y`.
// Assignee lists contain commas, so split only where the next known phrase
// starts, never on every ", ".
const LEGACY_PHRASES: { prefix: string; verb: string; category: TaskActivityCategory; icon: TaskActivityIcon }[] = [
  { prefix: "renamed to ", verb: "renamed this task to ", category: "edits", icon: "edit" },
  { prefix: "status changed to ", verb: "changed status to ", category: "status", icon: "status" },
  { prefix: "priority changed to ", verb: "changed priority to ", category: "status", icon: "priority" },
  { prefix: "assignees changed to ", verb: "changed assignees to ", category: "assignees", icon: "assignees" },
  { prefix: "client changed to ", verb: "moved this task to ", category: "edits", icon: "edit" },
  { prefix: "occurrence changed to ", verb: "changed repeat to ", category: "edits", icon: "edit" },
  { prefix: "deadline changed to ", verb: "changed the due date to ", category: "deadline", icon: "deadline" },
];
const LEGACY_SPLIT = new RegExp(`, (?=(?:${LEGACY_PHRASES.map((p) => p.prefix.trim()).join("|")}) )`);

function legacyUpdateEvents(row: ActivityLogRow, createdAt: string): TaskActivityEvent[] {
  const rest = stripActor(row.description, row.actorName);
  const colon = rest.startsWith('updated "') ? rest.indexOf('": ') : -1;
  const body = colon >= 0 ? rest.slice(colon + 3) : rest;
  return body.split(LEGACY_SPLIT).map((piece, i) => {
    const phrase = LEGACY_PHRASES.find((p) => piece.startsWith(p.prefix));
    return {
      id: `${row.id}:${i}`,
      kind: "text" as const,
      actorName: row.actorName,
      createdAt,
      text: phrase ? phrase.verb + piece.slice(phrase.prefix.length) : piece,
      icon: phrase?.icon ?? "edit",
      category: phrase?.category ?? "edits",
    };
  });
}

// Written by the priority auto-escalate cron with no actor.
const PRIORITY_ESCALATION = /^Priority automatically escalated from (.+) to (.+) \(due in (-?\d+) days?\)$/;

function dueInWords(days: number) {
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due in ${days} days`;
}

function textEvent(
  row: ActivityLogRow,
  createdAt: string,
  text: string,
  icon: TaskActivityIcon,
  category: TaskActivityCategory | null,
  automatic = false
): TaskActivityEvent {
  return { id: row.id, kind: "text", actorName: row.actorName, createdAt, text, icon, category, ...(automatic ? { automatic } : {}) };
}

function eventsFromLog(row: ActivityLogRow): TaskActivityEvent[] {
  const createdAt = toIso(row.createdAt);
  const details = (row.details && typeof row.details === "object" ? row.details : {}) as TaskActivityDetails;
  const rest = stripActor(row.description, row.actorName);

  switch (row.action) {
    case "commented":
      // Comments come straight from the Comment table (with their body),
      // so the log row would only be a bodiless duplicate.
      return [];
    case "updated": {
      const escalation = !row.actorName ? PRIORITY_ESCALATION.exec(row.description) : null;
      if (escalation) {
        const [, from, to, days] = escalation;
        return [
          textEvent(row, createdAt, `Priority raised automatically from ${from} to ${to} — ${dueInWords(Number(days))}`, "priority", "status", true),
        ];
      }
      if (details.changes && details.changes.length > 0) {
        return details.changes.map((change, i) => ({
          id: `${row.id}:${i}`,
          kind: "change" as const,
          actorName: row.actorName,
          createdAt,
          change,
        }));
      }
      return legacyUpdateEvents(row, createdAt);
    }
    case "status_changed": {
      // Written by campaign auto-advance: `"Title" auto-completed — reason`.
      const reason = row.description.split(" auto-completed — ")[1];
      return [textEvent(row, createdAt, `Marked complete automatically${reason ? ` — ${reason}` : ""}`, "status", "status", !row.actorName)];
    }
    case "restored":
      return [textEvent(row, createdAt, "restored this task from the archive", "archived", null)];
    case "created": {
      if (!row.actorName && row.description.startsWith("Automatically created")) {
        return [textEvent(row, createdAt, "Created automatically as the next occurrence of a recurring task", "auto", null, true)];
      }
      const original = quotedBetween(rest, 'duplicated task "', '" as "');
      if (original !== null) return [textEvent(row, createdAt, `created this task as a copy of "${original}"`, "created", null)];
      if (rest.startsWith("created task ")) return [textEvent(row, createdAt, "created this task", "created", null)];
      return [textEvent(row, createdAt, rest, "created", null)];
    }
    case "link_added": {
      const label = details.link?.label ?? quotedBetween(rest, 'added the link "', '" to "');
      return [textEvent(row, createdAt, label !== null ? `added the link "${label}"` : rest, "link", "links")];
    }
    case "link_removed": {
      const label = details.link?.label ?? quotedBetween(rest, 'removed the link "', '" from "');
      return [textEvent(row, createdAt, label !== null ? `removed the link "${label}"` : rest, "link", "links")];
    }
    case "subtask_added":
      return [textEvent(row, createdAt, `added the subtask "${details.subtask?.title ?? ""}"`, "subtask", "subtasks")];
    case "subtasks_added": {
      const count = details.subtaskCount ?? 0;
      return [textEvent(row, createdAt, `added ${count} subtask${count === 1 ? "" : "s"}`, "subtask", "subtasks")];
    }
    case "subtask_completed":
      return [textEvent(row, createdAt, `checked off "${details.subtask?.title ?? ""}"`, "subtaskDone", "subtasks")];
    case "subtask_reopened":
      return [textEvent(row, createdAt, `unchecked "${details.subtask?.title ?? ""}"`, "subtask", "subtasks")];
    case "subtask_removed":
      return [textEvent(row, createdAt, `removed the subtask "${details.subtask?.title ?? ""}"`, "subtask", "subtasks")];
    case "deleted":
    case "archived":
      return [textEvent(row, createdAt, "archived this task", "archived", null)];
    default:
      return [textEvent(row, createdAt, rest, "other", null)];
  }
}

// Newest first. A single save that changed several fields becomes one row per
// field, all sharing the save's timestamp, in the order they were recorded.
export function buildTaskActivityEvents(logs: ActivityLogRow[], comments: CommentRow[]): TaskActivityEvent[] {
  const events: TaskActivityEvent[] = [
    ...logs.flatMap(eventsFromLog),
    ...comments.map(
      (comment): TaskActivityEvent => ({
        id: `comment:${comment.id}`,
        kind: "comment",
        actorName: comment.author?.name ?? "Former team member",
        createdAt: toIso(comment.createdAt),
        body: comment.body,
      })
    ),
  ];
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => b.event.createdAt.localeCompare(a.event.createdAt) || a.index - b.index)
    .map(({ event }) => event);
}
