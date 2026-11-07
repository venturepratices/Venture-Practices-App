import { createCipheriv, randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { currentKeyId, decryptSecret, encryptSecret, readKeyIds, storedKeyId } from "@/lib/credential-crypto";

// Audit row 18 (K6, W19): stored client passwords, HighLevel tokens and
// Google Calendar tokens were saved as "iv.tag.data" with nothing saying
// which key made them, so CREDENTIALS_ENCRYPTION_KEY could never be changed
// (a new key made every stored value unreadable at once). New values now
// carry a version label and a non-secret key id, old unlabelled values still
// read, and CREDENTIALS_ENCRYPTION_KEY_OLD keeps values from the previous key
// readable during a rotation. Encryption always uses the current key.

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
const KEY_C = randomBytes(32).toString("base64");
const PLAINTEXT = "hunter2-wordpress-admin-password";

/** Exactly what the code before this change wrote: iv.tag.data, no label. */
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

  it("labels new values with a version and the current key's id", () => {
    const stored = encryptSecret(PLAINTEXT);
    expect(stored.startsWith("v2:")).toBe(true);
    expect(storedKeyId(stored)).toBe(currentKeyId());
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
    const labelled = encryptSecret(PLAINTEXT);

    setKeys(KEY_B, KEY_A);

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
    for (const secret of [PLAINTEXT, KEY_A, KEY_B, KEY_C]) {
      expect(error.message).not.toContain(secret);
    }
    for (const part of stored.split(/[.:]/).filter((p) => p.length >= 8)) {
      expect(error.message).not.toContain(part);
    }
    expect(error.message).not.toMatch(/—/);
  }

  it("gives a clear error with no secret for a labelled value from an unknown key", () => {
    const stored = encryptSecret(PLAINTEXT);
    setKeys(KEY_B);
    expectClearErrorWithoutSecrets(caught(() => decryptSecret(stored)), stored);
  });

  it("gives the same clear error for an old unlabelled value from an unknown key", () => {
    const stored = legacyEncrypt(PLAINTEXT, KEY_A);
    setKeys(KEY_B, KEY_C);
    expectClearErrorWithoutSecrets(caught(() => decryptSecret(stored)), stored);
  });

  it("gives the same clear error when a labelled value was tampered with", () => {
    const stored = encryptSecret(PLAINTEXT);
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
