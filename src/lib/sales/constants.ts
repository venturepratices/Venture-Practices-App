import type { SalesActivityType } from "@/generated/prisma/enums";

// Limits, choices and wording shared by the Sales board, the deal panel and
// their routes. No prisma and no server-only imports, so client components can
// load it too (the type import above is erased at build time).

// --- Paging and size limits (keep the board fast with many users) ---

/** Cards fetched per board column; past this the column footer points to the list view. */
export const BOARD_COLUMN_LIMIT = 50;
export const LIST_PAGE_SIZE = 50;
export const ACTIVITIES_PAGE_SIZE = 50;
export const TIMELINE_PAGE_SIZE = 30;
export const CONTACT_SEARCH_LIMIT = 8;

/** Days an open deal can sit in a stage before it rots (amber card). */
export const DEFAULT_ROTTING_DAYS = 14;

/** $10,000,000 in cents. Money is always integer cents. */
export const MAX_DEAL_CENTS = 1_000_000_000;
export const NOTE_MAX_CHARS = 50_000;
export const LOST_COMMENT_MAX = 1_000;
export const TEXT_FIELD_MAX = 500;
export const SUBJECT_MAX = 200;
export const TITLE_MAX = 200;
/** Most missed meetings the daily No Show job handles in one run. */
export const MISSED_MEETING_BATCH = 200;

/** Key of the custom field that drives the territory hold check (spec rule 4). */
export const TERRITORY_HOLD_FIELD_KEY = "territory-hold-expiry";

/** Delivery pipelines hold deals that are already won, so the board lists only these kinds. */
export const BOARD_PIPELINE_KINDS = ["SALES", "CONSULTING"] as const;

// --- Activities ---

export const ACTIVITY_TYPES = ["CALL", "MEETING", "TASK", "DEADLINE", "EMAIL", "LUNCH"] as const;

export const ACTIVITY_TYPE_LABELS: Record<SalesActivityType, string> = {
  CALL: "Call",
  MEETING: "Meeting",
  TASK: "Task",
  DEADLINE: "Deadline",
  EMAIL: "Email",
  LUNCH: "Lunch",
};

// --- Deal choices ---

export const LOST_REASONS = [
  "Price",
  "Chose a competitor",
  "Not ready yet",
  "No response",
  "Territory already taken",
  "Other",
] as const;

export const DEAL_SOURCES = [
  "Check Availability form",
  "Referral",
  "Direct inquiry",
  "Outbound",
  "Renewal",
  "Added by hand",
] as const;

type ActivityPreset = {
  label: string;
  type: SalesActivityType;
  subject: string;
  /** Days from today, in app time. */
  offsetDays: number;
};

/** The "First activity" choices in the Add deal dialog. */
export const FIRST_ACTIVITY_PRESETS: Record<"call-today" | "call-tomorrow" | "demo-2-days", ActivityPreset> = {
  "call-today": { label: "Call today", type: "CALL", subject: "First call", offsetDays: 0 },
  "call-tomorrow": { label: "Call tomorrow", type: "CALL", subject: "First call", offsetDays: 1 },
  "demo-2-days": { label: "Demo in 2 days", type: "MEETING", subject: "Demo", offsetDays: 2 },
};

/** The quick choices in the "Schedule the next step" prompt after a stage move. */
export const NEXT_STEP_PRESETS: ({ id: string } & ActivityPreset)[] = [
  { id: "call", label: "Call tomorrow", type: "CALL", subject: "Follow-up call", offsetDays: 1 },
  { id: "email", label: "Email in 2 days", type: "EMAIL", subject: "Check in by email", offsetDays: 2 },
  { id: "meeting", label: "Meeting next week", type: "MEETING", subject: "Meeting", offsetDays: 7 },
];

/** Due-date choices when scheduling an activity. `null` offset means the person picks the date. */
export const DUE_CHOICES: { id: string; label: string; offsetDays: number | null }[] = [
  { id: "today", label: "Today", offsetDays: 0 },
  { id: "tomorrow", label: "Tomorrow", offsetDays: 1 },
  { id: "2-days", label: "In 2 days", offsetDays: 2 },
  { id: "next-week", label: "Next week", offsetDays: 7 },
  { id: "pick", label: "Pick a date", offsetDays: null },
];

/** Half-hour times from 7:00 AM to 8:00 PM: "07:00" / "7:00 AM" through "20:00" / "8:00 PM" (27 entries). */
export const TIME_SLOTS: { value: string; label: string }[] = Array.from({ length: 27 }, (_, i) => {
  const minutesSinceMidnight = 7 * 60 + i * 30;
  const hour24 = Math.floor(minutesSinceMidnight / 60);
  const minutes = minutesSinceMidnight % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const mm = String(minutes).padStart(2, "0");
  return {
    value: `${String(hour24).padStart(2, "0")}:${mm}`,
    label: `${hour12}:${mm} ${hour24 < 12 ? "AM" : "PM"}`,
  };
});
