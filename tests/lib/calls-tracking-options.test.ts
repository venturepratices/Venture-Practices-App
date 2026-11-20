import { describe, expect, it } from "vitest";

import { mergeTrackingOptions } from "@/lib/calls/tracking-options";

// The tracking-number filter showed only "All numbers" because it read the
// labeled-numbers table, which nobody has filled in yet. It must offer every
// number that is on a call.

describe("mergeTrackingOptions", () => {
  it("offers every number seen on calls even when none are labeled", () => {
    const options = mergeTrackingOptions([], ["+17043973212", "+17043893355", "+17042863058"]);
    expect(options.map((o) => o.number)).toEqual(["+17042863058", "+17043893355", "+17043973212"]);
    expect(options.every((o) => o.label === null)).toBe(true);
  });

  it("lists each number once however many calls carry it", () => {
    const options = mergeTrackingOptions([], ["+1704", "+1704", "+1704", "+1980"]);
    expect(options).toHaveLength(2);
  });

  it("uses the label when a number has one, and puts named numbers first", () => {
    const options = mergeTrackingOptions(
      [{ number: "+17043973212", label: "Direct Mail" }],
      ["+17042863058", "+17043973212"],
    );
    expect(options).toEqual([
      { number: "+17043973212", label: "Direct Mail" },
      { number: "+17042863058", label: null },
    ]);
  });

  it("keeps a labeled number that has no calls yet", () => {
    const options = mergeTrackingOptions([{ number: "+17049990000", label: "Google Ads" }], []);
    expect(options).toEqual([{ number: "+17049990000", label: "Google Ads" }]);
  });

  it("ignores calls with no tracking number", () => {
    expect(mergeTrackingOptions([], [null, "(unknown)"])).toEqual([]);
  });
});
