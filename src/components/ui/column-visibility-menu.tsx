"use client";

import { Columns3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ColumnOption = { key: string; label: string };

export function ColumnVisibilityMenu({
  columns,
  visible,
  onToggle,
}: {
  columns: ColumnOption[];
  visible: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" size="sm" className="gap-1.5">
            <Columns3 className="size-3.5" />
            Columns
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <p className="px-1.5 py-1 text-xs font-medium text-muted-foreground">Show columns</p>
        <DropdownMenuSeparator />
        {columns.map((col) => (
          <DropdownMenuCheckboxItem
            key={col.key}
            checked={visible.has(col.key)}
            closeOnClick={false}
            onCheckedChange={() => onToggle(col.key)}
          >
            {col.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
