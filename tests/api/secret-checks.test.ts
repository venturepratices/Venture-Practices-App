import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Audit row 41 (old #15): every cron route, the agent API and the MCP route
// keep exactly the answers they give today (401 for cron and agent, 404 for
// MCP; `Authorization: Bearer <secret>` for cron and agent, the secret as
// the MCP path segment), and refuse everything when their secret is not set,
// including a caller who sends the text "undefined".
//
// Nothing real runs past the gate: the database and every outside service a
// route touches first are replaced by stubs that record that the gate let the
// request through and then stop it. Slack, Google, HighLevel and Blob are
// never called.

const h = vi.hoisted(() => {
  const state = { reached: false };
  class GatePassed extends Error {}
  const reach = () => {
    state.reached = true;
    throw new GatePassed("past the secret check");
  };
  const stub = () => vi.fn(reach);
  const prisma = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "symbol" || prop === "then") return undefined;
        return reach();
      },
    }
  );
  return { state, stub, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/notify", () => ({ notify: h.stub(), notifyChannel: h.stub() }));
vi.mock("@/lib/notify-dedupe", () => ({ hasRecentNotification: h.stub() }));
vi.mock("@/lib/slack", () => ({ postSlackDM: h.stub(), resolveSlackUserId: h.stub(), mentionOrName: h.stub() }));
vi.mock("@/lib/backup", () => ({
  BACKUP_PREFIX: "backups/",
  backupDateKey: h.stub(),
  createDatabaseSnapshot: h.stub(),
  writeBackupToBlob: h.stub(),
  pruneOldBackups: h.stub(),
}));
vi.mock("@/lib/google-calendar", () => ({ syncAllConnectedCalendars: h.stub() }));
vi.mock("@/lib/highlevel", () => ({ pruneAllConnectedClients: h.stub() }));
vi.mock("@vercel/blob", () => ({ list: h.stub() }));
vi.mock("@/lib/task-status", () => ({ getCompleteStatusId: h.stub() }));
vi.mock("@/lib/priority-level", () => ({ getPriorityLevelOptions: h.stub() }));
vi.mock("@/lib/activity-log", () => ({ logActivity: h.stub() }));
vi.mock("@/lib/daily-briefing", () => ({
  getClientBriefingData: h.stub(),
  getUserBriefingData: h.stub(),
  isClientBriefingEmpty: h.stub(),
  isUserBriefingEmpty: h.stub(),
}));
vi.mock("@/lib/agent-data", () => ({
  getClientDetail: h.stub(),
  listActivity: h.stub(),
  listClients: h.stub(),
  listTasks: h.stub(),
  listTeam: h.stub(),
}));
vi.mock("mcp-handler", () => ({
  createMcpHandler: () => async () => new Response("mcp handler reached", { status: 200 }),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

const CRON_SECRET = "cron-secret-for-tests-0123456789abcdef";
const AGENT_TOKEN = "agent-token-for-tests-0123456789abcdef";
const MCP_TOKEN = "mcp-token-for-tests-0123456789abcdef";

type Outcome = { status: number | null; body: unknown; reached: boolean };

async function run(handler: () => Promise<Response>): Promise<Outcome> {
  h.state.reached = false;
  try {
    const response = await handler();
    const body = await response
      .clone()
      .json()
      .catch(() => response.text());
    return { status: response.status, body, reached: h.state.reached };
  } catch (error) {
    // A route without its own try/catch lets the stub's stop signal through.
    if (!h.state.reached) throw error;
    return { status: null, body: null, reached: true };
  }
}

function request(path: string, authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request(`https://app.example.com${path}`, { headers });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("AGENT_API_TOKEN", AGENT_TOKEN);
  vi.stubEnv("MCP_ACCESS_TOKEN", MCP_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const CRON_DIR = join(process.cwd(), "src", "app", "api", "cron");
const cronNames = readdirSync(CRON_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const UNAUTHORIZED = { status: 401, body: { error: "Unauthorized" }, reached: false };

describe.each(cronNames)("cron route %s", (name) => {
  const path = `/api/cron/${name}`;
  async function call(authorization?: string) {
    const route = (await import(`@/app/api/cron/${name}/route`)) as { GET: (request: Request) => Promise<Response> };
    return run(() => route.GET(request(path, authorization)));
  }

  it("lets Vercel Cron's `Bearer <CRON_SECRET>` through", async () => {
    expect((await call(`Bearer ${CRON_SECRET}`)).reached).toBe(true);
  });

  it("answers 401 with no authorization header", async () => {
    expect(await call()).toEqual(UNAUTHORIZED);
  });

  it("answers 401 for a wrong, longer, shorter or reformatted secret", async () => {
    for (const header of [
      "Bearer wrong-secret",
      `Bearer ${CRON_SECRET}x`,
      `Bearer ${CRON_SECRET.slice(0, -1)}`,
      CRON_SECRET,
      `bearer ${CRON_SECRET}`,
      `Bearer  ${CRON_SECRET}`,
    ]) {
      expect(await call(header)).toEqual(UNAUTHORIZED);
    }
  });

  it("answers 401 to everything when CRON_SECRET is not set, including `Bearer undefined`", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    for (const header of [undefined, "Bearer undefined", "Bearer ", "Bearer"]) {
      expect(await call(header)).toEqual(UNAUTHORIZED);
    }
  });

  it("answers 401 to everything when CRON_SECRET is empty or blank", async () => {
    for (const value of ["", "   "]) {
      vi.stubEnv("CRON_SECRET", value);
      for (const header of [undefined, "Bearer ", "Bearer", `Bearer ${value}`]) {
        expect(await call(header)).toEqual(UNAUTHORIZED);
      }
    }
  });
});

describe("agent API (requireAgentToken)", () => {
  async function call(authorization?: string) {
    const route = await import("@/app/api/agent/v1/team/route");
    return run(() => route.GET(request("/api/agent/v1/team", authorization)));
  }

  it("lets `Bearer <AGENT_API_TOKEN>` through", async () => {
    expect((await call(`Bearer ${AGENT_TOKEN}`)).reached).toBe(true);
  });

  it("answers 401 for no header, a wrong token or the cron secret", async () => {
    for (const header of [undefined, "Bearer wrong", `Bearer ${AGENT_TOKEN}x`, `Bearer ${CRON_SECRET}`, AGENT_TOKEN]) {
      expect(await call(header)).toEqual(UNAUTHORIZED);
    }
  });

  it("answers 401 to everything when AGENT_API_TOKEN is not set or empty", async () => {
    for (const value of [undefined, ""]) {
      vi.stubEnv("AGENT_API_TOKEN", value);
      for (const header of [undefined, "Bearer undefined", "Bearer ", "Bearer"]) {
        expect(await call(header)).toEqual(UNAUTHORIZED);
      }
    }
  });
});

describe("MCP route (token in the path)", () => {
  const NOT_FOUND = { status: 404, body: { error: "Not found" }, reached: false };

  async function call(token: string) {
    const route = await import("@/app/api/mcp/[token]/route");
    return run(() =>
      route.GET(request(`/api/mcp/${encodeURIComponent(token)}`), { params: Promise.resolve({ token }) })
    );
  }

  it("hands the right token to the MCP handler", async () => {
    expect(await call(MCP_TOKEN)).toEqual({ status: 200, body: "mcp handler reached", reached: false });
  });

  it("answers 404 for a wrong, longer, shorter or empty token", async () => {
    for (const token of ["wrong", `${MCP_TOKEN}x`, MCP_TOKEN.slice(0, -1), ""]) {
      expect(await call(token)).toEqual(NOT_FOUND);
    }
  });

  it("answers 404 to everything when MCP_ACCESS_TOKEN is not set or empty", async () => {
    for (const value of [undefined, ""]) {
      vi.stubEnv("MCP_ACCESS_TOKEN", value);
      for (const token of ["undefined", "", "null"]) {
        expect(await call(token)).toEqual(NOT_FOUND);
      }
    }
  });
});
