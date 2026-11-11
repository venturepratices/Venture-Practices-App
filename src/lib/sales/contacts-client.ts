import type { MergeCounts } from "@/lib/sales/contact-merge";
import type { ContactKind, ContactsQuery } from "@/lib/sales/contacts-query";
import { contactsQueryToSearch } from "@/lib/sales/contacts-query";
import type { DuplicateInfo } from "@/lib/sales/duplicates";
import { endSentence, joinNames } from "@/lib/sales/format";

// Pure helpers for the Contacts page and the contact panel (no prisma, no
// server imports: the server modules above are read for their types only).
// Wording follows Mockup v2 where it draws the same thing (ruling P3A-X3),
// else the plan's strings.

const CONTACTS_PATH = "/sales/contacts";

type ContactsEmptyState = {
  title: string;
  /** None for a search that found nothing: that shows as one line with its action. */
  description: string | null;
  action: { label: string; href: string };
};

/** A Contacts URL for a query (no cursor). */
function contactsHref(query: ContactsQuery): string {
  const search = contactsQueryToSearch(query);
  return search ? `${CONTACTS_PATH}?${search}` : CONTACTS_PATH;
}

/** "people" / "organizations" without "s"-free grammar quirks: the whole-list word Mockup v2 uses. */
function tabWord(tab: ContactsQuery["tab"]): "people" | "organizations" {
  return tab;
}

/**
 * What an empty Contacts tab says (Mockup v2 `viewContacts`). A search that
 * found nothing wins and offers to clear it (keeping the tab and scope); Just
 * me offers everyone's; otherwise the tab is truly empty and offers Add.
 */
export function contactsEmptyState(query: ContactsQuery): ContactsEmptyState {
  const people = query.tab === "people";
  const word = tabWord(query.tab);

  if (query.q) {
    return {
      title: `No ${word} match "${query.q}".`,
      description: null,
      action: { label: "Clear search", href: contactsHref({ ...query, q: "", cursor: null }) },
    };
  }

  if (query.scope === "mine") {
    return {
      title: people ? "No people of yours yet." : "No organizations of yours yet.",
      description: people ? "People you own show up here." : "Organizations you own show up here.",
      action: {
        label: "Show everyone's",
        href: contactsHref({ ...query, scope: "everyone", cursor: null }),
      },
    };
  }

  const kind = people ? "person" : "organization";
  return {
    title: people ? "No people yet." : "No organizations yet.",
    description: people
      ? "People are added with each deal and lead, or here by hand."
      : "Practices are added with each deal and lead, or here by hand.",
    action: {
      label: people ? "Person" : "Organization",
      href: `${contactsHref({ ...query, cursor: null })}${
        contactsQueryToSearch({ ...query, cursor: null }) ? "&" : "?"
      }new=${kind}`,
    },
  };
}

// --- Contact panel (Task 23) ---

/** What the duplicate bar says, as one object the panel can render as a hidden row or a list of matches. */
export type DuplicateNotice =
  | { kind: "hidden"; text: string }
  | { kind: "matches"; label: string; matches: { id: string; name: string }[]; tail: string | null };

/** Text shown to a non-admin whose rep role meant a possible match sits out of view. */
export const DUPLICATE_HIDDEN_TEXT = "A matching contact already exists. Ask an admin to merge.";
const DUPLICATE_ASK_ADMIN = "Ask an admin to merge.";
/** The dialog's "Try again" error when the preview did not load. */
export const MERGE_PREVIEW_ERROR = "Could not load what will move.";

/**
 * Names possible duplicates for the contact panel's warn bar (Decision 17, A4).
 * Nothing to say when the matches are empty and nothing is hidden; a hidden
 * match that this viewer may not see gives the plain "Ask an admin to merge."
 * line (no name, no Merge button); visible matches give the names and, when
 * the viewer is not an admin, the tail that asks an admin to merge.
 */
export function duplicateNotice(info: DuplicateInfo, canMerge: boolean): DuplicateNotice | null {
  if (info.matches.length === 0) {
    if (!info.hiddenMatch) return null;
    return { kind: "hidden", text: DUPLICATE_HIDDEN_TEXT };
  }
  return {
    kind: "matches",
    label: info.matches.length === 1 ? "Possible duplicate:" : "Possible duplicates:",
    matches: info.matches,
    tail: canMerge ? null : DUPLICATE_ASK_ADMIN,
  };
}

/** The singular or plural form of a noun for a count ("1 deal", "3 deals"). */
function plural(count: number, singular: string, pluralForm?: string): string {
  const word = count === 1 ? singular : pluralForm ?? `${singular}s`;
  return `${count} ${word}`;
}

/**
 * The warn bar's "Moves 3 deals, 1 lead and 4 notes." line (Decision 20, A6).
 * Non-zero rows only, in the order people, deals, leads, activities, notes
 * (plan Task 23 pin); nothing to move reads "Nothing else moves.". Never two
 * dots: `endSentence` adds the final period.
 */
export function mergeCountsLine(counts: MergeCounts): string {
  const parts: string[] = [];
  if (counts.people > 0) parts.push(plural(counts.people, "person", "people"));
  if (counts.deals > 0) parts.push(plural(counts.deals, "deal"));
  if (counts.leads > 0) parts.push(plural(counts.leads, "lead"));
  if (counts.activities > 0) parts.push(plural(counts.activities, "activity", "activities"));
  if (counts.notes > 0) parts.push(plural(counts.notes, "note"));
  if (parts.length === 0) return "Nothing else moves.";
  return endSentence(`Moves ${joinNames(parts)}`);
}

/** The merge dialog's main line: "Keep X. Merge Y into it. Deals, ... move to X.". `endSentence` keeps short names' own period. */
export function mergeConfirmLine(kind: ContactKind, keepName: string, dropName: string): string {
  const moved =
    kind === "person"
      ? "Deals, leads, notes and activities"
      : "Deals, leads, people and notes";
  const keep = endSentence(`Keep ${keepName}`);
  const merge = endSentence(`Merge ${dropName} into it`);
  const movedLine = endSentence(`${moved} move to ${keepName}`);
  return `${keep} ${merge} ${movedLine}`;
}

/** The merge dialog's fill-blanks line, with short-name periods preserved by `endSentence`. */
export function mergeFillLine(keepName: string, dropName: string): string {
  const first = endSentence(`Empty details on ${keepName} are filled in from ${dropName}`);
  const second = endSentence(`Nothing on ${keepName} is overwritten`);
  return `${first} ${second}`;
}

/** The merged toast: "Merged. {drop} is now part of {keep}.". */
export function mergedToast(keepName: string, dropName: string): string {
  return endSentence(`Merged. ${dropName} is now part of ${keepName}`);
}

/** "1 person" / "3 people" / "0 people" for the organization panel's meta. */
export function contactMetaCount(count: number): string {
  return plural(count, "person", "people");
}

/** "Showing 20 of 35." when only part of a list fits; null when all of it is already shown. */
export function listCapLine(shown: number, total: number): string | null {
  if (shown >= total) return null;
  return `Showing ${shown} of ${total}.`;
}
