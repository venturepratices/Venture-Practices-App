/**
 * The tracking numbers the Calls page offers in its filter.
 *
 * The labeled-numbers table is empty until someone names a number, so the
 * filter used to offer nothing but "All numbers" even while the calls
 * themselves carried three different numbers. The filter now offers every
 * number that appears on a call, plus any labeled number, and uses the label
 * when there is one.
 */

export type TrackingOption = { number: string; label: string | null };

export function mergeTrackingOptions(
  labeled: Array<{ number: string; label: string }>,
  seenOnCalls: Array<string | null>,
): TrackingOption[] {
  const byNumber = new Map<string, string | null>();
  for (const t of labeled) {
    if (!byNumber.has(t.number)) byNumber.set(t.number, t.label);
  }
  for (const number of seenOnCalls) {
    if (number && number !== "(unknown)" && !byNumber.has(number)) byNumber.set(number, null);
  }
  return [...byNumber]
    .map(([number, label]) => ({ number, label }))
    .sort((a, b) => {
      // Named numbers first (A to Z), then the unnamed ones by number.
      if (a.label && !b.label) return -1;
      if (!a.label && b.label) return 1;
      return (a.label ?? "").localeCompare(b.label ?? "") || a.number.localeCompare(b.number);
    });
}
