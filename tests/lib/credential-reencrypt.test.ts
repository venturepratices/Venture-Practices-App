import { createCipheriv, randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { currentKeyId, decryptSecret, encryptSecret, storedKeyId } from "@/lib/credential-crypto";
import {
  type EncryptedRow,
  confirmAppUsesCurrentKey,
  currentKeyDeps,
  describePlan,
  parseReencryptArgs,
  planReencryption,
  requireKeysFromTerminal,
} from "@/lib/credential-reencrypt";

// Audit row 18 (K6, W19): scripts/reencrypt-credentials.ts moves every stored
// secret onto the current CREDENTIALS_ENCRYPTION_KEY after a rotation. Its
// planning step is a pure function so it can be checked here without a
// database: what needs re-encrypting, what is already done, what cannot be
// read, and that the printed summary holds counts only, never a secret.

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
const KEY_C = randomBytes(32).toString("base64");
/** Only ever set as the old key, so the app labels what it writes (a key change is in progress). */
const KEY_SPARE = randomBytes(32).toString("base64");

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

/**
 * What the app saves while a key change is in progress with `key` as its
 * current key: labelled with that key's id. (With no old key set the app
 * saves the old unlabelled format; see appSavesWithoutOldKey.)
 */
function encryptWith(plaintext: string, key: string): string {
  setKeys(key, KEY_SPARE);
  return encryptSecret(plaintext);
}

/** What the app saves with only CREDENTIALS_ENCRYPTION_KEY set: the old unlabelled format. */
function appSavesWithoutOldKey(plaintext: string, key: string): string {
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
    setKeys(KEY_B, KEY_A);
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

  // Review of round 2: outside a key change the app saves the unlabelled
  // format, so re-encrypting an unlabelled value then gives another unlabelled
  // value. Counting those as "to re-encrypt" would never reach 0.
  it("with no old key set, counts readable unlabelled values as already current and plans nothing", () => {
    const rows: EncryptedRow<"encryptedPassword">[] = [
      { id: "c1", values: { encryptedPassword: legacyEncrypt("pw-legacy", KEY_A) } },
      { id: "c2", values: { encryptedPassword: appSavesWithoutOldKey("pw-new", KEY_A) } },
      { id: "c3", values: { encryptedPassword: legacyEncrypt("pw-other-key", KEY_C) } },
      { id: "c4", values: { encryptedPassword: encryptWith("pw-labelled-other", KEY_C) } },
    ];
    setKeys(KEY_A);
    const plan = planReencryption("ClientCredential", rows, currentKeyDeps());
    expect(plan.values).toBe(4);
    expect(plan.alreadyCurrent).toBe(2);
    expect(plan.toReencrypt).toBe(0);
    expect(plan.unreadable).toEqual([
      { id: "c3", field: "encryptedPassword" },
      { id: "c4", field: "encryptedPassword" },
    ]);
    expect(plan.updates).toEqual([]);
  });

  it("during a key change, still moves unlabelled values on the new key onto the labelled format", () => {
    const savedAfterTheLastChange = appSavesWithoutOldKey("pw", KEY_B);
    setKeys(KEY_B, KEY_A);
    const plan = planReencryption(
      "ClientCredential",
      [{ id: "c1", values: { encryptedPassword: savedAfterTheLastChange } }],
      currentKeyDeps(),
    );
    expect(plan.toReencrypt).toBe(1);
    expect(storedKeyId(plan.updates[0].to.encryptedPassword as string)).toBe(currentKeyId());
  });

  it("does not change the rows it is given", () => {
    const legacy = legacyEncrypt("pw", KEY_A);
    const rows = [{ id: "c1", values: { encryptedPassword: legacy } }];
    setKeys(KEY_B, KEY_A);
    expect(planReencryption("ClientCredential", rows, currentKeyDeps()).updates).toHaveLength(1);
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

// Review of row 18: the laptop .env holds an encryption key that may not be
// production's. If the script took a key from there, --apply could move every
// stored value onto a key production does not have. `terminal` is the
// environment as the terminal set it, `loaded` is the same after .env.
describe("requireKeysFromTerminal", () => {
  const CURRENT = "CREDENTIALS_ENCRYPTION_KEY";
  const OLD = "CREDENTIALS_ENCRYPTION_KEY_OLD";

  function refusal(terminal: Record<string, string | undefined>, loaded: Record<string, string | undefined>): Error {
    try {
      requireKeysFromTerminal(terminal, loaded);
    } catch (error) {
      return error as Error;
    }
    throw new Error("expected requireKeysFromTerminal to refuse");
  }

  it("accepts both keys typed into the terminal", () => {
    const env = { [CURRENT]: KEY_B, [OLD]: KEY_A };
    expect(() => requireKeysFromTerminal(env, { ...env, DATABASE_URL: "from .env" })).not.toThrow();
  });

  it("accepts a current key with no old key anywhere, or a blank old key in .env", () => {
    expect(() => requireKeysFromTerminal({ [CURRENT]: KEY_B }, { [CURRENT]: KEY_B })).not.toThrow();
    expect(() => requireKeysFromTerminal({ [CURRENT]: KEY_B }, { [CURRENT]: KEY_B, [OLD]: "" })).not.toThrow();
    expect(() => requireKeysFromTerminal({ [CURRENT]: KEY_B, [OLD]: "" }, { [CURRENT]: KEY_B, [OLD]: "" })).not.toThrow();
  });

  it("refuses a current key filled in from .env when the terminal did not set one", () => {
    const error = refusal({ [OLD]: KEY_A }, { [CURRENT]: KEY_C, [OLD]: KEY_A });
    expect(error.message).toMatch(/CREDENTIALS_ENCRYPTION_KEY must be set in this terminal/);
    expect(error.message).toMatch(/never taken from \.env/);
  });

  it("refuses a blank current key in the terminal", () => {
    expect(refusal({ [CURRENT]: "", [OLD]: KEY_A }, { [CURRENT]: "", [OLD]: KEY_A }).message).toMatch(
      /CREDENTIALS_ENCRYPTION_KEY must be set in this terminal/,
    );
    expect(refusal({ [CURRENT]: "  " }, { [CURRENT]: "  " }).message).toMatch(
      /CREDENTIALS_ENCRYPTION_KEY must be set in this terminal/,
    );
  });

  it("refuses an old key filled in from .env when the terminal did not set one", () => {
    const error = refusal({ [CURRENT]: KEY_B }, { [CURRENT]: KEY_B, [OLD]: KEY_C });
    expect(error.message).toMatch(/CREDENTIALS_ENCRYPTION_KEY_OLD came from \.env, not from this terminal/);
  });

  it("refuses a key whose value in use is not the one the terminal set", () => {
    expect(refusal({ [CURRENT]: KEY_B, [OLD]: KEY_A }, { [CURRENT]: KEY_C, [OLD]: KEY_A }).message).toMatch(
      /CREDENTIALS_ENCRYPTION_KEY came from \.env, not from this terminal/,
    );
    expect(refusal({ [CURRENT]: KEY_B, [OLD]: KEY_A }, { [CURRENT]: KEY_B, [OLD]: KEY_C }).message).toMatch(
      /CREDENTIALS_ENCRYPTION_KEY_OLD came from \.env, not from this terminal/,
    );
  });

  it("never puts a key in its message", () => {
    const messages = [
      refusal({ [OLD]: KEY_A }, { [CURRENT]: KEY_C, [OLD]: KEY_A }).message,
      refusal({ [CURRENT]: KEY_B }, { [CURRENT]: KEY_B, [OLD]: KEY_C }).message,
      refusal({ [CURRENT]: KEY_B, [OLD]: KEY_A }, { [CURRENT]: KEY_C, [OLD]: KEY_A }).message,
    ];
    for (const message of messages) {
      for (const key of [KEY_A, KEY_B, KEY_C]) expect(message).not.toContain(key);
    }
  });
});

// Review of row 18: with an old key set, a wrong current key in the terminal
// still reads every value (through the old key), so the counts look fine and
// --apply moves everything onto a key the app does not have. Even "some values
// are already on the current key" is not proof: with the two keys swapped,
// values saved with the old key count as current. The app always saves with
// its own current key, so the newest saved vault password (re-saved in the
// app after the redeploy) is the proof.
describe("confirmAppUsesCurrentKey", () => {
  it("is not needed when no old key is set: a wrong key alone cannot read anything", () => {
    const fromOtherKey = encryptWith("pw", KEY_C);
    setKeys(KEY_B);
    expect(() => confirmAppUsesCurrentKey(fromOtherKey, currentKeyDeps())).not.toThrow();
    expect(() => confirmAppUsesCurrentKey(null, currentKeyDeps())).not.toThrow();
    setKeys(KEY_B, "");
    expect(() => confirmAppUsesCurrentKey(null, currentKeyDeps())).not.toThrow();
  });

  it("passes when the newest vault password is on this terminal's current key", () => {
    const savedByApp = encryptWith("pw", KEY_B);
    setKeys(KEY_B, KEY_A);
    expect(() => confirmAppUsesCurrentKey(savedByApp, currentKeyDeps())).not.toThrow();
  });

  it("stops when the terminal's current key is not the one the app saves with", () => {
    const savedByApp = encryptWith("pw", KEY_B);
    setKeys(KEY_C, KEY_A);
    expect(() => confirmAppUsesCurrentKey(savedByApp, currentKeyDeps())).toThrow(/Stopped, nothing was written/);
  });

  it("stops when the two keys are swapped", () => {
    const savedByApp = encryptWith("pw", KEY_B);
    setKeys(KEY_A, KEY_B);
    expect(() => confirmAppUsesCurrentKey(savedByApp, currentKeyDeps())).toThrow(/Stopped, nothing was written/);
  });

  it("stops when the same key is set as both current and old", () => {
    const savedByApp = encryptWith("pw", KEY_B);
    setKeys(KEY_A, KEY_A);
    expect(() => confirmAppUsesCurrentKey(savedByApp, currentKeyDeps())).toThrow(/Stopped, nothing was written/);
  });

  it("stops when the app saved without the old key set in Vercel, and says the old key must be set there too", () => {
    const savedByAppWithoutOldKey = appSavesWithoutOldKey("pw", KEY_B);
    setKeys(KEY_B, KEY_A);
    expect(() => confirmAppUsesCurrentKey(savedByAppWithoutOldKey, currentKeyDeps())).toThrow(
      /CREDENTIALS_ENCRYPTION_KEY_OLD is not set in Vercel as well/,
    );
  });

  it("stops when no vault password was saved since the new key, or there is none", () => {
    const beforeTheChange = encryptWith("pw", KEY_A);
    const beforeKeyIds = legacyEncrypt("pw", KEY_A);
    setKeys(KEY_B, KEY_A);
    for (const newest of [beforeTheChange, beforeKeyIds, null]) {
      expect(() => confirmAppUsesCurrentKey(newest, currentKeyDeps())).toThrow(/edit any vault password/);
    }
  });

  it("never puts a key or a stored value in its message", () => {
    const savedByApp = encryptWith("pw", KEY_B);
    setKeys(KEY_C, KEY_A);
    let message = "";
    try {
      confirmAppUsesCurrentKey(savedByApp, currentKeyDeps());
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    for (const secret of [KEY_A, KEY_B, KEY_C, ...savedByApp.split(/[.:]/).filter((p) => p.length >= 12)]) {
      expect(message).not.toContain(secret);
    }
  });
});
