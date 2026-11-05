"use client";

import {
  cloneElement,
  lazy,
  Suspense,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type MouseEvent,
  type ReactElement,
} from "react";

import { cn } from "@/lib/utils";
import type { TeamMemberFormDialog } from "@/components/team/team-member-form-dialog";

// Loads the member form dialog on demand instead of bundling it into the Team
// page. The dialog names the Sales switch (its label and field names), and the
// Team page is open to people without Sales access: Next sends a page every
// client chunk it imports statically, even for a tab that does not render for
// that person. A dynamic import() keeps the dialog in its own chunk, which only
// the admin-only Members tab ever asks for. The import has to stay inside this
// client file: a Server Component's dynamic import does not code-split.
// tests/lib/sales/team-secrecy.test.ts holds the line; never import the dialog
// as a value anywhere else. Never call the import() at module scope either:
// this wrapper's own chunk reaches every /team visitor, so that would fetch
// the dialog for people the Members tab is not shown to.
const MemberDialog = lazy(() =>
  import("@/components/team/team-member-form-dialog").then((m) => ({ default: m.TeamMemberFormDialog })),
);

const noSubscription = () => () => {};

/**
 * Until the dialog's chunk arrives a stand-in of the trigger button shows in
 * its place, so the row does not jump or pop in. The server and the hydrating
 * render show only the stand-in (so its click handler is live from the
 * start); the dialog's chunk starts loading as soon as the wrapper has
 * mounted. A click on the stand-in while it loads is remembered (the button
 * shows busy) and the dialog opens the moment it arrives.
 */
export function LazyTeamMemberFormDialog(props: ComponentProps<typeof TeamMemberFormDialog>) {
  const [pressed, setPressed] = useState(false);
  const mounted = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const standIn = standInTrigger(props.trigger as ReactElement<TriggerProps>, pressed, () => setPressed(true));
  if (!mounted) return standIn;
  return (
    <Suspense fallback={standIn}>
      <MemberDialog {...props} defaultOpen={pressed} />
    </Suspense>
  );
}

type TriggerProps = { onClick?: (event: MouseEvent<HTMLElement>) => void; className?: string };

/** The trigger button, standing in while the dialog loads: a press calls `onPress`, and once pressed it shows busy. */
export function standInTrigger(trigger: ReactElement<TriggerProps>, pressed: boolean, onPress: () => void) {
  return cloneElement(trigger, {
    onClick: (event: MouseEvent<HTMLElement>) => {
      trigger.props.onClick?.(event);
      onPress();
    },
    ...(pressed ? { "aria-busy": true, className: cn(trigger.props.className, "cursor-progress") } : {}),
  });
}
