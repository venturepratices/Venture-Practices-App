"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

// Same segmented-control pattern as TaskViewToggle (List/Board) and
// PrivateTabToggle (Projects/Tasks) — state lives in the URL (?tab=) so the
// choice survives a refresh and is shareable, just like the other view
// toggles here.
export function TaskCompletionToggle({ tab }: { tab: "active" | "completed" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setTab(next: "active" | "completed") {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "active") params.delete("tab");
    else params.set("tab", next);
    // A page position or specific status filter from the other tab rarely
    // still makes sense after switching — clearest to start clean.
    params.delete("page");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="inline-flex rounded-md border p-0.5">
      <button
        type="button"
        onClick={() => setTab("active")}
        className={cn(
          "rounded-sm px-2.5 py-1 text-sm font-medium transition-colors",
          tab === "active" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        Active
      </button>
      <button
        type="button"
        onClick={() => setTab("completed")}
        className={cn(
          "rounded-sm px-2.5 py-1 text-sm font-medium transition-colors",
          tab === "completed" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        Completed
      </button>
    </div>
  );
}
