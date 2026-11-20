import { describe, expect, it } from "vitest";

import {
  HighLevelApiError,
  HighLevelTokenUnreadableError,
  describeSyncError,
} from "@/lib/highlevel-errors";

// The "Sync now" button used to say "the token may have been revoked" for
// every failure. These pin the plain-language answer for each real cause, so
// the person clicking it knows what to fix.

describe("HighLevelApiError", () => {
  it("keeps the status and the old message format", () => {
    const error = new HighLevelApiError(403, '{"message":"forbidden"}');
    expect(error.status).toBe(403);
    expect(error.message).toBe('HighLevel API 403: {"message":"forbidden"}');
    expect(error).toBeInstanceOf(Error);
  });
});

describe("describeSyncError", () => {
  it("401: the token was refused, copy the whole token again", () => {
    const text = describeSyncError(new HighLevelApiError(401, "Invalid JWT"));
    expect(text).toMatch(/refused the token/i);
    expect(text).toMatch(/whole/i);
  });

  it("403: names the three permissions the token needs", () => {
    const text = describeSyncError(new HighLevelApiError(403, "forbidden"));
    expect(text).toContain("conversations.readonly");
    expect(text).toContain("conversations/message.readonly");
    expect(text).toContain("locations.readonly");
  });

  it("404 and 422: the Location ID does not match the token", () => {
    for (const status of [404, 422]) {
      expect(describeSyncError(new HighLevelApiError(status, "x"))).toMatch(/location id/i);
    }
  });

  it("429: slow down and retry", () => {
    expect(describeSyncError(new HighLevelApiError(429, "x"))).toMatch(/too many|limiting|wait/i);
  });

  it("5xx: HighLevel is having trouble", () => {
    expect(describeSyncError(new HighLevelApiError(503, "x"))).toMatch(/trouble|try again/i);
  });

  it("any other status shows the number", () => {
    expect(describeSyncError(new HighLevelApiError(418, "x"))).toContain("418");
  });

  it("an unreadable saved token says to save it again", () => {
    const text = describeSyncError(new HighLevelTokenUnreadableError());
    expect(text).toMatch(/saved token/i);
    expect(text).toMatch(/save/i);
  });

  it("anything else is a plain unexpected-error line that leaks no detail", () => {
    const text = describeSyncError(new Error("connect ECONNRESET 10.0.0.1:5432 password=hunter2"));
    expect(text).toMatch(/unexpected/i);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("ECONNRESET");
  });

  it("never echoes HighLevel's own response text back to the screen", () => {
    const text = describeSyncError(new HighLevelApiError(401, "Bearer pit-secret-token-value"));
    expect(text).not.toContain("pit-secret-token-value");
  });
});
