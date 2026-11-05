"use client";

import { Fragment } from "react";
import { Keyboard } from "lucide-react";

import { cn } from "@/lib/utils";
import { announceShortcut, SHORTCUT_HELP } from "@/lib/sales/shortcuts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// The "Keyboard shortcuts" list (mockup), opened with `?` or the keyboard
// button. There is one instance, owned by SalesShortcuts in the Sales layout,
// so pressing `?` with the list already open never stacks a second copy.

export function ShortcutsHelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3.5 gap-y-2">
          {SHORTCUT_HELP.map(({ keys, label }) => (
            <Fragment key={keys}>
              <dt>
                <kbd className="inline-flex h-5 min-w-6 items-center justify-center rounded-[5px] border border-b-2 bg-card px-1.5 font-sans text-[11px] text-muted-foreground">
                  {keys}
                </kbd>
              </dt>
              <dd>{label}</dd>
            </Fragment>
          ))}
        </dl>
        <DialogDescription className="text-[0.8rem]">Same keys as Pipedrive.</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Opens the shortcuts list, for the Deals toolbar and the Activities header. It
 * announces the `help` shortcut rather than holding its own dialog, so it works
 * on any page inside the Sales layout (where SalesShortcuts is mounted).
 */
export function ShortcutsButton({ className }: { className?: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Keyboard shortcuts"
      title="Keyboard shortcuts (?)"
      className={cn("pointer-coarse:min-h-10 pointer-coarse:min-w-10", className)}
      onClick={() => announceShortcut(window, "help")}
    >
      <Keyboard />
    </Button>
  );
}
