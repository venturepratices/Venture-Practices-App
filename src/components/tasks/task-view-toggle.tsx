"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutList, KanbanSquare } from "lucide-react";

import { cn } from "@/lib/utils";

export function TaskViewToggle({ view }: { view: "list" | "board" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setView(next: "list" | "board") {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "list") {
      params.delete("view");
    } else {
      params.set("view", next);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="inline-flex rounded-md border p-0.5">
      <button
        type="button"
        onClick={() => setView("list")}
        className={cn(
          "flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-sm font-medium transition-colors",
          view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <LayoutList className="size-4" />
        List
      </button>
      <button
        type="button"
        onClick={() => setView("board")}
        className={cn(
          "flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-sm font-medium transition-colors",
          view === "board" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <KanbanSquare className="size-4" />
        Board
      </button>
    </div>
  );
}
