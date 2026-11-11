import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A server render of the strip a lost deal shows at the top of its panel body.
// The reason was only a hover title on the "Lost" pill, which a phone or tablet
// never shows, and the comment typed into the Lost dialog was shown nowhere.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/sales/deals",
  useSearchParams: () => new URLSearchParams("deal=d1"),
}));

const { LostBar } = await import("@/components/sales/deal-panel");

function render(reason: string | null, comment: string | null) {
  return renderToString(createElement(LostBar, { reason, comment })).replaceAll("<!-- -->", "");
}

describe("LostBar (server render)", () => {
  it("shows the reason and the comment in words, not only on hover", () => {
    const html = render("Price", "Went with a cheaper printer");
    expect(html).toContain("Lost: Price.");
    expect(html).toContain("Went with a cheaper printer");
    expect(html).toContain("bg-status-danger text-status-danger-foreground");
  });

  it("keeps the comment's own line breaks and wraps long words", () => {
    const html = render("Other", "Owner retired.\nCall the new owner in spring.");
    expect(html).toContain("Owner retired.\nCall the new owner in spring.");
    expect(html).toMatch(/class="[^"]*whitespace-pre-wrap[^"]*\[overflow-wrap:anywhere\][^"]*"/);
  });

  it("shows just the headline when there is no comment or reason", () => {
    const html = render(null, null);
    expect(html).toContain("Lost.");
    expect(html).not.toContain("whitespace-pre-wrap");
  });
});
