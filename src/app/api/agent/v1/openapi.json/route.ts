import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Machine-readable API spec for the agent-facing endpoints, served
 * unauthenticated so an external agent (Viktor) can read the shape of the
 * doorway before being handed a token. Deliberately describes shapes only,
 * never data — nothing here reads from the DB. The real endpoints under
 * /api/agent/v1/... enforce bearer auth via requireAgentToken().
 */
export function GET(request: Request) {
  const baseUrl = new URL(request.url).origin;
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "Venture Practices — Agent API",
      version: "1.1.0",
      description:
        "Read-only endpoints for an external AI agent to answer questions about clients, tasks, projects, campaigns, team members, and recent activity. Excludes the credentials vault, private tasks, HighLevel conversations, and client billing/order data.",
    },
    servers: [{ url: `${baseUrl}/api/agent/v1` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/clients": {
        get: {
          summary: "List every active client with a quick status snapshot",
          description:
            "Returns every non-offboarded client with their contact, source, and current counts of open and overdue tasks. Call this first when a question references 'clients' generally or when you don't yet know which client id to drill into.",
          responses: { "200": { description: "OK" } },
        },
      },
      "/clients/{clientId}": {
        get: {
          summary: "Everything currently going on with one client",
          description:
            "Returns the client's info, up to 50 open tasks (with status, deadline, assignees), overdue count, active projects with current stage, recent direct mail campaigns, assets awaiting a decision, and the five most recent client notes. Use this to answer 'what's the status of X' or 'what's overdue on X'.",
          parameters: [{ name: "clientId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK" }, "404": { description: "Client not found" } },
        },
      },
      "/tasks": {
        get: {
          summary: "Cross-client task list — for questions not scoped to one client",
          description:
            "Returns tasks across every client (and internal, no-client tasks), each with its client, status, deadline, and assignees. Use this for 'what are my tasks', 'what's overdue everywhere', or 'what is <name> working on' — questions /clients/{clientId} can't answer because they span more than one client. Always excludes private tasks, regardless of who's asking.",
          parameters: [
            { name: "clientId", in: "query", schema: { type: "string" }, description: "Limit to one client's tasks." },
            {
              name: "assigneeName",
              in: "query",
              schema: { type: "string" },
              description: "Case-insensitive partial match against an assignee's name.",
            },
            { name: "overdue", in: "query", schema: { type: "string", enum: ["true"] }, description: "Only tasks past their deadline." },
            {
              name: "includeComplete",
              in: "query",
              schema: { type: "string", enum: ["true"] },
              description: "Include completed tasks (excluded by default).",
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/team": {
        get: {
          summary: "The team roster",
          description: "Returns every team member's name, email, and whether they're an admin. Use this to resolve a name mentioned in a question to a real person.",
          responses: { "200": { description: "OK" } },
        },
      },
      "/activity": {
        get: {
          summary: "Recent activity across the app",
          description:
            "Returns the most recent things that happened in the app (task/client/asset/project changes, notes added, etc.), newest first. Use this for 'what's new', 'what happened recently', or 'any updates on X'. Never includes credential-vault activity, HighLevel connection events, or client billing/order changes.",
          parameters: [
            { name: "clientId", in: "query", schema: { type: "string" }, description: "Limit to one client's activity." },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 50, default: 20 } },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  });
}
