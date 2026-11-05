import { describe, expect, it } from "vitest";

import { pressOpensSubmenu } from "@/components/sales/deal-quick-actions";

// The card menu's "Move to" (C9). Base UI's SubmenuTrigger opens on hover, and
// while it does it ignores a mouse press on the trigger (useClick with
// ignoreMouse: openOnHover, @base-ui/react 1.6.0 MenuSubmenuTrigger), so a
// click on "Move to" did nothing, and on touch a tap is the only way in.
// pressOpensSubmenu holds the submenu's open state: hover and keys still open
// it through Base UI, and a press on the trigger opens it too, never closing
// it on the same gesture.

function harness() {
  let open = false;
  const submenu = pressOpensSubmenu((next) => {
    open = next;
  });
  return { submenu, isOpen: () => open };
}

describe("pressOpensSubmenu", () => {
  it("a press on the trigger opens the submenu", () => {
    const { submenu, isOpen } = harness();
    submenu.onTriggerClick();
    expect(isOpen()).toBe(true);
  });

  it("a press never closes it: not after hover opened it, not on a second press", () => {
    const { submenu, isOpen } = harness();
    submenu.onOpenChange(true); // hover or ArrowRight, through Base UI
    submenu.onTriggerClick();
    expect(isOpen()).toBe(true);
    submenu.onTriggerClick();
    expect(isOpen()).toBe(true);
  });

  it("closes when Base UI closes it (pointer left, Esc, a stage picked)", () => {
    const { submenu, isOpen } = harness();
    submenu.onTriggerClick();
    submenu.onOpenChange(false);
    expect(isOpen()).toBe(false);
  });

  it("closes with the card menu, so the next right-click does not open on it", () => {
    const { submenu, isOpen } = harness();
    submenu.onTriggerClick();
    submenu.onMenuOpenChange(true);
    expect(isOpen()).toBe(true);
    submenu.onMenuOpenChange(false);
    expect(isOpen()).toBe(false);
  });
});
