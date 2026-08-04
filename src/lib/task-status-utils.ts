// Pure helpers for resolving a task status id against an already-fetched
// TaskStatusOption[] list — safe to import from client components (unlike
// src/lib/task-status.ts, which pulls in the Prisma client). Server
// components fetch the live list via getTaskStatusOptions() and pass it down
// as a prop; client components use these helpers against that prop.

export type StatusOptionLite = { id: string; label: string; tone: string; isComplete: boolean };

const FALLBACK_TONE = "neutral";

// Falls back to a plain neutral pill showing the raw id rather than crashing
// if a task's statusId doesn't match anything in the passed-in list (e.g. a
// stale reference to a since-deleted status that wasn't reassigned).
export function resolveStatusOption<T extends StatusOptionLite>(options: T[], statusId: string): StatusOptionLite {
  return options.find((o) => o.id === statusId) ?? { id: statusId, label: statusId, tone: FALLBACK_TONE, isComplete: false };
}

export function statusLabelMap(options: StatusOptionLite[]): Record<string, string> {
  return Object.fromEntries(options.map((o) => [o.id, o.label]));
}
