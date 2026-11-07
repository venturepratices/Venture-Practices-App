import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { currentKeyId, decryptSecret, encryptSecret, readKeyIds, storedKeyId } from "@/lib/credential-crypto";

// Audit row 18 (K6, W19): stored client passwords, HighLevel tokens and
// Google Calendar tokens were saved as "iv.tag.data" with nothing saying
// which key made them, so CREDENTIALS_ENCRYPTION_KEY could never be changed
// (a new key made every stored value unreadable at once). During a key change
// (CREDENTIALS_ENCRYPTION_KEY_OLD set to a different key) new values carry a
// version label and a non-secret key id; the rest of the time they keep the
// old unlabelled format so older code can still read them. Both formats read,
// and CREDENTIALS_ENCRYPTION_KEY_OLD keeps values from the previous key
// readable during a rotation. Encryption always uses the current key.

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
const KEY_C = randomBytes(32).toString("base64");
/** Only ever set as the old key, so the app labels what it writes (a key change is in progress). */
const KEY_SPARE = randomBytes(32).toString("base64");
const PLAINTEXT = "hunter2-wordpress-admin-password";

/** Exactly what the code before this change wrote: iv.tag.data, no label. */
function legacyEncrypt(plaintext: string, base64Key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(base64Key, "base64"), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

/** Exactly what the code before this change read (master 15ff780): the deployment a rollback would bring back. */
function legacyDecrypt(stored: string, base64Key: string): string {
  const [iv, tag, data] = stored.split(".");
  if (!iv || !tag || !data) throw new Error("Malformed encrypted credential value.");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(base64Key, "base64"), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

function setKeys(current: string | undefined, old?: string) {
  vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", current);
  vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY_OLD", old);
}

/** What the app saves while a key change is in progress with `key` as the current key: labelled with its id. */
function encryptDuringKeyChange(plaintext: string, key: string): string {
  setKeys(key, KEY_SPARE);
  return encryptSecret(plaintext);
}

function caught(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the call to throw");
}

beforeEach(() => {
  setKeys(KEY_A);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("encryptSecret / decryptSecret round trip", () => {
  it("gives back exactly what was stored", () => {
    expect(decryptSecret(encryptSecret(PLAINTEXT))).toBe(PLAINTEXT);
  });

  it("round trips non-English text", () => {
    expect(decryptSecret(encryptSecret("contraseña ✓ 密码"))).toBe("contraseña ✓ 密码");
  });

  it("never stores the plaintext and gives a different value each time", () => {
    const first = encryptSecret(PLAINTEXT);
    const second = encryptSecret(PLAINTEXT);
    expect(first).not.toContain(PLAINTEXT);
    expect(first).not.toBe(second);
  });

  it("labels new values with a version and the current key's id while an old key is set (a key change)", () => {
    setKeys(KEY_B, KEY_A);
    const stored = encryptSecret(PLAINTEXT);
    expect(stored.startsWith("v2:")).toBe(true);
    expect(storedKeyId(stored)).toBe(currentKeyId());
  });
});

// Review of round 2: a labelled value cannot be read by the code before this
// change, so if production were rolled back, every calendar token refreshed
// since (daily), and every password or HighLevel token saved since, would stop
// working. Outside a key change nothing needs the label, so values are saved
// in the old format, which every version reads.
describe("outside a key change, values stay readable by the code before this change", () => {
  it("saves the old unlabelled format when no old key is set", () => {
    const stored = encryptSecret(PLAINTEXT);
    expect(storedKeyId(stored)).toBeNull();
    expect(stored.split(".")).toHaveLength(3);
    expect(legacyDecrypt(stored, KEY_A)).toBe(PLAINTEXT);
    expect(decryptSecret(stored)).toBe(PLAINTEXT);
  });

  it("also saves the old format when the old key is blank or the same as the current key", () => {
    for (const old of ["", "   ", KEY_A]) {
      setKeys(KEY_A, old);
      const stored = encryptSecret(PLAINTEXT);
      expect(storedKeyId(stored)).toBeNull();
      expect(legacyDecrypt(stored, KEY_A)).toBe(PLAINTEXT);
    }
  });

  it("refuses to save with a malformed old key, as reading already does", () => {
    setKeys(KEY_A, "too-short");
    expect(caught(() => encryptSecret(PLAINTEXT)).message).toMatch(
      /CREDENTIALS_ENCRYPTION_KEY_OLD must decode to exactly 32 bytes/,
    );
  });
});

describe("currentKeyId", () => {
  it("is a short id that does not reveal the key", () => {
    const id = currentKeyId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(KEY_A).not.toContain(id);
    expect(Buffer.from(KEY_A, "base64").toString("hex")).not.toContain(id);
  });

  it("is the same for the same key and different for another key", () => {
    const idA = currentKeyId();
    expect(currentKeyId()).toBe(idA);
    setKeys(KEY_B);
    expect(currentKeyId()).not.toBe(idA);
  });
});

describe("readKeyIds", () => {
  it("lists the current key, then the old key when one is set", () => {
    const idA = currentKeyId();
    expect(readKeyIds()).toEqual([idA]);
    setKeys(KEY_B, KEY_A);
    expect(readKeyIds()).toEqual([currentKeyId(), idA]);
  });

  it("lists a key once when the old key equals the current one", () => {
    setKeys(KEY_A, KEY_A);
    expect(readKeyIds()).toEqual([currentKeyId()]);
  });
});

describe("storedKeyId", () => {
  it("is null for an old unlabelled value", () => {
    expect(storedKeyId(legacyEncrypt(PLAINTEXT, KEY_A))).toBeNull();
  });
});

describe("old unlabelled values", () => {
  it("still decrypt with the key that wrote them", () => {
    expect(decryptSecret(legacyEncrypt(PLAINTEXT, KEY_A))).toBe(PLAINTEXT);
  });
});

describe("key rotation with CREDENTIALS_ENCRYPTION_KEY_OLD", () => {
  it("reads labelled and unlabelled values written with the old key", () => {
    const legacy = legacyEncrypt(PLAINTEXT, KEY_A);
    const unlabelled = encryptSecret(PLAINTEXT);
    const labelled = encryptDuringKeyChange(PLAINTEXT, KEY_A);
    expect(storedKeyId(labelled)).not.toBeNull();

    setKeys(KEY_B, KEY_A);

    expect(decryptSecret(unlabelled)).toBe(PLAINTEXT);

    expect(decryptSecret(legacy)).toBe(PLAINTEXT);
    expect(decryptSecret(labelled)).toBe(PLAINTEXT);
  });

  it("always encrypts with the new current key", () => {
    const idA = currentKeyId();
    setKeys(KEY_B, KEY_A);
    const idB = currentKeyId();

    const stored = encryptSecret(PLAINTEXT);
    expect(storedKeyId(stored)).toBe(idB);
    expect(storedKeyId(stored)).not.toBe(idA);

    // Once the old key is removed, the newly written value still reads.
    setKeys(KEY_B);
    expect(decryptSecret(stored)).toBe(PLAINTEXT);
  });

  it("treats a blank old key as not set", () => {
    setKeys(KEY_A, "   ");
    expect(decryptSecret(encryptSecret(PLAINTEXT))).toBe(PLAINTEXT);
  });

  it("does not need the old key when it equals the current one", () => {
    setKeys(KEY_A, KEY_A);
    expect(decryptSecret(legacyEncrypt(PLAINTEXT, KEY_A))).toBe(PLAINTEXT);
  });

  it("refuses a malformed old key with a clear message", () => {
    setKeys(KEY_B, "too-short");
    const error = caught(() => decryptSecret(legacyEncrypt(PLAINTEXT, KEY_A)));
    expect(error.message).toMatch(/CREDENTIALS_ENCRYPTION_KEY_OLD must decode to exactly 32 bytes/);
  });
});

describe("a value no configured key can read", () => {
  function expectClearErrorWithoutSecrets(error: Error, stored: string) {
    expect(error.message).toMatch(/could not be decrypted/i);
    expect(error.message).toContain("CREDENTIALS_ENCRYPTION_KEY_OLD");
    for (const secret of [PLAINTEXT, KEY_A, KEY_B, KEY_C, KEY_SPARE]) {
      expect(error.message).not.toContain(secret);
    }
    for (const part of stored.split(/[.:]/).filter((p) => p.length >= 8)) {
      expect(error.message).not.toContain(part);
    }
    expect(error.message).not.toMatch(/—/);
  }

  it("gives a clear error with no secret for a labelled value from an unknown key", () => {
    const stored = encryptDuringKeyChange(PLAINTEXT, KEY_A);
    setKeys(KEY_B);
    expectClearErrorWithoutSecrets(caught(() => decryptSecret(stored)), stored);
  });

  it("gives the same clear error for an old unlabelled value from an unknown key", () => {
    const stored = legacyEncrypt(PLAINTEXT, KEY_A);
    setKeys(KEY_B, KEY_C);
    expectClearErrorWithoutSecrets(caught(() => decryptSecret(stored)), stored);
  });

  it("gives the same clear error when a labelled value was tampered with", () => {
    const stored = encryptDuringKeyChange(PLAINTEXT, KEY_A);
    const [label, id, body] = stored.split(":");
    const [iv, tag, data] = body.split(".");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    const tampered = `${label}:${id}:${iv}.${tag}.${flipped.toString("base64")}`;
    expectClearErrorWithoutSecrets(caught(() => decryptSecret(tampered)), tampered);
  });
});

describe("bad configuration and bad values", () => {
  it("refuses to encrypt or decrypt without CREDENTIALS_ENCRYPTION_KEY, even with an old key set", () => {
    const stored = encryptSecret(PLAINTEXT);
    setKeys(undefined, KEY_A);
    expect(caught(() => encryptSecret(PLAINTEXT)).message).toMatch(/CREDENTIALS_ENCRYPTION_KEY is not set/);
    expect(caught(() => decryptSecret(stored)).message).toMatch(/CREDENTIALS_ENCRYPTION_KEY is not set/);
  });

  it("refuses a current key that is not 32 bytes", () => {
    setKeys("too-short");
    expect(caught(() => encryptSecret(PLAINTEXT)).message).toMatch(
      /CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes/,
    );
  });

  it("calls a value with the wrong shape malformed", () => {
    for (const bad of ["", "not-encrypted", "a.b", "v2:", "v2:abcd1234:a.b", "v3:abcd1234:a.b.c", "v2:a.b.c"]) {
      expect(caught(() => decryptSecret(bad)).message).toMatch(/Malformed encrypted credential value/);
    }
  });
});
