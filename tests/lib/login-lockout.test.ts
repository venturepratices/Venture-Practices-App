import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

// These tests call the Credentials provider's authorize() exactly as Auth.js
// does for a POST to /api/auth/callback/credentials, so they prove the
// lockout holds even when the login form (and its server action) is skipped.

const captured = vi.hoisted(() => ({ config: undefined as unknown }));

// The real next-auth entry can't load outside Next.js (it imports
// next/server), so stand in for it: capture the config NextAuth() is given,
// and re-export the same error classes next-auth itself re-exports.
vi.mock("next-auth", async () => {
  const errors = await import("@auth/core/errors");
  return {
    AuthError: errors.AuthError,
    CredentialsSignin: errors.CredentialsSignin,
    default: (config: unknown) => {
      captured.config = config;
      return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), unstable_update: vi.fn() };
    },
  };
});

// Spy on bcrypt.compare but keep the real work, so the unknown-email check
// really spends the same time a real password check does.
vi.mock("bcryptjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bcryptjs")>();
  return { ...actual, default: { ...actual.default, compare: vi.fn(actual.default.compare) } };
});

// ---------------------------------------------------------------------------
// A small in-memory stand-in for the Prisma tables authorize() touches. It
// supports plain equality plus the `in` / `gte` filters and `increment`
// updates, and throws on anything else so a query shape it doesn't
// understand can't silently "pass".
// ---------------------------------------------------------------------------
type AttemptRow = { id: string; email: string; ip: string; attempts: number; lockedUntil: Date | null; updatedAt: Date };
type Where = Record<string, unknown>;

const attemptRows: AttemptRow[] = [];
const teamMembers = new Map<string, Record<string, unknown>>();
const clientUsers = new Map<string, Record<string, unknown>>();

function matchesField(value: unknown, condition: unknown): boolean {
  if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
    return Object.entries(condition as Record<string, unknown>).every(([op, arg]) => {
      if (op === "in") return (arg as unknown[]).includes(value);
      if (op === "gte") return (value as number) >= (arg as number);
      throw new Error(`fake prisma: unsupported filter "${op}"`);
    });
  }
  return value === condition;
}

function matches(row: AttemptRow, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "email_ip") {
      const { email, ip } = condition as { email: string; ip: string };
      return row.email === email && row.ip === ip;
    }
    if (!(key in row)) throw new Error(`fake prisma: unsupported where key "${key}"`);
    return matchesField(row[key as keyof AttemptRow], condition);
  });
}

function applyData(row: AttemptRow, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      const ops = value as Record<string, number>;
      if (!("increment" in ops) || Object.keys(ops).length !== 1) throw new Error(`fake prisma: unsupported update on "${key}"`);
      (row as Record<string, unknown>)[key] = (row[key as keyof AttemptRow] as number) + ops.increment;
    } else {
      (row as Record<string, unknown>)[key] = value;
    }
  }
  // Prisma may skip an update with no fields at all, so an empty update
  // leaves updatedAt alone here too.
  if (Object.keys(data).length > 0 && !("updatedAt" in data)) row.updatedAt = new Date();
}

let nextId = 1;
const fakePrisma = {
  loginAttempt: {
    findUnique: async ({ where }: { where: Where }) => {
      const row = attemptRows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    },
    findMany: async ({ where }: { where: Where }) => attemptRows.filter((r) => matches(r, where)).map((r) => ({ ...r })),
    upsert: async ({ where, create, update }: { where: Where; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      let row = attemptRows.find((r) => matches(r, where));
      if (row) {
        applyData(row, update);
      } else {
        row = { id: `attempt-${nextId++}`, email: "", ip: "", attempts: 0, lockedUntil: null, updatedAt: new Date() };
        applyData(row, create);
        attemptRows.push(row);
      }
      return { ...row };
    },
    update: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      const row = attemptRows.find((r) => matches(r, where));
      if (!row) throw new Error("fake prisma: record to update not found");
      applyData(row, data);
      return { ...row };
    },
    updateMany: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      const hits = attemptRows.filter((r) => matches(r, where));
      hits.forEach((r) => applyData(r, data));
      return { count: hits.length };
    },
    deleteMany: async ({ where }: { where: Where }) => {
      const before = attemptRows.length;
      for (let i = attemptRows.length - 1; i >= 0; i--) if (matches(attemptRows[i], where)) attemptRows.splice(i, 1);
      return { count: before - attemptRows.length };
    },
  },
  teamMember: {
    findUnique: async ({ where }: { where: { email: string } }) => teamMembers.get(where.email) ?? null,
  },
  clientUser: {
    findUnique: async ({ where }: { where: { email: string } }) => clientUsers.get(where.email) ?? null,
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: fakePrisma }));

await import("@/lib/auth");
const { LoginLockedError } = await import("@/lib/login-lockout");

type Authorize = (credentials: Record<string, unknown>, request: Request) => Promise<unknown>;
const authorize = (captured.config as { providers: { options: { authorize: Authorize } }[] }).providers[0].options.authorize;

const compareMock = vi.mocked(bcrypt.compare);

// Cost 4 keeps the known-account tests fast; the code under test must not
// care what cost a stored hash uses.
const STAFF_EMAIL = "staff@example.com";
const STAFF_PASSWORD = "correct horse battery";
const STAFF_HASH = bcrypt.hashSync(STAFF_PASSWORD, 4);

// Real stored hashes use cost 12 (team-members.ts, client-users.ts,
// change-password.ts), so the stand-in check for an unknown email must too.
const REAL_HASH_COST = 12;

function requestFrom(ip: string) {
  return new Request("http://localhost/api/auth/callback/credentials", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

function signInAttempt(password: string, ip = "203.0.113.1", email = STAFF_EMAIL) {
  return authorize({ email, password, remember: "false" }, requestFrom(ip));
}

const START = new Date("2026-11-07T12:00:00.000Z");
const MINUTE = 60 * 1000;

beforeEach(() => {
  attemptRows.length = 0;
  teamMembers.clear();
  clientUsers.clear();
  teamMembers.set(STAFF_EMAIL, {
    id: "member-1",
    name: "Staff Person",
    email: STAFF_EMAIL,
    passwordHash: STAFF_HASH,
    role: "member",
    isAdmin: false,
    mustChangePassword: false,
  });
  compareMock.mockClear();
  // Only the clock is faked: bcryptjs schedules its work with setImmediate.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

async function expectLocked(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(LoginLockedError);
  expect((error as { code: string }).code).toBe("locked");
  expect((error as { type: string }).type).toBe("CredentialsSignin");
  return error as InstanceType<typeof LoginLockedError>;
}

describe("login lockout inside authorize()", () => {
  it("lets a correct password in and returns the account", async () => {
    const user = await signInAttempt(STAFF_PASSWORD);
    expect(user).toMatchObject({ id: "member-1", email: STAFF_EMAIL, isClientUser: false });
  });

  it("refuses direct authorize() calls once 5 wrong passwords have come from one IP, without checking the password", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await signInAttempt("wrong password")).toBeNull();
    }
    compareMock.mockClear();

    await expectLocked(signInAttempt("wrong password"));
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("trips the per-email limit when the wrong passwords come from 5 different IPs", async () => {
    for (let i = 1; i <= 5; i++) {
      expect(await signInAttempt("wrong password", `198.51.100.${i}`)).toBeNull();
    }

    await expectLocked(signInAttempt(STAFF_PASSWORD, "192.0.2.99"));
  });

  it("treats different capitalisation and spacing of the email as the same account for the limit", async () => {
    const spellings = [STAFF_EMAIL, "Staff@Example.com", " STAFF@example.com", "staff@EXAMPLE.COM ", "sTaFf@example.com"];
    for (const [i, email] of spellings.entries()) {
      await signInAttempt("wrong password", `198.51.100.${i + 1}`, email);
    }

    await expectLocked(signInAttempt(STAFF_PASSWORD, "192.0.2.99"));
  });

  it("still refuses the correct password while locked, and lets it in once the 15 minutes have passed", async () => {
    for (let i = 0; i < 5; i++) await signInAttempt("wrong password");

    vi.setSystemTime(new Date(START.getTime() + 14 * MINUTE));
    const error = await expectLocked(signInAttempt(STAFF_PASSWORD));
    expect(error.lockedUntil.getTime()).toBe(START.getTime() + 15 * MINUTE);

    vi.setSystemTime(new Date(START.getTime() + 15 * MINUTE + 1000));
    expect(await signInAttempt(STAFF_PASSWORD)).toMatchObject({ id: "member-1" });
  });

  it("does not count tries made during a lock, so hammering a locked email doesn't stretch the lock", async () => {
    for (let i = 0; i < 5; i++) await signInAttempt("wrong password");

    for (let i = 1; i <= 10; i++) {
      vi.setSystemTime(new Date(START.getTime() + i * MINUTE));
      await expectLocked(signInAttempt("wrong password", `198.51.100.${i}`));
    }

    vi.setSystemTime(new Date(START.getTime() + 15 * MINUTE + 1000));
    expect(await signInAttempt(STAFF_PASSWORD)).toMatchObject({ id: "member-1" });
  });

  it("refuses a try that was already starting when another try set the lock", async () => {
    const findMany = fakePrisma.loginAttempt.findMany;
    const spy = vi.spyOn(fakePrisma.loginAttempt, "findMany").mockImplementationOnce(async (args) => {
      const seenBeforeLock = await findMany(args);
      // Another request fails its 5th try right now and locks the email.
      attemptRows.push({
        id: "attempt-other",
        email: STAFF_EMAIL,
        ip: "*",
        attempts: 0,
        lockedUntil: new Date(START.getTime() + 15 * MINUTE),
        updatedAt: new Date(),
      });
      return seenBeforeLock;
    });

    await expectLocked(signInAttempt(STAFF_PASSWORD));
    expect(compareMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("checks a real-cost bcrypt hash for an unknown email, so it takes as long as a known one", async () => {
    expect(await signInAttempt("any password", "203.0.113.1", "nobody@example.com")).toBeNull();

    expect(compareMock).toHaveBeenCalledTimes(1);
    const [password, hash] = compareMock.mock.calls[0];
    expect(password).toBe("any password");
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/);
    expect(bcrypt.getRounds(hash as string)).toBe(REAL_HASH_COST);
  });

  it("counts and locks unknown emails the same way, so the lockout does not reveal which emails exist", async () => {
    for (let i = 1; i <= 5; i++) {
      expect(await signInAttempt("any password", `198.51.100.${i}`, "nobody@example.com")).toBeNull();
    }

    await expectLocked(signInAttempt("any password", "192.0.2.99", "nobody@example.com"));
  }, 20_000);

  it("resets the count after a successful login, for that IP and for the email as a whole", async () => {
    for (let i = 0; i < 4; i++) await signInAttempt("wrong password", "203.0.113.1");
    expect(await signInAttempt(STAFF_PASSWORD, "203.0.113.1")).toMatchObject({ id: "member-1" });

    for (let i = 0; i < 4; i++) {
      expect(await signInAttempt("wrong password", "203.0.113.2")).toBeNull();
    }
    expect(await signInAttempt(STAFF_PASSWORD, "203.0.113.2")).toMatchObject({ id: "member-1" });
    expect(attemptRows.filter((r) => ["203.0.113.1", "203.0.113.2", "*"].includes(r.ip))).toHaveLength(0);
  });

  it("lets at most 5 of a burst of simultaneous guesses reach the password check", async () => {
    const burst = Array.from({ length: 12 }, (_, i) => signInAttempt(`guess ${i}`, `198.51.100.${i + 1}`));
    const results = await Promise.allSettled(burst);

    expect(compareMock).toHaveBeenCalledTimes(5);
    expect(results.every((r) => (r.status === "fulfilled" ? r.value === null : r.reason instanceof LoginLockedError))).toBe(true);
    await expectLocked(signInAttempt(STAFF_PASSWORD, "192.0.2.99"));
  });
});

// Anyone who knows an email can keep its email-wide row locked for as long as
// they like, by failing 5 times again each time a lock ends. An IP the owner
// signed in from recently is only held to its own per-IP limit, so that alone
// can't keep the owner out.
describe("an IP that signed in to the account before", () => {
  const OWNER_IP = "203.0.113.1";
  const DAY = 24 * 60 * MINUTE;

  async function outsiderLocksEmail() {
    for (let i = 1; i <= 5; i++) await signInAttempt("wrong password", `198.51.100.${i}`);
    await expectLocked(signInAttempt(STAFF_PASSWORD, "192.0.2.99"));
  }

  it("still gets in while an outsider keeps renewing the email-wide lock", async () => {
    expect(await signInAttempt(STAFF_PASSWORD, OWNER_IP)).toMatchObject({ id: "member-1" });

    for (let round = 0; round < 3; round++) {
      vi.setSystemTime(new Date(START.getTime() + round * 16 * MINUTE));
      await outsiderLocksEmail();
      expect(await signInAttempt(STAFF_PASSWORD, OWNER_IP)).toMatchObject({ id: "member-1" });
    }
  });

  it("is trusted for 90 days counted from its latest successful sign-in", async () => {
    expect(await signInAttempt(STAFF_PASSWORD, OWNER_IP)).toMatchObject({ id: "member-1" });
    vi.setSystemTime(new Date(START.getTime() + 60 * DAY));
    expect(await signInAttempt(STAFF_PASSWORD, OWNER_IP)).toMatchObject({ id: "member-1" });

    vi.setSystemTime(new Date(START.getTime() + 140 * DAY));
    await outsiderLocksEmail();
    expect(await signInAttempt(STAFF_PASSWORD, OWNER_IP)).toMatchObject({ id: "member-1" });
  });

  it("is no longer trusted after 90 days without a successful sign-in from it", async () => {
    expect(await signInAttempt(STAFF_PASSWORD, OWNER_IP)).toMatchObject({ id: "member-1" });

    vi.setSystemTime(new Date(START.getTime() + 91 * DAY));
    await outsiderLocksEmail();
    await expectLocked(signInAttempt(STAFF_PASSWORD, OWNER_IP));
  });

  it("is still held to its own limit of 5 wrong passwords", async () => {
    expect(await signInAttempt(STAFF_PASSWORD, OWNER_IP)).toMatchObject({ id: "member-1" });
    for (let i = 0; i < 5; i++) expect(await signInAttempt("wrong password", OWNER_IP)).toBeNull();
    compareMock.mockClear();

    await expectLocked(signInAttempt(STAFF_PASSWORD, OWNER_IP));
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("does not stretch an email-wide lock with its own wrong passwords", async () => {
    expect(await signInAttempt(STAFF_PASSWORD, OWNER_IP)).toMatchObject({ id: "member-1" });
    await outsiderLocksEmail();

    vi.setSystemTime(new Date(START.getTime() + 10 * MINUTE));
    for (let i = 0; i < 5; i++) await signInAttempt("wrong password", OWNER_IP).catch(() => null);

    vi.setSystemTime(new Date(START.getTime() + 15 * MINUTE + 1000));
    expect(await signInAttempt(STAFF_PASSWORD, "192.0.2.99")).toMatchObject({ id: "member-1" });
  });

  it("never applies to requests that carry no IP, since they all share one bucket", async () => {
    const withoutIp = () =>
      authorize(
        { email: STAFF_EMAIL, password: STAFF_PASSWORD, remember: "false" },
        new Request("http://localhost/api/auth/callback/credentials", { method: "POST" }),
      );
    expect(await withoutIp()).toMatchObject({ id: "member-1" });

    await outsiderLocksEmail();
    await expectLocked(withoutIp());
  });
});
