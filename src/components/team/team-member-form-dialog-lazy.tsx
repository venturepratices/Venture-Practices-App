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
  type Ref,
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
 * shows busy) and the dialog opens the moment it arrives. React replaces the
 * button's DOM node twice on the way (when the stand-in moves into the
 * Suspense boundary, and when the real trigger takes its place); the buttons
 * share one keepFocusAcrossSwap ref, so a keyboard user keeps their focus.
 */
export function LazyTeamMemberFormDialog(props: ComponentProps<typeof TeamMemberFormDialog>) {
  const [pressed, setPressed] = useState(false);
  // One focus keeper for this button for as long as it is on the page.
  const [keepFocus] = useState(keepFocusAcrossSwap);
  const mounted = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const trigger = props.trigger as ReactElement<TriggerProps>;
  const standIn = standInTrigger(trigger, pressed, () => setPressed(true), keepFocus);
  if (!mounted) return standIn;
  return (
    <Suspense fallback={standIn}>
      <MemberDialog {...props} trigger={cloneElement(trigger, { ref: keepFocus })} defaultOpen={pressed} />
    </Suspense>
  );
}

type TriggerProps = { onClick?: (event: MouseEvent<HTMLElement>) => void; className?: string; ref?: Ref<HTMLElement> };

/**
 * The trigger button, standing in while the dialog loads: a press calls
 * `onPress`, and once pressed it shows busy. `ref` is the focus keeper it
 * shares with the real trigger.
 */
export function standInTrigger(
  trigger: ReactElement<TriggerProps>,
  pressed: boolean,
  onPress: () => void,
  ref?: Ref<HTMLElement>,
) {
  return cloneElement(trigger, {
    onClick: (event: MouseEvent<HTMLElement>) => {
      trigger.props.onClick?.(event);
      onPress();
    },
    ...(ref ? { ref } : {}),
    ...(pressed ? { "aria-busy": true, className: cn(trigger.props.className, "cursor-progress") } : {}),
  });
}

/**
 * A ref for a button that React may replace with a new DOM node: if the old
 * node had focus when it was removed, the node that takes its place gets it
 * back (only while nothing else has taken it). React runs a ref's cleanup
 * just before it removes the node, while it still has focus.
 */
export function keepFocusAcrossSwap(): (node: HTMLElement | null) => (() => void) | undefined {
  let held = false;
  return (node) => {
    if (!node) return;
    const page = node.ownerDocument;
    if (held && (page.activeElement === null || page.activeElement === page.body)) node.focus();
    return () => {
      held = page.activeElement === node;
    };
  };
}
