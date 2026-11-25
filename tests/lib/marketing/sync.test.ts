import { describe, expect, it } from "vitest";

import {
  buildSnapshotRow,
  rollupHealth,
  safeExternalHref,
  summarize,
  type SyncLink,
} from "@/lib/marketing/sync";
import type { Sequence } from "@/lib/marketing/sequences";

// Hardened external link + health roll-up for Marketing > Sync. Every URL
// rendered on that page goes through safeExternalHref, so the allow-list and
// protocol check are security-sensitive.

const baseSequence: Sequence = {
  key: "sales",
  displayName: "Sales",
  tabNumber: "03",
  subtitle: "test",
  purpose: "test",
  brand: "practice-mailers",
  flowId: "flow_abc",
  listId: "list_xyz",
  listName: "Sales leads",
  ghlSegment: "sales_segment",
  ghlWorkflowId: "wf_123",
  status: "active",
  visualPass: "done",
  duration: "14 days",
  entry: { title: "entry", sub: "sub" },
  steps: [],
  exits: [],
  fromAddress: "Ben Shaver <hello@news.venturepractices.com>",
};

const link = (overrides: Partial<SyncLink>): SyncLink => ({
  key: "nitro-flow",
  label: "NitroSend flow",
  value: "something",
  source: "nitrosend",
  health: "in-sync",
  externalUrl: null,
  ...overrides,
});

describe("safeExternalHref", () => {
  it("accepts https URLs on NitroSend's host", () => {
    expect(safeExternalHref("https://app.nitrosend.com/my/flows/abc")).toBe(
      "https://app.nitrosend.com/my/flows/abc",
    );
  });

  it("accepts https URLs on HighLevel hosts", () => {
    expect(safeExternalHref("https://app.gohighlevel.com/foo")).toBe(
      "https://app.gohighlevel.com/foo",
    );
    expect(safeExternalHref("https://app.highlevel.com/foo")).toBe(
      "https://app.highlevel.com/foo",
    );
  });

  it("rejects http:// even on an allow-listed host", () => {
    expect(safeExternalHref("http://app.nitrosend.com/foo")).toBeNull();
  });

  it("rejects javascript: URLs", () => {
    expect(safeExternalHref("javascript:alert(1)")).toBeNull();
  });

  it("rejects data: URLs", () => {
    expect(safeExternalHref("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejects hosts not on the allow-list even over https", () => {
    expect(safeExternalHref("https://evil.example.com/")).toBeNull();
    expect(safeExternalHref("https://app.nitrosend.com.evil.example.com/")).toBeNull();
  });

  it("rejects null, empty, and malformed input", () => {
    expect(safeExternalHref(null)).toBeNull();
    expect(safeExternalHref(undefined)).toBeNull();
    expect(safeExternalHref("")).toBeNull();
    expect(safeExternalHref("not a url")).toBeNull();
  });
});

describe("rollupHealth", () => {
  it("picks mismatch over everything else", () => {
    expect(
      rollupHealth([
        link({ health: "in-sync" }),
        link({ health: "mismatch" }),
        link({ health: "pending" }),
      ]),
    ).toBe("mismatch");
  });

  it("picks not-connected over pending and in-sync", () => {
    expect(
      rollupHealth([
        link({ health: "in-sync" }),
        link({ health: "not-connected" }),
        link({ health: "pending" }),
      ]),
    ).toBe("not-connected");
  });

  it("picks pending over in-sync", () => {
    expect(
      rollupHealth([link({ health: "in-sync" }), link({ health: "pending" })]),
    ).toBe("pending");
  });

  it("stays in-sync when every link is in-sync", () => {
    expect(
      rollupHealth([link({ health: "in-sync" }), link({ health: "in-sync" })]),
    ).toBe("in-sync");
  });

  it("does not let not-wired drag an otherwise in-sync row", () => {
    expect(
      rollupHealth([link({ health: "in-sync" }), link({ health: "not-wired" })]),
    ).toBe("in-sync");
  });

  it("falls back to not-wired when everything is not-wired", () => {
    expect(rollupHealth([link({ health: "not-wired" })])).toBe("not-wired");
  });
});

describe("buildSnapshotRow", () => {
  it("builds four typed links per sequence", () => {
    const row = buildSnapshotRow(baseSequence);
    expect(row.links.map((l) => l.key)).toEqual([
      "nitro-flow",
      "nitro-list",
      "ghl-segment",
      "ghl-workflow",
    ]);
  });

  it("treats a flow id of 'not built' as not-connected", () => {
    const row = buildSnapshotRow({ ...baseSequence, flowId: "not built" });
    const flow = row.links.find((l) => l.key === "nitro-flow");
    expect(flow?.health).toBe("not-connected");
    expect(flow?.externalUrl).toBeNull();
  });

  it("treats a missing GHL workflow as not-wired, not not-connected", () => {
    const row = buildSnapshotRow({ ...baseSequence, ghlWorkflowId: undefined });
    const wf = row.links.find((l) => l.key === "ghl-workflow");
    expect(wf?.health).toBe("not-wired");
    expect(wf?.externalUrl).toBeNull();
  });

  it("builds an external NitroSend flow URL on the allow-list", () => {
    const row = buildSnapshotRow(baseSequence);
    const flow = row.links.find((l) => l.key === "nitro-flow");
    expect(flow?.externalUrl).toMatch(/^https:\/\/app\.nitrosend\.com\//);
  });
});

describe("summarize", () => {
  it("counts each health and picks the worst", () => {
    const rows = [
      buildSnapshotRow(baseSequence),
      buildSnapshotRow({ ...baseSequence, key: "nurture", flowId: "not built" }),
    ];
    const s = summarize(rows);
    expect(s.total).toBe(2);
    expect(s.counts["not-connected"]).toBeGreaterThanOrEqual(1);
    expect(s.worst === "mismatch" || s.worst === "not-connected").toBe(true);
  });
});
