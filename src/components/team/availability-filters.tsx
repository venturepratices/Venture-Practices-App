"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const COMMON_TIME_ZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
  { value: "UTC", label: "UTC" },
];

function detectBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

/**
 * Date + from-time + to-time + timezone, synced to URL params
 * (?date=&from=&to=&tz=) so the server page can compute the query window in
 * whichever zone the viewer means — same live-update-on-change pattern as
 * DateRangeFilter. Timezone defaults to the browser's own detected zone
 * (not always Charlotte, NC) since availability is checked by people
 * wherever they actually are.
 */
export function AvailabilityFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const date = searchParams.get("date") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const tzParam = searchParams.get("tz");

  const detectedTz = useMemo(() => detectBrowserTimeZone(), []);
  const tz = tzParam ?? detectedTz;

  const tzOptions = useMemo(() => {
    if (COMMON_TIME_ZONES.some((t) => t.value === detectedTz)) return COMMON_TIME_ZONES;
    return [{ value: detectedTz, label: `${detectedTz} (detected)` }, ...COMMON_TIME_ZONES];
  }, [detectedTz]);

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    // Pin whatever timezone is currently shown (default detected, or already
    // chosen) into the URL the first time any field changes — otherwise the
    // server has no way to know which zone the displayed default meant.
    if (!params.get("tz")) params.set("tz", tz);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Input
        type="date"
        value={date}
        onChange={(e) => setParam("date", e.target.value)}
        aria-label="Date"
        className="h-8 w-[150px]"
      />
      <span className="text-sm text-muted-foreground">from</span>
      <Input
        type="time"
        value={from}
        onChange={(e) => setParam("from", e.target.value)}
        aria-label="Start time"
        className="h-8 w-[120px]"
      />
      <span className="text-sm text-muted-foreground">to</span>
      <Input
        type="time"
        value={to}
        onChange={(e) => setParam("to", e.target.value)}
        aria-label="End time"
        className="h-8 w-[120px]"
      />
      <Select value={tz} onValueChange={(value) => setParam("tz", value ?? "")}>
        <SelectTrigger size="sm" className="w-[200px]">
          <SelectValue aria-label="Timezone" />
        </SelectTrigger>
        <SelectContent>
          {tzOptions.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
