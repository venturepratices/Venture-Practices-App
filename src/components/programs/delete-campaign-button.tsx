"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function DeleteCampaignButton({
  campaignId,
  campaignLabel,
  clientId,
  programId,
}: {
  campaignId: string;
  campaignLabel: string;
  clientId: string;
  programId: string;
}) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Delete "${campaignLabel}"? Its tasks will survive but become unattached.`)) return;
    setIsDeleting(true);
    const response = await fetch(`/api/campaigns/${campaignId}`, { method: "DELETE" });
    if (response.ok) {
      router.push(`/clients/${clientId}/programs/${programId}`);
      router.refresh();
    } else {
      setIsDeleting(false);
      window.alert("Couldn't delete that campaign.");
    }
  }

  return (
    <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={handleDelete} disabled={isDeleting}>
      {isDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      Delete
    </Button>
  );
}
