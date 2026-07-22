import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_SECONDS = THIRTY_DAYS_MS / 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    // Credentials provider only supports JWT sessions (Auth.js throws
    // UnsupportedStrategy for "database" here). 30 days is the outer ceiling;
    // the real "remember me" logic lives in the jwt callback below.
    strategy: "jwt",
    maxAge: THIRTY_DAYS_SECONDS,
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        remember: { label: "Remember me", type: "text" },
      },
      // Checks TeamMember (agency staff) first, then ClientUser (a real
      // client-login account, Slice 4b) — one login page serves both, since
      // email uniqueness is enforced across both tables independently and a
      // real account only ever exists in one of them.
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }
        const remember = credentials?.remember === "true";

        const member = await prisma.teamMember.findUnique({ where: { email } });
        if (member) {
          const passwordMatches = await bcrypt.compare(password, member.passwordHash);
          if (!passwordMatches) return null;
          return {
            id: member.id,
            name: member.name,
            email: member.email,
            role: member.role,
            isAdmin: member.isAdmin,
            mustChangePassword: member.mustChangePassword,
            isClientUser: false,
            remember,
          };
        }

        const clientUser = await prisma.clientUser.findUnique({ where: { email } });
        if (clientUser) {
          const passwordMatches = await bcrypt.compare(password, clientUser.passwordHash);
          if (!passwordMatches) return null;
          return {
            id: clientUser.id,
            name: clientUser.name,
            email: clientUser.email,
            mustChangePassword: clientUser.mustChangePassword,
            isClientUser: true,
            clientId: clientUser.clientId,
            remember,
          };
        }

        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Fresh sign-in: stamp the effective session lifetime based on "remember me".
        const remember = Boolean((user as { remember?: boolean }).remember);
        token.role = (user as { role?: string }).role;
        token.isAdmin = (user as { isAdmin?: boolean }).isAdmin;
        token.mustChangePassword = (user as { mustChangePassword?: boolean }).mustChangePassword;
        token.isClientUser = Boolean((user as { isClientUser?: boolean }).isClientUser);
        token.clientId = (user as { clientId?: string }).clientId;
        token.absoluteExpires = Date.now() + (remember ? THIRTY_DAYS_MS : EIGHT_HOURS_MS);
        return token;
      }

      // Every subsequent request: if we're past the remembered/non-remembered
      // window, invalidate the session even though the outer cookie (set to a
      // flat 30-day maxAge) hasn't expired yet. Returning null here is Auth.js's
      // documented way to invalidate a JWT session.
      const absoluteExpires = token.absoluteExpires as number | undefined;
      if (typeof absoluteExpires === "number" && Date.now() > absoluteExpires) {
        return null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        (session.user as { role?: string }).role = token.role as string | undefined;
        (session.user as { isAdmin?: boolean }).isAdmin = token.isAdmin as boolean | undefined;
        session.user.mustChangePassword = token.mustChangePassword as boolean | undefined;
        session.user.isClientUser = token.isClientUser as boolean | undefined;
        session.user.clientId = token.clientId as string | undefined;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
