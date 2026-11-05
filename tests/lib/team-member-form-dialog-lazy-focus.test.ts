import { createElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

// The Team page's member dialog loads on demand; until it arrives a stand-in
// of its button shows. When the real trigger replaces the stand-in, a keyboard
// user focused on it used to land on <body> (M4). The stand-in and the real
// trigger share one focus keeper (keepFocusAcrossSwap, tested in
// team-member-form-dialog-lazy.test.ts), so the new button takes the focus
// back. This checks they really get the same one.
//
// Node has no browser. useSyncExternalStore answers as the browser does after
// hydration, so the wrapper renders the lazy dialog; a static prerender waits
// for it, and renders the stand-in as the boundary's fallback on the way.

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useSyncExternalStore: <T,>(subscribe: (onChange: () => void) => () => void, getSnapshot: () => T) =>
      actual.useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
  };
});

type TriggerProps = { ref?: unknown; onClick?: unknown };
const seen = vi.hoisted(() => ({ dialogTriggers: [] as unknown[], buttons: [] as Array<{ ref?: unknown; onClick?: unknown }> }));

// The real dialog's own markup is not under test here: it records the trigger it is given.
vi.mock("@/components/team/team-member-form-dialog", () => ({
  TeamMemberFormDialog: ({ trigger }: { trigger: unknown }) => {
    seen.dialogTriggers.push(trigger);
    return null;
  },
}));

/** The trigger button the Team page passes in; records the props each copy of it gets. */
function TriggerButton(props: TriggerProps) {
  seen.buttons.push(props);
  return createElement("button", null, "New team member");
}

const { prerender } = await import("react-dom/static");
const { LazyTeamMemberFormDialog } = await import("@/components/team/team-member-form-dialog-lazy");

describe("LazyTeamMemberFormDialog's trigger", () => {
  it("gives the stand-in and the real trigger the same focus keeper", async () => {
    await prerender(createElement(LazyTeamMemberFormDialog, { mode: "create", clients: [], trigger: createElement(TriggerButton) }));

    expect(seen.dialogTriggers).toHaveLength(1);
    const real = seen.dialogTriggers[0] as ReactElement<TriggerProps>;
    expect(typeof real.props.ref).toBe("function");

    // The stand-in is the copy with the click handler that remembers a press.
    const standIns = seen.buttons.filter((props) => typeof props.onClick === "function");
    expect(standIns.length).toBeGreaterThan(0);
    for (const standIn of standIns) expect(standIn.ref).toBe(real.props.ref);
  });
});
