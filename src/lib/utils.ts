import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// The whole team operates out of Charlotte, NC — every date/time shown in the
// app is displayed in this zone, regardless of the server's or viewer's own
// local timezone, so "due 7/31" always means 7/31 in Ben's timezone for
// everyone looking at it.
const APP_TIME_ZONE = "America/New_York";

export function formatDate(date: Date | string, options?: Intl.DateTimeFormatOptions) {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", { timeZone: APP_TIME_ZONE, ...options });
}

export function formatDateTime(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  const time = d.toLocaleTimeString("en-US", { timeZone: APP_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
  return `${formatDate(d)} at ${time}`;
}

export function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

// Computes how far the wall-clock time in `timeZone` leads UTC at `date` —
// i.e. Date.UTC(<wall-clock parts>) - date.getTime(). Needed because a fixed
// UTC offset can't represent a timezone with DST across the year.
function tzLeadMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const hour = Number(parts.hour) % 24; // Intl can report "24" for midnight
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return asUtc - date.getTime();
}

/**
 * End of the given calendar day IN THE APP'S TIMEZONE (not the server's), so
 * a "to" date in a range filter includes that whole day for the team in
 * Charlotte, NC regardless of what timezone the server happens to run in.
 */
export function endOfDay(dateString: string): Date {
  const wallClockAsUtc = new Date(`${dateString}T23:59:59.999Z`);
  const lead = tzLeadMs(wallClockAsUtc, APP_TIME_ZONE);
  return new Date(wallClockAsUtc.getTime() - lead);
}

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
