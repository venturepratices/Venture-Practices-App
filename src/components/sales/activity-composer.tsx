"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { CalendarPlus, StickyNote } from "lucide-react";
import { toast } from "sonner";

import type { SalesActivityType } from "@/generated/prisma/enums";
import { addNoteRequest, createActivityRequest } from "@/lib/sales/api-client";
import { ACTIVITY_TYPE_LABELS, ACTIVITY_TYPES, DUE_CHOICES, NOTE_MAX_CHARS, SUBJECT_MAX, TIME_SLOTS } from "@/lib/sales/constants";
import { composerDueDate, type DueChoice } from "@/lib/sales/panel-client";
import { todayDateString } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ACTIVITY_ICONS } from "@/components/sales/sales-pills";
import { useSalesShortcut } from "@/components/sales/sales-shortcuts";

// The deal panel's composer card (mockup `.comp`, `composer`): an Activity tab
// to schedule the next step and a Note tab. Both tabs stay mounted, so a half
// typed note survives a look at the Activity tab. The `t` and `e` keys open
// the Activity tab on Task or Email with the subject focused; the panel's
// "Schedule" button and the card menu's "Add activity" do the same through the
// handle. Only the deal owner or an admin sees it (Decision 15).

export type ComposerHandle = { openActivity(type?: SalesActivityType): void };

type Tab = "activity" | "note";

const ANY_TIME = "any";
const DUE_ITEMS = Object.fromEntries(DUE_CHOICES.map((choice) => [choice.id, choice.label]));
const TIME_ITEMS: Record<string, string> = {
  [ANY_TIME]: "Any time",
  ...Object.fromEntries(TIME_SLOTS.map((slot) => [slot.value, slot.label])),
};

const TAB_CLASS =
  "inline-flex items-center gap-1.5 border-b-2 border-transparent px-2.5 py-2 text-[13px] font-semibold whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-selected:border-primary aria-selected:text-primary pointer-coarse:min-h-10 [&_svg]:size-4";

export function ActivityComposer({
  dealId,
  onSaved,
  ref,
}: {
  dealId: string;
  /** After an activity or note is saved: reload the panel. */
  onSaved: () => void;
  ref?: React.Ref<ComposerHandle>;
}) {
  const id = useId();
  const [tab, setTab] = useState<Tab>("activity");
  const [type, setType] = useState<SalesActivityType>("CALL");
  const [subject, setSubject] = useState("");
  const [due, setDue] = useState<DueChoice>("tomorrow");
  const [picked, setPicked] = useState("");
  const [time, setTime] = useState(ANY_TIME);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<Tab | null>(null);
  const [error, setError] = useState<{ tab: Tab; message: string } | null>(null);
  // Bumped to move focus to the subject once the Activity tab is showing.
  const [focusRequest, setFocusRequest] = useState(0);
  const subjectRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ activity: null, note: null });

  useImperativeHandle(ref, () => ({
    openActivity(nextType) {
      setTab("activity");
      if (nextType) setType(nextType);
      setFocusRequest((count) => count + 1);
    },
  }));

  useEffect(() => {
    if (focusRequest > 0) subjectRef.current?.focus();
  }, [focusRequest]);

  useSalesShortcut("new-task", () => {
    setTab("activity");
    setType("TASK");
    setFocusRequest((count) => count + 1);
  });
  useSalesShortcut("new-email", () => {
    setTab("activity");
    setType("EMAIL");
    setFocusRequest((count) => count + 1);
  });

  const dueDateMissing = due === "pick" && composerDueDate("pick", "", picked) === null;

  async function saveActivity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    // "Today" is read at the click, in app time (Review Focus 2).
    const dueDate = composerDueDate(due, todayDateString(), picked);
    if (!dueDate) {
      setError({ tab: "activity", message: "Pick a date." });
      return;
    }
    setError(null);
    setSaving("activity");
    const result = await createActivityRequest(dealId, {
      type,
      subject: subject.trim(),
      dueDate,
      dueTime: time === ANY_TIME ? null : time,
    });
    setSaving(null);
    if (!result.ok) {
      setError({ tab: "activity", message: result.error });
      return;
    }
    setSubject("");
    setDue("tomorrow");
    setPicked("");
    setTime(ANY_TIME);
    toast("Activity saved.");
    onSaved();
  }

  async function saveNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || note.trim() === "") return;
    setError(null);
    setSaving("note");
    const result = await addNoteRequest(dealId, { body: note });
    setSaving(null);
    if (!result.ok) {
      setError({ tab: "note", message: result.error });
      return;
    }
    setNote("");
    toast("Note saved.");
    onSaved();
  }

  /** Arrow keys move between the two tabs (the tab list's own keyboard pattern). */
  function onTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next: Tab = event.key === "Home" ? "activity" : event.key === "End" ? "note" : tab === "activity" ? "note" : "activity";
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  const errorFor = (which: Tab) => (error?.tab === which ? error.message : null);
  const typeLabel = ACTIVITY_TYPE_LABELS[type];

  return (
    <div className="rounded-[10px] border bg-card">
      <div role="tablist" aria-label="Add to this deal" onKeyDown={onTabKeyDown} className="flex border-b px-1.5">
        {(["activity", "note"] as const).map((which) => (
          <button
            key={which}
            ref={(element) => {
              tabRefs.current[which] = element;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${which}`}
            aria-selected={tab === which}
            aria-controls={`${id}-panel-${which}`}
            tabIndex={tab === which ? 0 : -1}
            onClick={() => setTab(which)}
            className={TAB_CLASS}
          >
            {which === "activity" ? <CalendarPlus aria-hidden="true" /> : <StickyNote aria-hidden="true" />}
            {which === "activity" ? "Activity" : "Note"}
          </button>
        ))}
      </div>

      <form
        role="tabpanel"
        id={`${id}-panel-activity`}
        aria-labelledby={`${id}-tab-activity`}
        hidden={tab !== "activity"}
        onSubmit={saveActivity}
        noValidate
        className="grid gap-2.5 p-3"
      >
        <div role="group" aria-label="Activity type" className="flex flex-wrap gap-1">
          {ACTIVITY_TYPES.map((option) => {
            const Icon = ACTIVITY_ICONS[option];
            const label = ACTIVITY_TYPE_LABELS[option];
            return (
              <button
                key={option}
                type="button"
                aria-label={label}
                title={label}
                aria-pressed={type === option}
                onClick={() => setType(option)}
                className="inline-flex h-8 w-9 items-center justify-center rounded-[7px] border bg-background text-muted-foreground outline-none transition-[color,background-color,border-color,scale] duration-150 ease-out hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-accent-foreground motion-reduce:transition-none pointer-coarse:size-10 [&_svg]:size-4"
              >
                <Icon aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <Input
          ref={subjectRef}
          aria-label="Subject"
          placeholder={`${typeLabel}: what is the next step?`}
          maxLength={SUBJECT_MAX}
          autoComplete="off"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          className="pointer-coarse:h-10"
        />

        <div className="flex flex-wrap gap-2 *:min-w-0 *:flex-[1_1_120px]">
          <Select
            items={DUE_ITEMS}
            value={due}
            onValueChange={(next) => {
              if (typeof next === "string" && DUE_CHOICES.some((choice) => choice.id === next)) {
                setDue(next as DueChoice);
                setError(null);
              }
            }}
          >
            <SelectTrigger aria-label="Due" className="w-full pointer-coarse:h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DUE_CHOICES.map((choice) => (
                <SelectItem key={choice.id} value={choice.id} className="pointer-coarse:min-h-10">
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select items={TIME_ITEMS} value={time} onValueChange={(next) => typeof next === "string" && setTime(next)}>
            <SelectTrigger aria-label="Time" className="w-full pointer-coarse:h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_TIME} className="pointer-coarse:min-h-10">
                Any time
              </SelectItem>
              {TIME_SLOTS.map((slot) => (
                <SelectItem key={slot.value} value={slot.value} className="pointer-coarse:min-h-10">
                  {slot.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {due === "pick" ? (
          <Input
            type="date"
            aria-label="Due date"
            value={picked}
            onChange={(event) => {
              setPicked(event.target.value);
              setError(null);
            }}
            aria-invalid={errorFor("activity") === "Pick a date." || undefined}
            className="pointer-coarse:h-10"
          />
        ) : null}

        <ComposerFooter error={errorFor("activity")} errorId={`${id}-activity-error`}>
          <Button type="submit" size="sm" disabled={saving !== null || dueDateMissing} className="pointer-coarse:min-h-10">
            Save activity
          </Button>
        </ComposerFooter>
      </form>

      <form
        role="tabpanel"
        id={`${id}-panel-note`}
        aria-labelledby={`${id}-tab-note`}
        hidden={tab !== "note"}
        onSubmit={saveNote}
        noValidate
        className="grid gap-2.5 p-3"
      >
        <Textarea
          aria-label="Note"
          placeholder="Write a note. Everyone on the deal can see it."
          maxLength={NOTE_MAX_CHARS}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-invalid={errorFor("note") ? true : undefined}
          aria-describedby={errorFor("note") ? `${id}-note-error` : undefined}
          className="min-h-20"
        />
        <ComposerFooter error={errorFor("note")} errorId={`${id}-note-error`}>
          <Button type="submit" size="sm" disabled={saving !== null || note.trim() === ""} className="pointer-coarse:min-h-10">
            Save note
          </Button>
        </ComposerFooter>
      </form>
    </div>
  );
}

/** The save button on the right, with a refusal from the server on the left of it. */
function ComposerFooter({ error, errorId, children }: { error: string | null; errorId: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
      {error ? (
        <p id={errorId} role="alert" className="m-0 mr-auto min-w-0 text-[0.8rem] text-destructive">
          {error}
        </p>
      ) : null}
      {children}
    </div>
  );
}
