"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConvertToTaskDialog } from "@/components/planning/convert-to-task-dialog";
import { PLANNING_STATUS_LABELS } from "@/lib/validations/planning";
import { formatDate } from "@/lib/utils";

type PlanningItem = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  convertedTaskId: string | null;
  createdAt: string | Date;
  createdBy: { name: string } | null;
};

export function PlanningItemRow({
  clientId,
  item,
  teamMembers,
  canManage,
}: {
  clientId: string;
  item: PlanningItem;
  teamMembers: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [showConvert, setShowConvert] = useState(false);

  async function setStatus(status: string) {
    await fetch(`/api/planning-items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
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
    <div className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{item.title}</p>
        {item.description ? <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{item.description}</p> : null}
        <p className="mt-1 text-xs text-muted-foreground">
          {item.createdBy?.name ? `Added by ${item.createdBy.name}` : "Added"} · {formatDate(item.createdAt)}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
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
                <SelectValue>{(value: string) => PLANNING_STATUS_LABELS[value] ?? value}</SelectValue>
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
          <span className="text-xs font-medium text-muted-foreground">{PLANNING_STATUS_LABELS[item.status] ?? item.status}</span>
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
