import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The shared organization and person picker (Add deal, new lead, convert, and
// the Details rows of deals and leads). Rendered with the real Base UI
// combobox on the server: the popup is a portal and stays out, so this checks
// the box itself, the request body a choice becomes, and `disabled`. The root
// is wrapped only to record the props the picker gives it, so a test can close
// the list the way Base UI would.

type CloseDetails = { reason: string };
const root = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));

vi.mock("@/components/ui/combobox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/combobox")>();
  const { createElement: h } = await import("react");
  const Combobox = (props: Record<string, unknown>) => {
    root.props = props;
    return h(actual.Combobox as never, props as never);
  };
  return { ...actual, Combobox };
});

const { ContactPicker, contactBody, existingChoice } = await import("@/components/sales/contact-picker");

/** Base UI's close of the list, with the reason it gives. */
const closeList = (reason: string) => (root.props.onOpenChange as (open: boolean, details: CloseDetails) => void)(false, { reason });

type PickerProps = Parameters<typeof ContactPicker>[0];

function render(props: Partial<PickerProps> = {}): string {
  return renderToString(
    createElement(ContactPicker, {
      kind: "person",
      label: "Person",
      placeholder: "Sarah K.",
      value: null,
      onChange: vi.fn(),
      ...props,
    }),
  ).replaceAll("<!-- -->", "");
}

/** The opening tag of the first element matching `pattern`. */
function tag(html: string, pattern: RegExp): string {
  const match = pattern.exec(html);
  expect(match, String(pattern)).not.toBeNull();
  return match![0];
}

const input = (html: string) => tag(html, /<input[^>]*>/);
const trigger = (html: string) => tag(html, /<button[^>]*aria-label="Show person matches"[^>]*>/);

describe("contactBody", () => {
  it("sends a picked contact by id, a new one by name, and none as null", () => {
    expect(contactBody(null)).toBeNull();
    expect(contactBody({ key: "person:p1", kind: "existing", id: "p1", name: "Sarah K.", detail: null })).toEqual({ id: "p1" });
    expect(contactBody({ key: "new", kind: "new", name: "Dana Q." })).toEqual({ name: "Dana Q." });
  });
});

describe("existingChoice", () => {
  it("turns a person found by search into a choice that shows their organization under the name", () => {
    expect(existingChoice("person", { id: "p1", name: "Sarah K.", organizationName: "Oak Creek Dental" })).toEqual({
      key: "person:p1",
      kind: "existing",
      id: "p1",
      name: "Sarah K.",
      detail: "Oak Creek Dental",
    });
  });

  it("turns a panel's organization into a choice with no detail line", () => {
    expect(existingChoice("organization", { id: "o1", name: "Oak Creek Dental" })).toEqual({
      key: "organization:o1",
      kind: "existing",
      id: "o1",
      name: "Oak Creek Dental",
      detail: null,
    });
  });
});

describe("ContactPicker (server render)", () => {
  it("labels the box and offers a button that shows the matches", () => {
    const html = render();
    const id = /id="([^"]+)"/.exec(input(html))?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`for="${id}"`);
    expect(html).toMatch(/<label[^>]*>Person<\/label>/);
    expect(input(html)).toContain('placeholder="Sarah K."');
    expect(trigger(html)).toBeTruthy();
  });

  it("shows the picked contact's name in the box", () => {
    const html = render({ value: existingChoice("person", { id: "p1", name: "Sarah K.", organizationName: null }) });
    expect(input(html)).toContain('value="Sarah K."');
  });

  it("can be typed in and opened while enabled", () => {
    const html = render();
    expect(input(html)).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(trigger(html)).not.toMatch(/\sdisabled(=|\s|>)/);
  });

  it("passes disabled to the box and to its button", () => {
    const html = render({ disabled: true });
    expect(input(html)).toMatch(/\sdisabled(=|\s|>)/);
    expect(trigger(html)).toMatch(/\sdisabled(=|\s|>)/);
  });

  it("turns the whole box off while disabled, so a press beside the input cannot open the list", () => {
    // Base UI's box opens the list on a press anywhere in it unless the
    // combobox itself is disabled; the input's own `disabled` does not reach it.
    const group = (html: string) => tag(html, /<div[^>]*data-slot="combobox-input-group"[^>]*>/);
    expect(group(render({ disabled: true }))).toMatch(/\sdata-disabled(=|\s|>)/);
    expect(root.props.disabled).toBe(true);
    expect(group(render())).not.toMatch(/\sdata-disabled(=|\s|>)/);
    expect(root.props.disabled).toBeFalsy();
  });

  it("looks disabled the way the app's selects do while it is disabled", () => {
    // The shared combobox box has no disabled look of its own; the Owner and
    // Pipeline selects beside it fade to half and show a not-allowed cursor.
    const group = tag(render(), /<div[^>]*data-slot="combobox-input-group"[^>]*>/);
    const classes = /class="([^"]*)"/.exec(group)?.[1].split(/\s+/) ?? [];
    expect(classes).toEqual(expect.arrayContaining(["has-disabled:cursor-not-allowed", "has-disabled:opacity-50"]));
  });
});

describe("ContactPicker: opening and closing the list without typing", () => {
  // Base UI fills the box from a starting `value` without reporting that text
  // to `onInputValueChange`, so the picker must not read its own empty record
  // as "the person emptied the box". A Details row that saves on change would
  // otherwise drop the deal's or lead's person.
  const CLOSE_REASONS = ["outside-press", "escape-key", "focus-out", "trigger-press"];

  it("keeps a starting contact", () => {
    for (const reason of CLOSE_REASONS) {
      const onChange = vi.fn();
      const html = render({ value: existingChoice("person", { id: "p1", name: "Sarah K." }), onChange });
      expect(input(html)).toContain('value="Sarah K."');
      closeList(reason);
      expect(onChange, reason).not.toHaveBeenCalled();
    }
  });

  it("leaves an empty box empty (Add deal's start)", () => {
    for (const reason of CLOSE_REASONS) {
      const onChange = vi.fn();
      render({ value: null, onChange });
      closeList(reason);
      expect(onChange, reason).not.toHaveBeenCalled();
    }
  });
});
