import { prisma } from "@/lib/prisma";

export default async function ActivityPage() {
  const entries = await prisma.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 150,
  });

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="mt-1 text-muted-foreground">Every meaningful action across the agency, most recent first.</p>
      </div>

      <div className="mt-6 rounded-lg border divide-y">
        {entries.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          entries.map((entry) => {
            const timestamp = new Date(entry.createdAt);
            return (
              <div key={entry.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1 truncate">{entry.description}</span>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                  {timestamp.toLocaleDateString()} at {timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
