// Pure column-definition data for the task list — split out of task-row.tsx
// so a server component can compute a default `visibleColumns` set without
// having to import the client-only TaskRow module.

// Column widths keyed by the same column keys used by the visibility menu —
// order here defines column order in the grid. "Client" is only included
// when showClient is on (the per-client Tasks tab never shows its own name).
// defaultWidth is a starting point only — the user can drag each column
// wider (or narrower) and that preference persists (see useColumnWidths).
// Order here defines left-to-right column order in the grid — "Priority" is
// deliberately last so it sits immediately beside the (always-shown, fixed)
// Status pill at the end of the row. "Date created" defaults to hidden (see
// DEFAULT_HIDDEN_COLUMNS below) to make room for it without widening the
// row — still toggleable back on via the Columns menu, just not shown by
// default.
export const OPTIONAL_COLUMNS: { key: string; label: string; defaultWidth: number; clientOnly?: boolean }[] = [
  { key: "client", label: "Client", defaultWidth: 120, clientOnly: true },
  { key: "due", label: "Due", defaultWidth: 110 },
  { key: "assignee", label: "Assignee", defaultWidth: 130 },
  { key: "relatedTo", label: "Related to", defaultWidth: 150 },
  { key: "createdBy", label: "Created by", defaultWidth: 120 },
  { key: "dateCreated", label: "Date created", defaultWidth: 110 },
  { key: "priority", label: "Priority", defaultWidth: 110 },
];

export const TASK_COLUMN_KEYS = OPTIONAL_COLUMNS.map((c) => c.key);

export const DEFAULT_HIDDEN_COLUMNS = ["dateCreated"];

export function taskColumnsFor(showClient?: boolean) {
  return OPTIONAL_COLUMNS.filter((c) => !c.clientOnly || showClient);
}

export function defaultTaskColumnWidths(showClient?: boolean) {
  return Object.fromEntries(taskColumnsFor(showClient).map((c) => [c.key, c.defaultWidth]));
}
