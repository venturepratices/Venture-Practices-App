import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// backup.ts imports prisma and the Blob SDK at module scope; this test only
// reads constants, so neither may ever reach a real database or store.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@vercel/blob", () => ({ put: vi.fn(), list: vi.fn(), del: vi.fn() }));

const { BACKUP_MODEL_KEYS, BACKUP_EXCLUDED_MODELS } = await import("@/lib/backup");

describe("backup coverage guard", () => {
  it("every Prisma model is backed up or explicitly excluded with a reason", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const models = [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);
    const covered = new Set(BACKUP_MODEL_KEYS.map((k) => k[0].toUpperCase() + k.slice(1)));
    const missing = models.filter((m) => !covered.has(m) && !(m in BACKUP_EXCLUDED_MODELS));
    expect(missing).toEqual([]);
  });

  it("does not list a model that no longer exists in the schema", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const models = new Set([...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]));
    const listed = [
      ...BACKUP_MODEL_KEYS.map((k) => k[0].toUpperCase() + k.slice(1)),
      ...Object.keys(BACKUP_EXCLUDED_MODELS),
    ];
    expect(listed.filter((m) => !models.has(m))).toEqual([]);
  });

  it("never both backs up and excludes the same model, and every exclusion has a reason", () => {
    const covered = new Set(BACKUP_MODEL_KEYS.map((k) => k[0].toUpperCase() + k.slice(1)));
    for (const [model, reason] of Object.entries(BACKUP_EXCLUDED_MODELS)) {
      expect(covered.has(model)).toBe(false);
      expect(reason.trim().length).toBeGreaterThan(0);
    }
  });
});
