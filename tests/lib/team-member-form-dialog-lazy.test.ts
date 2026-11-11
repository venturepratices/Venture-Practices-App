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

const { keepFocusAcrossSwap, standInTrigger } = await import("@/components/team/team-member-form-dialog-lazy");
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

// React swaps the button's DOM node twice: right after hydration (the stand-in
// moves into a Suspense boundary) and when the dialog's chunk arrives (the
// real trigger replaces the stand-in). A keyboard user focused on it then
// landed on <body> (M4). keepFocusAcrossSwap is the ref both buttons share.
// A stand-in page: React runs a ref's cleanup just before it removes the node,
// and a removed node that had focus leaves it on <body>.
function fakePage() {
  type FakeButton = { ownerDocument: typeof doc; focus(): void };
  const body = {};
  const doc = { body, activeElement: body as unknown };
  const button = (): FakeButton => {
    const node: FakeButton = { ownerDocument: doc, focus: () => void (doc.activeElement = node) };
    return node;
  };
  const keep = keepFocusAcrossSwap();
  return {
    doc,
    button,
    /** React mounts a button with the shared ref. */
    mount(node: FakeButton) {
      const cleanup = keep(node as unknown as HTMLElement);
      return {
        /** React removes it again. */
        remove() {
          cleanup?.();
          if (doc.activeElement === node) doc.activeElement = body;
        },
      };
    },
  };
}

describe("keepFocusAcrossSwap", () => {
  it("gives focus to the button that replaces the focused one, across both swaps", () => {
    const page = fakePage();
    const hydrated = page.button();
    const first = page.mount(hydrated);
    hydrated.focus(); // the person tabbed to it
    first.remove();
    const fallback = page.button();
    const second = page.mount(fallback);
    expect(page.doc.activeElement).toBe(fallback);
    second.remove();
    const real = page.button();
    page.mount(real);
    expect(page.doc.activeElement).toBe(real);
  });

  it("leaves focus alone when the replaced button did not have it", () => {
    const page = fakePage();
    const elsewhere = page.button();
    const standIn = page.mount(page.button());
    standIn.remove();
    page.mount(page.button());
    expect(page.doc.activeElement).toBe(page.doc.body);
    elsewhere.focus();
    const again = page.mount(page.button());
    again.remove();
    page.mount(page.button());
    expect(page.doc.activeElement).toBe(elsewhere);
  });

  it("never takes focus from something that has it by then", () => {
    const page = fakePage();
    const standInNode = page.button();
    const standIn = page.mount(standInNode);
    standInNode.focus();
    standIn.remove();
    const other = page.button();
    other.focus();
    page.mount(page.button());
    expect(page.doc.activeElement).toBe(other);
  });
});

describe("the stand-in trigger's ref", () => {
  it("is the ref it is given, so focus can move from it to the real trigger", () => {
    const ref = keepFocusAcrossSwap();
    const standIn = standInTrigger(createElement("button", null, "Edit"), false, () => {}, ref);
    expect((standIn.props as { ref?: unknown }).ref).toBe(ref);
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
