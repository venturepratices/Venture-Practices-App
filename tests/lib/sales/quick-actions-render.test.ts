import { createElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BoardCard, BoardStage } from "@/lib/sales/board";

// How the card menu wires its "Move to" submenu (C9). Base UI's submenu
// trigger ignores a mouse press while it opens on hover, so "Move to" did
// nothing on a click and a tap. DealQuickActions holds the submenu's open
// state itself (pressOpensSubmenu, tested on its own in
// quick-actions-submenu.test.ts): the submenu is controlled, a press on its
// trigger opens it, and closing the card menu closes it. Drop any of those
// props and the dead click is back while the helper's tests stay green.
//
// Node has no browser to click in. The menu parts render in place and record
// the props they get, and React's useState is wrapped so a state change the
// test makes can be fed into the next render, which is what React would do.

const hooks = vi.hoisted(() => ({ next: 0, state: [] as unknown[], updates: [] as Array<[number, unknown]> }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.next++;
      if (!(index in hooks.state)) hooks.state[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [hooks.state[index], (update: unknown) => hooks.updates.push([index, update])];
    },
  };
});

type Props = Record<string, unknown> & { children?: ReactNode };
const seen = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock("@/components/ui/context-menu", async () => {
  const { createElement: h, Fragment: F } = await import("react");
  const recorded = (part: string) => (props: Props) => {
    seen.set(part, props);
    return h(F, null, props.children);
  };
  const inPlace = ({ children }: Props) => h(F, null, children);
  return {
    ContextMenu: recorded("menu"),
    ContextMenuTrigger: ({ render }: { render: ReactElement }) => render,
    ContextMenuContent: inPlace,
    ContextMenuItem: inPlace,
    ContextMenuRadioGroup: inPlace,
    ContextMenuRadioItem: inPlace,
    ContextMenuSeparator: () => null,
    ContextMenuSub: recorded("sub"),
    ContextMenuSubContent: inPlace,
    ContextMenuSubTrigger: recorded("subTrigger"),
  };
});

const { DealQuickActions } = await import("@/components/sales/deal-quick-actions");

function stage(id: string, name: string): BoardStage {
  return { id, key: id, name, position: 0, probability: 30, isWon: false, isLost: false, requiresValue: false, isNoShow: false, rottingDays: 14 };
}

const STAGES = [stage("s1", "New Opt-In"), stage("s2", "Demo Complete")];

const CARD: BoardCard = {
  id: "d1",
  title: "Bright Smile Dental",
  valueCents: 1_440_000,
  mrrCents: 120_000,
  stageId: "s1",
  status: "OPEN",
  stageEnteredAt: "2026-11-04T15:00:00.000Z",
  ownerId: "u1",
  personName: "Sarah K.",
  organizationName: "Bright Smile Dental",
  next: null,
};

const PROPS: ComponentProps<typeof DealQuickActions> = {
  card: CARD,
  stages: STAGES,
  viewer: { userId: "u1", isAdmin: false },
  actions: { open: vi.fn(), move: vi.fn(), setStatus: vi.fn(), changed: vi.fn() },
  // The card: it becomes the menu's trigger.
  children: createElement("div", { role: "button" }, CARD.title),
};

/** One render of the card's menu, after applying the state changes made since the last one. */
function render() {
  for (const [index, update] of hooks.updates.splice(0)) {
    hooks.state[index] = typeof update === "function" ? (update as (current: unknown) => unknown)(hooks.state[index]) : update;
  }
  hooks.next = 0;
  seen.clear();
  renderToString(createElement(DealQuickActions, PROPS));
  const part = (name: string) => {
    const props = seen.get(name);
    expect(props, name).toBeDefined();
    return props as Record<string, unknown>;
  };
  return { menu: part("menu"), sub: part("sub"), subTrigger: part("subTrigger") };
}

const call = (handler: unknown, ...args: unknown[]) => {
  expect(typeof handler).toBe("function");
  (handler as (...args: unknown[]) => void)(...args);
};

beforeEach(() => {
  hooks.state = [];
  hooks.updates = [];
});

describe("the card menu's Move to submenu (server render)", () => {
  it("is controlled: it starts closed and opens when the person presses its trigger", () => {
    const first = render();
    expect(first.sub.open).toBe(false);
    call(first.subTrigger.onClick, {});
    expect(render().sub.open).toBe(true);
  });

  it("still opens and closes through Base UI (hover, arrow keys, Esc)", () => {
    call(render().sub.onOpenChange, true);
    const opened = render();
    expect(opened.sub.open).toBe(true);
    call(opened.sub.onOpenChange, false);
    expect(render().sub.open).toBe(false);
  });

  it("closes with the card menu, so the next right-click starts closed", () => {
    call(render().subTrigger.onClick, {});
    const opened = render();
    expect(opened.sub.open).toBe(true);
    call(opened.menu.onOpenChange, false);
    expect(render().sub.open).toBe(false);
  });
});
