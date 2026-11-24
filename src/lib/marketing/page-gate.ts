import { notFound, redirect } from "next/navigation";

import { requireMarketingUser, type MarketingActor } from "@/lib/marketing/access";
import { PermissionError } from "@/lib/permissions";

/**
 * The gate every Marketing page (and the Marketing layout) runs first. People
 * without access get a plain 404, signed-out visitors go to the login page.
 * Layouts do not re-run on navigation, so every page calls this itself too.
 */
export async function requireMarketingPage(): Promise<MarketingActor> {
  try {
    return await requireMarketingUser();
  } catch (error) {
    // notFound() and redirect() throw, so they sit in the catch, not the try.
    if (error instanceof PermissionError && error.status === 403) notFound();
    if (error instanceof PermissionError && error.status === 401) redirect("/login");
    throw error;
  }
}
