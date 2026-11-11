import { describe, expect, it } from "vitest";
import type { Breadcrumb, Event } from "@sentry/nextjs";

import { scrubBreadcrumb, scrubEvent, scrubUrl, sentryScrubHooks } from "@/lib/sentry-scrub";

// Guard for audit finding M6 (also W11, K4, K15, B12): Sentry must not
// receive secrets, tokens or personal details carried in URLs, headers,
// cookies or request bodies. Error type, message and stack stay as they are,
// so errors still group and read the same in Sentry.

// Fake values in the real shapes.
const KEY_IN_PATH = "mcp-live-Q7f9Xk2LpV8sT4wZ"; // a secret that sits in the URL path
const SHARE_TOKEN = "f3Kx9_Qm2LpV8sT4wZbN7cR1yH6jD0eA5uG-iO3kPqE"; // randomBytes(32).toString("base64url")
const CUID = "cmh1x2y3z0000abcd1234efgh";
const UUID = "6f1c2b9e-3d4a-4e5f-9a8b-7c6d5e4f3a2b";
const STAFF_EMAIL = "dj@example.com";
const STAFF_EMAIL_IN_URL = encodeURIComponent(STAFF_EMAIL); // dj%40example.com
const CLIENT_IP = "203.0.113.9";
const USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const SLACK_LOOKUP = `https://slack.com/api/users.lookupByEmail?email=${STAFF_EMAIL_IN_URL}`;

function sent(value: unknown): string {
  return JSON.stringify(value);
}

describe("scrubUrl", () => {
  it("drops the query string and fragment", () => {
    expect(scrubUrl("https://app.example.com/clients?tab=notes&q=Smith#top")).toBe("https://app.example.com/clients");
    expect(scrubUrl("/my-tasks?view=board#c12")).toBe("/my-tasks");
    expect(scrubUrl(SLACK_LOOKUP)).toBe("https://slack.com/api/users.lookupByEmail");
  });

  it("replaces a key carried in the URL path with a placeholder", () => {
    expect(scrubUrl(`/api/mcp/${KEY_IN_PATH}`)).toBe("/api/mcp/[token]");
    expect(scrubUrl(`https://app.example.com/api/mcp/${KEY_IN_PATH}?cursor=2`)).toBe(
      "https://app.example.com/api/mcp/[token]",
    );
    expect(scrubUrl(`/API/MCP/${KEY_IN_PATH}`)).toBe("/API/MCP/[token]");
  });

  it("replaces guest link tokens, short or long, on pages and API calls", () => {
    expect(scrubUrl(`/review/${SHARE_TOKEN}`)).toBe("/review/[token]");
    expect(scrubUrl("/review/abc")).toBe("/review/[token]");
    expect(scrubUrl(`/api/review/${SHARE_TOKEN}/versions/${CUID}/comments?since=1`)).toBe(
      "/api/review/[token]/versions/[id]/comments",
    );
  });

  it("replaces everything after /api/webhooks/", () => {
    expect(scrubUrl("/api/webhooks/inbound/s3cret")).toBe("/api/webhooks/[redacted]/[redacted]");
    expect(scrubUrl("/api/webhooks/s3cret")).toBe("/api/webhooks/[redacted]");
  });

  it("replaces ids, tokens and emails in any path", () => {
    expect(scrubUrl(`/clients/${CUID}/tasks`)).toBe("/clients/[id]/tasks");
    expect(scrubUrl(`/api/things/${UUID}`)).toBe("/api/things/[id]");
    expect(scrubUrl(`/team/${STAFF_EMAIL_IN_URL}`)).toBe("/team/[email]");
    expect(scrubUrl(`/team/${STAFF_EMAIL}/profile`)).toBe("/team/[email]/profile");
    // a HighLevel-style 20 character id on another host
    expect(scrubUrl("https://services.example.com/contacts/ve9EPM428h8vShlRW1KT")).toBe(
      "https://services.example.com/contacts/[id]",
    );
    // a long random value with no digits or capitals
    expect(scrubUrl(`/x/${"k".repeat(40)}`)).toBe("/x/[id]");
  });

  it("keeps ordinary route words and file names readable", () => {
    for (const path of [
      "/api/workflow-template-folders",
      "/settings/direct-mail-templates",
      "/api/tasks/[taskId]/subtasks/bulk-populate-clients",
      "/api/archived-workflow-instances/[archivedInstanceId]/restore",
      "/api/me/notification-preferences",
      "/api/agent/v1/openapi.json",
      "/_next/static/chunks/app/layout-0a1b2c3d4e5f6789.js",
      "/",
      "",
    ]) {
      expect(scrubUrl(path)).toBe(path);
    }
  });

  it("leaves route patterns alone, so already-safe names stay identical", () => {
    expect(scrubUrl("/api/mcp/[token]")).toBe("/api/mcp/[token]");
    expect(scrubUrl("/review/[token]")).toBe("/review/[token]");
    expect(scrubUrl("/api/webhooks/[source]")).toBe("/api/webhooks/[source]");
    expect(scrubUrl("/clients/[clientId]/workflows/[instanceId]")).toBe("/clients/[clientId]/workflows/[instanceId]");
    expect(scrubUrl("/api/auth/[...nextauth]")).toBe("/api/auth/[...nextauth]");
  });

  it("drops a user name and password written into a URL", () => {
    expect(scrubUrl("postgresql://app_user:hunter2@db.example.com/main?sslmode=require")).toBe(
      "postgresql://db.example.com/main",
    );
  });

  it("gives the same answer when run twice", () => {
    const once = scrubUrl(`https://app.example.com/api/review/${SHARE_TOKEN}/versions/${CUID}?x=1`);
    expect(scrubUrl(once)).toBe(once);
  });
});

describe("scrubEvent on a server route error (onRequestError)", () => {
  const exception = {
    values: [
      {
        type: "TypeError",
        value: "Cannot read properties of undefined (reading 'id')",
        mechanism: { type: "auto.function.nextjs.on_request_error", handled: false },
        stacktrace: {
          frames: [{ filename: "/var/task/.next/server/app/api/mcp/[token]/route.js", function: "POST", lineno: 42 }],
        },
      },
    ],
  };

  function routeError(): Event {
    return {
      event_id: "0f2c4d6e8a0b4c2d9e8f7a6b5c4d3e2f",
      level: "error",
      platform: "node",
      exception: structuredClone(exception),
      transaction: "POST /api/mcp/[token]",
      request: {
        url: `https://app.example.com/api/mcp/${KEY_IN_PATH}?cursor=abc`,
        method: "POST",
        query_string: "cursor=abc",
        headers: {
          host: "app.example.com",
          authorization: "Bearer agent-live-key-9x8y7z",
          cookie: "authjs.session-token=eyJhbGciOi.sessionvalue",
          "x-forwarded-for": CLIENT_IP,
          "x-shared-secret": "hook-secret-1234",
          referer: `https://app.example.com/review/${SHARE_TOKEN}?from=email`,
          "user-agent": USER_AGENT,
        },
        cookies: { "authjs.session-token": "eyJhbGciOi.sessionvalue" },
        data: `{"email":"${STAFF_EMAIL}","password":"hunter2"}`,
        env: { REMOTE_ADDR: CLIENT_IP },
      },
      user: { id: CUID, email: STAFF_EMAIL, ip_address: CLIENT_IP, username: "dj" },
      contexts: {
        nextjs: {
          request_path: `/api/mcp/${KEY_IN_PATH}?cursor=abc`,
          router_kind: "App Router",
          router_path: "/api/mcp/[token]",
          route_type: "route",
        },
        trace: {
          trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
          span_id: "00f067aa0ba902b7",
          data: {
            "http.target": `/api/mcp/${KEY_IN_PATH}?cursor=abc`,
            "url.full": `https://app.example.com/api/mcp/${KEY_IN_PATH}?cursor=abc`,
            "http.client_ip": CLIENT_IP,
            "http.request.header.authorization": "[Filtered]",
            "http.method": "POST",
          },
        },
        runtime: { name: "node", version: "v22.11.0" },
      },
      breadcrumbs: [
        {
          type: "http",
          category: "http",
          level: "info",
          timestamp: 1730980000,
          data: {
            url: "https://slack.com/api/users.lookupByEmail",
            "http.method": "GET",
            "http.query": `?email=${STAFF_EMAIL_IN_URL}`,
            status_code: 200,
          },
        },
      ],
    };
  }

  it("removes the key, cookies, headers, body, IP and email from what is sent", () => {
    const out = sent(scrubEvent(routeError()));
    for (const secret of [
      KEY_IN_PATH,
      SHARE_TOKEN,
      "cursor",
      "agent-live-key",
      "authjs",
      "sessionvalue",
      "hook-secret",
      "hunter2",
      CLIENT_IP,
      STAFF_EMAIL,
      STAFF_EMAIL_IN_URL,
    ]) {
      expect(out).not.toContain(secret);
    }
  });

  it("keeps only the method, the scrubbed URL and the browser name on the request", () => {
    expect(scrubEvent(routeError()).request).toEqual({
      method: "POST",
      url: "https://app.example.com/api/mcp/[token]",
      headers: { "user-agent": USER_AGENT },
    });
  });

  it("keeps only the user id", () => {
    expect(scrubEvent(routeError()).user).toEqual({ id: CUID });
  });

  it("keeps the error itself, its route name and its route pattern, for grouping", () => {
    const out = scrubEvent(routeError());
    expect(out.exception).toEqual(exception);
    expect(out.transaction).toBe("POST /api/mcp/[token]");
    expect(out.level).toBe("error");
    expect(out.contexts?.nextjs).toEqual({
      request_path: "/api/mcp/[token]",
      router_kind: "App Router",
      router_path: "/api/mcp/[token]",
      route_type: "route",
    });
    expect(out.contexts?.trace).toEqual({
      trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
      span_id: "00f067aa0ba902b7",
      data: {
        "http.target": "/api/mcp/[token]",
        "url.full": "https://app.example.com/api/mcp/[token]",
        "http.method": "POST",
      },
    });
    expect(out.contexts?.runtime).toEqual({ name: "node", version: "v22.11.0" });
  });

  it("drops the staff email the Slack lookup puts in its query string", () => {
    expect(scrubEvent(routeError()).breadcrumbs).toEqual([
      {
        type: "http",
        category: "http",
        level: "info",
        timestamp: 1730980000,
        data: { url: "https://slack.com/api/users.lookupByEmail", "http.method": "GET", status_code: 200 },
      },
    ]);
  });

  it("does not change the event it was given", () => {
    const original = routeError();
    const before = sent(original);
    scrubEvent(original);
    expect(sent(original)).toBe(before);
  });

  it("removes the user entirely when there is no id", () => {
    const event = routeError();
    event.user = { email: STAFF_EMAIL, ip_address: CLIENT_IP };
    expect(scrubEvent(event).user).toBeUndefined();
  });
});

describe("scrubEvent on a browser error", () => {
  function browserError(): Event {
    return {
      level: "error",
      platform: "javascript",
      exception: { values: [{ type: "Error", value: "Request failed with status 500" }] },
      transaction: "/review/[token]",
      request: {
        url: `https://app.example.com/review/${SHARE_TOKEN}?ref=email#comment-3`,
        headers: {
          "User-Agent": USER_AGENT,
          Referer: `https://mail.example.com/inbox?q=${STAFF_EMAIL_IN_URL}`,
        },
      },
      breadcrumbs: [
        {
          category: "navigation",
          data: { from: `/review/${SHARE_TOKEN}?a=1`, to: `/review/${SHARE_TOKEN}#comment-3` },
        },
        {
          category: "fetch",
          type: "http",
          data: {
            method: "GET",
            url: `/api/review/${SHARE_TOKEN}/versions/${CUID}/comments?since=2026-11-01`,
            status_code: 500,
            response_body_size: 120,
          },
        },
        {
          category: "xhr",
          type: "http",
          data: { method: "POST", url: `https://app.example.com/api/tasks?clientId=${CUID}`, status_code: 201 },
        },
        {
          category: "console",
          level: "warning",
          message: `Slack email lookup failed: ${SLACK_LOOKUP}`,
          data: { arguments: [`Slack email lookup failed: ${SLACK_LOOKUP}`], logger: "console" },
        },
        { category: "ui.click", message: "body > div.w-1/2 > button.inline-flex[type=\"submit\"]" },
      ],
    };
  }

  it("removes the guest token, the referrer and the email from what is sent", () => {
    const out = sent(scrubEvent(browserError()));
    for (const secret of [SHARE_TOKEN, CUID, STAFF_EMAIL_IN_URL, "mail.example.com", "ref=email", "comment-3", "since"]) {
      expect(out).not.toContain(secret);
    }
  });

  it("keeps the page URL without its token and keeps the browser name", () => {
    expect(scrubEvent(browserError()).request).toEqual({
      url: "https://app.example.com/review/[token]",
      headers: { "User-Agent": USER_AGENT },
    });
  });

  it("scrubs navigation, fetch, xhr and console breadcrumbs, and leaves click selectors alone", () => {
    expect(scrubEvent(browserError()).breadcrumbs).toEqual([
      { category: "navigation", data: { from: "/review/[token]", to: "/review/[token]" } },
      {
        category: "fetch",
        type: "http",
        data: {
          method: "GET",
          url: "/api/review/[token]/versions/[id]/comments",
          status_code: 500,
          response_body_size: 120,
        },
      },
      {
        category: "xhr",
        type: "http",
        data: { method: "POST", url: "https://app.example.com/api/tasks", status_code: 201 },
      },
      {
        category: "console",
        level: "warning",
        message: "Slack email lookup failed: https://slack.com/api/users.lookupByEmail",
        data: { arguments: ["Slack email lookup failed: https://slack.com/api/users.lookupByEmail"], logger: "console" },
      },
      { category: "ui.click", message: "body > div.w-1/2 > button.inline-flex[type=\"submit\"]" },
    ]);
  });
});

describe("scrubEvent on performance traces", () => {
  function serverTransaction(): Event {
    return {
      type: "transaction",
      transaction: `GET /review/${SHARE_TOKEN}`,
      request: { url: `https://app.example.com/review/${SHARE_TOKEN}?x=1`, method: "GET" },
      contexts: {
        trace: {
          trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
          span_id: "00f067aa0ba902b7",
          op: "http.server",
          data: {
            "sentry.op": "http.server",
            "http.method": "GET",
            "http.url": `https://app.example.com/review/${SHARE_TOKEN}?x=1`,
            "http.target": `/review/${SHARE_TOKEN}?x=1`,
            "url.path": `/review/${SHARE_TOKEN}`,
            "next.span_name": `GET /review/${SHARE_TOKEN}?x=1`,
            "http.client_ip": CLIENT_IP,
            "http.user_agent": USER_AGENT,
            "http.request.header.referer": `https://mail.example.com/?q=${STAFF_EMAIL_IN_URL}`,
            "http.request.header.cookie": "authjs.session-token=abc",
          },
        },
      },
      spans: [
        {
          span_id: "a1b2c3d4e5f60718",
          trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
          start_timestamp: 1730980000,
          op: "http.client",
          description: `GET ${SLACK_LOOKUP}`,
          data: {
            "http.method": "GET",
            url: SLACK_LOOKUP,
            "url.full": SLACK_LOOKUP,
            "http.query": `?email=${STAFF_EMAIL_IN_URL}`,
            "server.address": "slack.com",
          },
        },
        {
          span_id: "b1b2c3d4e5f60718",
          trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
          start_timestamp: 1730980000,
          op: "db",
          description: 'SELECT "public"."Task"."id" FROM "public"."Task" WHERE "public"."Task"."id" = $1 LIMIT $2',
          data: {
            "db.system": "postgresql",
            "db.query.text": 'SELECT "public"."Task"."id" FROM "public"."Task" WHERE "public"."Task"."id" = $1 LIMIT $2',
          },
        },
      ],
    };
  }

  it("removes the guest token, the IP, the cookie and the staff email from what is sent", () => {
    const out = sent(scrubEvent(serverTransaction()));
    for (const secret of [SHARE_TOKEN, CLIENT_IP, "authjs", STAFF_EMAIL_IN_URL, "mail.example.com"]) {
      expect(out).not.toContain(secret);
    }
  });

  it("names the transaction with a placeholder instead of the token", () => {
    expect(scrubEvent(serverTransaction()).transaction).toBe("GET /review/[token]");
  });

  it("keeps useful trace data and drops headers and the client IP", () => {
    expect(scrubEvent(serverTransaction()).contexts?.trace?.data).toEqual({
      "sentry.op": "http.server",
      "http.method": "GET",
      "http.url": "https://app.example.com/review/[token]",
      "http.target": "/review/[token]",
      "url.path": "/review/[token]",
      "next.span_name": "GET /review/[token]",
      "http.user_agent": USER_AGENT,
    });
  });

  it("scrubs outgoing call spans and leaves database spans readable", () => {
    const [call, query] = scrubEvent(serverTransaction()).spans ?? [];
    expect(call.description).toBe("GET https://slack.com/api/users.lookupByEmail");
    expect(call.data).toEqual({
      "http.method": "GET",
      url: "https://slack.com/api/users.lookupByEmail",
      "url.full": "https://slack.com/api/users.lookupByEmail",
      "server.address": "slack.com",
    });
    expect(query).toEqual(serverTransaction().spans?.[1]);
  });

  it("names browser page loads by route, with ids replaced and route patterns kept", () => {
    expect(scrubEvent({ type: "transaction", transaction: `/clients/${CUID}/tasks` }).transaction).toBe(
      "/clients/[id]/tasks",
    );
    expect(scrubEvent({ type: "transaction", transaction: "/review/[token]" }).transaction).toBe("/review/[token]");
    expect(scrubEvent({ type: "transaction", transaction: "GET /api/mcp/[token]" }).transaction).toBe(
      "GET /api/mcp/[token]",
    );
  });
});

describe("scrubBreadcrumb", () => {
  it("scrubs a server outgoing call breadcrumb as it is recorded", () => {
    const crumb: Breadcrumb = {
      category: "http",
      type: "http",
      data: {
        url: "https://slack.com/api/users.lookupByEmail",
        "http.method": "GET",
        "http.query": `?email=${STAFF_EMAIL_IN_URL}`,
        "http.fragment": "#x",
        status_code: 200,
      },
    };
    expect(scrubBreadcrumb(crumb)).toEqual({
      category: "http",
      type: "http",
      data: { url: "https://slack.com/api/users.lookupByEmail", "http.method": "GET", status_code: 200 },
    });
  });

  it("never drops a breadcrumb, and gives the same answer when run twice", () => {
    const crumb: Breadcrumb = { category: "navigation", data: { from: `/review/${SHARE_TOKEN}`, to: "/dashboard?x=1" } };
    const once = scrubBreadcrumb(crumb);
    expect(once).toEqual({ category: "navigation", data: { from: "/review/[token]", to: "/dashboard" } });
    expect(scrubBreadcrumb(once)).toEqual(once);
  });

  it("leaves logged objects that are not plain data as they are", () => {
    const error = new Error("boom");
    const crumb: Breadcrumb = { category: "console", message: "boom", data: { arguments: [error], logger: "console" } };
    const out = scrubBreadcrumb(crumb);
    expect((out.data?.arguments as unknown[])[0]).toBe(error);
  });
});

describe("sentryScrubHooks", () => {
  it("runs the same scrub for errors, traces and breadcrumbs", () => {
    const event: Event = { request: { url: `/review/${SHARE_TOKEN}?x=1` } };
    expect(sentryScrubHooks.beforeSend(event)).toEqual(scrubEvent(event));
    expect(sentryScrubHooks.beforeSendTransaction(event)).toEqual(scrubEvent(event));
    const crumb: Breadcrumb = { category: "fetch", data: { url: `/api/mcp/${KEY_IN_PATH}` } };
    expect(sentryScrubHooks.beforeBreadcrumb(crumb)).toEqual({ category: "fetch", data: { url: "/api/mcp/[token]" } });
  });
});
