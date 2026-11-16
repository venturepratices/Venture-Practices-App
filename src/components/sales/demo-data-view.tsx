"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Counts = {
  organizations: number;
  people: number;
  leads: number;
  deals: number;
  activities: number;
  notes: number;
};

type SeedSummary = {
  made: Counts & { customFieldValues: number; auditRows: number; teamMembers: number };
  today: string;
};

type CleanSummary = {
  removed: Counts & { files: number; customFieldValues: number };
  kept: { organizations: number; people: number; leads: number; deals: number };
  addedStaying: number;
  dryRun: boolean;
  includeAdded: boolean;
};

const CARD = "rounded-[12px] border bg-card shadow-sm";

export function DemoDataView({ initialCounts }: { initialCounts: Counts }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"add" | "remove" | null>(null);
  const [includeAdded, setIncludeAdded] = useState(false);
  const [counts] = useState(initialCounts);

  const total = counts.organizations + counts.people + counts.leads + counts.deals + counts.activities + counts.notes;

  async function callApi(method: "POST" | "DELETE") {
    if (!password) {
      toast.error("Type your password to confirm.");
      return;
    }
    const kind = method === "POST" ? "add" : "remove";
    setBusy(kind);
    try {
      const res = await fetch("/api/sales/admin/demo-data", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, includeAdded: method === "DELETE" ? includeAdded : undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as
        | { ok: true; summary: SeedSummary | CleanSummary }
        | { error?: string };
      if (!res.ok || !("ok" in body)) {
        toast.error(("error" in body && body.error) || `Something went wrong (${res.status}).`);
        return;
      }
      if (method === "POST") {
        const s = body.summary as SeedSummary;
        const m = s.made;
        toast.success(
          `Added: ${m.organizations} practices, ${m.people} people, ${m.deals} deals, ${m.leads} leads, ${m.activities} activities, ${m.notes} notes.`,
        );
      } else {
        const s = body.summary as CleanSummary;
        const r = s.removed;
        const kept = s.kept.organizations + s.kept.people + s.kept.leads + s.kept.deals;
        const parts = [
          `${r.organizations} practices`,
          `${r.people} people`,
          `${r.deals} deals`,
          `${r.leads} leads`,
          `${r.activities} activities`,
          `${r.notes} notes`,
        ];
        toast.success(`Removed: ${parts.join(", ")}.${kept > 0 ? ` Kept ${kept} that the team was still using.` : ""}`);
      }
      setPassword("");
      router.refresh();
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      <div className="flex items-center gap-2 text-[13px]">
        <Link href="/sales/settings" className="text-muted-foreground hover:text-foreground">
          Settings
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">Demo data</span>
      </div>

      <section className={CARD}>
        <div className="flex items-center gap-2 border-b px-4 py-3 text-[14px] font-semibold">
          <FlaskConical aria-hidden="true" className="size-4 text-muted-foreground" />
          <h1 className="m-0 text-[14px] font-semibold">Demo data</h1>
        </div>
        <div className="space-y-4 px-4 py-4 text-[13.5px] leading-snug">
          <p className="m-0">
            Fill Sales with example practices, people, deals, leads, activities and notes so the team can see how every
            screen works. Everything is clearly marked <strong>&ldquo;TEST &rdquo;</strong>, emails are on <code>example.com</code>
            , and phones are in the 555-01 range.
          </p>
          <p className="m-0 text-muted-foreground">
            Safe to run twice. Add fills in what is missing. Remove takes the TEST rows out again. Anything the team adds
            on a TEST row is left alone unless you tick &ldquo;also remove things we added on TEST rows&rdquo;.
          </p>

          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="text-[12.5px] font-medium text-muted-foreground">Currently in the system</div>
            <div className="mt-1 text-[13.5px]">
              {total === 0 ? (
                "No TEST rows yet."
              ) : (
                <>
                  {counts.organizations} practices, {counts.people} people, {counts.deals} deals, {counts.leads} leads,{" "}
                  {counts.activities} activities, {counts.notes} notes.
                </>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-[12.5px] font-medium text-muted-foreground" htmlFor="demo-pw">
              Your password
            </label>
            <Input
              id="demo-pw"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Type your password to confirm"
              disabled={busy !== null}
              className="max-w-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={includeAdded}
              onChange={(e) => setIncludeAdded(e.target.checked)}
              disabled={busy !== null}
            />
            Also remove notes, activities, files and field values the team added on TEST rows.
          </label>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => callApi("POST")}
              disabled={busy !== null}
              className="pointer-coarse:min-h-11"
            >
              {busy === "add" ? <Loader2 className="size-4 animate-spin" /> : null}
              Add demo data
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => callApi("DELETE")}
              disabled={busy !== null || total === 0}
              className="pointer-coarse:min-h-11"
            >
              {busy === "remove" ? <Loader2 className="size-4 animate-spin" /> : null}
              Remove demo data
            </Button>
            <Link
              href="/sales/settings"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "pointer-coarse:min-h-11")}
            >
              Back
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
