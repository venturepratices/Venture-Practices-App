"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import { cn, initialsOf } from "@/lib/utils";

export type MentionItem = { id: string; name: string };

type Props = {
  items: MentionItem[];
  // Tiptap's Mention node schema stores {id, label} — not our {id, name}
  // shape — so the label mapping happens right here, at the one spot that
  // hands a selection off to Tiptap's command().
  command: (item: { id: string; label: string }) => void;
};

export type MentionListHandle = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
};

export const MentionList = forwardRef<MentionListHandle, Props>(function MentionList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => setSelectedIndex(0), [items]);

  function selectItem(index: number) {
    const item = items[index];
    if (item) command({ id: item.id, label: item.name });
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((selectedIndex + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((selectedIndex + 1) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return <div className="rounded-md border bg-card p-2 text-xs text-muted-foreground shadow-lg">No matching person</div>;
  }

  return (
    <div className="max-h-64 min-w-44 overflow-y-auto rounded-md border bg-card p-1 shadow-lg">
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            selectItem(index);
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
            index === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"
          )}
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {initialsOf(item.name)}
          </span>
          <span className="truncate">{item.name}</span>
        </button>
      ))}
    </div>
  );
});
