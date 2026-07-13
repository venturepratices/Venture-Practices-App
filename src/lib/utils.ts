import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDateTime(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  return `${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** End of the given calendar day, so a "to" date in a range filter includes that whole day. */
export function endOfDay(dateString: string): Date {
  const date = new Date(dateString);
  date.setHours(23, 59, 59, 999);
  return date;
}
