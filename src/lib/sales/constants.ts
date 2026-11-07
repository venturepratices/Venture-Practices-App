import type { SalesActivityType } from "@/generated/prisma/enums";

// Limits, choices and wording shared by the Sales board, the deal panel and
// their routes. No prisma and no server-only imports, so client components can
// load it too (the type import above is erased at build time).

// --- Paging and size limits (keep the board fast with many users) ---

/** Cards fetched per board column; past this the column footer points to the list view. */
export const BOARD_COLUMN_LIMIT = 50;
export const LIST_PAGE_SIZE = 50;
export const ACTIVITIES_PAGE_SIZE = 50;
export const LEADS_PAGE_SIZE = 50;
export const CONTACTS_PAGE_SIZE = 50;
export const TIMELINE_PAGE_SIZE = 30;
export const CONTACT_SEARCH_LIMIT = 8;
/** Possible duplicates the contact panel names at most. */
export const DUPLICATE_MATCHES_MAX = 5;
/** Deals, leads or people a contact panel lists at most; the true count shows past it. */
export const CONTACT_LINKED_ROWS = 20;
/** Most leads one bulk-bar request may change; each still runs in its own transaction. */
export const BULK_IDS_MAX = 100;
/** Most leads one bulk convert may turn into deals; each still runs in its own transaction. */
export const BULK_CONVERT_MAX = 25;
/** Most deals, leads, notes, activities and people one merge of duplicate contacts may move, all in one transaction. */
export const MERGE_LINKED_MAX = 500;

// --- Sales dashboard and Insights ---

/** Rows each dashboard box lists ("Today and overdue", "No next step", "Deals in Follow-Up"). */
export const DASHBOARD_LIST_ROWS = 8;
/** History lines the dashboard's "Recent activity" box shows. */
export const RECENT_ACTIVITY_ROWS = 7;
/** History rows "Recent activity" reads per page while it looks for lines on deals the viewer may see. */
export const RECENT_FEED_SCAN = 50;
/** Pages "Recent activity" reads at most, so a viewer who sees few deals never scans the whole log. */
export const RECENT_FEED_PAGES = 4;
/** Won deals Insights reads at most for one range; past it the page says the charts are partial. */
export const INSIGHTS_ROW_CAP = 5000;
/** Key of the stage the dashboard's "Deals in Follow-Up" box lists. */
export const FOLLOW_UP_STAGE_KEY = "follow-up";

// --- Deal files (final versions, stored in the private Blob store) ---

/** Largest file one upload may carry: Vercel's request body limit, so the copy says "Up to 4 MB". */
export const FILE_MAX_BYTES = 4 * 1024 * 1024;
/** Room for the multipart wrapping around the file (boundaries, the tick field, headers). */
export const FORM_OVERHEAD_BYTES = 64 * 1024;
/** Live (not removed) files one deal may hold; the panel lists at most this many. */
export const FILES_PER_DEAL_MAX = 50;
/** Files one person may add per app-time day, removed ones included. */
export const FILES_PER_PERSON_DAY = 30;
/** Bytes one person may add per app-time day, removed ones included. */
export const FILE_BYTES_PER_PERSON_DAY = 100 * 1024 * 1024;
/** Longest stored display name, extension included. */
export const FILE_NAME_MAX = 200;
/** Every Sales file's pathname in the store starts with this; downloads refuse anything else. */
export const FILE_PATH_PREFIX = "sales-files/";

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

/** Key of the lead custom field that holds the practice's ZIP (the Inbox's "· ZIP {zip}" line). */
export const PRACTICE_ZIP_FIELD_KEY = "practice-zip";

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

/** The source of a deal made with the Add deal dialog, and the default for a new lead added by hand. */
export const HAND_MADE_SOURCE = "Added by hand" satisfies (typeof DEAL_SOURCES)[number];

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

/** The call a converted deal gets, due today for the deal owner, when no open activity moved with the lead. */
export const CONVERT_FIRST_CALL_SUBJECT = "First call after conversion";

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
