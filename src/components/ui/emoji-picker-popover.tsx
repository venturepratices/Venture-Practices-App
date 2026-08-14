"use client";

import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";

import { cn } from "@/lib/utils";

// A curated common-use set — not exhaustive, just enough to cover everyday
// team-comment use (reactions, status, common objects) without needing an
// emoji-data dependency.
const EMOJIS = [
  "😀", "😂", "😅", "😊", "😉", "😍", "🤔", "😐", "😴", "😢",
  "😡", "😱", "🥳", "😎", "🙌", "👏", "👍", "👎", "🙏", "💪",
  "✅", "❌", "⚠️", "🔥", "⭐", "🎉", "🚀", "💡", "📌", "📎",
  "📅", "⏰", "💰", "📈", "📉", "🔗", "📝", "📞", "✉️", "🔔",
  "❤️", "💯", "👀", "🤝", "🙋", "🚨", "🧠", "☕",
] as const;

export function EmojiPickerPopover({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
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

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        title="Emoji"
        aria-label="Emoji"
        onMouseDown={(event) => {
          event.preventDefault();
          setOpen((value) => !value);
        }}
        className={cn(
          "flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted",
          open && "bg-accent text-accent-foreground"
        )}
      >
        <Smile className="size-3.5" />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-20 mt-1 grid w-56 grid-cols-8 gap-0.5 rounded-md border bg-card p-2 shadow-lg">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onSelect(emoji);
                setOpen(false);
              }}
              className="flex size-6 items-center justify-center rounded text-base hover:bg-muted"
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
