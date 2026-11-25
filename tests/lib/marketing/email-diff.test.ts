import { describe, expect, it } from "vitest";
import {
  diffEmail,
  diffText,
  extractVariables,
  missingVariables,
} from "@/lib/marketing/email-diff";

describe("diffText", () => {
  it("marks identical text as all same", () => {
    const segs = diffText("a\nb\nc", "a\nb\nc");
    expect(segs.every((s) => s.type === "same")).toBe(true);
    expect(segs.map((s) => s.text).join("")).toBe("a\nb\nc");
  });

  it("full replacement yields all del then all add", () => {
    const segs = diffText("a\nb\n", "x\ny\n");
    expect(segs).toEqual([
      { type: "del", text: "a\n" },
      { type: "del", text: "b\n" },
      { type: "add", text: "x\n" },
      { type: "add", text: "y\n" },
    ]);
  });

  it("detects an inserted middle line", () => {
    expect(diffText("a\nc\n", "a\nb\nc\n")).toEqual([
      { type: "same", text: "a\n" },
      { type: "add", text: "b\n" },
      { type: "same", text: "c\n" },
    ]);
  });

  it("detects a deleted middle line", () => {
    expect(diffText("a\nb\nc\n", "a\nc\n")).toEqual([
      { type: "same", text: "a\n" },
      { type: "del", text: "b\n" },
      { type: "same", text: "c\n" },
    ]);
  });

  it("handles empty inputs", () => {
    expect(diffText("", "")).toEqual([]);
    expect(diffText("", "a")).toEqual([{ type: "add", text: "a" }]);
  });
});

describe("extractVariables", () => {
  it("finds a single tag", () => {
    expect(extractVariables("Hi {{firstName}}")).toEqual(["firstName"]);
  });

  it("finds two different tags in order", () => {
    expect(extractVariables("{{b}} then {{a}}")).toEqual(["b", "a"]);
  });

  it("dedupes repeats", () => {
    expect(extractVariables("{{a}} {{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
  });

  it("is case-sensitive", () => {
    expect(extractVariables("{{firstName}} {{FirstName}}")).toEqual([
      "firstName",
      "FirstName",
    ]);
  });

  it("returns [] when there are no tags", () => {
    expect(extractVariables("plain text")).toEqual([]);
  });

  it("ignores malformed tags", () => {
    expect(extractVariables("oops {{foo")).toEqual([]);
  });

  it("treats triple braces as one tag", () => {
    expect(extractVariables("{{{foo}}}")).toEqual(["foo"]);
  });
});

describe("missingVariables", () => {
  it("returns a dropped variable", () => {
    expect(missingVariables("Hi {{name}}", "Hi there")).toEqual(["name"]);
  });

  it("returns [] when preserved", () => {
    expect(missingVariables("Hi {{name}}", "Hello {{name}}!")).toEqual([]);
  });

  it("ignores additions", () => {
    expect(missingVariables("Hi", "Hi {{name}}")).toEqual([]);
  });
});

describe("diffEmail", () => {
  const base = { subject: "Hello", body: "Hi {{name}}\nBye" };

  it("reports no change for identical drafts", () => {
    const d = diffEmail(base, { ...base });
    expect(d.changed).toBe(false);
    expect(d.droppedVariables).toEqual([]);
  });

  it("flags a subject-only change", () => {
    const d = diffEmail(base, { ...base, subject: "Howdy" });
    expect(d.changed).toBe(true);
    expect(d.droppedVariables).toEqual([]);
  });

  it("flags a body-only change", () => {
    const d = diffEmail(base, { ...base, body: "Hi {{name}}\nCheers" });
    expect(d.changed).toBe(true);
  });

  it("reports dropped body variables", () => {
    const d = diffEmail(base, { ...base, body: "Hi\nBye" });
    expect(d.droppedVariables).toEqual(["name"]);
  });

  it("ignores variables dropped from the subject", () => {
    const d = diffEmail(
      { subject: "Hi {{name}}", body: "x" },
      { subject: "Hi", body: "x" },
    );
    expect(d.changed).toBe(true);
    expect(d.droppedVariables).toEqual([]);
  });
});
