import { Suspense } from "react";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MobileSidebarProvider } from "@/components/layout/mobile-sidebar-context";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/topbar";
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const [clients, teamMembers, unreadCount] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    session?.user?.id
      ? prisma.notification.count({ where: { recipientId: session.user.id, readAt: null } })
      : Promise.resolve(0),
  ]);

  return (
    <MobileSidebarProvider>
      <div className="flex h-screen">
        <Sidebar clients={clients} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar userName={session?.user?.name} userEmail={session?.user?.email} unreadCount={unreadCount} />
          <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
        </div>
        <Suspense fallback={null}>
          <TaskDetailPanel clients={clients} teamMembers={teamMembers} />
        </Suspense>
      </div>
    </MobileSidebarProvider>
  );
}
