/**
 * Builds the absolute URL for a notification's linkPath, for use inside a
 * Slack message (Slack has no concept of "the current page" the way an
 * in-app click does, so it always needs a full URL). Falls back to a plain
 * relative path if NEXT_PUBLIC_APP_URL isn't set — better than crashing, and
 * the caller can decide whether an unset base URL is worth logging.
 */
export function absoluteUrlFor(linkPath: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) return linkPath;
  return `${base.replace(/\/$/, "")}${linkPath}`;
}
