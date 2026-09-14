// Pure helpers for resolving a task status id against an already-fetched
// TaskStatusOption[] list — safe to import from client components (unlike
// src/lib/task-status.ts, which pulls in the Prisma client). Server
// components fetch the live list via getTaskStatusOptions() and pass it down
// as a prop; client components use these helpers against that prop.

export type StatusOptionLite = { id: string; label: string; tone: string; color: string; isComplete: boolean };

const FALLBACK_TONE = "neutral";
const FALLBACK_COLOR = "#71717a";

// Falls back to a plain neutral pill showing the raw id rather than crashing
// if a task's statusId doesn't match anything in the passed-in list (e.g. a
// stale reference to a since-deleted status that wasn't reassigned).
export function resolveStatusOption<T extends StatusOptionLite>(options: T[], statusId: string): StatusOptionLite {
  return (
    options.find((o) => o.id === statusId) ?? {
      id: statusId,
      label: statusId,
      tone: FALLBACK_TONE,
      color: FALLBACK_COLOR,
      isComplete: false,
    }
  );
}

export function statusLabelMap(options: StatusOptionLite[]): Record<string, string> {
  return Object.fromEntries(options.map((o) => [o.id, o.label]));
}

// Priority levels are a separate, nullable axis from status (see
// PriorityLevelOption in prisma/schema.prisma) — a task may have no priority
// at all, so resolution returns null instead of a fallback pill.
export type PriorityLevelOptionLite = { id: string; label: string; color: string; sequenceNumber: number };

export function resolvePriorityLevelOption<T extends PriorityLevelOptionLite>(
  options: T[],
  priorityLevelId: string | null | undefined
): PriorityLevelOptionLite | null {
  if (!priorityLevelId) return null;
  return options.find((o) => o.id === priorityLevelId) ?? { id: priorityLevelId, label: priorityLevelId, color: FALLBACK_COLOR, sequenceNumber: 0 };
}

export function priorityLevelLabelMap(options: PriorityLevelOptionLite[]): Record<string, string> {
  return Object.fromEntries(options.map((o) => [o.id, o.label]));
}
