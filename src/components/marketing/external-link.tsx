import { ExternalLink as ExternalLinkIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { safeExternalHref } from "@/lib/marketing/sync";

/**
 * A hardened external link.
 *
 * - Runs the URL through `safeExternalHref` so only https URLs on allow-listed
 *   hosts render as links; anything else falls back to inert text so a bad
 *   value in a snapshot never ships as an attack vector.
 * - Always uses `rel="noopener noreferrer nofollow"` + `target="_blank"` so
 *   clicks cannot leak referrer, cannot script the opener, and never carry
 *   outbound link juice to systems we do not own.
 * - Has an accessible "opens in a new tab" label.
 */
export function ExternalLink({
  href,
  label,
  system,
  className,
}: {
  href: string | null;
  label: string;
  /** Short name of the system, e.g. "NitroSend" or "HighLevel". */
  system: string;
  className?: string;
}) {
  const safeHref = safeExternalHref(href);

  if (!safeHref) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-sm text-muted-foreground",
          className,
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer nofollow"
      aria-label={`${label} — opens in ${system} in a new tab`}
      className={cn(
        "inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none rounded",
        className,
      )}
    >
      {label}
      <ExternalLinkIcon aria-hidden className="size-3.5" />
    </a>
  );
}
