import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, FileCheck2, Sunrise, UserPlus } from "lucide-react";

import { auth } from "@/lib/auth";
import { getUserBriefingData, isUserBriefingEmpty } from "@/lib/daily-briefing";
import { getTaskStatusOptions } from "@/lib/task-status";
import { formatDate, startOfDay, todayDateString } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { TaskRow } from "@/components/tasks/task-row";

export default async function MyBriefingPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { date } = await searchParams;
  const dateStr = date ?? todayDateString();

  const [briefing, statusOptions] = await Promise.all([
    getUserBriefingData(session.user.id, dateStr),
    getTaskStatusOptions(),
  ]);
  const { dueToday, overdue, assignedRecently, needsDecision } = briefing;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Sunrise className="size-6 text-secondary-accent" />
          Your daily briefing
        </h1>
        <p className="mt-1 text-muted-foreground">{formatDate(startOfDay(dateStr), { weekday: "long", month: "long", day: "numeric" })}</p>
      </div>

      {isUserBriefingEmpty(briefing) ? (
        <Card>
          <CardContent>
            <EmptyState icon={CheckCircle2} title="All clear." description="Nothing due, overdue, newly assigned, or waiting on your decision today." />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Due today" value={dueToday.length} icon={CalendarClock} tone="primary" delayMs={0} />
            <StatCard label="Overdue" value={overdue.length} icon={AlertTriangle} tone="accent" delayMs={40} />
            <StatCard label="Newly assigned" value={assignedRecently.length} icon={UserPlus} tone="primary" delayMs={80} />
            <StatCard label="Needs your decision" value={needsDecision.length} icon={FileCheck2} tone="accent" delayMs={120} />
          </div>

          {overdue.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Overdue</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {overdue.map((task, i) => (
                    <TaskRow key={task.id} task={task} showClient statusOptions={statusOptions} delayMs={Math.min(i * 40, 400)} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {dueToday.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Due today</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {dueToday.map((task, i) => (
                    <TaskRow key={task.id} task={task} showClient statusOptions={statusOptions} delayMs={Math.min(i * 40, 400)} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {needsDecision.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Needs your decision</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {needsDecision.map((asset) => (
                    <Link
                      key={asset.id}
                      href={`/clients/${asset.clientId}/assets/${asset.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted"
                    >
                      <span className="truncate">
                        {asset.title} <span className="text-muted-foreground">— {asset.clientName}</span>
                      </span>
                      {asset.dueDate ? <span className="shrink-0 text-xs text-muted-foreground">Due {formatDate(asset.dueDate)}</span> : null}
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {assignedRecently.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Newly assigned to you</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {assignedRecently.map((task, i) => (
                    <TaskRow key={task.id} task={task} showClient statusOptions={statusOptions} delayMs={Math.min(i * 40, 400)} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
