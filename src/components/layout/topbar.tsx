import { LogOut } from "lucide-react";

import { signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export function TopBar({ userName, userEmail }: { userName?: string | null; userEmail?: string | null }) {
  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <div />
      <div className="flex items-center gap-3">
        <div className="text-right text-sm leading-tight">
          <p className="font-medium">{userName ?? "Team member"}</p>
          <p className="text-muted-foreground">{userEmail}</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
            <LogOut className="size-4" />
          </Button>
        </form>
      </div>
    </header>
  );
}
