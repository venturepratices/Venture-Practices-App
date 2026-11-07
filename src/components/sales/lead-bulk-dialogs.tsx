"use client";

import { useId, useRef } from "react";

import type { SalesMemberOption } from "@/lib/sales/board";
import { BULK_CONVERT_MAX, BULK_IDS_MAX } from "@/lib/sales/constants";
import { assignChoices, assignMenuLabel, assignNote, bulkLimitNote, deleteLeadsCopy } from "@/lib/sales/leads-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MUTED_TEXT, OwnerAvatar } from "@/components/sales/sales-pills";

// The Leads Inbox bulk bar and its two choices (Mockup v2 `#s=leads-sel`,
// `#s=leads-assign`, `#s=leads-delete`): what to do with the ticked leads,
// who to give them to (a menu, as Mockup v2 draws it), and the admin's delete
// confirm. The caller sends the requests; these only ask.

/** Small buttons on the accent fill, 40px tall on phones and touch screens (Mockup v2). */
const BAR_BUTTON = "max-sm:h-10 pointer-coarse:h-10";

type Viewer = { userId: string; isAdmin: boolean };

export type AssignMenuProps = {
  /** Everyone who may own a lead. */
  members: SalesMemberOption[];
  /** The owner of each ticked lead, so the one who owns them all reads "Owner now". */
  ownerIds: readonly string[];
  viewer: Viewer;
  /** The person picked: the caller assigns the ticked leads to them. */
  onPick: (ownerId: string) => void;
};

/**
 * "Assign to…": a menu of Sales members (avatar, short name, "(you)"), the
 * current owner of every ticked lead not pickable, and a note on what moves
 * with the leads.
 */
export function AssignLeadsMenu({
  count,
  members,
  ownerIds,
  viewer,
  onPick,
  disabled,
  describedBy,
}: AssignMenuProps & { count: number; disabled: boolean; describedBy?: string }) {
  const noteId = useId();
  const { notMine, choices } = assignChoices(members, ownerIds, viewer);
  const names = new Map(members.map((member) => [member.id, member.name]));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button size="sm" variant="outline" aria-describedby={describedBy} className={BAR_BUTTON}>
            Assign to…
          </Button>
        }
      />
      <DropdownMenuContent className="w-60" aria-describedby={noteId}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{assignMenuLabel(count)}</DropdownMenuLabel>
          {choices.map((choice) => (
            <DropdownMenuItem
              key={choice.id}
              disabled={choice.disabled}
              onClick={() => onPick(choice.id)}
              className="gap-2 pointer-coarse:min-h-10"
            >
              {/* The name beside it says who; the avatar is only the colour people know them by. */}
              <span aria-hidden="true" className="contents">
                <OwnerAvatar id={choice.id} name={names.get(choice.id) ?? choice.label} />
              </span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{choice.label}</span>
              {choice.ownerNow ? <span className={cn("text-xs font-medium", MUTED_TEXT)}>Owner now</span> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <p id={noteId} className="px-1.5 py-1 text-xs text-muted-foreground">
          {assignNote(notMine)}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The bar over the Inbox while leads are ticked (Mockup v2): "{n} selected",
 * then Convert to deal (only when `onConvert` is given; Task 21), Assign to…,
 * Archive, Delete (admins) and Clear. Past 25 ticked Convert is off, past 100
 * everything but Clear, each with a line saying so. On phones it sticks to the
 * top while the cards scroll under it.
 */
export function LeadsBulkBar({
  count,
  isAdmin,
  busy = false,
  onConvert,
  assign,
  onArchive,
  onDelete,
  onClear,
}: {
  count: number;
  isAdmin: boolean;
  /** A bulk request is on its way: every action but Clear waits for it. */
  busy?: boolean;
  onConvert?: () => void;
  assign: AssignMenuProps;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const noteId = useId();
  const note = bulkLimitNote(count, onConvert !== undefined);
  const overAll = count > BULK_IDS_MAX;
  const overConvert = count > BULK_CONVERT_MAX;
  const describedBy = (over: boolean) => (over && note ? noteId : undefined);

  return (
    <div
      role="region"
      aria-label="Selected leads"
      className="mb-2.5 flex flex-wrap items-center gap-2 rounded-[10px] bg-accent px-3 py-2 text-[13px] font-semibold text-accent-foreground max-sm:sticky max-sm:top-0 max-sm:z-10 max-sm:shadow"
    >
      <span role="status" className="mr-0.5 tabular-nums">
        {count} selected
      </span>
      {onConvert ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || overConvert}
          aria-describedby={describedBy(overConvert)}
          onClick={onConvert}
          className={BAR_BUTTON}
        >
          Convert to deal
        </Button>
      ) : null}
      <AssignLeadsMenu count={count} {...assign} disabled={busy || overAll} describedBy={describedBy(overAll)} />
      <Button
        size="sm"
        variant="outline"
        disabled={busy || overAll}
        aria-describedby={describedBy(overAll)}
        onClick={onArchive}
        className={BAR_BUTTON}
      >
        Archive
      </Button>
      {isAdmin ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || overAll}
          aria-describedby={describedBy(overAll)}
          onClick={onDelete}
          className={cn(BAR_BUTTON, "text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20")}
        >
          Delete
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={onClear} className={cn(BAR_BUTTON, "hover:bg-background/60 dark:hover:bg-background/30")}>
        Clear
      </Button>
      {note ? (
        <span id={noteId} className="basis-full text-[12.5px] font-medium">
          {note}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The admin's delete confirm (Mockup v2 `#s=leads-delete`): names the leads,
 * says it cannot be undone, points to Archive instead, and starts on Cancel.
 */
export function DeleteLeadsDialog({
  open,
  onOpenChange,
  titles,
  deleting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The ticked leads' titles. */
  titles: readonly string[];
  deleting: boolean;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const copy = deleteLeadsCopy(titles);

  return (
    <Dialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <DialogContent role="alertdialog" showCloseButton={false} initialFocus={cancelRef} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="leading-snug break-words">{copy.title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{copy.names}</p>
        <DialogDescription className="text-foreground">{copy.text}</DialogDescription>
        <p className="text-sm text-muted-foreground">To put a lead aside and keep the option to bring it back, use Archive instead.</p>
        <DialogFooter>
          <Button ref={cancelRef} variant="outline" onClick={() => onOpenChange(false)} className="pointer-coarse:min-h-10">
            Cancel
          </Button>
          <Button variant="destructive" disabled={deleting} onClick={onConfirm} className="pointer-coarse:min-h-10">
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
