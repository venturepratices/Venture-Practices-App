"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

// Same segmented-control pattern as TaskViewToggle (List/Board) — state lives
// in the URL (?tab=) rather than component state, so the choice survives a
// refresh and is shareable/bookmarkable like every other view toggle here.
export function PrivateTabToggle({ tab, projectCount, taskCount }: { tab: "projects" | "tasks"; projectCount: number; taskCount: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setTab(next: "projects" | "tasks") {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "projects") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="inline-flex rounded-md border p-0.5">
      <button
        type="button"
        onClick={() => setTab("projects")}
        className={cn(
          "flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-sm font-medium transition-colors",
          tab === "projects" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        Projects
        <span className={cn("text-xs", tab === "projects" ? "text-primary-foreground/80" : "text-muted-foreground/80")}>{projectCount}</span>
      </button>
      <button
        type="button"
        onClick={() => setTab("tasks")}
        className={cn(
          "flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-sm font-medium transition-colors",
          tab === "tasks" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        Tasks
        <span className={cn("text-xs", tab === "tasks" ? "text-primary-foreground/80" : "text-muted-foreground/80")}>{taskCount}</span>
      </button>
    </div>
  );
}
