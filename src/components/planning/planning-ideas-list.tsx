"use client";

import { Archive, CheckCircle2, Lightbulb } from "lucide-react";

import { ColumnVisibilityMenu } from "@/components/ui/column-visibility-menu";
import { EmptyState } from "@/components/ui/empty-state";
import {
  PlanningItemRow,
  PlanningListHeader,
  PLANNING_COLUMNS,
  PLANNING_COLUMN_KEYS,
  defaultPlanningColumnWidths,
} from "@/components/planning/planning-item-row";
import { useColumnVisibility } from "@/lib/use-column-visibility";
import { useColumnWidths } from "@/lib/use-column-widths";

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

export function PlanningIdeasList({
  clientId,
  items,
  teamMembers,
  canManage,
  folders,
  tab,
  emptyLabel,
}: {
  clientId: string;
  items: PlanningItem[];
  teamMembers: { id: string; name: string }[];
  canManage: boolean;
  folders: { id: string; name: string }[];
  tab: string;
  emptyLabel: string;
}) {
  const { visible: visibleColumns, toggle: toggleColumn } = useColumnVisibility("planningIdeasColumns", PLANNING_COLUMN_KEYS);
  const { widths: columnWidths, setWidth: setColumnWidth, resetWidths } = useColumnWidths(
    "planningIdeasColumnWidths",
    defaultPlanningColumnWidths()
  );
  const emptyIcon = tab === "archive" ? Archive : tab === "converted" ? CheckCircle2 : Lightbulb;

  if (items.length === 0) {
    return <EmptyState icon={emptyIcon} title={emptyLabel} />;
  }

  return (
    <>
      <div className="flex items-center justify-end px-4 py-2">
        <ColumnVisibilityMenu columns={PLANNING_COLUMNS} visible={visibleColumns} onToggle={toggleColumn} onResetWidths={resetWidths} />
      </div>
      <PlanningListHeader
        visibleColumns={visibleColumns}
        widths={columnWidths}
        onResizeColumn={setColumnWidth}
        showFolderColumn={canManage && folders.length > 0}
      />
      <div className="divide-y">
        {items.map((item) => (
          <PlanningItemRow
            key={item.id}
            clientId={clientId}
            item={item}
            teamMembers={teamMembers}
            canManage={canManage}
            folders={folders}
            visibleColumns={visibleColumns}
            widths={columnWidths}
          />
        ))}
      </div>
    </>
  );
}
