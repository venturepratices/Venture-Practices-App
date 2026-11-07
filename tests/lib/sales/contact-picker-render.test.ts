import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The shared organization and person picker (Add deal, new lead, convert, and
// the Details rows of deals and leads). Rendered with the real Base UI
// combobox on the server: the popup is a portal and stays out, so this checks
// the box itself, the request body a choice becomes, and `disabled`.

const { ContactPicker, contactBody, existingChoice } = await import("@/components/sales/contact-picker");

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

  it("looks disabled the way the app's selects do while it is disabled", () => {
    // The shared combobox box has no disabled look of its own; the Owner and
    // Pipeline selects beside it fade to half and show a not-allowed cursor.
    const group = tag(render(), /<div[^>]*data-slot="combobox-input-group"[^>]*>/);
    const classes = /class="([^"]*)"/.exec(group)?.[1].split(/\s+/) ?? [];
    expect(classes).toEqual(expect.arrayContaining(["has-disabled:cursor-not-allowed", "has-disabled:opacity-50"]));
  });
});
