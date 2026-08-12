"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExternalLink } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NO_ASSET = "__none__";

type AssetOption = { id: string; title: string; status: string };

export function ProofAssetSelect({
  campaignId,
  clientId,
  currentAssetId,
  options,
}: {
  campaignId: string;
  clientId: string;
  currentAssetId: string | null;
  options: AssetOption[];
}) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  async function handleChange(value: string | null) {
    if (!value) return;
    setIsSaving(true);
    await fetch(`/api/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofAssetId: value === NO_ASSET ? null : value }),
    });
    setIsSaving(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select value={currentAssetId ?? NO_ASSET} onValueChange={handleChange} disabled={isSaving}>
        <SelectTrigger className="w-full">
          <SelectValue>
            {(value: string) => (value === NO_ASSET ? "Not linked" : options.find((o) => o.id === value)?.title ?? value)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_ASSET}>Not linked</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {currentAssetId ? (
        <Link
          href={`/clients/${clientId}/assets/${currentAssetId}`}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          title="View asset"
        >
          <ExternalLink className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}
