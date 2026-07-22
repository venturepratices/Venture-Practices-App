import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isClientUser = !!req.auth?.user?.isClientUser;
  const isLoginPage = req.nextUrl.pathname === "/login";
  const isChangePasswordPage = req.nextUrl.pathname === "/change-password";
  const isPortalPath = req.nextUrl.pathname.startsWith("/portal");

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL(isClientUser ? "/portal" : "/dashboard", req.nextUrl));
  }
  // An admin-issued temporary password is single-use in spirit: block every
  // other page until the person sets their own new password.
  if (isLoggedIn && req.auth?.user?.mustChangePassword && !isChangePasswordPage) {
    return NextResponse.redirect(new URL("/change-password", req.nextUrl));
  }
  // Client-login accounts (Slice 4b) get a completely separate, much smaller
  // shell — they must never reach the agency's internal (app) routes, and
  // staff have no reason to be in the client shell either.
  if (isLoggedIn && !isChangePasswordPage) {
    if (isClientUser && !isPortalPath) {
      return NextResponse.redirect(new URL("/portal", req.nextUrl));
    }
    if (!isClientUser && isPortalPath) {
      return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
    }
  }
});

export const config = {
  // /review/* is the public, tokenized guest review surface (Slice 4a) — it
  // must never hit this auth gate. Its own routes/pages enforce access purely
  // via the share-link token, independent of any TeamMember session.
  matcher: ["/((?!api|review|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg)$).*)"],
};
