import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The New client and Edit client dialogs (old audit #14 follow-up). Only an
// admin may set a client's Slack channel now, so the field is read-only for
// everyone else, and a refused save must keep the dialog open with the
// reason instead of closing as if it had saved.

vi.mock("@/lib/actions/clients", () => ({ createClientAction: vi.fn(), updateClientAction: vi.fn() }));

const { SlackChannelField, runClientFormAction } = await import("@/components/clients/client-form-dialog");

const EM_DASH = String.fromCharCode(0x2014);

function formData() {
  const data = new FormData();
  data.set("name", "Acme Dental");
  return data;
}

describe("runClientFormAction", () => {
  it("keeps the dialog open and returns the reason when the save is refused", async () => {
    const reason = "Only an admin can set or change a client's Slack channel. Ask an admin to do it for you.";
    const action = vi.fn().mockResolvedValue({ error: reason });
    const onSaved = vi.fn();

    const state = await runClientFormAction(action, { error: null }, formData(), onSaved);

    expect(state).toEqual({ error: reason });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("closes the dialog only once the save went through", async () => {
    const action = vi.fn().mockResolvedValue({ error: null });
    const onSaved = vi.fn();
    const data = formData();

    const state = await runClientFormAction(action, { error: "old reason" }, data, onSaved);

    expect(state).toEqual({ error: null });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith({ error: "old reason" }, data);
  });
});

describe("SlackChannelField", () => {
  const render = (canChange: boolean, defaultValue = "C0123ABCD45") =>
    renderToStaticMarkup(createElement(SlackChannelField, { canChange, defaultValue }));

  it("is read-only for someone who is not an admin, still sending the current value so their save is not refused", () => {
    const html = render(false);

    // Attribute order and case are React's; the browser reads readOnly="" as readonly.
    expect(html).toMatch(/<input(?=[^>]*name="slackChannelId")(?=[^>]*readonly="")(?=[^>]*value="C0123ABCD45")[^>]*>/i);
    // Not disabled: a disabled field is left out of the form, which would clear the channel.
    expect(html).not.toMatch(/<input[^>]*\sdisabled(=""|\s|\/|>)/i);
    expect(html).toContain("Only an admin can change this.");
  });

  it("can be changed by an admin", () => {
    const html = render(true);

    expect(html).toMatch(/<input[^>]*name="slackChannelId"/);
    expect(html).not.toMatch(/readonly/i);
    expect(html).not.toContain("Only an admin can change this.");
    expect(html).toMatch(/existing channel/i);
  });

  it("uses no em dashes", () => {
    expect(render(true)).not.toContain(EM_DASH);
    expect(render(false, "")).not.toContain(EM_DASH);
  });
});

// There is no browser test setup, so this reads the dialog's source: the
// form has to submit through runClientFormAction, and must not close itself
// straight after submitting (the old code closed before the answer came back).
describe("client dialog wiring", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/clients/client-form-dialog.tsx"), "utf8");

  it("submits through runClientFormAction and closes only from it", () => {
    expect(source).toMatch(/useActionState\(\s*\(previous: ClientFormState, formData: FormData\) =>\s*runClientFormAction\(action, previous, formData, onSaved\)/);
    expect(source).toContain("<form action={formAction}>");
    expect(source).not.toMatch(/await formAction\(formData\);\s*setOpen\(false\)/);
  });

  it("passes who may change the Slack channel to the field", () => {
    expect(source).toMatch(/<SlackChannelField\s+canChange=\{canChangeSlackChannel\}/);
  });
});
