"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth";

export type LoginState = { error: string | null };

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
      if (error.type === "CredentialsSignin") {
        return { error: "That email or password isn't right. Try again." };
      }
      return { error: "Something went wrong signing you in. Please try again." };
    }
    // NextAuth signals a successful sign-in redirect by throwing — let it propagate.
    throw error;
  }
}
