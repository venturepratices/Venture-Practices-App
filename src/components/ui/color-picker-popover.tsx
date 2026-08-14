"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { isValidHexColor } from "@/lib/rich-text-colors";

type Preset = { name: string; value: string };

type Props = {
  label: string;
  icon: LucideIcon;
  presets: readonly Preset[];
  activeColor?: string | null;
  onSelect: (hex: string) => void;
  onClear: () => void;
  clearLabel: string;
  /** Tints the trigger icon with the currently-applied color, e.g. text color. */
  indicatorColor?: string | null;
};

export function ColorPickerPopover({
  label,
  icon: Icon,
  presets,
  activeColor,
  onSelect,
  onClear,
  clearLabel,
  indicatorColor,
}: Props) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

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

  function applyHex() {
    const value = hexInput.trim();
    if (!isValidHexColor(value)) return;
    onSelect(value.startsWith("#") ? value : `#${value}`);
    setOpen(false);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        title={label}
        aria-label={label}
        onMouseDown={(event) => {
          event.preventDefault();
          setOpen((value) => !value);
        }}
        className={cn(
          "flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted",
          open && "bg-accent text-accent-foreground"
        )}
      >
        <span className="relative flex items-center justify-center">
          <Icon className="size-3.5" />
          {indicatorColor ? (
            <span
              className="absolute -bottom-1 left-0 right-0 h-[3px] rounded-full"
              style={{ backgroundColor: indicatorColor }}
            />
          ) : null}
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 space-y-2 rounded-md border bg-card p-2.5 shadow-lg">
          <div className="grid grid-cols-5 gap-1.5">
            {presets.map((preset) => (
              <button
                key={preset.value}
                type="button"
                title={preset.name}
                aria-label={preset.name}
                onClick={() => {
                  onSelect(preset.value);
                  setOpen(false);
                }}
                className={cn(
                  "size-7 rounded-full border transition-transform hover:scale-110",
                  activeColor?.toLowerCase() === preset.value.toLowerCase() && "ring-2 ring-primary ring-offset-1"
                )}
                style={{ backgroundColor: preset.value }}
              />
            ))}
          </div>

          <div className="flex items-center gap-1.5 border-t pt-2">
            <label className="relative flex size-7 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border">
              <input
                type="color"
                value={isValidHexColor(hexInput) ? hexInput : "#000000"}
                onChange={(event) => {
                  setHexInput(event.target.value);
                  onSelect(event.target.value);
                }}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
              <span
                className="pointer-events-none size-full"
                style={{ backgroundColor: isValidHexColor(hexInput) ? hexInput : "transparent" }}
              />
            </label>
            <input
              value={hexInput}
              onChange={(event) => setHexInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyHex();
                }
              }}
              placeholder="#hexcode"
              className="h-7 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-xs"
            />
            <button
              type="button"
              onClick={applyHex}
              disabled={!isValidHexColor(hexInput)}
              className="h-7 shrink-0 rounded-md border px-2 text-xs font-medium hover:bg-muted disabled:opacity-40"
            >
              Add
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            className="w-full rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            {clearLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
