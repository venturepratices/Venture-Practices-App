/**
 * Matching for the Calls page's search-as-you-type filters (client and
 * tracking number). Kept apart from the component so it can be tested.
 */

export type FilterItem = {
  value: string;
  label: string;
  /** Extra text that should also match what the person types (for example the raw phone number). */
  searchText?: string;
};

const digitsOnly = (s: string) => s.replace(/\D/g, "");

export function matchesFilterQuery(item: FilterItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;

  const haystack = `${item.label} ${item.searchText ?? ""}`.toLowerCase();
  if (haystack.includes(q)) return true;

  // A typed phone number matches however it is written: "704 397", "704-397",
  // "(704) 397-3212" and "+17043973212" all find the same number.
  const typedDigits = digitsOnly(q);
  const looksLikePhone = /^[\d\s()+\-.]+$/.test(q);
  return looksLikePhone && typedDigits.length >= 3 && digitsOnly(haystack).includes(typedDigits);
}
