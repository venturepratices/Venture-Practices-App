import type { BotScope } from "@/lib/sales/bot-scopes";

// The web addresses a bot may call, per permission, for the "How to connect a
// bot" panel. No imports at runtime, so the browser can load it. Kept equal to
// the routes that really accept a bot key by tests/lib/sales/bot-route-scopes.test.ts.

export type BotEndpoint = { method: "GET" | "POST"; path: string; what: string };

export const BOT_SCOPE_ENDPOINTS: readonly { scope: BotScope; endpoints: BotEndpoint[] }[] = [
  {
    scope: "read",
    endpoints: [
      { method: "GET", path: "/api/sales/deals", what: "List deals" },
      { method: "GET", path: "/api/sales/deals/{dealId}", what: "Open one deal" },
      { method: "GET", path: "/api/sales/deals/{dealId}/timeline", what: "A deal's history" },
      { method: "GET", path: "/api/sales/leads", what: "List leads" },
      { method: "GET", path: "/api/sales/leads/{leadId}", what: "Open one lead" },
      { method: "GET", path: "/api/sales/leads/{leadId}/timeline", what: "A lead's history" },
    ],
  },
  {
    scope: "notes",
    endpoints: [
      { method: "POST", path: "/api/sales/deals/{dealId}/notes", what: "Add a note to a deal" },
      { method: "POST", path: "/api/sales/leads/{leadId}/notes", what: "Add a note to a lead" },
    ],
  },
  {
    scope: "activities",
    endpoints: [
      { method: "POST", path: "/api/sales/deals/{dealId}/activities", what: "Add a call, meeting or task to a deal" },
      { method: "POST", path: "/api/sales/leads/{leadId}/activities", what: "Add a call, meeting or task to a lead" },
    ],
  },
  {
    scope: "move",
    endpoints: [{ method: "POST", path: "/api/sales/deals/{dealId}/move", what: "Move a deal to another stage" }],
  },
  {
    scope: "create",
    endpoints: [
      { method: "POST", path: "/api/sales/deals", what: "Create a deal" },
      { method: "POST", path: "/api/sales/leads", what: "Create a lead" },
    ],
  },
];
