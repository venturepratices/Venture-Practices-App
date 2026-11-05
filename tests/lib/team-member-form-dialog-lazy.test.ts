import { createElement, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The Team page's member dialog loads on demand (it names the Sales switch,
// tests/lib/sales/team-secrecy.test.ts). Until its chunk arrived the button
// shown in its place had no click handler, so a first click did nothing (F6).
// Now a click on that stand-in is remembered and the dialog opens with
// `defaultOpen` once it arrives. Node has no browser to click in, so this
// checks the two halves: the stand-in records the press, and the dialog opens
// when mounted with `defaultOpen`.

vi.mock("@/lib/actions/team-members", () => ({
  createTeamMemberAction: vi.fn(async () => ({ error: null })),
  updateTeamMemberAction: vi.fn(async () => ({ error: null })),
}));

// The dialog is a portal, which a server render leaves out: render it in place, only while open.
vi.mock("@/components/ui/dialog", async () => {
  const { createElement: h, Fragment: F } = await import("react");
  const part = ({ children }: { children?: ReactNode }) => h("div", null, children);
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      h(F, null, ...(Array.isArray(children) ? children : [children]).filter((child) => open || isTrigger(child))),
    DialogTrigger: ({ render }: { render: ReactElement }) => render,
    DialogContent: part,
    DialogHeader: part,
    DialogTitle: part,
    DialogDescription: part,
    DialogFooter: part,
  };
});

function isTrigger(child: unknown) {
  return typeof child === "object" && child !== null && "props" in child && "render" in (child.props as object);
}

const { standInTrigger } = await import("@/components/team/team-member-form-dialog-lazy");
const { TeamMemberFormDialog } = await import("@/components/team/team-member-form-dialog");

const click = {} as MouseEvent<HTMLElement>;

describe("the stand-in trigger shown while the member dialog loads", () => {
  it("remembers a press, so the dialog can open when it arrives", () => {
    let presses = 0;
    const standIn = standInTrigger(createElement("button", null, "New team member"), false, () => presses++);
    (standIn.props as { onClick: (event: MouseEvent<HTMLElement>) => void }).onClick(click);
    expect(presses).toBe(1);
  });

  it("still runs the trigger's own click handler", () => {
    let own = 0;
    const trigger = createElement("button", { onClick: () => own++ }, "Edit");
    const standIn = standInTrigger(trigger, false, () => {});
    (standIn.props as { onClick: (event: MouseEvent<HTMLElement>) => void }).onClick(click);
    expect(own).toBe(1);
  });

  it("shows itself busy once pressed, and keeps the trigger's label and look", () => {
    const trigger = createElement("button", { className: "h-8 px-2.5" }, "New team member");
    expect(renderToString(standInTrigger(trigger, false, () => {}))).toBe('<button class="h-8 px-2.5">New team member</button>');
    const busy = renderToString(standInTrigger(trigger, true, () => {}));
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain(">New team member</button>");
  });
});

describe("TeamMemberFormDialog", () => {
  const props = { mode: "create" as const, clients: [], trigger: createElement("button", null, "New team member") };

  it("opens straight away when mounted after a press on the stand-in", () => {
    const html = renderToString(createElement(TeamMemberFormDialog, { ...props, defaultOpen: true }));
    expect(html).toContain("Create a login and check exactly what this person can access.");
  });

  it("starts closed otherwise", () => {
    const html = renderToString(createElement(TeamMemberFormDialog, props));
    expect(html).toContain("New team member");
    expect(html).not.toContain("Create a login");
  });
});
