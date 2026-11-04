import { notFound, redirect } from "next/navigation";

import { PermissionError } from "@/lib/permissions";
import { requireSalesUser, type SalesActor } from "@/lib/sales/access";

/**
 * The gate every Sales page (and the Sales layout) runs first. Pages answer a
 * plain 404 to people without Sales access, so the area's existence is not
 * confirmed (Decision 22); signed-out visitors go to the login page. Routes
 * keep requireSalesUser's 403. Layouts do not re-run on navigation, so every
 * page calls this itself too.
 */
export async function requireSalesPage(): Promise<SalesActor> {
  try {
    return await requireSalesUser();
  } catch (error) {
    // notFound() and redirect() throw, so they sit in the catch, not the try.
    if (error instanceof PermissionError && error.status === 403) notFound();
    if (error instanceof PermissionError && error.status === 401) redirect("/login");
    throw error;
  }
}
