"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AskViktorPanel } from "@/components/ai-assistant/ask-viktor-panel";

/**
 * Topbar trigger for the Ask Viktor panel. Client component because the
 * panel needs local open/close state and the topbar is a server component;
 * keeping this wrapper client-only means the surrounding shell stays SSR
 * without special-casing.
 */
export function AskViktorButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Ask Viktor"
        title="Ask Viktor"
        onClick={() => setOpen(true)}
        className="text-primary"
      >
        <Sparkles className="size-4" />
      </Button>
      <AskViktorPanel open={open} onOpenChange={setOpen} />
    </>
  );
}
