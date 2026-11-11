import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypts/decrypts third-party client credentials (e.g. a WordPress admin
 * password) at rest. This must be reversible — unlike login passwords
 * (bcrypt, one-way), the actual plaintext needs to be shown back to a user
 * who re-authenticates for it — so this uses AES-256-GCM with a server-side
 * key instead. There is no silent fallback to storing plaintext: if the key
 * is missing or malformed, every call throws rather than degrading.
 *
 * Stored formats (base64 parts):
 * - "<iv>.<tag>.<data>", unlabelled. Written whenever no old key is set, which
 *   is almost always, because every older version of this app can read it: a
 *   rollback of production never strands a stored value.
 * - "v2:<keyId>:<iv>.<tag>.<data>", labelled. Written only while
 *   CREDENTIALS_ENCRYPTION_KEY_OLD holds a different key, that is during a key
 *   change. keyId is a short, non-secret fingerprint of the key that wrote the
 *   value. To change the key: set the new key as CREDENTIALS_ENCRYPTION_KEY
 *   and the previous one as CREDENTIALS_ENCRYPTION_KEY_OLD, then run
 *   scripts/reencrypt-credentials.ts, which moves every value onto the new key
 *   in this format. Code older than the label cannot read it, so do not roll
 *   production back past the label's arrival once a key change has started.
 * Both are read: a labelled value with the key its id names, an unlabelled one
 * with the current key then the old one. Encryption always uses the current key.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const VERSION = "v2";

type Key = { id: string; bytes: Buffer };

function parseKey(name: string, raw: string): Key {
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) {
    throw new Error(`${name} must decode to exactly 32 bytes (generate with: openssl rand -base64 32).`);
  }
  const id = createHash("sha256").update("credential-key-id:").update(bytes).digest("hex").slice(0, 8);
  return { id, bytes };
}

function getCurrentKey(): Key {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not set. Client credentials cannot be stored or read without it. See the deployment guide for how to generate one."
    );
  }
  return parseKey("CREDENTIALS_ENCRYPTION_KEY", raw);
}

/** The keys that may read a stored value: the current one first, then the optional old one. */
function getReadKeys(): Key[] {
  const current = getCurrentKey();
  const rawOld = process.env.CREDENTIALS_ENCRYPTION_KEY_OLD;
  if (!rawOld || !rawOld.trim()) return [current];
  const old = parseKey("CREDENTIALS_ENCRYPTION_KEY_OLD", rawOld);
  return old.id === current.id ? [current] : [current, old];
}

/** Non-secret id of CREDENTIALS_ENCRYPTION_KEY, as written into new stored values. */
export function currentKeyId(): string {
  return getCurrentKey().id;
}

/** Non-secret ids of every key that can read: current first, then the old one if set. Throws on a bad key. */
export function readKeyIds(): string[] {
  return getReadKeys().map((key) => key.id);
}

type Parsed = { keyId: string | null; iv: string; tag: string; data: string };

function parseStored(stored: string): Parsed {
  let keyId: string | null = null;
  let body = stored;
  if (stored.includes(":")) {
    const parts = stored.split(":");
    if (parts.length !== 3 || parts[0] !== VERSION || !/^[0-9a-f]{8}$/.test(parts[1])) {
      throw new Error("Malformed encrypted credential value.");
    }
    keyId = parts[1];
    body = parts[2];
  }
  const [iv, tag, data, extra] = body.split(".");
  if (!iv || !tag || !data || extra !== undefined) {
    throw new Error("Malformed encrypted credential value.");
  }
  return { keyId, iv, tag, data };
}

/** The key id a stored value was written with, or null for a value from before key ids existed. */
export function storedKeyId(stored: string): string | null {
  return parseStored(stored).keyId;
}

/** True while a different old key is set, i.e. CREDENTIALS_ENCRYPTION_KEY is being changed. Throws on a bad key. */
function keyChangeInProgress(): boolean {
  return getReadKeys().length > 1;
}

export function encryptSecret(plaintext: string): string {
  const key = getCurrentKey();
  const labelled = keyChangeInProgress();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key.bytes, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const body = [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
  // Only a key change needs the label; without it, every older version can still read the value.
  return labelled ? `${VERSION}:${key.id}:${body}` : body;
}

function tryDecrypt(key: Key, parsed: Parsed): string | null {
  try {
    const decipher = createDecipheriv(ALGORITHM, key.bytes, Buffer.from(parsed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(parsed.data, "base64")), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    // Wrong key or altered value: GCM refuses it. The caller tries the next key.
    return null;
  }
}

export function decryptSecret(stored: string): string {
  const parsed = parseStored(stored);
  const readKeys = getReadKeys();
  // A labelled value names its key; an unlabelled one may be from either.
  const candidates = parsed.keyId === null ? readKeys : readKeys.filter((key) => key.id === parsed.keyId);
  for (const key of candidates) {
    const plaintext = tryDecrypt(key, parsed);
    if (plaintext !== null) return plaintext;
  }
  throw new Error(
    "A stored credential could not be decrypted with CREDENTIALS_ENCRYPTION_KEY or CREDENTIALS_ENCRYPTION_KEY_OLD. If the key was changed, set the previous key as CREDENTIALS_ENCRYPTION_KEY_OLD and redeploy."
  );
}
