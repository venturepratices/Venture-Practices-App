"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ConvertToTaskDialog } from "@/components/planning/convert-to-task-dialog";
import { PlanningItemLinksSection } from "@/components/planning/planning-item-links-section";
import { PlanningStatusPill } from "@/components/planning/planning-status-pill";
import { formatDate } from "@/lib/utils";

type PlanningItemDetail = {
  id: string;
  clientId: string;
  title: string;
  description: string | null;
  status: string;
  folderId: string | null;
  convertedTaskId: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  links: { id: string; label: string; url: string }[];
};

export function PlanningItemDetailPanel({
  clientId,
  teamMembers,
  folders,
  canManage,
}: {
  clientId: string;
  teamMembers: { id: string; name: string }[];
  folders: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ideaId = searchParams.get("ideaId");

  const [item, setItem] = useState<PlanningItemDetail | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [showConvert, setShowConvert] = useState(false);

  function refetch() {
    if (!ideaId) return;
    fetch(`/api/planning-items/${ideaId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PlanningItemDetail | null) => {
        if (data) setItem(data);
      });
  }

  useEffect(() => {
    if (!ideaId) {
      setItem(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/planning-items/${ideaId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PlanningItemDetail | null) => {
        if (cancelled) return;
        setItem(data);
        setTitle(data?.title ?? "");
        setDescription(data?.description ?? "");
      });
    return () => {
      cancelled = true;
    };
  }, [ideaId]);

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("ideaId");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  async function patch(body: Record<string, unknown>) {
    if (!ideaId) return;
    await fetch(`/api/planning-items/${ideaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    refetch();
    router.refresh();
  }

  async function saveTitle() {
    if (!item || !title.trim() || title.trim() === item.title) return;
    await patch({ title: title.trim() });
  }

  async function saveDescription() {
    if (!item || description === (item.description ?? "")) return;
    await patch({ description: description.trim() || null });
  }

  function handleStatusSelect(value: string | null) {
    if (!value || !item) return;
    if (value === "MOVE_TO_TASK") {
      setShowConvert(true);
      return;
    }
    if (value === "MOVE_TO_ARCHIVE") {
      void patch({ status: "ARCHIVED" });
      return;
    }
    void patch({ status: value });
  }

  async function remove() {
    if (!item) return;
    if (!window.confirm(`Delete the idea "${item.title}"? This can't be undone.`)) return;
    const response = await fetch(`/api/planning-items/${item.id}`, { method: "DELETE" });
    if (response.ok) {
      close();
      router.refresh();
    }
  }

  return (
    <>
      <Sheet open={Boolean(ideaId)} onOpenChange={(open) => !open && close()}>
        <SheetContent className="flex flex-col gap-6 overflow-y-auto p-6">
          {item ? (
            <>
              <SheetHeader className="p-0">
                <SheetTitle className="sr-only">Idea details</SheetTitle>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  onBlur={saveTitle}
                  disabled={!canManage}
                  className="border-none px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
                />
              </SheetHeader>

              <div className="space-y-1.5">
                <Label htmlFor="idea-description">Description</Label>
                <Textarea
                  id="idea-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  onBlur={saveDescription}
                  disabled={!canManage}
                  placeholder="Add more detail about this idea..."
                  className="min-h-24 text-sm"
                />
              </div>

              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  {item.status === "CONVERTED" ? (
                    item.convertedTaskId ? (
                      <Link
                        href={`/clients/${clientId}/tasks?taskId=${item.convertedTaskId}`}
                        className="flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
                      >
                        View task <ArrowRight className="size-3" />
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">Converted</span>
                    )
                  ) : canManage ? (
                    <Select value={item.status} onValueChange={handleStatusSelect}>
                      <SelectTrigger className="w-[170px]">
                        <SelectValue>{(value: string) => <PlanningStatusPill status={value} />}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="IDEA">Idea</SelectItem>
                        <SelectItem value="STRATEGY">Strategy</SelectItem>
                        <SelectItem value="MOVE_TO_TASK">Move to task</SelectItem>
                        <SelectItem value="MOVE_TO_ARCHIVE">Move to Archive</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <PlanningStatusPill status={item.status} />
                  )}
                </div>

                {canManage && item.status !== "CONVERTED" && folders.length > 0 ? (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Folder</Label>
                    <Select
                      value={item.folderId ?? "NONE"}
                      onValueChange={(value) => patch({ folderId: value === "NONE" ? null : value })}
                    >
                      <SelectTrigger className="w-[170px]">
                        <SelectValue />
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
                  </div>
                ) : null}
              </div>

              <p className="text-xs text-muted-foreground">
                {item.createdBy?.name ? `Added by ${item.createdBy.name}` : "Added"} · {formatDate(item.createdAt)}
              </p>

              <Separator />

              <div className="space-y-2">
                <Label>Links</Label>
                <PlanningItemLinksSection itemId={item.id} links={item.links} canManage={canManage} />
              </div>

              {canManage ? (
                <>
                  <Separator />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-fit text-destructive hover:text-destructive"
                    onClick={remove}
                  >
                    <Trash2 className="size-3.5" />
                    Delete idea
                  </Button>
                </>
              ) : null}
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <ConvertToTaskDialog
        open={showConvert}
        onOpenChange={setShowConvert}
        itemId={item?.id ?? ""}
        teamMembers={teamMembers}
        onConverted={() => {
          refetch();
          router.refresh();
        }}
      />
    </>
  );
}
