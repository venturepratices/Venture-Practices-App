import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role?: string;
      isAdmin?: boolean;
      mustChangePassword?: boolean;
      /** True for a real client-login account (Slice 4b) rather than agency TeamMember staff. */
      isClientUser?: boolean;
      /** Only set when isClientUser is true — the one client this account may ever access. */
      clientId?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    isAdmin?: boolean;
    mustChangePassword?: boolean;
    isClientUser?: boolean;
    clientId?: string;
    absoluteExpires?: number;
  }
}
