"use client";

import { FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useWorkflowSidebar } from "@/components/workflows/workflow-sidebar-context";

export function WorkflowFolderToggleButton() {
  const { open } = useWorkflowSidebar();

  return (
    <Button type="button" variant="outline" size="sm" className="md:hidden" onClick={open}>
      <FolderOpen className="size-4" />
      Folders
    </Button>
  );
}
