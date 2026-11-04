import { describe, expect, it } from "vitest";
import { boardQueryToSearch, parseBoardQuery, savedViewSchema, type BoardQuery } from "@/lib/sales/board-query";

const DEFAULTS: BoardQuery = {
  pipeline: null,
  view: "board",
  scope: "everyone",
  status: "open",
  next: "any",
  q: "",
  cursor: null,
};

describe("parseBoardQuery", () => {
  it("defaults everything", () => {
    expect(parseBoardQuery({})).toEqual(DEFAULTS);
  });

  it("reads valid params and trims search", () => {
    expect(
      parseBoardQuery({
        pipeline: "direct-mail",
        view: "list",
        scope: "mine",
        status: "won",
        next: "overdue",
        q: "  bright ",
      }),
    ).toEqual({ ...DEFAULTS, pipeline: "direct-mail", view: "list", scope: "mine", status: "won", next: "overdue", q: "bright" });
  });

  it("falls back on bad values, short searches and arrays", () => {
    expect(parseBoardQuery({ view: "grid", status: "deleted", next: "x", q: "a" })).toEqual(DEFAULTS);
    expect(parseBoardQuery({ view: ["list", "board"] }).view).toBe("list");
    expect(parseBoardQuery({ q: "x".repeat(150) }).q).toHaveLength(100);
  });

  it("does not reject an unknown pipeline key (the loader falls back), but drops an empty or oversized one", () => {
    expect(parseBoardQuery({ pipeline: "removed-pipeline" }).pipeline).toBe("removed-pipeline");
    expect(parseBoardQuery({ pipeline: "" }).pipeline).toBeNull();
    expect(parseBoardQuery({ pipeline: "x".repeat(65) }).pipeline).toBeNull();
  });

  it("reads a cursor of 1 to 64 characters and ignores a malformed one", () => {
    expect(parseBoardQuery({ cursor: "abc123" }).cursor).toBe("abc123");
    expect(parseBoardQuery({ cursor: "" }).cursor).toBeNull();
    expect(parseBoardQuery({ cursor: "c".repeat(65) }).cursor).toBeNull();
    expect(parseBoardQuery({ cursor: ["first", "second"] }).cursor).toBe("first");
  });

  it("uses the saved view only when the URL names none of pipeline, view, scope", () => {
    const saved = { pipeline: "new-mover-mail", view: "list", scope: "mine" };
    expect(parseBoardQuery({}, saved)).toEqual({ ...DEFAULTS, ...saved });
    expect(parseBoardQuery({ view: "board" }, saved)).toEqual({ ...DEFAULTS, view: "board" });
    expect(parseBoardQuery({ pipeline: "direct-mail" }, saved)).toEqual({ ...DEFAULTS, pipeline: "direct-mail" });
    expect(parseBoardQuery({ scope: "everyone" }, saved)).toEqual({ ...DEFAULTS, scope: "everyone" });
    expect(parseBoardQuery({}, { view: 3 })).toEqual(DEFAULTS);
  });

  it("keeps the other URL filters when it applies the saved view", () => {
    const saved = { pipeline: "direct-mail", view: "board", scope: "mine" };
    expect(parseBoardQuery({ status: "lost", q: "oak" }, saved)).toEqual({
      ...DEFAULTS,
      ...saved,
      status: "lost",
      q: "oak",
    });
  });

  it("ignores a malformed saved view, whether null, a string or carrying extra keys", () => {
    expect(parseBoardQuery({}, null)).toEqual(DEFAULTS);
    expect(parseBoardQuery({}, "list")).toEqual(DEFAULTS);
    expect(parseBoardQuery({}, { pipeline: null, view: "board", scope: "mine", extra: 1 })).toEqual(DEFAULTS);
  });
});

describe("savedViewSchema", () => {
  it("accepts a null pipeline and rejects unknown keys and bad values", () => {
    expect(savedViewSchema.safeParse({ pipeline: null, view: "list", scope: "everyone" }).success).toBe(true);
    expect(savedViewSchema.safeParse({ pipeline: "", view: "list", scope: "everyone" }).success).toBe(false);
    expect(savedViewSchema.safeParse({ pipeline: "x".repeat(65), view: "list", scope: "everyone" }).success).toBe(false);
    expect(savedViewSchema.safeParse({ pipeline: null, view: "grid", scope: "everyone" }).success).toBe(false);
    expect(savedViewSchema.safeParse({ pipeline: null, view: "list", scope: "mine", status: "won" }).success).toBe(false);
  });
});

describe("boardQueryToSearch", () => {
  it("writes only non-default params", () => {
    expect(boardQueryToSearch({ ...DEFAULTS, pipeline: "direct-mail", q: "oak" })).toBe("pipeline=direct-mail&q=oak");
    expect(boardQueryToSearch(DEFAULTS)).toBe("");
  });

  it("writes keys in a fixed order and never writes the cursor", () => {
    expect(
      boardQueryToSearch({
        pipeline: "direct-mail",
        view: "list",
        scope: "mine",
        status: "lost",
        next: "none",
        q: "oak",
        cursor: "abc",
      }),
    ).toBe("pipeline=direct-mail&view=list&scope=mine&status=lost&next=none&q=oak");
  });

  it("round-trips through parseBoardQuery, including searches with spaces and symbols", () => {
    const query: BoardQuery = { ...DEFAULTS, pipeline: "new-mover-mail", scope: "mine", q: "Bright & Co" };
    const params = Object.fromEntries(new URLSearchParams(boardQueryToSearch(query)));
    expect(parseBoardQuery(params)).toEqual(query);
  });
});
