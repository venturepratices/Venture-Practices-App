"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CAMPAIGN_STAGE_VALUES } from "@/lib/campaign-stage";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StagePill } from "@/components/programs/stage-pill";

export function StageSelect({
  campaignId,
  currentStage,
  canManage,
}: {
  campaignId: string;
  currentStage: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  if (!canManage) return <StagePill stage={currentStage} />;

  async function handleChange(value: string | null) {
    if (!value || value === currentStage) return;
    setIsSaving(true);
    await fetch(`/api/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentStage: value }),
    });
    setIsSaving(false);
    router.refresh();
  }

  return (
    <Select value={currentStage} onValueChange={handleChange} disabled={isSaving}>
      <SelectTrigger className="w-fit">
        <SelectValue>{(stage: string) => <StagePill stage={stage} />}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {CAMPAIGN_STAGE_VALUES.map((stage) => (
          <SelectItem key={stage} value={stage}>
            <StagePill stage={stage} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
