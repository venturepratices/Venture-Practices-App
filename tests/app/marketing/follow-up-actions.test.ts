import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMarketingUser = vi.fn();
const getFlowEmail = vi.fn();
const saveFlowEmailDraft = vi.fn();
const logMarketingAction = vi.fn();
const missingVariables = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/marketing/access", () => ({
  requireMarketingUser: (...a: unknown[]) => requireMarketingUser(...a),
}));
vi.mock("@/lib/marketing/nitro-client", () => ({
  getFlowEmail: (...a: unknown[]) => getFlowEmail(...a),
  saveFlowEmailDraft: (...a: unknown[]) => saveFlowEmailDraft(...a),
}));
vi.mock("@/lib/marketing/audit", () => ({
  logMarketingAction: (...a: unknown[]) => logMarketingAction(...a),
}));
vi.mock("@/lib/marketing/email-diff", () => ({
  missingVariables: (...a: unknown[]) => missingVariables(...a),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

import { PermissionError } from "@/lib/permissions";
import {
  fetchEmailDraftAction,
  saveEmailDraftAction,
} from "@/app/(app)/marketing/follow-up-system/actions";

const input = {
  flowId: "flow-1",
  stepIndex: 2,
  before: { subject: "Hello SECRET_SUBJECT", body: "Hi {{firstName}} SECRET_BODY" },
  after: { subject: "Hello SECRET_SUBJECT 2", body: "Hi there SECRET_BODY" },
};

// Unique actor per test so the module-level rate limiter never leaks across tests.
let actorCounter = 0;
function asAdmin(id = `admin-${++actorCounter}`) {
  requireMarketingUser.mockResolvedValue({ userId: id, isAdmin: true });
  return id;
}

beforeEach(() => {
  vi.clearAllMocks();
  missingVariables.mockReturnValue([]);
  saveFlowEmailDraft.mockResolvedValue({ ok: true, updatedAt: "2026-11-25T00:00:00Z" });
});

describe("saveEmailDraftAction", () => {
  it("rejects non-admins as forbidden", async () => {
    requireMarketingUser.mockResolvedValue({ userId: "v1", isAdmin: false });
    const r = await saveEmailDraftAction(input);
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe("forbidden");
    expect(saveFlowEmailDraft).not.toHaveBeenCalled();
  });

  it("maps 401 to unauthorized", async () => {
    requireMarketingUser.mockRejectedValue(new PermissionError(401, "x"));
    const r = await saveEmailDraftAction(input);
    expect(r.error?.kind).toBe("unauthorized");
  });

  it("rejects invalid input", async () => {
    asAdmin();
    const r = await saveEmailDraftAction({ ...input, flowId: "" });
    expect(r).toEqual({ ok: false, error: { kind: "unknown", message: "Invalid input" } });
    expect(saveFlowEmailDraft).not.toHaveBeenCalled();
  });

  it("saves, audits, and revalidates when nothing is dropped", async () => {
    asAdmin();
    const r = await saveEmailDraftAction(input);
    expect(r.ok).toBe(true);
    expect(saveFlowEmailDraft).toHaveBeenCalledWith(input);
    expect(logMarketingAction).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/marketing/follow-up-system");
  });

  it("asks for confirmation when a variable is dropped", async () => {
    asAdmin();
    missingVariables.mockReturnValue(["firstName"]);
    const r = await saveEmailDraftAction(input);
    expect(r).toEqual({ ok: false, needsConfirmation: true, droppedVariables: ["firstName"] });
    expect(saveFlowEmailDraft).not.toHaveBeenCalled();
  });

  it("saves a confirmed drop and records droppedCount", async () => {
    asAdmin();
    missingVariables.mockReturnValue(["firstName"]);
    const r = await saveEmailDraftAction({ ...input, confirmedDrop: true });
    expect(r.ok).toBe(true);
    expect(saveFlowEmailDraft).toHaveBeenCalledTimes(1);
    const meta = logMarketingAction.mock.calls[0][3];
    expect(meta.droppedCount).toBe(1);
  });

  it("rate limits the 21st save in an hour", async () => {
    asAdmin("rate-user");
    for (let i = 0; i < 20; i++) {
      expect((await saveEmailDraftAction(input)).ok).toBe(true);
    }
    const r = await saveEmailDraftAction(input);
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe("rate_limited");
    expect(saveFlowEmailDraft).toHaveBeenCalledTimes(20);
  });

  it("bubbles up a missing_key error unchanged", async () => {
    asAdmin();
    const err = { ok: false, error: { kind: "missing_key", message: "No key" } };
    saveFlowEmailDraft.mockResolvedValue(err);
    const r = await saveEmailDraftAction(input);
    expect(r).toEqual(err);
    expect(logMarketingAction).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("maps thrown errors to unknown", async () => {
    asAdmin();
    vi.spyOn(console, "error").mockImplementation(() => {});
    saveFlowEmailDraft.mockRejectedValue(new Error("boom"));
    const r = await saveEmailDraftAction(input);
    expect(r.error?.kind).toBe("unknown");
  });

  it("writes audit metadata with exact fields and no raw text", async () => {
    const id = asAdmin();
    await saveEmailDraftAction(input);
    const [actor, action, description, meta] = logMarketingAction.mock.calls[0];
    expect(actor.userId).toBe(id);
    expect(action).toBe("marketing.email.save");
    expect(meta).toEqual({
      flowId: "flow-1",
      stepIndex: 2,
      subjectChanged: true,
      bodyLengthBefore: input.before.body.length,
      bodyLengthAfter: input.after.body.length,
      droppedCount: 0,
    });
    const serialized = JSON.stringify([description, meta]);
    expect(serialized).not.toContain("SECRET_SUBJECT");
    expect(serialized).not.toContain("SECRET_BODY");
  });
});

describe("fetchEmailDraftAction", () => {
  it("lets a non-admin Marketing viewer fetch", async () => {
    requireMarketingUser.mockResolvedValue({ userId: "v1", isAdmin: false });
    const content = { ok: true, content: { flowId: "f", stepIndex: 0, subject: "s", body: "b" } };
    getFlowEmail.mockResolvedValue(content);
    expect(await fetchEmailDraftAction("f", 0)).toEqual(content);
    expect(getFlowEmail).toHaveBeenCalledWith("f", 0);
  });

  it("returns forbidden for users without Marketing access", async () => {
    requireMarketingUser.mockRejectedValue(new PermissionError(403, "no"));
    const r = await fetchEmailDraftAction("f", 0);
    expect(r.error?.kind).toBe("forbidden");
    expect(getFlowEmail).not.toHaveBeenCalled();
  });
});
