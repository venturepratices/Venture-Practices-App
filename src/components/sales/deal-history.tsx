"use client";

import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  ArrowRight,
  CalendarPlus,
  CalendarX,
  Check,
  CircleDollarSign,
  Lock,
  Plus,
  RotateCcw,
  Settings2,
  StickyNote,
  Trash2,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { editNoteRequest } from "@/lib/sales/api-client";
import { NOTE_MAX_CHARS } from "@/lib/sales/constants";
import { clockTime } from "@/lib/sales/format";
import { groupTimelineByDay } from "@/lib/sales/panel-client";
import type { TimelineEntry, TimelineIcon } from "@/lib/sales/timeline";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SECTION_HEADING } from "@/components/sales/next-steps";

// The panel's "History" (mockup `.tl`): the deal's locked log, newest first,
// under sticky day headers ("Today", "Yesterday", "Nov 3"). Each line says
// what happened and who did it. Notes show their text in a warm box, as plain
// text only (Decision 16); the note's author or an admin can edit it, and the
// old text stays in the log. Older entries load with "Show older" (spec 7.8).

const ICONS: Record<TimelineIcon, LucideIcon> = {
  created: Plus,
  stage: ArrowRight,
  won: Check,
  lost: X,
  reopened: RotateCcw,
  value: CircleDollarSign,
  owner: UserRound,
  field: Settings2,
  deleted: Trash2,
  activity: CalendarPlus,
  done: Check,
  missed: CalendarX,
  note: StickyNote,
};

export type HistoryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: TimelineEntry[]; hasOlder: boolean; loadingOlder: boolean };

export function DealHistory({
  history,
  now,
  onShowOlder,
  onRetry,
  onSaved,
}: {
  history: HistoryState;
  now: Date;
  onShowOlder: () => void;
  onRetry: () => void;
  /** After a note edit is saved: reload the panel. */
  onSaved: () => void;
}) {
  const id = useId();

  return (
    <section aria-labelledby={`${id}-heading`} className="grid gap-2">
      <h3 id={`${id}-heading`} className={SECTION_HEADING}>
        History
        <span
          title="Nobody can edit or delete history"
          className="inline-flex items-center gap-1 rounded-full bg-muted px-[7px] py-0.5 text-[11px] font-semibold tracking-normal text-muted-foreground normal-case [&_svg]:size-3"
        >
          <Lock aria-hidden="true" />
          locked
        </span>
      </h3>

      {history.status === "loading" ? (
        <p className="m-0 text-[13px] text-muted-foreground" aria-live="polite">
          Loading history...
        </p>
      ) : history.status === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <span>Could not load the history.</span>
          <Button variant="link" size="sm" onClick={onRetry} className="h-auto px-0 pointer-coarse:min-h-10">
            Try again
          </Button>
        </div>
      ) : history.entries.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <>
          {groupTimelineByDay(history.entries, now).map((group) => (
            <div key={`${group.label}:${group.entries[0].id}`}>
              {/* Sticks to the top of the panel's scrolling body (its 14px top padding). */}
              <h4 className="sticky -top-3.5 z-[1] m-0 bg-popover py-[3px] text-[11.5px] font-bold text-muted-foreground">
                {group.label}
              </h4>
              <ol className="m-0 list-none p-0">
                {group.entries.map((entry) => (
                  <HistoryLine key={entry.id} entry={entry} onSaved={onSaved} />
                ))}
              </ol>
            </div>
          ))}
          {history.hasOlder ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onShowOlder}
              disabled={history.loadingOlder}
              className="justify-self-center pointer-coarse:min-h-10"
            >
              {history.loadingOlder ? "Loading..." : "Show older"}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Who made the change, as the small line under it says it. */
function actorLabel(entry: TimelineEntry): string {
  switch (entry.actorType) {
    case "SYSTEM":
      return "Sales rule";
    case "WEBHOOK":
      return "Webhook";
    case "BOT":
      return entry.actorName ?? "Bot";
    case "USER":
      return entry.actorName ?? "Former team member";
  }
}

function HistoryLine({ entry, onSaved }: { entry: TimelineEntry; onSaved: () => void }) {
  const Icon = ICONS[entry.icon];

  return (
    <li className="flex gap-2.5 py-1.5 text-[13px]">
      <span
        aria-hidden="true"
        className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] bg-muted text-muted-foreground [&_svg]:size-3.5"
      >
        <Icon />
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 break-words">{entry.text}</p>
        {/* Who and when (spec 7.8): the day is the group's header, the time is here, readable on touch and by screen readers. */}
        <p className="m-0 text-xs text-muted-foreground">
          {actorLabel(entry)} ·{" "}
          <time dateTime={entry.at} title={formatDateTime(entry.at)} className="tabular-nums">
            {clockTime(new Date(entry.at))}
          </time>
        </p>
        {entry.note ? <NoteBox note={entry.note} onSaved={onSaved} /> : null}
      </div>
    </li>
  );
}

function NoteBox({ note, onSaved }: { note: NonNullable<TimelineEntry["note"]>; onSaved: () => void }) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  // A reload brought different stored text: start any next edit from it.
  const [stored, setStored] = useState(note.body);
  if (note.body !== stored) {
    setStored(note.body);
    setDraft(note.body);
  }

  /** Leaves the edit box and puts focus back on "Edit", where the person started. */
  function finish() {
    flushSync(() => {
      setEditing(false);
      setError(null);
    });
    editRef.current?.focus();
  }

  function cancel() {
    setDraft(note.body);
    finish();
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (draft.trim() === note.body.trim()) {
      cancel();
      return;
    }
    setSaving(true);
    const result = await editNoteRequest(note.id, { body: draft });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    finish();
    toast("Note saved.");
    onSaved();
  }

  if (editing) {
    return (
      <form onSubmit={save} className="mt-1 grid gap-2" noValidate>
        <Textarea
          aria-label="Edit note"
          autoFocus
          maxLength={NOTE_MAX_CHARS}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Esc leaves the edit without closing the panel.
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-h-20"
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {error ? (
            <p id={`${id}-error`} role="alert" className="m-0 mr-auto text-[0.8rem] text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={cancel} className="pointer-coarse:min-h-10">
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving || draft.trim() === ""} className="pointer-coarse:min-h-10">
            Save
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-1 rounded-lg bg-status-warning/40 px-2.5 py-2 text-[13px] text-foreground">
      <p className="m-0 break-words whitespace-pre-wrap">{note.body}</p>
      {note.canEdit ? (
        <Button
          ref={editRef}
          variant="link"
          size="xs"
          onClick={() => setEditing(true)}
          aria-label="Edit note"
          className="mt-0.5 h-auto px-0 text-xs text-muted-foreground hover:text-foreground pointer-coarse:min-h-10"
        >
          Edit
        </Button>
      ) : null}
    </div>
  );
}
