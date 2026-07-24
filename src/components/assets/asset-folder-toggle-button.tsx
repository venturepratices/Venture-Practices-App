"use client";

import { FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAssetSidebar } from "@/components/assets/asset-sidebar-context";

export function AssetFolderToggleButton() {
  const { open } = useAssetSidebar();

  return (
    <Button type="button" variant="outline" size="sm" className="md:hidden" onClick={open}>
      <FolderOpen className="size-4" />
      Folders
    </Button>
  );
}
