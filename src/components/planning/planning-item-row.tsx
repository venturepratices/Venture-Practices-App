"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Folder, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConvertToTaskDialog } from "@/components/planning/convert-to-task-dialog";
import { PlanningStatusPill } from "@/components/planning/planning-status-pill";
import { cn, formatDate } from "@/lib/utils";

export function planningRowGridClass() {
  return "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:grid-cols-[minmax(0,1fr)_140px_110px_auto]";
}

export function PlanningListHeader() {
  return (
    <div
      className={cn(
        planningRowGridClass(),
        "w-full border-b px-4 py-2 text-xs font-medium tracking-wide text-muted-foreground"
      )}
    >
      <span>Idea</span>
      <span className="hidden md:block">Created by</span>
      <span className="hidden md:block">Date created</span>
      <span className="justify-self-end">Status</span>
    </div>
  );
}

type PlanningItem = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  folderId: string | null;
  convertedTaskId: string | null;
  createdAt: string | Date;
  createdBy: { name: string } | null;
};

export function PlanningItemRow({
  clientId,
  item,
  teamMembers,
  canManage,
  folders,
}: {
  clientId: string;
  item: PlanningItem;
  teamMembers: { id: string; name: string }[];
  canManage: boolean;
  folders?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showConvert, setShowConvert] = useState(false);

  function openIdea() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("ideaId", item.id);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function setStatus(status: string) {
    await fetch(`/api/planning-items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  }

  async function setFolder(folderId: string | null) {
    await fetch(`/api/planning-items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(`Delete the idea "${item.title}"? This can't be undone.`)) return;
    const response = await fetch(`/api/planning-items/${item.id}`, { method: "DELETE" });
    if (response.ok) router.refresh();
  }

  function handleSelect(value: string | null) {
    if (!value) return;
    if (value === "MOVE_TO_TASK") {
      setShowConvert(true);
      return;
    }
    if (value === "MOVE_TO_ARCHIVE") {
      void setStatus("ARCHIVED");
      return;
    }
    void setStatus(value);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openIdea}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") openIdea();
      }}
      className={cn(planningRowGridClass(), "w-full cursor-pointer px-4 py-3 text-sm transition-colors hover:bg-muted")}
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{item.title}</p>
        {item.description ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.description}</p> : null}
        <p className="mt-1 text-xs text-muted-foreground md:hidden">
          {[item.createdBy?.name ? `Added by ${item.createdBy.name}` : "Added", formatDate(item.createdAt)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <span className="hidden truncate text-muted-foreground md:block">{item.createdBy?.name ?? "—"}</span>
      <span className="hidden whitespace-nowrap text-muted-foreground md:block">{formatDate(item.createdAt)}</span>

      <div onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center gap-2 justify-self-end">
        {canManage && folders && folders.length > 0 ? (
          <Select value={item.folderId ?? "NONE"} onValueChange={(value) => setFolder(value === "NONE" ? null : value)}>
            <SelectTrigger className="w-[36px] justify-center px-0" aria-label="Move to folder">
              <Folder className="size-3.5 text-muted-foreground" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">No folder</SelectItem>
              {folders.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>
                  {folder.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {item.status === "CONVERTED" ? (
          item.convertedTaskId ? (
            <Link
              href={`/clients/${clientId}/tasks?taskId=${item.convertedTaskId}`}
              className="flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              View task <ArrowRight className="size-3" />
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">Converted</span>
          )
        ) : canManage ? (
          <>
            <Select value={item.status} onValueChange={handleSelect}>
              <SelectTrigger className="w-[150px]">
                <SelectValue>{(value: string) => <PlanningStatusPill status={value} />}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="IDEA">Idea</SelectItem>
                <SelectItem value="STRATEGY">Strategy</SelectItem>
                <SelectItem value="MOVE_TO_TASK">Move to task</SelectItem>
                <SelectItem value="MOVE_TO_ARCHIVE">Move to Archive</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${item.title}`} onClick={remove}>
              <Trash2 className="size-3.5" />
            </Button>
          </>
        ) : (
          <PlanningStatusPill status={item.status} />
        )}
      </div>

      <ConvertToTaskDialog
        open={showConvert}
        onOpenChange={setShowConvert}
        itemId={item.id}
        teamMembers={teamMembers}
        onConverted={() => router.refresh()}
      />
    </div>
  );
}
