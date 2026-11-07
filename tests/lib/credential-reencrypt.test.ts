import { createCipheriv, randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { currentKeyId, decryptSecret, encryptSecret, storedKeyId } from "@/lib/credential-crypto";
import {
  type EncryptedRow,
  currentKeyDeps,
  describePlan,
  parseReencryptArgs,
  planReencryption,
} from "@/lib/credential-reencrypt";

// Audit row 18 (K6, W19): scripts/reencrypt-credentials.ts moves every stored
// secret onto the current CREDENTIALS_ENCRYPTION_KEY after a rotation. Its
// planning step is a pure function so it can be checked here without a
// database: what needs re-encrypting, what is already done, what cannot be
// read, and that the printed summary holds counts only, never a secret.

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
const KEY_C = randomBytes(32).toString("base64");

function legacyEncrypt(plaintext: string, base64Key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(base64Key, "base64"), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

function setKeys(current: string | undefined, old?: string) {
  vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", current);
  vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY_OLD", old);
}

function encryptWith(plaintext: string, key: string): string {
  setKeys(key);
  return encryptSecret(plaintext);
}

beforeEach(() => {
  setKeys(KEY_A);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("planReencryption with the real keys", () => {
  it("plans old-format and old-key values, and leaves values on the current key alone", () => {
    const legacyFromA = legacyEncrypt("pw-legacy", KEY_A);
    const labelledFromA = encryptWith("pw-labelled-a", KEY_A);
    const labelledFromB = encryptWith("pw-labelled-b", KEY_B);
    const legacyFromB = legacyEncrypt("pw-legacy-b", KEY_B);

    setKeys(KEY_B, KEY_A);
    const rows: EncryptedRow<"encryptedPassword">[] = [
      { id: "c1", values: { encryptedPassword: legacyFromA } },
      { id: "c2", values: { encryptedPassword: labelledFromA } },
      { id: "c3", values: { encryptedPassword: labelledFromB } },
      { id: "c4", values: { encryptedPassword: legacyFromB } },
    ];
    const plan = planReencryption("ClientCredential", rows, currentKeyDeps());

    expect(plan.table).toBe("ClientCredential");
    expect(plan.values).toBe(4);
    expect(plan.alreadyCurrent).toBe(1);
    expect(plan.toReencrypt).toBe(3);
    expect(plan.unreadable).toEqual([]);
    expect(plan.updates.map((u) => u.id)).toEqual(["c1", "c2", "c4"]);

    // Each new value is on the current key and still reads once the old key is gone.
    const idB = currentKeyId();
    setKeys(KEY_B);
    const expected: Record<string, string> = { c1: "pw-legacy", c2: "pw-labelled-a", c4: "pw-legacy-b" };
    for (const update of plan.updates) {
      const stored = update.to.encryptedPassword as string;
      expect(storedKeyId(stored)).toBe(idB);
      expect(decryptSecret(stored)).toBe(expected[update.id]);
    }
  });

  it("keeps the value it read in `from`, so the write can skip a row changed meanwhile", () => {
    const legacy = legacyEncrypt("pw", KEY_A);
    const plan = planReencryption("ClientCredential", [{ id: "c1", values: { encryptedPassword: legacy } }], currentKeyDeps());
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].from).toEqual({ encryptedPassword: legacy });
  });

  it("only touches the fields of a row that need it", () => {
    const current = encryptWith("access", KEY_B);
    const old = encryptWith("refresh", KEY_A);
    setKeys(KEY_B, KEY_A);
    const plan = planReencryption(
      "TeamMemberCalendarConnection",
      [{ id: "t1", values: { encryptedAccessToken: current, encryptedRefreshToken: old } }],
      currentKeyDeps(),
    );
    expect(plan.values).toBe(2);
    expect(plan.alreadyCurrent).toBe(1);
    expect(plan.toReencrypt).toBe(1);
    expect(Object.keys(plan.updates[0].from)).toEqual(["encryptedRefreshToken"]);
    expect(Object.keys(plan.updates[0].to)).toEqual(["encryptedRefreshToken"]);
  });

  it("reports values no configured key can read by row and field, and never plans to write them", () => {
    const unknown = encryptWith("pw-unknown", KEY_C);
    const readable = legacyEncrypt("pw-ok", KEY_A);
    setKeys(KEY_B, KEY_A);
    const plan = planReencryption(
      "TeamMemberCalendarConnection",
      [
        { id: "t1", values: { encryptedAccessToken: unknown, encryptedRefreshToken: readable } },
        { id: "t2", values: { encryptedAccessToken: "not-a-stored-value", encryptedRefreshToken: unknown } },
      ],
      currentKeyDeps(),
    );
    expect(plan.unreadable).toEqual([
      { id: "t1", field: "encryptedAccessToken" },
      { id: "t2", field: "encryptedAccessToken" },
      { id: "t2", field: "encryptedRefreshToken" },
    ]);
    expect(plan.toReencrypt).toBe(1);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].id).toBe("t1");
    expect(Object.keys(plan.updates[0].to)).toEqual(["encryptedRefreshToken"]);
  });

  it("plans nothing on a second run after the first was written (safe to re-run)", () => {
    const rows: EncryptedRow<"encryptedToken">[] = [
      { id: "h1", values: { encryptedToken: legacyEncrypt("token-1", KEY_A) } },
      { id: "h2", values: { encryptedToken: encryptWith("token-2", KEY_A) } },
    ];
    setKeys(KEY_B, KEY_A);
    const first = planReencryption("ClientHighLevelConnection", rows, currentKeyDeps());
    expect(first.toReencrypt).toBe(2);

    const written = rows.map((row) => {
      const update = first.updates.find((u) => u.id === row.id);
      return { id: row.id, values: { ...row.values, ...update?.to } };
    });
    const second = planReencryption("ClientHighLevelConnection", written, currentKeyDeps());
    expect(second.toReencrypt).toBe(0);
    expect(second.alreadyCurrent).toBe(2);
    expect(second.updates).toEqual([]);
  });

  it("does not change the rows it is given", () => {
    const legacy = legacyEncrypt("pw", KEY_A);
    const rows = [{ id: "c1", values: { encryptedPassword: legacy } }];
    planReencryption("ClientCredential", rows, currentKeyDeps());
    expect(rows).toEqual([{ id: "c1", values: { encryptedPassword: legacy } }]);
  });
});

describe("planReencryption with stand-in deps (pure)", () => {
  it("uses only the deps it is given", () => {
    const plan = planReencryption(
      "ClientCredential",
      [
        { id: "a", values: { encryptedPassword: "new:1" } },
        { id: "b", values: { encryptedPassword: "old:2" } },
        { id: "c", values: { encryptedPassword: "broken" } },
      ],
      {
        isCurrent: (stored) => stored.startsWith("new:"),
        reencrypt: (stored) => {
          if (stored === "broken") throw new Error("cannot read");
          return stored.replace("old:", "new:");
        },
      },
    );
    expect(plan).toEqual({
      table: "ClientCredential",
      values: 3,
      alreadyCurrent: 1,
      toReencrypt: 1,
      unreadable: [{ id: "c", field: "encryptedPassword" }],
      updates: [{ id: "b", from: { encryptedPassword: "old:2" }, to: { encryptedPassword: "new:2" } }],
    });
  });
});

describe("describePlan", () => {
  it("prints counts in plain words and never a stored value or secret", () => {
    const legacy = legacyEncrypt("super-secret-password", KEY_A);
    const unknown = encryptWith("other-secret", KEY_C);
    const current = encryptWith("third-secret", KEY_B);
    setKeys(KEY_B, KEY_A);
    const plan = planReencryption(
      "ClientCredential",
      [
        { id: "c1", values: { encryptedPassword: legacy } },
        { id: "c2", values: { encryptedPassword: unknown } },
        { id: "c3", values: { encryptedPassword: current } },
      ],
      currentKeyDeps(),
    );
    const text = describePlan(plan);

    expect(text).toBe("ClientCredential: 3 stored values, 1 already on the current key, 1 to re-encrypt, 1 cannot be read.");
    const secrets = [
      "super-secret-password",
      "other-secret",
      "third-secret",
      KEY_A,
      KEY_B,
      KEY_C,
      ...plan.updates.flatMap((u) => [...Object.values(u.from), ...Object.values(u.to)] as string[]),
      legacy,
      unknown,
      current,
    ];
    for (const secret of secrets) {
      for (const part of secret.split(/[.:]/).filter((p) => p.length >= 12)) {
        expect(text).not.toContain(part);
      }
    }
  });
});

describe("currentKeyDeps", () => {
  it("fails straight away with the usual message when CREDENTIALS_ENCRYPTION_KEY is missing", () => {
    setKeys(undefined);
    expect(() => currentKeyDeps()).toThrow(/CREDENTIALS_ENCRYPTION_KEY is not set/);
  });

  it("fails straight away on a malformed old key, instead of calling every old value unreadable", () => {
    setKeys(KEY_B, "too-short");
    expect(() => currentKeyDeps()).toThrow(/CREDENTIALS_ENCRYPTION_KEY_OLD must decode to exactly 32 bytes/);
  });
});

describe("parseReencryptArgs", () => {
  it("is a dry run by default", () => {
    expect(parseReencryptArgs([])).toEqual({ apply: false });
  });

  it("writes only with --apply", () => {
    expect(parseReencryptArgs(["--apply"])).toEqual({ apply: true });
  });

  it("refuses anything else, so a typo never runs silently", () => {
    expect(() => parseReencryptArgs(["--aply"])).toThrow(/Unknown option "--aply"/);
    expect(() => parseReencryptArgs(["apply"])).toThrow(/Unknown option "apply"/);
  });
});
