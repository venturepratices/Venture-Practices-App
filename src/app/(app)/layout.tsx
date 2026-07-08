import { Suspense } from "react";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/topbar";
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const [clients, teamMembers] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex h-screen">
      <Sidebar clients={clients} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar userName={session?.user?.name} userEmail={session?.user?.email} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
      <Suspense fallback={null}>
        <TaskDetailPanel clients={clients} teamMembers={teamMembers} />
      </Suspense>
    </div>
  );
}
