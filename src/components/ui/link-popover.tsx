"use client";

import { useEffect, useRef, useState } from "react";
import { Link2 } from "lucide-react";

import { cn } from "@/lib/utils";

type Props = {
  active: boolean;
  currentUrl?: string | null;
  onApply: (url: string) => void;
  onRemove: () => void;
};

/**
 * Replaces window.prompt() for the rich-text editor's "Add link" button —
 * some embedded/browser environments block prompt() outright (confirmed via
 * a real Sentry report), so this needs to be a real inline control like every
 * other link-adding UI in the app (Task Links, Client Links).
 */
export function LinkPopover({ active, currentUrl, onApply, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Selecting the freshly-seeded text has to wait a frame — the input doesn't
  // exist in the DOM until this render commits. Seeding the value itself
  // happens in the toggle handler below, not here, so opening the popover
  // doesn't cascade an extra render.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.select());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function apply() {
    const value = urlInput.trim();
    if (!value) return;
    onApply(value);
    setOpen(false);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        title="Add link"
        aria-label="Add link"
        onMouseDown={(event) => {
          event.preventDefault();
          // Re-seed from the current selection's link every time it opens, so
          // editing an existing link starts from that link rather than a
          // stale value left over from the last time it was used.
          if (!open) setUrlInput(currentUrl ?? "https://");
          setOpen((value) => !value);
        }}
        className={cn(
          "flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted",
          (active || open) && "bg-accent text-accent-foreground"
        )}
      >
        <Link2 className="size-3.5" />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 space-y-2 rounded-md border bg-card p-2.5 shadow-lg">
          <input
            ref={inputRef}
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
            placeholder="https://example.com"
            className="h-7 w-full rounded-md border bg-background px-2 text-xs"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={apply}
              disabled={!urlInput.trim()}
              className="h-7 flex-1 rounded-md border px-2 text-xs font-medium hover:bg-muted disabled:opacity-40"
            >
              {active ? "Update link" : "Add link"}
            </button>
            {active ? (
              <button
                type="button"
                onClick={() => {
                  onRemove();
                  setOpen(false);
                }}
                className="h-7 shrink-0 rounded-md border px-2 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
