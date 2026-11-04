import { Suspense } from "react";

import { auth } from "@/lib/auth";
import { accessibleClientFilter, loadPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getTaskStatusOptions } from "@/lib/task-status";
import { getPriorityLevelOptions } from "@/lib/priority-level";
import { salesDueCountWhere, salesNavGroup } from "@/lib/sales/nav";
import { MobileSidebarProvider } from "@/components/layout/mobile-sidebar-context";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/topbar";
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel";
import { Toaster } from "@/components/ui/sonner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const perms = await loadPermissions();
  const clientWhere = await accessibleClientFilter("id");
  // Sales is secret from people without access: for them nothing Sales-related
  // is queried, and the sidebar gets no group (so the page carries no Sales text).
  const salesOn = !!perms && (perms.isAdmin || perms.caps.canUseSales);
  const [clients, teamMembers, unreadCount, recentNotifications, statusOptions, priorityLevelOptions, salesDueCount] = await Promise.all([
    // Sidebar client list scoped to what this user may access.
    prisma.client.findMany({ where: clientWhere, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    session?.user?.id
      ? prisma.notification.count({ where: { recipientId: session.user.id, readAt: null } })
      : Promise.resolve(0),
    // Feeds the notification bell's popup — just enough recent rows to fill
    // it, not a paginated list (that's what the full /notifications page is
    // for, reachable from the popup's "View all" link).
    session?.user?.id
      ? prisma.notification.findMany({ where: { recipientId: session.user.id }, orderBy: { createdAt: "desc" }, take: 8 })
      : Promise.resolve([]),
    getTaskStatusOptions(),
    getPriorityLevelOptions(),
    // The count beside Sales > Activities: their own to-dos due today or overdue.
    salesOn && perms
      ? prisma.salesActivity.count({ where: salesDueCountWhere(perms.userId, new Date()) })
      : Promise.resolve(0),
  ]);

  return (
    <MobileSidebarProvider>
      <div className="flex h-screen">
        <Sidebar
          clients={clients}
          userName={session?.user?.name}
          userEmail={session?.user?.email}
          isAdmin={!!perms?.isAdmin}
          canViewActivity={!!perms?.caps.canViewActivity}
          canViewArchive={!!perms?.caps.canViewArchive}
          canManageDirectMail={!!perms?.caps.canManageDirectMail}
          canViewWorkflows={!!perms?.caps.canViewWorkflows}
          canManageWorkflows={!!perms?.caps.canManageWorkflows}
          canManageOrders={!!perms?.caps.canManageOrders}
          canUseLeadership={!!perms?.caps.canUseLeadership}
          navGroup={salesNavGroup(
            { isAdmin: !!perms?.isAdmin, canUseSales: !!perms?.caps.canUseSales },
            salesDueCount,
          )}
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar unreadCount={unreadCount} recentNotifications={recentNotifications} />
          <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
        </div>
        <Suspense fallback={null}>
          <TaskDetailPanel
            clients={clients}
            teamMembers={teamMembers}
            currentUserId={session?.user?.id ?? null}
            statusOptions={statusOptions}
            priorityLevelOptions={priorityLevelOptions}
          />
        </Suspense>
      </div>
      {/* The one toast area for the app (Sales moves and undo, Team page refusals). */}
      <Toaster position="bottom-center" />
    </MobileSidebarProvider>
  );
}
