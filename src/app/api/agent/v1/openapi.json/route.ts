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
      version: "1.0.0",
      description:
        "Read-only endpoints for an external AI agent to answer questions about clients, tasks, projects, and campaigns. Excludes the credentials vault, private tasks, and HighLevel conversations.",
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
    },
  });
}
