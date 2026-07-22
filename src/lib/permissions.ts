import { cache } from "react";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { CAPABILITIES, type Capability } from "@/lib/permission-catalog";
import { prisma } from "@/lib/prisma";

export { CAPABILITIES, type Capability };

/**
 * Central access-control helper. Two roles: Admin (bypasses everything,
 * including granting other people admin/permissions) and Member, gated by
 * ~22 granular per-feature capabilities + the ClientAccess join (WHICH
 * clients — a separate axis from WHAT actions). See the "Access management /
 * permissions" plan.
 *
 * Deliberately NOT auto-granted: every capability defaults false and stays
 * false until an admin explicitly checks it for that person, every time —
 * there's no "grandfathering" when a new capability is introduced.
 *
 * Authoritative permission data is read FRESH from the DB on every request
 * (wrapped in React cache() so it's a single query per request), deliberately
 * NOT threaded through the JWT — a JWT claim only refreshes at login, which
 * would let a revoked permission linger. Reading fresh means revoking access
 * (a client grant or a capability) takes effect on the user's very next action.
 */

export type Permissions = {
  userId: string;
  isAdmin: boolean;
  allClientsAccess: boolean;
  caps: Record<Capability, boolean>;
  clientIds: Set<string>;
};

/** Thrown by the require* helpers; carries the HTTP status a route should return. */
export class PermissionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PermissionError";
    this.status = status;
  }
}

/** Loads the current user's permissions fresh from the DB (deduped per request). */
export const loadPermissions = cache(async (): Promise<Permissions | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const member = await prisma.teamMember.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isAdmin: true,
      allClientsAccess: true,
      clientAccess: { select: { clientId: true } },
      canCreateClients: true,
      canEditClients: true,
      canDeleteClients: true,
      canCreateTasks: true,
      canEditTasks: true,
      canDeleteTasks: true,
      canCommentOnTasks: true,
      canManageTaskLinks: true,
      canCreateClientNotes: true,
      canEditClientNotes: true,
      canDeleteClientNotes: true,
      canCreateMeetingNotes: true,
      canDeleteMeetingNotes: true,
      canManageClientLinks: true,
      canViewCredentials: true,
      canManageCredentials: true,
      canRevealCredentials: true,
      canViewConversations: true,
      canManageHighLevel: true,
      canViewActivity: true,
      canViewArchive: true,
      canRestoreArchive: true,
      canViewAssets: true,
      canUploadAssets: true,
      canCommentOnAssets: true,
      canDecideOnAssets: true,
      canManageAssetReviewers: true,
      canShareAssetsExternally: true,
      canDeleteAssets: true,
    },
  });
  if (!member) return null;

  const caps = Object.fromEntries(CAPABILITIES.map((cap) => [cap, member[cap]])) as Record<Capability, boolean>;

  return {
    userId: member.id,
    isAdmin: member.isAdmin,
    allClientsAccess: member.allClientsAccess,
    caps,
    clientIds: new Set(member.clientAccess.map((c) => c.clientId)),
  };
});

function hasCapability(p: Permissions, cap: Capability): boolean {
  return p.isAdmin || p.caps[cap];
}

function hasClientAccess(p: Permissions, clientId: string): boolean {
  return p.isAdmin || p.allClientsAccess || p.clientIds.has(clientId);
}

// --- Boolean variants: for server components / conditional UI. ---

export async function getPermissions(): Promise<Permissions | null> {
  return loadPermissions();
}

export async function isAdmin(): Promise<boolean> {
  const p = await loadPermissions();
  return !!p?.isAdmin;
}

export async function canAccessClient(clientId: string): Promise<boolean> {
  const p = await loadPermissions();
  return p ? hasClientAccess(p, clientId) : false;
}

export async function canUseCapability(cap: Capability): Promise<boolean> {
  const p = await loadPermissions();
  return p ? hasCapability(p, cap) : false;
}

// --- Throwing variants: for API routes and server actions. ---

export async function requireUser(): Promise<Permissions> {
  const p = await loadPermissions();
  if (!p) throw new PermissionError(401, "You need to be signed in.");
  return p;
}

export async function requireAdmin(): Promise<Permissions> {
  const p = await requireUser();
  if (!p.isAdmin) throw new PermissionError(403, "This action is for admins only.");
  return p;
}

export async function requireCapability(cap: Capability): Promise<Permissions> {
  const p = await requireUser();
  if (!hasCapability(p, cap)) throw new PermissionError(403, "You don't have access to this.");
  return p;
}

export async function requireClientAccess(clientId: string): Promise<Permissions> {
  const p = await requireUser();
  if (!hasClientAccess(p, clientId)) {
    throw new PermissionError(403, "You don't have access to this client.");
  }
  return p;
}

/**
 * Prisma `where` fragment to scope a list query to the caller's accessible
 * clients. `field` is the column holding the client id on the queried model
 * ("id" for Client itself, "clientId" for related models). Returns `{}` for
 * admins / all-access (unscoped), and an impossible filter if not signed in.
 */
export async function accessibleClientFilter(
  field: "id" | "clientId" = "id"
): Promise<Record<string, unknown>> {
  const p = await loadPermissions();
  if (!p) return { [field]: { in: [] as string[] } };
  if (p.isAdmin || p.allClientsAccess) return {};
  return { [field]: { in: [...p.clientIds] } };
}

/** Map a thrown PermissionError to a JSON response; rethrow anything else. */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof PermissionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}
