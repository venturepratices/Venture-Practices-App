import { DUE_CHOICES, FILE_MAX_BYTES } from "@/lib/sales/constants";
import type { PanelFile } from "@/lib/sales/deal-panel";
import { dayLabel, isValidDateString } from "@/lib/sales/format";
import type { TimelineEntry } from "@/lib/sales/timeline";
import { addDaysToDateString, dateInputValue } from "@/lib/utils";

// Pure helpers for the slide-in deal panel (deal-panel.tsx and its parts):
// History grouped by day, the composer's due date, when to ask for a next
// step, the stage caption, the Sheet width and when the panel shows. No
// database and no React, so they are unit-tested here and safe in the
// browser. Days are app-time (Eastern) days, never UTC or the viewer's own
// zone.

/**
 * The panel's width on the shared Sheet. SheetContent sets its own width with
 * `data-[side=right]:w-3/4` and `data-[side=right]:sm:max-w-sm`; these use the
 * same `data-[side=right]:` variant so tailwind-merge drops those two. A plain
 * `w-full sm:max-w-[560px]` would survive the merge but lose to the attribute
 * selector's higher specificity, leaving the panel 75% wide on phones and
 * 384px on desktop. Full screen under 640px, 560px above (Decision 5).
 */
export const DEAL_PANEL_SHEET_CLASS = "gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]";

/**
 * Whether the deal panel shows: the URL names a deal (`?deal=`) and no close
 * is on its way. `closing` is the pending state of the transition that
 * replaced the URL on close, so the panel hides at once and the URL catches
 * up later. It ends when the router settles, whether the close landed or a
 * reopen of the same deal replaced it, so the panel never remembers a
 * dismissed deal and a deal reopened mid-close opens again.
 */
export function dealPanelOpen(dealId: string | null, closing: boolean): boolean {
  return dealId !== null && !closing;
}

/**
 * History entries in day groups for the sticky day headers: "Today",
 * "Yesterday", then short dates ("Nov 3"), each day read in app time. The
 * entries arrive newest first (timeline.ts), so the groups do too, and each
 * group keeps the order it was given.
 */
export function groupTimelineByDay(entries: TimelineEntry[], now: Date): { label: string; entries: TimelineEntry[] }[] {
  const groups: { day: string; label: string; entries: TimelineEntry[] }[] = [];
  for (const entry of entries) {
    const at = new Date(entry.at);
    const day = dateInputValue(at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.entries.push(entry);
    else groups.push({ day, label: dayLabel(at, now), entries: [entry] });
  }
  return groups.map(({ label, entries: dayEntries }) => ({ label, entries: dayEntries }));
}

export type DueChoice = "today" | "tomorrow" | "2-days" | "next-week" | "pick";

/**
 * The "YYYY-MM-DD" an activity is due from the composer's due choice: days
 * added to `today` (app time, read with todayDateString() at the moment of the
 * click, so "Tomorrow" at 11:30 PM Eastern is the next Eastern day), or the
 * picked date. Null when "Pick a date" has no real date yet.
 */
export function composerDueDate(choice: DueChoice, today: string, picked: string): string | null {
  if (choice === "pick") return isValidDateString(picked) ? picked : null;
  const offset = DUE_CHOICES.find((option) => option.id === choice)?.offsetDays ?? 0;
  return addDaysToDateString(today, offset);
}

/** What holdEscapeForDraft reads from a key press; React's KeyboardEvent has all of it. */
type EscapeKeyPress = {
  key: string;
  nativeEvent: { isComposing: boolean };
  preventDefault(): void;
  stopPropagation(): void;
};

/**
 * Esc inside the deal panel's composer while it holds unsaved text (F3). The
 * press stops there, before the panel's own Esc handler further up (Base UI's
 * dialog, on the popup and the document), so the panel stays open and the
 * draft stays. Stopping is enough for the document one too: the panel renders
 * in Base UI's portal, and React handles a portal's events on the portal's
 * own node (inside <body>), so the stopped press never reaches the document.
 * With nothing typed (spaces count as nothing) Esc goes on and
 * closes the panel as before; while an IME is composing a word, Esc belongs to
 * the keyboard. `drafts` is every text box's value, both tabs. True when held.
 */
export function holdEscapeForDraft(event: EscapeKeyPress, drafts: readonly string[]): boolean {
  if (event.key !== "Escape" || event.nativeEvent.isComposing) return false;
  if (!drafts.some((text) => text.trim() !== "")) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

/** After a to-do is ticked done: an open deal with nothing else scheduled asks for its next step (spec rule 1). */
export function needsNextStepPrompt(deal: { status: string; openActivityCount: number }): boolean {
  return deal.status === "OPEN" && deal.openActivityCount === 0;
}

/** The first words of a lost deal's strip: "Lost: Price.", or "Lost." when no reason was stored (an imported deal). */
export function lostHeadline(reason: string | null): string {
  const trimmed = reason?.trim();
  return trimmed ? `Lost: ${trimmed}.` : "Lost.";
}

/**
 * Where the stage bar scrolls to when it opens on a phone, where it is wider
 * than the screen (C4): the current stage in the middle of the bar, held
 * between the bar's start and its end. `item` is the current chevron's offset
 * and width inside the bar; a bar that fits stays at 0.
 */
export function centeredScrollLeft(
  item: { start: number; width: number },
  bar: { width: number; scrollWidth: number },
): number {
  const most = Math.max(0, bar.scrollWidth - bar.width);
  return Math.min(most, Math.max(0, item.start + item.width / 2 - bar.width / 2));
}

/**
 * The line under the stage bar: "Demo Complete · 1 day in this stage · 30%
 * win chance" for an open deal. A won or lost deal says its status and where
 * it sits ("Lost · Contract Signed"): the stage's win chance and clock no
 * longer apply to it (C3; a lost deal counts 0% in forecasts, Ruling 19).
 */
export function stageCaption(
  stageName: string,
  days: number,
  probability: number,
  status: "OPEN" | "WON" | "LOST",
): string {
  if (status !== "OPEN") return `${status === "WON" ? "Won" : "Lost"} · ${stageName}`;
  return `${stageName} · ${days} ${days === 1 ? "day" : "days"} in this stage · ${probability}% win chance`;
}

// --- Composer tabs (Activity, Note, and on deals File) ---

/** Which tab the composer shows: Activity (next step), Note, or on deals File. */
export type ComposerTab = "activity" | "note" | "file";

/** The tabs a composer offers for a deal or a lead; the File tab belongs to deals only (Decision 24). */
export function composerTabs(kind: "deal" | "lead"): ComposerTab[] {
  return kind === "deal" ? ["activity", "note", "file"] : ["activity", "note"];
}

/** Arrow keys cycle through the composer's tabs; Home lands on the first, End on the last. */
export function nextTab(tabs: ComposerTab[], current: ComposerTab, key: "ArrowRight" | "ArrowLeft" | "Home" | "End"): ComposerTab {
  if (key === "Home") return tabs[0];
  if (key === "End") return tabs[tabs.length - 1];
  const i = tabs.indexOf(current);
  const step = key === "ArrowRight" ? 1 : -1;
  const next = (i + step + tabs.length) % tabs.length;
  return tabs[next];
}

// --- File rows ---

/**
 * A file's size in the words the panel shows: "1 KB" for anything under a
 * kilobyte (empty files cannot be stored, so 1 is the floor), whole KB under
 * a megabyte, MB with one decimal above it, and no decimal when the file is
 * a whole MB ("4 MB" at the cap).
 */
export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) {
    const kb = Math.max(1, Math.round(bytes / 1024));
    return `${kb} KB`;
  }
  const mb = bytes / (1024 * 1024);
  const rounded = Math.round(mb * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} MB` : `${rounded.toFixed(1)} MB`;
}

/** "Today", "Yesterday", or the short date ("Nov 2"), in app time, lower-cased for the file row. */
function dayWord(date: Date, now: Date): string {
  const label = dayLabel(date, now);
  return label === "Today" || label === "Yesterday" ? label.toLowerCase() : label;
}

/**
 * The small line under a file row's name: size, the stage the deal was in when
 * the file was added, and the person and day. The stage is left out when none
 * was recorded (an imported row). "today" and "yesterday" are read in app
 * time, so an upload at 11:30 PM Eastern on Nov 5 still shows "today" to
 * someone looking at it 15 minutes later in UTC.
 */
export function fileMetaLine(file: PanelFile, now: Date): string {
  const parts = [fileSizeLabel(file.sizeBytes)];
  if (file.stageName) parts.push(file.stageName);
  parts.push(`${file.uploadedBy}, ${dayWord(new Date(file.createdAt), now)}`);
  return parts.join(" · ");
}

/** File extensions the File tab accepts; checked by the browser's `accept` and again by `fileCheck`. */
const UPLOAD_EXTENSIONS = [".pdf", ".docx", ".xlsx", ".png", ".jpg", ".jpeg"];

/**
 * What the File tab refuses before sending a file: no file picked, a type that
 * is not in the list, more than 4 MB, or the final-version box left unticked.
 * The bytes are still checked again at the server; this is the quick guard.
 */
export function fileCheck(file: { name: string; size: number } | null, confirmed: boolean): string | null {
  if (!file) return "Choose a file first.";
  const lower = file.name.toLowerCase();
  if (!UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "Only PDF, Word, Excel, PNG or JPG files can be added.";
  if (file.size > FILE_MAX_BYTES) return "Files can be up to 4 MB.";
  if (!confirmed) return "Tick the box first. Files are for final versions only.";
  return null;
}
