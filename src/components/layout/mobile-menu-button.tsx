"use client";

import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useMobileSidebar } from "@/components/layout/mobile-sidebar-context";

export function MobileMenuButton() {
  const { toggle } = useMobileSidebar();

  return (
    <Button type="button" variant="ghost" size="icon" aria-label="Open menu" className="md:hidden" onClick={toggle}>
      <Menu className="size-4" />
    </Button>
  );
}
