import fs from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Sales is secret from one team member. The shared sidebar and top bar ship to
// every signed-in person, so their source must not name Sales in any way (no
// path, label, import or prop name, all of which survive minification). The
// Sales group reaches the sidebar only as data, built on the server by the app
// layout for people with access.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/x",
  useSearchParams: () => new URLSearchParams(),
}));

const SRC = path.join(process.cwd(), "src");
const read = (relative: string) => fs.readFileSync(path.join(SRC, ...relative.split("/")), "utf8");
const sourceFiles = (dir: string) =>
  (fs.readdirSync(path.join(SRC, dir), { recursive: true }) as string[])
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => /\.(ts|tsx)$/.test(file));

describe("guard: the shared layout components name nothing Sales-related", () => {
  it.each([
    "components/layout/sidebar.tsx",
    "components/layout/sidebar-group-link.tsx",
    "components/layout/topbar.tsx",
  ])("%s", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/sales/i);
    expect(source).not.toMatch(/deals/i);
    expect(source).not.toMatch(/leads/i);
  });

  it("nor does any other file under src/components/layout", () => {
    const files = sourceFiles("components/layout");
    expect(files).toEqual(expect.arrayContaining(["sidebar.tsx", "sidebar-group-link.tsx", "topbar.tsx"]));
    for (const file of files) {
      const source = read(`components/layout/${file}`);
      expect(source, file).not.toMatch(/sales/i);
      expect(source, file).not.toMatch(/deals/i);
      expect(source, file).not.toMatch(/leads/i);
    }
  });

  it("the sidebar no longer holds a count's screen-reader words (they come with the data)", () => {
    expect(read("components/layout/sidebar.tsx")).not.toContain("due today or overdue");
  });

  it("the server app layout builds the group from @/lib/sales/nav", () => {
    expect(read("app/(app)/layout.tsx")).toMatch(/from "@\/lib\/sales\/nav"/);
  });

  it("no shared component imports @/lib/sales/nav", () => {
    const shared = sourceFiles("components").filter((file) => !file.startsWith("sales/"));
    expect(shared.length).toBeGreaterThan(0);
    for (const file of shared) {
      expect(read(`components/${file}`), file).not.toContain("@/lib/sales/nav");
    }
  });
});

describe("SidebarGroupLink", () => {
  const link = { href: "/x", label: "X", icon: "inbox" as const, count: 2, countLabel: "open items" };

  it("reads the count with the label the data gives, as one string", async () => {
    const { SidebarGroupLink } = await import("@/components/layout/sidebar-group-link");
    const html = renderToString(createElement(SidebarGroupLink, { link, active: false }));
    expect(html).toContain('href="/x"');
    expect(html).toContain("<span class=\"sr-only\"> open items</span>");
    // The pill never shrinks or wraps beside a long label.
    expect(html).toMatch(/<span class="[^"]*\bshrink-0\b[^"]*">2<span class="sr-only">/);
    expect(html).not.toContain("aria-current");
  });

  it("shows no pill when the count is zero", async () => {
    const { SidebarGroupLink } = await import("@/components/layout/sidebar-group-link");
    const html = renderToString(createElement(SidebarGroupLink, { link: { ...link, count: 0 }, active: false }));
    expect(html).toContain(">X</span>");
    expect(html).not.toContain("sr-only");
    expect(html).not.toContain("rounded-full");
  });

  it("marks the current page", async () => {
    const { SidebarGroupLink } = await import("@/components/layout/sidebar-group-link");
    const html = renderToString(createElement(SidebarGroupLink, { link, active: true }));
    expect(html).toContain('aria-current="page"');
  });

  it("has an icon for every icon key", async () => {
    const { ICONS } = await import("@/components/layout/sidebar-group-link");
    expect(Object.keys(ICONS).sort()).toEqual(["board", "calendar", "chart", "home", "inbox", "people", "settings"]);
  });
});
