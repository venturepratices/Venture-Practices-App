import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The Pipedrive import schema. This test reads the Prisma schema and the new
// migration as plain text (no database): every imported kind of record carries
// the Pipedrive id it came from, the run table and the user-map table exist,
// the migration only adds things, and the database itself allows one RUNNING
// import at a time.

const root = process.cwd();
const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const migrationPath = path.join(root, "prisma/migrations/20261112000001_sales_pipedrive_import/migration.sql");
// A missing file reads as empty, so every assertion below fails on its own line
// instead of the whole suite dying on one unreadable file.
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, "utf8") : "";

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`^model ${name} \\{[\\s\\S]*?^\\}`, "m"));
  if (!match) throw new Error(`model ${name} not found in prisma/schema.prisma`);
  return match[0];
}

function enumBlock(name: string): string {
  const match = schema.match(new RegExp(`^enum ${name} \\{[\\s\\S]*?^\\}`, "m"));
  if (!match) throw new Error(`enum ${name} not found in prisma/schema.prisma`);
  return match[0];
}

describe("Pipedrive import schema", () => {
  it.each([
    "SalesOrganization",
    "SalesPerson",
    "SalesLead",
    "SalesDeal",
    "SalesActivity",
    "SalesNote",
    "SalesFile",
  ])("%s keeps the Pipedrive id it came from, unique", (model) => {
    expect(modelBlock(model)).toMatch(/^\s*pipedriveId\s+Int\?\s+@unique\s*$/m);
  });

  it("declares the two import enums", () => {
    expect(enumBlock("SalesImportMode")).toMatch(/DRY_RUN[\s\S]*LIVE/);
    expect(enumBlock("SalesImportStatus")).toMatch(/RUNNING[\s\S]*DONE[\s\S]*FAILED/);
  });

  it("declares the SalesImportRun table with plain-string startedById", () => {
    const run = modelBlock("SalesImportRun");
    expect(run).toMatch(/^\s*id\s+String\s+@id/m);
    expect(run).toMatch(/^\s*mode\s+SalesImportMode\s*$/m);
    expect(run).toMatch(/^\s*isFinal\s+Boolean\s+@default\(false\)\s*$/m);
    expect(run).toMatch(/^\s*status\s+SalesImportStatus\s*$/m);
    expect(run).toMatch(/^\s*phase\s+String\s*$/m);
    expect(run).toMatch(/^\s*cursor\s+Json\?\s*$/m);
    expect(run).toMatch(/^\s*counts\s+Json\s*$/m);
    expect(run).toMatch(/^\s*issues\s+Json\s*$/m);
    expect(run).toMatch(/^\s*startedById\s+String\s*$/m);
    expect(run).toMatch(/^\s*startedAt\s+DateTime\s/m);
    expect(run).toMatch(/^\s*updatedAt\s+DateTime\s+@updatedAt/m);
    expect(run).toMatch(/^\s*finishedAt\s+DateTime\?\s*$/m);
    // No relation to TeamMember: removing a person never touches import history.
    expect(run).not.toMatch(/@relation/);
  });

  it("declares the SalesImportUserMap table keyed by the Pipedrive user id", () => {
    const map = modelBlock("SalesImportUserMap");
    expect(map).toMatch(/^\s*pipedriveUserId\s+Int\s+@id\s*$/m);
    expect(map).toMatch(/^\s*memberId\s+String\s*$/m);
    expect(map).toMatch(/^\s*createdAt\s+DateTime\s/m);
    expect(map).toMatch(/^\s*updatedAt\s+DateTime\s+@updatedAt/m);
    expect(map).not.toMatch(/@relation/);
  });
});

describe("Pipedrive import migration", () => {
  it("only adds: no DROP, no UPDATE, no DELETE", () => {
    // Strip SQL comments first so a sentence in a comment cannot trip the check.
    const sql = migration.replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
  });

  it.each(["SalesOrganization", "SalesPerson", "SalesLead", "SalesActivity", "SalesNote", "SalesFile"])(
    "adds a unique pipedriveId column to %s",
    (table) => {
      expect(migration).toMatch(new RegExp(`ALTER TABLE "${table}" ADD COLUMN\\s+"pipedriveId" INTEGER`));
      expect(migration).toMatch(
        new RegExp(`CREATE UNIQUE INDEX "${table}_pipedriveId_key" ON "${table}"\\("pipedriveId"\\)`),
      );
    },
  );

  it("creates the two enums and the two tables", () => {
    expect(migration).toContain(`CREATE TYPE "SalesImportMode" AS ENUM ('DRY_RUN', 'LIVE')`);
    expect(migration).toContain(`CREATE TYPE "SalesImportStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED')`);
    expect(migration).toContain(`CREATE TABLE "SalesImportRun"`);
    expect(migration).toContain(`CREATE TABLE "SalesImportUserMap"`);
  });

  it("lets the database hold only one RUNNING import at a time", () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "SalesImportRun_one_running" ON "SalesImportRun" \(\(1\)\) WHERE "status" = 'RUNNING'/,
    );
  });
});
