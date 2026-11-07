import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { ContactChoice } from "@/components/sales/contact-picker";

// What leaving the shared contact picker does to its value, once the person
// has typed or picked something. Node has no browser to type in: the combobox
// parts render in place and the root records the props the picker gives it,
// and React's useState is wrapped so the text Base UI reports can be fed into
// the next render, which is what React would do. (The real Base UI box, and
// a list opened and closed without typing, are in contact-picker-render.)

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

type Details = { reason: string };
type RootProps = {
  onInputValueChange: (text: string, details: Details) => void;
  onOpenChange: (open: boolean, details: Details) => void;
  children?: ReactNode;
};
const root = vi.hoisted(() => ({ props: null as RootProps | null }));

vi.mock("@/components/ui/combobox", async () => {
  const { createElement: h, Fragment: F } = await import("react");
  const inPlace = ({ children }: { children?: ReactNode }) => h(F, null, children);
  return {
    Combobox: (props: RootProps) => {
      root.props = props;
      return h(F, null, props.children);
    },
    ComboboxInputGroup: inPlace,
    ComboboxInput: () => h("input"),
    ComboboxTrigger: inPlace,
    ComboboxContent: inPlace,
    ComboboxEmpty: inPlace,
    ComboboxList: () => null,
    ComboboxItem: inPlace,
  };
});

const { ContactPicker, existingChoice } = await import("@/components/sales/contact-picker");

const SARAH = existingChoice("person", { id: "p1", name: "Sarah K." });

let value: ContactChoice | null;
let onChange: Mock<(value: ContactChoice | null) => void>;

function render() {
  hooks.next = 0;
  renderToString(createElement(ContactPicker, { kind: "person", label: "Person", placeholder: "Sarah K.", value, onChange }));
}

/** Base UI reports new text in the box; React renders the picker again with it. */
function report(text: string, reason: string) {
  root.props!.onInputValueChange(text, { reason });
  for (const [index, update] of hooks.updates.splice(0)) {
    hooks.state[index] = typeof update === "function" ? (update as (prev: unknown) => unknown)(hooks.state[index]) : update;
  }
  render();
}

const leave = (reason = "outside-press") => root.props!.onOpenChange(false, { reason });

beforeEach(() => {
  hooks.state = [];
  hooks.updates = [];
  onChange = vi.fn<(value: ContactChoice | null) => void>();
});

describe("ContactPicker: leaving the box", () => {
  it("clears a starting contact the person emptied", () => {
    value = SARAH;
    render();
    report("", "input-change");
    leave();
    expect(onChange.mock.calls).toEqual([[null]]);
  });

  it("keeps a typed name that matches nothing as a new contact", () => {
    value = null;
    render();
    report("  Dana Q. ", "input-change");
    leave("escape-key");
    expect(onChange.mock.calls).toEqual([[{ key: "new", kind: "new", name: "Dana Q." }]]);
  });

  it("keeps a starting contact when only its own name was retyped", () => {
    value = SARAH;
    render();
    report("Sarah K.", "input-change");
    leave();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not undo a pick when the list closes after it", () => {
    value = null;
    render();
    report("Sar", "input-change");
    leave("item-press");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps a contact the parent swapped in, which Base UI reports as the new name", () => {
    value = SARAH;
    render();
    value = existingChoice("person", { id: "p2", name: "Dana Q." });
    report("Dana Q.", "none");
    leave();
    expect(onChange).not.toHaveBeenCalled();
  });
});
