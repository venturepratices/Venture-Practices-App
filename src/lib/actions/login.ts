"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth";
import { lockedOutMessage, LoginLockedError } from "@/lib/login-lockout";

export type LoginState = { error: string | null };

// The "too many failed attempts" lockout is counted and enforced inside the
// Credentials provider's authorize() (src/lib/auth.ts), so it also covers a
// POST straight to /api/auth/callback/credentials. This action only turns
// the outcome into a message for the form.
export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      remember: formData.get("remember") === "on" ? "true" : "false",
      redirectTo: "/dashboard",
    });
    return { error: null };
  } catch (error) {
    if (error instanceof AuthError) {
      if (error instanceof LoginLockedError) {
        return { error: lockedOutMessage(error.lockedUntil) };
      }
      if (error.type === "CredentialsSignin") {
        return { error: "That email or password isn't right. Try again." };
      }
      return { error: "Something went wrong signing you in. Please try again." };
    }
    // NextAuth signals a successful sign-in redirect by throwing; let it
    // propagate. authorize() has already cleared the attempt count.
    throw error;
  }
}
