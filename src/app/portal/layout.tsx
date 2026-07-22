import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";

import { signOut } from "@/lib/auth";
import { getClientUserSession } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";

/**
 * The entire client-portal shell (Slice 4b) — deliberately tiny: brand,
 * client name, sign out. No sidebar, no nav to anything else. proxy.ts
 * already keeps non-client-user sessions out of /portal and client-user
 * sessions out of the agency app; this check is the same belt-and-suspenders
 * pattern used elsewhere in this app (e.g. the Assets tab page re-checking
 * canViewAssets even though the layout already gated client access).
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const clientUser = await getClientUserSession();
  if (!clientUser) redirect("/login");

  const client = await prisma.client.findUnique({ where: { id: clientUser.clientId }, select: { name: true } });

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary font-heading text-xs font-bold text-primary-foreground">
            VP
          </div>
          <div className="leading-tight">
            <p className="font-heading text-sm font-semibold">Venture Practices</p>
            <p className="text-xs text-muted-foreground">{client?.name ?? "Client portal"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{clientUser.name}</span>
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
      <div className="flex-1">{children}</div>
    </div>
  );
}
