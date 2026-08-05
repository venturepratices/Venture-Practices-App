import { intervalPositionInDay, type Interval } from "@/lib/availability";

const HOUR_MARKS = [0, 3, 6, 9, 12, 15, 18, 21];

function hourLabel(hour: number) {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

/**
 * A horizontal 24-hour timeline for one person's day, showing only Busy
 * blocks (never event titles/attendees — we only ever have free/busy data,
 * by design). Pure presentational, no client JS needed.
 */
export function AvailabilityDayTimeline({ day, busyBlocks }: { day: Interval; busyBlocks: Interval[] }) {
  return (
    <div className="mt-2">
      <div className="relative h-6 w-full overflow-hidden rounded-md bg-status-success/20">
        {busyBlocks.map((block, i) => {
          const { leftPct, widthPct } = intervalPositionInDay(block, day);
          if (widthPct <= 0) return null;
          return (
            <div
              key={i}
              className="absolute inset-y-0 bg-status-danger"
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              title="Busy"
            />
          );
        })}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
        {HOUR_MARKS.map((h) => (
          <span key={h}>{hourLabel(h)}</span>
        ))}
      </div>
    </div>
  );
}
