import { beforeEach, describe, expect, it, vi } from "vitest";

// The login form's server action. Counting and lockout now live in
// authorize() (see login-lockout.test.ts); the form only turns the result
// into a friendly message, so it must not count a wrong password a second
// time or keep its own separate lockout.

vi.mock("next-auth", async () => {
  const errors = await import("@auth/core/errors");
  return { AuthError: errors.AuthError, CredentialsSignin: errors.CredentialsSignin };
});

const signInMock = vi.fn();
vi.mock("@/lib/auth", () => ({ signIn: (...args: unknown[]) => signInMock(...args) }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.1" }),
}));

const loginAttemptCalls: string[] = [];
const touch = (method: string) => async () => {
  loginAttemptCalls.push(method);
  return null;
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    loginAttempt: {
      findUnique: touch("findUnique"),
      findMany: touch("findMany"),
      upsert: touch("upsert"),
      update: touch("update"),
      updateMany: touch("updateMany"),
      deleteMany: touch("deleteMany"),
    },
  },
}));

const { CredentialsSignin } = await import("@auth/core/errors");
const { loginAction } = await import("@/lib/actions/login");
const { LoginLockedError } = await import("@/lib/login-lockout");

function form(email: string, password: string) {
  const data = new FormData();
  data.set("email", email);
  data.set("password", password);
  return data;
}

beforeEach(() => {
  signInMock.mockReset();
  loginAttemptCalls.length = 0;
});

describe("loginAction", () => {
  it("shows how many minutes are left when authorize() refuses with the lockout", async () => {
    signInMock.mockRejectedValue(new LoginLockedError(new Date(Date.now() + 14 * 60 * 1000 + 30 * 1000)));

    const result = await loginAction({ error: null }, form("staff@example.com", "whatever"));

    expect(result).toEqual({ error: "Too many failed attempts. Try again in 15 minutes." });
  });

  it("says 1 minute, not 1 minutes, near the end of a lockout", async () => {
    signInMock.mockRejectedValue(new LoginLockedError(new Date(Date.now() + 20 * 1000)));

    const result = await loginAction({ error: null }, form("staff@example.com", "whatever"));

    expect(result).toEqual({ error: "Too many failed attempts. Try again in 1 minute." });
  });

  it("shows the wrong-password message and leaves the counting to authorize()", async () => {
    signInMock.mockRejectedValue(new CredentialsSignin());

    const result = await loginAction({ error: null }, form("staff@example.com", "wrong"));

    expect(result).toEqual({ error: "That email or password isn't right. Try again." });
    expect(loginAttemptCalls).toEqual([]);
  });

  it("passes a successful sign-in redirect through without touching the attempt store", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/dashboard;307;" });
    signInMock.mockRejectedValue(redirect);

    await expect(loginAction({ error: null }, form("staff@example.com", "right"))).rejects.toBe(redirect);
    expect(loginAttemptCalls).toEqual([]);
  });
});
