import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";
  const isChangePasswordPage = req.nextUrl.pathname === "/change-password";

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }
  // An admin-issued temporary password is single-use in spirit: block every
  // other page until the person sets their own new password.
  if (isLoggedIn && req.auth?.user?.mustChangePassword && !isChangePasswordPage) {
    return NextResponse.redirect(new URL("/change-password", req.nextUrl));
  }
});

export const config = {
  // /review/* is the public, tokenized guest review surface (Slice 4a) — it
  // must never hit this auth gate. Its own routes/pages enforce access purely
  // via the share-link token, independent of any TeamMember session.
  matcher: ["/((?!api|review|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg)$).*)"],
};
