import { activitiesQueryToSearch, type ActivitiesQuery } from "@/lib/sales/activities-query";
import { ACTIVITY_TYPE_LABELS } from "@/lib/sales/constants";

// Pure helpers for the Activities page (no prisma, no server imports).

type EmptyState = { title: string; description: string; action: { label: string; href: string } };

const DEALS_HREF = "/sales/deals";

/** An Activities page link: the given day filter, every type, and "Just me" kept when it is on. */
function activitiesHref(when: ActivitiesQuery["when"], scope: ActivitiesQuery["scope"]): string {
  const search = activitiesQueryToSearch({ when, type: "all", scope, cursor: null });
  return search ? `/sales/activities?${search}` : "/sales/activities";
}

/**
 * What an empty Activities list says (Decision 20): a title, one line of
 * explanation and a way forward (spec 7.12). A type filter is the likeliest
 * reason for an empty list, so it wins and offers to show every type. Links
 * that stay on this page keep "Just me" (`scope`, default Everyone).
 */
export function activitiesEmptyState(query: {
  when: ActivitiesQuery["when"];
  type: ActivitiesQuery["type"];
  scope?: ActivitiesQuery["scope"];
}): EmptyState {
  const scope = query.scope ?? "everyone";
  if (query.type !== "all") {
    return {
      title: `No ${ACTIVITY_TYPE_LABELS[query.type].toLowerCase()} activities here`,
      description: "Other types may still have work waiting.",
      action: { label: "Show all types", href: activitiesHref(query.when, scope) },
    };
  }
  switch (query.when) {
    case "open":
      return {
        title: "Nothing to do",
        description: "Activities you plan on a deal or lead show up here.",
        action: { label: "Open Deals", href: DEALS_HREF },
      };
    case "overdue":
      return {
        title: "Nothing overdue",
        description: "You are all caught up.",
        action: { label: "See what is due today", href: activitiesHref("today", scope) },
      };
    case "today":
      return {
        title: "Nothing due today",
        description: "Plan your next calls from the Deals board.",
        action: { label: "Open Deals", href: DEALS_HREF },
      };
    case "done":
      return {
        title: "Nothing done yet",
        description: "Tick an activity's circle when it is done and it lands here.",
        action: { label: "See what is to do", href: activitiesHref("open", scope) },
      };
  }
}
