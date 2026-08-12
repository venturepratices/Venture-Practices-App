import { describe, expect, it } from "vitest";

import { NotificationType } from "@/generated/prisma/enums";
import { ambientNotificationTypes, getNotificationTier, TIER_EMOJI } from "@/lib/notification-tier";

const ALL_TYPES = Object.values(NotificationType);

describe("notification-tier", () => {
  it("assigns exactly one tier to every NotificationType enum value", () => {
    for (const type of ALL_TYPES) {
      expect(() => getNotificationTier(type)).not.toThrow();
      expect(getNotificationTier(type)).toBeDefined();
    }
  });

  it("has an emoji for every tier", () => {
    expect(TIER_EMOJI.CRITICAL).toBeTruthy();
    expect(TIER_EMOJI.IMPORTANT).toBeTruthy();
    expect(TIER_EMOJI.AMBIENT).toBeTruthy();
  });

  it("ambientNotificationTypes() returns only types actually classified as AMBIENT", () => {
    const ambient = ambientNotificationTypes();
    expect(ambient.length).toBeGreaterThan(0);
    for (const type of ambient) {
      expect(getNotificationTier(type)).toBe("AMBIENT");
    }
    // and nothing classified AMBIENT was left out
    const missed = ALL_TYPES.filter((t) => getNotificationTier(t) === "AMBIENT" && !ambient.includes(t));
    expect(missed).toEqual([]);
  });

  it("TASK_OVERDUE is CRITICAL — the highest-signal type must never be silently downgraded", () => {
    expect(getNotificationTier("TASK_OVERDUE")).toBe("CRITICAL");
  });
});
