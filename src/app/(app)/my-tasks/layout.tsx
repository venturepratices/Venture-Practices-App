import { MyTasksTabNav } from "@/components/layout/my-tasks-tab-nav";

// Same shell as clients/[clientId]/layout.tsx: a fixed header, then a row of
// in-page tabs, then whatever the active tab renders. "Private" lives here as
// a tab rather than a sidebar entry — see src/app/(app)/my-tasks/private/page.tsx.
export default function MyTasksLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="-m-6 flex h-full flex-col">
      <div className="border-b px-6 py-4">
        <h1 className="text-2xl font-semibold">My Tasks</h1>
      </div>
      <MyTasksTabNav />
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
    </div>
  );
}
