"use client";

import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <Button
      type="submit"
      variant="ghost"
      size="icon"
      aria-label="Sign out"
      onClick={(e) => {
        if (!window.confirm("Sign out of Venture Practices?")) {
          e.preventDefault();
        }
      }}
    >
      <LogOut className="size-4" />
    </Button>
  );
}
