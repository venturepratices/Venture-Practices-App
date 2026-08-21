import { NextResponse } from "next/server";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

import { getClientDetail, listActivity, listClients, listTasks, listTeam } from "@/lib/agent-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Remote MCP server for Claude.ai / Cowork's "custom connector" feature —
 * the same read-only data as the REST API at /api/agent/v1/** (Viktor's
 * doorway), reached instead via the Model Context Protocol so Claude chat
 * can call it as a live tool during a conversation. src/lib/agent-data.ts is
 * the single source of truth both doorways read from, so the exclusions
 * (credentials vault, private tasks, HighLevel conversations, billing/order
 * data) can never drift between the two.
 *
 * Auth: Claude.ai's custom-connector setup only exposes OAuth in its
 * "Advanced settings" — no generic bearer-token/header field — so instead
 * of standing up a full OAuth authorization server for a single internal
 * connector, the secret lives in the URL path itself (same long-random-
 * string-as-a-secret idea as CRON_SECRET/AGENT_API_TOKEN, just delivered as
 * a path segment since that's the one thing Claude.ai's "Remote MCP server
 * URL" field actually lets you paste in). A wrong/missing token 404s rather
 * than 401s, so a guess doesn't even confirm this endpoint exists.
 */
function tokenIsValid(token: string): boolean {
  const expected = process.env.MCP_ACCESS_TOKEN;
  return Boolean(expected) && token === expected;
}

const NO_ARGS = z.object({});

const mcpHandler = createMcpHandler((server) => {
  server.registerTool(
    "about_the_app",
    {
      title: "About this app",
      description:
        "Explains what the Venture Practices PM app is and what data it manages. Call this first if you're unsure what kind of questions this connector can answer.",
      inputSchema: NO_ARGS,
    },
    async () => ({
      content: [
        {
          type: "text",
          text: [
            "Venture Practices PM is the agency's internal project-management app.",
            "It tracks: clients, tasks (with status/deadline/assignees), projects (staged workflows like onboarding), direct mail campaigns, assets awaiting approval, and client notes.",
            "This connector is read-only and deliberately does NOT have access to: the credentials vault (client logins/passwords), private tasks (marked visible only to their creator), HighLevel conversations/calls (client SMS/email/call content), or client billing/order data (fees, ad budgets).",
            "Available tools: list_clients (every client with open/overdue task counts), get_client (one client's full picture — tasks, projects, campaigns, notes), list_tasks (cross-client task search, e.g. 'what is X working on' or 'what's overdue'), list_activity (recent things that happened, optionally per client), list_team (the team roster).",
          ].join(" "),
        },
      ],
    }),
  );

  server.registerTool(
    "list_clients",
    {
      title: "List clients",
      description:
        "Every active client with contact info and a quick open/overdue task count. Call this first when a question mentions 'clients' generally or you don't yet know a client's id — get_client needs the id this returns.",
      inputSchema: NO_ARGS,
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify({ clients: await listClients() }, null, 2) }],
    }),
  );

  server.registerTool(
    "get_client",
    {
      title: "Get one client's full picture",
      description:
        "One client's info, open/overdue tasks, active projects with current stage, direct mail campaigns, assets awaiting a decision, and recent notes. Use this to answer 'what's going on with X' or 'what's overdue on X'. Get the clientId from list_clients first.",
      inputSchema: z.object({ clientId: z.string().describe("The client's id, from list_clients") }),
    },
    async ({ clientId }) => {
      const detail = await getClientDetail(clientId);
      if (!detail) {
        return { content: [{ type: "text", text: `No client found with id "${clientId}". Call list_clients to see valid ids.` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
    },
  );

  server.registerTool(
    "list_tasks",
    {
      title: "Cross-client task search",
      description:
        "Tasks across every client (and internal, no-client tasks) — for questions get_client can't answer because they span more than one client, like 'what are my tasks', 'what's overdue everywhere', or 'what is <name> working on'. Always excludes private tasks, regardless of who's asking.",
      inputSchema: z.object({
        clientId: z.string().optional().describe("Limit to one client's tasks"),
        assigneeName: z.string().optional().describe("Case-insensitive partial match against an assignee's name"),
        overdueOnly: z.boolean().optional().describe("Only tasks past their deadline"),
        includeComplete: z.boolean().optional().describe("Include completed tasks (excluded by default)"),
      }),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify({ tasks: await listTasks(args) }, null, 2) }],
    }),
  );

  server.registerTool(
    "list_activity",
    {
      title: "Recent activity",
      description:
        "The most recent things that happened in the app, newest first — for 'what's new', 'what happened recently', or 'any updates on X'. Never includes credential-vault activity, HighLevel connection events, or client billing/order changes.",
      inputSchema: z.object({
        clientId: z.string().optional().describe("Limit to one client's activity"),
        limit: z.number().int().min(1).max(50).optional().describe("Defaults to 20, capped at 50"),
      }),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify({ activity: await listActivity(args) }, null, 2) }],
    }),
  );

  server.registerTool(
    "list_team",
    {
      title: "Team roster",
      description: "Every team member's name, email, and whether they're an admin. Use this to resolve a name mentioned in a question to a real person.",
      inputSchema: NO_ARGS,
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify({ team: await listTeam() }, null, 2) }],
    }),
  );
});

async function handler(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!tokenIsValid(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return mcpHandler(request);
}

export { handler as GET, handler as POST };
