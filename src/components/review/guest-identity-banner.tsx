"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UserCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The one-time "who are you" step for a guest reviewer — no password, no
 * signup. Shown until identified; once submitted, the server sets a signed
 * cookie and every comment/decision composer downstream just works, already
 * attributed to this name+email.
 */
export function GuestIdentityBanner({ token }: { token: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/review/${token}/identify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(b?.error ?? "Something went wrong.");
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 border-b bg-primary/5 px-4 py-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <UserCircle className="size-4" />
        To comment or approve, tell us who you are:
      </div>
      <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-40 text-sm" required />
      <Input
        type="email"
        placeholder="Your email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="h-8 w-52 text-sm"
        required
      />
      <Button type="submit" size="sm" disabled={submitting || !name.trim() || !email.trim()}>
        {submitting ? "Continuing…" : "Continue"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  );
}
