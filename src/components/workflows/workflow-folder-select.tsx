"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NO_FOLDER = "__none__";

export function WorkflowFolderSelect({
  instanceId,
  folderId,
  folders,
}: {
  instanceId: string;
  folderId: string | null;
  folders: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(folderId ?? NO_FOLDER);
  const [isSaving, setIsSaving] = useState(false);

  async function handleChange(next: string | null) {
    if (!next) return;
    setValue(next);
    setIsSaving(true);
    const response = await fetch(`/api/workflows/${instanceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId: next === NO_FOLDER ? null : next }),
    });
    setIsSaving(false);
    if (response.ok) router.refresh();
    else setValue(folderId ?? NO_FOLDER);
  }

  return (
    <Select value={value} onValueChange={handleChange} disabled={isSaving}>
      <SelectTrigger size="sm" className="w-[160px]">
        <SelectValue>{(v: string) => (v === NO_FOLDER ? "No folder" : folders.find((f) => f.id === v)?.name ?? "No folder")}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_FOLDER}>No folder</SelectItem>
        {folders.map((f) => (
          <SelectItem key={f.id} value={f.id}>
            {f.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
