"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Folder, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ColumnResizeHandle } from "@/components/ui/column-resize-handle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConvertToTaskDialog } from "@/components/planning/convert-to-task-dialog";
import { PlanningStatusPill } from "@/components/planning/planning-status-pill";
import { cn, formatDate } from "@/lib/utils";

const OPTIONAL_COLUMNS: { key: string; label: string; defaultWidth: number }[] = [
  { key: "createdBy", label: "Created by", defaultWidth: 150 },
  { key: "dateCreated", label: "Date created", defaultWidth: 120 },
];

export const PLANNING_COLUMN_KEYS = OPTIONAL_COLUMNS.map((c) => c.key);
export const PLANNING_COLUMNS = OPTIONAL_COLUMNS;

export function defaultPlanningColumnWidths() {
  return Object.fromEntries(OPTIONAL_COLUMNS.map((c) => [c.key, c.defaultWidth]));
}

// Same "grid template via CSS variable" trick as task-row.tsx — column
// visibility/width are both runtime (localStorage) preferences, so Tailwind
// can't have pre-generated a class for every combination at build time.
// The trailing actions cell (folder select + status select/pill + delete
// button) must be a fixed width, not "auto" — each row is its own CSS Grid
// container, so an "auto" track resolves to that row's own content width
// and never lines up with the header or with other rows.
const ACTIONS_WIDTH = 230;

function gridTemplateVar(visible: Set<string> | undefined, widths: Record<string, number>) {
  const cols = OPTIONAL_COLUMNS.filter((c) => !visible || visible.has(c.key));
  const template = ["minmax(0,1fr)", ...cols.map((c) => `${widths[c.key] ?? c.defaultWidth}px`), `${ACTIONS_WIDTH}px`].join(" ");
  return { "--planning-grid-cols": template } as React.CSSProperties;
}

// Tailwind's JIT scanner needs the literal class string, not an interpolated
// one, so ACTIONS_WIDTH's value (230) is hardcoded here to match the constant.
const GRID_CLASS = "grid grid-cols-[minmax(0,1fr)_230px] items-center gap-3 md:[grid-template-columns:var(--planning-grid-cols)]";

export function PlanningListHeader({
  visibleColumns,
  widths,
  onResizeColumn,
  showFolderColumn,
}: {
  visibleColumns?: Set<string>;
  widths?: Record<string, number>;
  onResizeColumn?: (key: string, width: number, commit: boolean) => void;
  showFolderColumn?: boolean;
}) {
  const columns = OPTIONAL_COLUMNS.filter((c) => !visibleColumns || visibleColumns.has(c.key));
  const resolvedWidths = widths ?? defaultPlanningColumnWidths();
  return (
    <div
      style={gridTemplateVar(visibleColumns, resolvedWidths)}
      className={cn(GRID_CLASS, "w-full min-w-0 border-b px-4 py-2.5 text-xs font-bold tracking-wide text-foreground")}
    >
      <span className="min-w-0">Idea title</span>
      {columns.map((col) => (
        <span key={col.key} className="relative hidden min-w-0 truncate md:block">
          {col.label}
          {onResizeColumn ? (
            <ColumnResizeHandle
              width={resolvedWidths[col.key] ?? col.defaultWidth}
              onResize={(width, commit) => onResizeColumn(col.key, width, commit)}
            />
          ) : null}
        </span>
      ))}
      {/* Mirrors the row's actions layout (folder select + status + delete)
          so each label lines up with its actual control, not just the
          overall cell edge. */}
      <div className="flex min-w-0 shrink-0 items-center gap-2 justify-self-end">
        {showFolderColumn ? (
          <span className="flex w-[36px] items-center justify-center" title="Folder" aria-label="Folder">
            <Folder className="size-3.5 text-muted-foreground" />
          </span>
        ) : null}
        <span className="w-[150px]">Status</span>
        <span className="w-[28px]" />
      </div>
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
  visibleColumns,
  widths,
}: {
  clientId: string;
  item: PlanningItem;
  teamMembers: { id: string; name: string }[];
  canManage: boolean;
  folders?: { id: string; name: string }[];
  visibleColumns?: Set<string>;
  widths?: Record<string, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showConvert, setShowConvert] = useState(false);
  const isVisible = (key: string) => !visibleColumns || visibleColumns.has(key);
  const resolvedWidths = widths ?? defaultPlanningColumnWidths();

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
      style={gridTemplateVar(visibleColumns, resolvedWidths)}
      className={cn(GRID_CLASS, "w-full min-w-0 cursor-pointer px-4 py-3 text-sm transition-colors hover:bg-muted")}
    >
      <div className="min-w-0">
        <p className="truncate font-medium" title={item.title}>
          {item.title}
        </p>
        {item.description ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={item.description}>
            {item.description}
          </p>
        ) : null}
        <p className="mt-1 truncate text-xs text-muted-foreground md:hidden">
          {[item.createdBy?.name ? `Added by ${item.createdBy.name}` : "Added", formatDate(item.createdAt)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {isVisible("createdBy") ? (
        <span className="hidden min-w-0 truncate text-muted-foreground md:block" title={item.createdBy?.name ?? undefined}>
          {item.createdBy?.name ?? "—"}
        </span>
      ) : null}
      {isVisible("dateCreated") ? (
        <span className="hidden min-w-0 truncate whitespace-nowrap text-muted-foreground md:block">{formatDate(item.createdAt)}</span>
      ) : null}

      <div onClick={(e) => e.stopPropagation()} className="flex min-w-0 shrink-0 items-center gap-2 justify-self-end">
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
