// Client-safe catalog of every granular permission, grouped for the Team
// admin UI. `src/lib/permissions.ts` (server-only enforcement, imports auth +
// prisma) and this file's consumers (including client components) both need
// the same list of capability keys — this file has NO server imports, so it's
// safe to import from "use client" components, unlike permissions.ts itself.

export const PERMISSION_GROUPS = [
  {
    title: "Clients",
    items: [
      { key: "canCreateClients", label: "Create clients" },
      { key: "canEditClients", label: "Edit client info" },
      { key: "canDeleteClients", label: "Delete clients" },
    ],
  },
  {
    title: "Tasks",
    items: [
      { key: "canCreateTasks", label: "Create tasks" },
      { key: "canEditTasks", label: "Edit tasks" },
      { key: "canDeleteTasks", label: "Delete tasks (archive)" },
      { key: "canCommentOnTasks", label: "Comment on tasks" },
      { key: "canManageTaskLinks", label: "Manage task links" },
    ],
  },
  {
    title: "Client Notes",
    items: [
      { key: "canCreateClientNotes", label: "Add notes" },
      { key: "canEditClientNotes", label: "Edit notes" },
      { key: "canDeleteClientNotes", label: "Delete notes" },
    ],
  },
  {
    title: "Meeting Notes",
    items: [
      { key: "canCreateMeetingNotes", label: "Add meeting notes" },
      { key: "canDeleteMeetingNotes", label: "Delete meeting notes" },
    ],
  },
  {
    title: "Client Links",
    items: [{ key: "canManageClientLinks", label: "Manage client links (add/remove)" }],
  },
  {
    title: "Credentials Vault",
    items: [
      { key: "canViewCredentials", label: "View credential list" },
      { key: "canManageCredentials", label: "Add / edit / delete credentials" },
      { key: "canRevealCredentials", label: "Reveal passwords" },
    ],
  },
  {
    title: "HighLevel Conversations & Calls",
    items: [
      { key: "canViewConversations", label: "View conversations & calls" },
      { key: "canManageHighLevel", label: "Connect / manage HighLevel" },
    ],
  },
  {
    title: "Activity & Archive",
    items: [
      { key: "canViewActivity", label: "View activity log" },
      { key: "canViewArchive", label: "View archive" },
      { key: "canRestoreArchive", label: "Restore archived tasks" },
    ],
  },
  {
    title: "Assets (review & approval)",
    items: [
      { key: "canViewAssets", label: "View assets" },
      { key: "canUploadAssets", label: "Upload assets / new versions" },
      { key: "canCommentOnAssets", label: "Comment on assets" },
      { key: "canDecideOnAssets", label: "Approve / request changes" },
      { key: "canManageAssetReviewers", label: "Manage reviewers" },
      { key: "canShareAssetsExternally", label: "Share externally (public link)" },
      { key: "canDeleteAssets", label: "Delete assets" },
      { key: "canManageClientUsers", label: "Manage client login accounts" },
    ],
  },
] as const;

export const CAPABILITIES = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));

export type Capability = (typeof CAPABILITIES)[number];

/**
 * "Full member access" quick-select preset for the Team admin UI — the
 * day-to-day work capabilities, excluding destructive/sensitive ones (client
 * delete, the credentials vault, HighLevel management, activity/archive)
 * which an admin grants individually, deliberately, per person.
 */
export const BASIC_MEMBER_CAPABILITIES: Capability[] = [
  "canCreateClients",
  "canEditClients",
  "canCreateTasks",
  "canEditTasks",
  "canDeleteTasks",
  "canCommentOnTasks",
  "canManageTaskLinks",
  "canCreateClientNotes",
  "canEditClientNotes",
  "canDeleteClientNotes",
  "canCreateMeetingNotes",
  "canDeleteMeetingNotes",
  "canManageClientLinks",
  // Assets — day-to-day work capabilities included in the preset. The more
  // sensitive canManageAssetReviewers / canShareAssetsExternally / canDeleteAssets
  // are left off and granted deliberately.
  "canViewAssets",
  "canUploadAssets",
  "canCommentOnAssets",
  "canDecideOnAssets",
];
