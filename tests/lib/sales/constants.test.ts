import { describe, expect, it } from "vitest";
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  BOARD_PIPELINE_KINDS,
  DEAL_SOURCES,
  DUE_CHOICES,
  FIRST_ACTIVITY_PRESETS,
  LOST_REASONS,
  NEXT_STEP_PRESETS,
  TIME_SLOTS,
} from "@/lib/sales/constants";
import * as constants from "@/lib/sales/constants";

describe("Sales constants", () => {
  it("pins the paging and size limits Plan 2 relies on", () => {
    expect(constants).toMatchObject({
      BOARD_COLUMN_LIMIT: 50,
      LIST_PAGE_SIZE: 50,
      ACTIVITIES_PAGE_SIZE: 50,
      TIMELINE_PAGE_SIZE: 30,
      CONTACT_SEARCH_LIMIT: 8,
      DEFAULT_ROTTING_DAYS: 14,
      MAX_DEAL_CENTS: 1_000_000_000,
      NOTE_MAX_CHARS: 50_000,
      LOST_COMMENT_MAX: 1_000,
      TEXT_FIELD_MAX: 500,
      SUBJECT_MAX: 200,
      TITLE_MAX: 200,
      MISSED_MEETING_BATCH: 200,
      TERRITORY_HOLD_FIELD_KEY: "territory-hold-expiry",
    });
  });

  it("offers half-hour time slots from 7:00 AM to 8:00 PM", () => {
    expect(TIME_SLOTS).toHaveLength(27);
    expect(TIME_SLOTS[0]).toEqual({ value: "07:00", label: "7:00 AM" });
    expect(TIME_SLOTS[1]).toEqual({ value: "07:30", label: "7:30 AM" });
    expect(TIME_SLOTS.find((s) => s.value === "12:00")?.label).toBe("12:00 PM");
    expect(TIME_SLOTS.find((s) => s.value === "13:30")?.label).toBe("1:30 PM");
    expect(TIME_SLOTS[26]).toEqual({ value: "20:00", label: "8:00 PM" });
    expect(new Set(TIME_SLOTS.map((s) => s.value)).size).toBe(27);
  });

  it("labels every activity type and lists them in the mockup order", () => {
    expect([...ACTIVITY_TYPES]).toEqual(["CALL", "MEETING", "TASK", "DEADLINE", "EMAIL", "LUNCH"]);
    expect(ACTIVITY_TYPE_LABELS).toEqual({
      CALL: "Call",
      MEETING: "Meeting",
      TASK: "Task",
      DEADLINE: "Deadline",
      EMAIL: "Email",
      LUNCH: "Lunch",
    });
  });

  it("shows only the Sales and Consulting pipelines on the board", () => {
    expect([...BOARD_PIPELINE_KINDS]).toEqual(["SALES", "CONSULTING"]);
  });

  it("keeps the mockup lists of lost reasons and deal sources", () => {
    expect([...LOST_REASONS]).toEqual([
      "Price",
      "Chose a competitor",
      "Not ready yet",
      "No response",
      "Territory already taken",
      "Other",
    ]);
    expect([...DEAL_SOURCES]).toEqual([
      "Check Availability form",
      "Referral",
      "Direct inquiry",
      "Outbound",
      "Renewal",
      "Added by hand",
    ]);
  });

  it("defines the first-activity and next-step presets", () => {
    expect(FIRST_ACTIVITY_PRESETS).toEqual({
      "call-today": { label: "Call today", type: "CALL", subject: "First call", offsetDays: 0 },
      "call-tomorrow": { label: "Call tomorrow", type: "CALL", subject: "First call", offsetDays: 1 },
      "demo-2-days": { label: "Demo in 2 days", type: "MEETING", subject: "Demo", offsetDays: 2 },
    });
    expect(NEXT_STEP_PRESETS).toEqual([
      { id: "call", label: "Call tomorrow", type: "CALL", subject: "Follow-up call", offsetDays: 1 },
      { id: "email", label: "Email in 2 days", type: "EMAIL", subject: "Check in by email", offsetDays: 2 },
      { id: "meeting", label: "Meeting next week", type: "MEETING", subject: "Meeting", offsetDays: 7 },
    ]);
  });

  it("offers the due-date choices, ending with a free date pick", () => {
    expect(DUE_CHOICES).toEqual([
      { id: "today", label: "Today", offsetDays: 0 },
      { id: "tomorrow", label: "Tomorrow", offsetDays: 1 },
      { id: "2-days", label: "In 2 days", offsetDays: 2 },
      { id: "next-week", label: "Next week", offsetDays: 7 },
      { id: "pick", label: "Pick a date", offsetDays: null },
    ]);
  });

  it("uses no em dash or en dash in any user-facing text", () => {
    const text = JSON.stringify({
      ACTIVITY_TYPE_LABELS,
      LOST_REASONS,
      DEAL_SOURCES,
      FIRST_ACTIVITY_PRESETS,
      NEXT_STEP_PRESETS,
      DUE_CHOICES,
      TIME_SLOTS,
    });
    expect(text).not.toContain("—");
    expect(text).not.toContain("–");
  });
});
