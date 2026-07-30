"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function WorkflowInstanceControls({
  instanceId,
  instanceName,
  status,
  redirectOnDelete,
}: {
  instanceId: string;
  instanceName: string;
  status: string;
  redirectOnDelete: string;
}) {
  const router = useRouter();
  const [isCancelling, setIsCancelling] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleCancel() {
    if (!window.confirm(`Cancel "${instanceName}"? Its tasks survive but become unattached from the project.`)) return;
    setIsCancelling(true);
    const response = await fetch(`/api/workflows/${instanceId}/cancel`, { method: "POST" });
    setIsCancelling(false);
    if (response.ok) router.refresh();
    else window.alert("Couldn't cancel that project.");
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${instanceName}"? Its tasks will be archived (recoverable from Archive), not permanently erased.`)) return;
    setIsDeleting(true);
    const response = await fetch(`/api/workflows/${instanceId}`, { method: "DELETE" });
    if (response.ok) {
      router.push(redirectOnDelete);
      router.refresh();
    } else {
      setIsDeleting(false);
      window.alert("Couldn't delete that project.");
    }
  }

  return (
    <div className="flex items-center gap-2">
      {status === "ACTIVE" ? (
        <Button type="button" size="sm" variant="outline" onClick={handleCancel} disabled={isCancelling}>
          {isCancelling ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
          Cancel
        </Button>
      ) : null}
      <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={handleDelete} disabled={isDeleting}>
        {isDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        Delete
      </Button>
    </div>
  );
}
