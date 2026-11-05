"use client";

import { lazy, Suspense, type ComponentProps } from "react";

import type { TeamMemberFormDialog } from "@/components/team/team-member-form-dialog";

// Loads the member form dialog on demand instead of bundling it into the Team
// page. The dialog names the Sales switch (its label and field names), and the
// Team page is open to people without Sales access: Next sends a page every
// client chunk it imports statically, even for a tab that does not render for
// that person. A dynamic import() keeps the dialog in its own chunk, which only
// the admin-only Members tab ever asks for. The import has to stay inside this
// client file: a Server Component's dynamic import does not code-split.
// tests/lib/sales/team-secrecy.test.ts holds the line; never import the dialog
// as a value anywhere else.
const MemberDialog = lazy(() =>
  import("@/components/team/team-member-form-dialog").then((m) => ({ default: m.TeamMemberFormDialog })),
);

/**
 * Until the dialog's chunk arrives the trigger button shows on its own, so the
 * row does not jump or pop in; it opens the dialog as soon as the chunk is in.
 */
export function LazyTeamMemberFormDialog(props: ComponentProps<typeof TeamMemberFormDialog>) {
  return (
    <Suspense fallback={props.trigger}>
      <MemberDialog {...props} />
    </Suspense>
  );
}
