"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, User, X } from "lucide-react";
import { toast } from "sonner";

import { updateDealRequest } from "@/lib/sales/api-client";
import type { BoardStage } from "@/lib/sales/board";
import { TITLE_MAX } from "@/lib/sales/constants";
import type { DealPanelData } from "@/lib/sales/deal-panel";
import { daysInStage, formatMoney, shortName } from "@/lib/sales/format";
import { centeredScrollLeft, stageCaption } from "@/lib/sales/panel-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SheetClose } from "@/components/ui/sheet";
import { OwnerAvatar } from "@/components/sales/sales-pills";
import type { MoveHooks, MovableDeal, useDealMoves } from "@/components/sales/use-deal-moves";

// The top of the deal panel (mockup `.ph`): where the deal sits, its name
// (edited in place), value, person, owner, Won and Lost (or Reopen), and the
// stage bar with its caption. Stage, status and value changes go through
// useDealMoves, so the panel follows the same rules and toasts as the board.
// On a phone the header wraps and Won and Lost take their own line.

type Moves = Pick<ReturnType<typeof useDealMoves>, "move" | "setStatus" | "editValue">;

const PILL = "inline-flex shrink-0 items-center rounded-full px-[7px] py-0.5 text-[11px] leading-[1.4] font-semibold";

export function DealPanelHeader({
  data,
  now,
  moves,
  titleId,
  onChanged,
}: {
  data: DealPanelData;
  now: Date;
  moves: Moves;
  /** The id of the deal's name: the panel is labelled by it. */
  titleId: string;
  /** After a change is saved: reload the panel. */
  onChanged: () => void;
}) {
  const { deal, pipeline, stages, canEdit } = data;
  const [statusBusy, setStatusBusy] = useState(false);
  const stage = stages.find((option) => option.id === deal.stageId) ?? null;
  const movable: MovableDeal = {
    id: deal.id,
    title: deal.title,
    stageId: deal.stageId,
    valueCents: deal.valueCents,
    mrrCents: deal.mrrCents,
  };
  const open = deal.status === "OPEN";

  async function setStatus(status: "WON" | "LOST" | "OPEN") {
    if (statusBusy) return;
    setStatusBusy(true);
    try {
      await moves.setStatus(movable, status);
    } finally {
      setStatusBusy(false);
    }
  }

  const days = daysInStage(new Date(deal.stageEnteredAt), now);

  return (
    <header className="flex-none border-b px-4 pt-3 pb-3 sm:px-[18px] sm:pt-3.5">
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <p className="m-0 flex min-w-0 items-center gap-1.5">
          <span className="truncate">{pipeline.name}</span>
          <ArrowRight aria-hidden="true" className="size-3 shrink-0" />
          <span className="sr-only">, stage </span>
          <span className="truncate">{stage?.name}</span>
        </p>
        {deal.status === "WON" ? (
          <span className={cn(PILL, "bg-status-success text-status-success-foreground")}>Won</span>
        ) : deal.status === "LOST" ? (
          <span
            className={cn(PILL, "bg-status-danger text-status-danger-foreground")}
            title={deal.lostReason ? `Lost: ${deal.lostReason}` : undefined}
          >
            Lost
          </span>
        ) : null}
        <PanelCloseButton />
      </div>

      {/* The panel's name. Pointing the panel at the box itself would name it "Deal name" (the box's own label) in Chrome. */}
      <h2 id={titleId} className="sr-only">
        {deal.title}
      </h2>
      <TitleInput dealId={deal.id} title={deal.title} canEdit={canEdit} onSaved={onChanged} />

      <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[13px]">
        <button
          type="button"
          title="Edit value"
          aria-label={`${formatMoney(deal.valueCents)}${deal.mrrCents > 0 ? ` · ${formatMoney(deal.mrrCents)}/mo` : ""}, edit value`}
          disabled={!canEdit || !stage}
          aria-disabled={!canEdit || undefined}
          onClick={() => stage && moves.editValue(movable, stage)}
          className="-mx-1 rounded-md px-1 text-left tabular-nums outline-none transition-colors enabled:hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default pointer-coarse:min-h-10"
        >
          <span className="text-[15px] font-[650]">{formatMoney(deal.valueCents)}</span>
          {deal.mrrCents > 0 ? (
            <span className="font-medium text-muted-foreground"> · {formatMoney(deal.mrrCents)}/mo</span>
          ) : null}
        </button>

        {deal.person ? (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <User aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="sr-only">Person: </span>
            <span className="truncate">{deal.person.name}</span>
          </span>
        ) : null}

        <OwnerPicker data={data} onChanged={onChanged} />

        <span className="ml-auto flex gap-1.5 max-sm:ml-0 max-sm:w-full">
          {open ? (
            <>
              <Button
                size="sm"
                disabled={!canEdit || statusBusy}
                aria-disabled={!canEdit || undefined}
                onClick={() => void setStatus("WON")}
                // green-700, not the mockup's green-600: white on green-600 is 3.2:1, under spec 7.11's 4.5:1 (Decision 34).
                className="bg-green-700 text-white hover:bg-green-800 focus-visible:ring-green-700/40 max-sm:flex-1 pointer-coarse:min-h-10"
              >
                Won
              </Button>
              <Button
                size="sm"
                disabled={!canEdit || statusBusy}
                aria-disabled={!canEdit || undefined}
                onClick={() => void setStatus("LOST")}
                className="bg-red-600 text-white hover:bg-red-600/90 focus-visible:ring-red-600/40 max-sm:flex-1 pointer-coarse:min-h-10"
              >
                Lost
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit || statusBusy}
              aria-disabled={!canEdit || undefined}
              onClick={() => void setStatus("OPEN")}
              className="max-sm:flex-1 pointer-coarse:min-h-10"
            >
              Reopen
            </Button>
          )}
        </span>
      </div>

      {/* Keyed by where the deal is stored, so a shown-early move resets once the reload lands. */}
      <StageBar
        key={`${deal.stageId}:${deal.status}`}
        stages={stages}
        currentId={deal.stageId}
        disabled={!open || !canEdit}
        onMove={(target, hooks) => void moves.move(movable, target, hooks)}
      />
      {stage ? (
        <p className="mt-[5px] mb-0 text-[11.5px] text-muted-foreground">
          {stageCaption(stage.name, days, stage.probability, deal.status)}
        </p>
      ) : null}
    </header>
  );
}

/** The close icon button, also shown while the panel loads or cannot show a deal. */
export function PanelCloseButton() {
  return (
    <SheetClose
      render={<Button variant="ghost" size="icon" className="-mr-1.5 ml-auto size-[30px] shrink-0 pointer-coarse:size-10" />}
      aria-label="Close (Esc)"
      title="Close (Esc)"
    >
      <X aria-hidden="true" />
    </SheetClose>
  );
}

/**
 * The deal name as a heading-sized box with no border until hover or focus.
 * Saved when the box is left or Enter is pressed, if it changed and is not
 * blank; Esc puts the saved name back (a second Esc closes the panel).
 */
function TitleInput({
  dealId,
  title,
  canEdit,
  onSaved,
}: {
  dealId: string;
  title: string;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  // A reload brought a different stored name: show it.
  const [stored, setStored] = useState(title);
  if (title !== stored) {
    setStored(title);
    setDraft(title);
  }

  async function commit() {
    const next = draft.trim();
    if (next === "") {
      setDraft(title);
      return;
    }
    if (next === title || saving) return;
    setSaving(true);
    const result = await updateDealRequest(dealId, { title: next });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      setDraft(title);
      return;
    }
    onSaved();
  }

  return (
    <input
      aria-label="Deal name"
      value={draft}
      maxLength={TITLE_MAX}
      autoComplete="off"
      spellCheck={false}
      disabled={!canEdit}
      aria-disabled={!canEdit || undefined}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape" && draft !== title) {
          event.preventDefault();
          event.stopPropagation();
          setDraft(title);
        }
      }}
      className="mt-1 -ml-[3px] block w-[calc(100%+3px)] min-w-0 truncate rounded-[5px] border border-transparent bg-transparent px-[3px] py-px text-[19px] leading-snug font-semibold text-foreground outline-none transition-colors enabled:hover:border-input focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
    />
  );
}

/** The owner's avatar and a compact list of Sales members by short name. A new owner takes the open to-dos (Decision 15). */
function OwnerPicker({ data, onChanged }: { data: DealPanelData; onChanged: () => void }) {
  const { deal, members, canEdit } = data;
  const [saving, setSaving] = useState(false);
  // Someone who lost Sales access can still own old deals; keep them in the list so the box names them.
  const options = members.some((member) => member.id === deal.owner.id) ? members : [deal.owner, ...members];
  const items = Object.fromEntries(options.map((member) => [member.id, shortName(member.name)]));

  async function change(next: unknown) {
    if (typeof next !== "string" || next === deal.owner.id || saving) return;
    setSaving(true);
    const result = await updateDealRequest(deal.id, { ownerId: next });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast(`Owner changed to ${items[next] ?? "the new owner"}.`);
    onChanged();
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="inline-flex">
        <OwnerAvatar id={deal.owner.id} name={deal.owner.name} />
      </span>
      <Select items={items} value={deal.owner.id} onValueChange={(next) => void change(next)} disabled={!canEdit || saving}>
        <SelectTrigger
          aria-label="Owner"
          aria-disabled={!canEdit || undefined}
          className="h-7 gap-1 px-1.5 text-[13px] disabled:opacity-100 pointer-coarse:h-10"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((member) => (
            <SelectItem key={member.id} value={member.id} className="pointer-coarse:min-h-10">
              {shortName(member.name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  );
}

// Under the md breakpoint (768px) and on every touch screen, tablets included:
// each chevron keeps its whole name at 12px (growing to fill a short pipeline,
// never shrinking) and the bar scrolls sideways inside itself, instead of
// squeezing every stage in as cut-off names or bare colours (C4, M11). A touch
// cannot show the `title`. A mouse on a wider screen shares the width out as
// in the mockup.
const STAGE_BUTTON =
  "h-6 min-w-0 flex-1 px-2.5 text-[10.5px] font-semibold whitespace-nowrap outline-none transition-[filter,background-color,color] duration-150 [clip-path:polygon(0_0,calc(100%_-_7px)_0,100%_50%,calc(100%_-_7px)_100%,0_100%,7px_50%)] first:rounded-l-[5px] first:[clip-path:polygon(0_0,calc(100%_-_7px)_0,100%_50%,calc(100%_-_7px)_100%,0_100%)] enabled:hover:brightness-95 focus-visible:brightness-90 focus-visible:inset-ring-2 focus-visible:inset-ring-ring disabled:cursor-default motion-reduce:transition-none pointer-coarse:h-10 max-md:min-w-20 max-md:flex-[1_0_auto] max-md:px-3.5 max-md:text-xs pointer-coarse:min-w-20 pointer-coarse:flex-[1_0_auto] pointer-coarse:px-3.5 pointer-coarse:text-xs";

// A stage not reached yet. On the muted fill the muted grey is 4.32:1 in light,
// under spec 7.11's 4.5:1, so light uses slate-600, one step darker in the same
// hue (6.9:1); dark keeps the muted grey (5.5:1) (M12).
const NOT_REACHED_STAGE = "bg-muted text-slate-600 dark:text-muted-foreground";

/**
 * One chevron per stage (mockup `.stagebar`): passed stages green, the current
 * one a darker green (green-700 and green-800, so their white names pass AA,
 * Decision 34). A click moves the deal there, shown at once and taken back if
 * the move is refused. Locked while the deal is closed or read-only. On a
 * phone or tablet the bar can be wider than the panel and opens scrolled to
 * the deal's stage (a bar that fits stays at its start); it is keyed by the
 * stored stage, so it does so again after a move.
 */
function StageBar({
  stages,
  currentId,
  disabled,
  onMove,
}: {
  stages: BoardStage[];
  currentId: string;
  disabled: boolean;
  onMove: (target: BoardStage, hooks: MoveHooks) => void;
}) {
  const [shownId, setShownId] = useState(currentId);
  const currentIndex = stages.findIndex((stage) => stage.id === shownId);
  const barRef = useRef<HTMLDivElement>(null);

  // Before the first paint, so the bar never shows its start and then jumps.
  useLayoutEffect(() => {
    const bar = barRef.current;
    const current = bar?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!bar || !current) return;
    bar.scrollLeft = centeredScrollLeft(
      { start: current.offsetLeft, width: current.offsetWidth },
      { width: bar.clientWidth, scrollWidth: bar.scrollWidth },
    );
  }, []);

  return (
    <div
      ref={barRef}
      role="group"
      aria-label="Stage"
      aria-disabled={disabled || undefined}
      // `relative` also makes the bar the chevrons' offset parent, which the scroll above measures from.
      className="relative mt-3 flex gap-0.5 max-md:overflow-x-auto max-md:overscroll-x-contain pointer-coarse:overflow-x-auto pointer-coarse:overscroll-x-contain"
    >
      {stages.map((stage, index) => (
        <button
          key={stage.id}
          type="button"
          title={stage.name}
          aria-label={stage.name}
          aria-current={index === currentIndex ? "step" : undefined}
          disabled={disabled}
          onClick={() =>
            onMove(stage, { optimistic: () => setShownId(stage.id), revert: () => setShownId(currentId) })
          }
          className={cn(
            STAGE_BUTTON,
            index < currentIndex
              ? "bg-green-700 text-white"
              : index === currentIndex
                ? "bg-green-800 text-white"
                : NOT_REACHED_STAGE,
          )}
        >
          <span className="block truncate">{stage.name}</span>
        </button>
      ))}
    </div>
  );
}
