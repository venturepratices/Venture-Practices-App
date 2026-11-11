import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Sales is secret (A10, widened by the plan). Nothing in the Sales code may
// post to Slack, send email, reach HighLevel, write the shared activity log,
// refresh a shared page, or touch the client-token upload path or the asset
// store's key. And the bot-facing code (the agent data layer, the agent API
// and the MCP server) must never mention Sales, so no bot can reach it.

const ROOT = process.cwd();
const FORBIDDEN =
  /logActivity|notify|notifyChannel|slack|sendEmail|@\/lib\/email|@\/lib\/highlevel|revalidatePath|handleUpload|@vercel\/blob\/client|ASSETS_READ_WRITE_TOKEN/;

/** Every .ts/.tsx file under a folder (recursive), as paths relative to the project root. */
function sourceFiles(dir: string): string[] {
  const full = path.join(ROOT, ...dir.split("/"));
  return (fs.readdirSync(full, { recursive: true }) as string[])
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .map((file) => `${dir}/${file}`);
}
const read = (file: string) => fs.readFileSync(path.join(ROOT, ...file.split("/")), "utf8");

describe("guard: Sales code reaches no shared channel", () => {
  it.each(["src/lib/sales", "src/app/api/sales", "src/components/sales", "src/app/(app)/sales"])("%s", (dir) => {
    const files = sourceFiles(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(read(file), file).not.toMatch(FORBIDDEN);
    }
  });

  it("the pattern catches each name it is meant to", () => {
    for (const word of [
      "logActivity(",
      "notify(",
      "notifyChannel(",
      "slack",
      "sendEmail(",
      'from "@/lib/email"',
      'from "@/lib/highlevel"',
      "revalidatePath(",
      "handleUpload(",
      'from "@vercel/blob/client"',
      "process.env.ASSETS_READ_WRITE_TOKEN",
    ]) {
      expect(word).toMatch(FORBIDDEN);
    }
  });
});

describe("guard: the bot-facing code never mentions Sales", () => {
  it("src/lib/agent-data.ts, src/app/api/agent and src/app/api/mcp", () => {
    const files = ["src/lib/agent-data.ts", ...sourceFiles("src/app/api/agent"), ...sourceFiles("src/app/api/mcp")];
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      expect(read(file), file).not.toMatch(/sales/i);
    }
  });
});
