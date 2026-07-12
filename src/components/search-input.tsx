"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  placeholder: string;
  className?: string;
};

/**
 * Search box that syncs its text to the `q` URL param (debounced), so server
 * pages can filter with it — same pattern as the dropdown filters.
 */
export function SearchInput({ placeholder, className }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlQuery = searchParams.get("q") ?? "";

  // Keep the box in sync when the URL changes from elsewhere (e.g. "Clear filters").
  useEffect(() => {
    if (debounceRef.current) return; // user is mid-typing; don't clobber
    setValue(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function apply(next: string) {
    debounceRef.current = null;
    const params = new URLSearchParams(searchParams.toString());
    if (next.trim()) params.set("q", next.trim());
    else params.delete("q");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function onChange(next: string) {
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => apply(next), 300);
  }

  function clear() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setValue("");
    apply("");
  }

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="pl-8 pr-8"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
