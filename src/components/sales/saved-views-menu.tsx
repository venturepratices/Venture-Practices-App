"use client";

import { useId, useRef, useState } from "react";
import { Bookmark, Check, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { saveSavedViewsRequest } from "@/lib/sales/api-client";
import { addSavedView, isSameView, removeSavedView } from "@/lib/sales/board-client";
import type { BoardQuery, SavedBoardView } from "@/lib/sales/board-query";
import { SAVED_VIEWS_MAX, SAVED_VIEW_NAME_MAX } from "@/lib/sales/constants";
import { endSentence } from "@/lib/sales/format";
import { MUTED_TEXT } from "@/components/sales/sales-pills";
import type { SavedViewItem } from "@/lib/sales/view-preference";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The Deals toolbar's Views menu (Decision 29; Mockup v2 `viewsMenu`,
// `saveViewModal`). Shows each saved view with its summary, ticks the one on
// screen, and lets the owner remove any one. "Save this view..." opens a small
// dialog that calls out what will be stored. Up to 20 views; names unique
// ignoring case (checked by `addSavedView` before any request). Preferences,
// not Sales data, so the writes go through `saveSavedViewsRequest` and nothing
// writes a history row.

// --- Views menu ---

export function SavedViewsMenu({
  items,
  query,
  shownPipelineKey,
  currentSummary,
  onApply,
  onSaved,
}: {
  items: SavedViewItem[];
  query: BoardQuery;
  shownPipelineKey: string;
  /** The summary line of the board as it is right now, shown in the Save dialog. */
  currentSummary: string;
  onApply: (view: SavedBoardView) => void;
  onSaved: (views: SavedBoardView[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [savingOpen, setSavingOpen] = useState(false);

  const atLimit = items.length >= SAVED_VIEWS_MAX;

  async function remove(view: SavedBoardView) {
    const next = removeSavedView(
      items.map((item) => item.view),
      view.name,
    );
    const result = await saveSavedViewsRequest(next);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onSaved(result.data.views);
    toast(endSentence(`Removed ${view.name}`));
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" aria-haspopup="menu" className="pointer-coarse:h-10">
              <Bookmark aria-hidden="true" />
              Views
            </Button>
          }
        />
        <DropdownMenuContent className="w-[min(calc(100vw-2rem),22rem)]">
          <DropdownMenuLabel id="saved-views-heading">Saved views</DropdownMenuLabel>
          {items.length === 0 ? (
            <div className="px-2 pb-2 text-[13px]">
              <p className="m-0 font-semibold">No saved views yet.</p>
              <p className={cn("mt-0.5 mb-0", MUTED_TEXT)}>
                Save the filters you use most, like Proposals out or My overdue.
              </p>
            </div>
          ) : (
            <div role="list" aria-labelledby="saved-views-heading">
              {items.map(({ view, summary }) => {
                const current = isSameView(view, query, shownPipelineKey);
                return (
                  <div
                    key={view.name}
                    role="listitem"
                    className="group/row flex items-center gap-1 rounded-md focus-within:bg-accent hover:bg-accent/60"
                  >
                    <button
                      type="button"
                      aria-current={current ? "true" : undefined}
                      onClick={() => {
                        setOpen(false);
                        onApply(view);
                      }}
                      className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-10"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-primary"
                      >
                        {current ? <Check aria-hidden="true" className="size-4" /> : null}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-semibold" title={view.name}>
                          {view.name}
                        </span>
                        <span className={cn("truncate text-[12px]", MUTED_TEXT)} title={summary}>
                          {summary}
                        </span>
                      </span>
                      {current ? <span className="sr-only">, showing now</span> : null}
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${view.name}`}
                      title="Remove"
                      onClick={() => {
                        void remove(view);
                      }}
                      className="mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-80 outline-hidden hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:size-10"
                    >
                      <X aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={atLimit}
            onClick={(event) => {
              event.preventDefault();
              setOpen(false);
              setSavingOpen(true);
            }}
            className="pointer-coarse:min-h-10"
          >
            <Plus aria-hidden="true" />
            Save this view
            {"…"}
          </DropdownMenuItem>
          <p className={cn("mt-1 mb-0 px-2 py-1 text-[12px]", MUTED_TEXT)}>
            {atLimit
              ? `You can keep up to ${SAVED_VIEWS_MAX} views. Remove one first.`
              : "Only you see your views."}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      <SaveViewDialog
        open={savingOpen}
        onOpenChange={setSavingOpen}
        items={items}
        query={query}
        currentSummary={currentSummary}
        onSaved={(views) => {
          onSaved(views);
          setSavingOpen(false);
        }}
      />
    </>
  );
}

// --- Save this view dialog ---

export function SaveViewDialog({
  open,
  onOpenChange,
  items,
  query,
  currentSummary,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SavedViewItem[];
  query: BoardQuery;
  currentSummary: string;
  onSaved: (views: SavedBoardView[]) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // A fresh open starts blank. Reset during render (not in an effect) so the
  // first paint already carries the empty state, as React's docs now prefer.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setName("");
      setError(null);
    }
  }

  async function save() {
    if (saving) return;
    setError(null);
    const added = addSavedView(
      items.map((item) => item.view),
      name,
      query,
    );
    if (!added.ok) {
      setError(added.error);
      inputRef.current?.focus();
      return;
    }
    setSaving(true);
    const result = await saveSavedViewsRequest(added.views);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      inputRef.current?.focus();
      return;
    }
    toast("View saved.");
    onSaved(result.data.views);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Save this view</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={inputId}>Name</Label>
            <Input
              id={inputId}
              ref={inputRef}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError(null);
              }}
              placeholder="Proposals out"
              maxLength={SAVED_VIEW_NAME_MAX}
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              disabled={saving}
            />
            {error ? (
              <p id={errorId} role="alert" className="m-0 text-[12px] text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogDescription className="m-0 text-[12px] [overflow-wrap:anywhere]">
            Saves what you see now: {currentSummary}. Only you see your views.
          </DialogDescription>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
              className="pointer-coarse:min-h-10"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="pointer-coarse:min-h-10">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
