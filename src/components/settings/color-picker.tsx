"use client";

import { useState } from "react";

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

/**
 * A native color swatch + hex text input, kept in sync with each other and
 * with `value`. Commits on blur (or Enter in the text field) rather than on
 * every drag/keystroke — same "commit on blur" pattern as the label rename
 * inputs in TaskStatusEditor/PriorityLevelEditor, and it avoids firing a
 * PATCH per pixel while someone drags around the native color picker.
 */
export function ColorPicker({
  value,
  onCommit,
  disabled,
}: {
  value: string;
  onCommit: (hex: string) => void;
  disabled?: boolean;
}) {
  const [hex, setHex] = useState(value);
  // Reset local state during render when the prop changes from outside (a
  // successful save elsewhere) — same "adjusting state when a prop changes"
  // pattern TaskBoard uses for its own optimistic-then-synced local state,
  // rather than an effect that would call setState after an extra render.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setHex(value);
  }

  function commit(next: string) {
    const trimmed = next.trim();
    if (!HEX_REGEX.test(trimmed)) {
      setHex(value); // invalid — revert to the last known-good color
      return;
    }
    setHex(trimmed);
    if (trimmed.toLowerCase() !== value.toLowerCase()) onCommit(trimmed);
  }

  return (
    <span className="flex items-center gap-1.5">
      <input
        type="color"
        value={HEX_REGEX.test(hex) ? hex : value}
        onChange={(event) => setHex(event.target.value)}
        onBlur={() => commit(hex)}
        disabled={disabled}
        aria-label="Pick a color"
        className="size-8 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <input
        type="text"
        value={hex}
        onChange={(event) => setHex(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
        disabled={disabled}
        placeholder="#71717a"
        className="h-8 w-24 rounded-md border bg-background px-2 font-mono text-xs uppercase"
      />
    </span>
  );
}
