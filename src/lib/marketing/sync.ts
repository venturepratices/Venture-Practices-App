/**
 * Sync status model for Marketing > Sync.
 *
 * This is a READ-ONLY view of how each follow-up sequence is wired across
 * our three systems: NitroSend (flow + list), HighLevel (segment + workflow),
 * and the local database (campaign row). Nothing in this file writes to any
 * of those systems — later PRs that add writes must go through a separate
 * action-logging path (see audit.ts).
 *
 * Today the connection data comes from the same hand-maintained SEQUENCES
 * array as the Follow-up system page. A later PR swaps `getSyncRows` for a
 * live multi-source fetch (NitroSend HTTP + GHL MCP) without touching the
 * view layer.
 */

import type { Brand, Sequence, SequenceKey, SequenceStatus } from "./sequences";

/** Where a piece of sync information came from. */
export type SyncSource = "nitrosend" | "highlevel" | "app" | "snapshot";

/**
 * Health of ONE integration link. "in-sync" means both sides exist and agree;
 * "mismatch" means both sides exist but names/counts diverge; "pending" means
 * one side exists and the other is still being wired; "not-connected" means
 * nothing on either side; "not-wired" means the integration itself is not
 * live yet (e.g. GHL workflow not published). Keep the five values closed —
 * UI tiles switch on them exhaustively.
 */
export type SyncHealth =
  | "in-sync"
  | "mismatch"
  | "pending"
  | "not-connected"
  | "not-wired";

/** Human-readable label for a SyncHealth. Used by HealthDot and tooltips. */
export const SYNC_HEALTH_LABEL: Record<SyncHealth, string> = {
  "in-sync": "In sync",
  mismatch: "Mismatch",
  pending: "Pending",
  "not-connected": "Not connected",
  "not-wired": "Not wired yet",
};

/** Short explanation shown beneath the status in the row and in the tooltip. */
export const SYNC_HEALTH_REASON: Record<SyncHealth, string> = {
  "in-sync": "Both sides match on the latest snapshot.",
  mismatch: "Both sides exist but something differs (name, list ID, counts).",
  pending: "One side exists, the other has not been wired yet.",
  "not-connected": "Neither NitroSend nor HighLevel has this piece.",
  "not-wired":
    "This integration is not live yet. Hooked up once the piece on the other end is live.",
};

/**
 * One link in a sequence's integration row. A sequence row has several of
 * these (NitroSend flow, NitroSend list, GHL segment, GHL appointment
 * workflow). Keeping them typed lets the UI render them uniformly.
 */
export interface SyncLink {
  /** Stable key for React lists + aria-labels. */
  key:
    | "nitro-flow"
    | "nitro-list"
    | "ghl-segment"
    | "ghl-workflow"
    | "app-campaign";
  label: string;
  /** Human-friendly current value, e.g. "LIST_abc123" or "not configured". */
  value: string;
  source: SyncSource;
  health: SyncHealth;
  /**
   * External link to open the thing in its native system, or null when there
   * is nowhere to go (e.g. the piece does not exist yet). Every URL rendered
   * from this field must go through `safeExternalHref` before being used.
   */
  externalUrl: string | null;
}

export interface SyncRow {
  key: SequenceKey;
  displayName: string;
  brand: Brand;
  status: SequenceStatus;
  /** Roll-up status across the row's links — worst wins. */
  rollup: SyncHealth;
  /** ISO timestamp of the snapshot the row was computed from. Null when unknown. */
  lastSnapshotAt: string | null;
  links: SyncLink[];
}

/**
 * Worst health in a set of links. "not-wired" is excluded from the roll-up
 * because an integration that is not live yet should not drag an otherwise
 * in-sync row red.
 */
export function rollupHealth(links: SyncLink[]): SyncHealth {
  const ORDER: SyncHealth[] = [
    "mismatch",
    "not-connected",
    "pending",
    "in-sync",
    "not-wired",
  ];
  const seen = new Set(links.map((l) => l.health));
  for (const h of ORDER) {
    if (seen.has(h)) return h;
  }
  return "not-wired";
}

/**
 * External URL guard. Returns the URL only if it is an http(s) URL on an
 * allow-listed host. Anything else collapses to null so a bad entry in the
 * hand-maintained SEQUENCES table can never cause a `javascript:` or
 * `data:` link to render in the UI.
 */
const ALLOWED_EXTERNAL_HOSTS = new Set<string>([
  "app.nitrosend.com",
  "app.gohighlevel.com",
  "app.highlevel.com",
]);

export function safeExternalHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (!ALLOWED_EXTERNAL_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const NITRO_FLOW_BASE = "https://app.nitrosend.com/my/flows";
const NITRO_LIST_BASE = "https://app.nitrosend.com/my/audience";
const GHL_BASE = "https://app.gohighlevel.com";

function nitroFlowLink(flowId: string): string | null {
  if (!flowId || flowId === "not built") return null;
  return safeExternalHref(`${NITRO_FLOW_BASE}/${flowId}`);
}

function nitroListLink(listId: string | undefined): string | null {
  if (!listId) return null;
  return safeExternalHref(`${NITRO_LIST_BASE}/${listId}`);
}

function ghlWorkflowLink(workflowId: string | undefined): string | null {
  if (!workflowId) return null;
  return safeExternalHref(`${GHL_BASE}/v2/location/workflows/${workflowId}`);
}

/**
 * Build one sync row from a sequence. Pure: no I/O, no clock, no secrets.
 * A later PR will add a parallel `fetchLiveSyncRow(sequence)` that reads
 * NitroSend + GHL live and compares to this snapshot — the view layer will
 * not care which one it got.
 */
export function buildSnapshotRow(s: Sequence): SyncRow {
  const flowHealth: SyncHealth =
    s.flowId === "not built"
      ? "not-connected"
      : s.status === "active"
        ? "in-sync"
        : "pending";

  const listHealth: SyncHealth =
    s.listId && s.listName ? "in-sync" : s.listId || s.listName ? "mismatch" : "not-connected";

  const segmentHealth: SyncHealth = s.ghlSegment ? "in-sync" : "not-connected";
  const workflowHealth: SyncHealth = s.ghlWorkflowId ? "in-sync" : "not-wired";

  const links: SyncLink[] = [
    {
      key: "nitro-flow",
      label: "NitroSend flow",
      value: s.flowId === "not built" ? "Not built yet" : s.flowId,
      source: "nitrosend",
      health: flowHealth,
      externalUrl: nitroFlowLink(s.flowId),
    },
    {
      key: "nitro-list",
      label: "NitroSend list",
      value: s.listName ?? s.listId ?? "Not configured",
      source: "nitrosend",
      health: listHealth,
      externalUrl: nitroListLink(s.listId),
    },
    {
      key: "ghl-segment",
      label: "HighLevel segment",
      value: s.ghlSegment ?? "Not tagged",
      source: "highlevel",
      health: segmentHealth,
      externalUrl: null,
    },
    {
      key: "ghl-workflow",
      label: "HighLevel workflow",
      value: s.ghlWorkflowId ?? "Not wired",
      source: "highlevel",
      health: workflowHealth,
      externalUrl: ghlWorkflowLink(s.ghlWorkflowId),
    },
  ];

  return {
    key: s.key,
    displayName: s.displayName,
    brand: s.brand,
    status: s.status,
    rollup: rollupHealth(links),
    lastSnapshotAt: null,
    links,
  };
}

/**
 * Build the full set of rows from the hand-maintained sequences. Later PR
 * swaps this for an async multi-source fetch; the signature stays the same.
 */
export function buildSnapshotRows(
  sequences: Record<SequenceKey, Sequence>,
): SyncRow[] {
  return (Object.values(sequences) as Sequence[]).map(buildSnapshotRow);
}

/**
 * Top-level sync summary for the page header. One count per health, plus the
 * single worst roll-up across every row (used for the page banner tone).
 */
export interface SyncSummary {
  total: number;
  counts: Record<SyncHealth, number>;
  worst: SyncHealth;
}

export function summarize(rows: SyncRow[]): SyncSummary {
  const counts: Record<SyncHealth, number> = {
    "in-sync": 0,
    mismatch: 0,
    pending: 0,
    "not-connected": 0,
    "not-wired": 0,
  };
  for (const r of rows) counts[r.rollup]++;
  const ORDER: SyncHealth[] = [
    "mismatch",
    "not-connected",
    "pending",
    "in-sync",
    "not-wired",
  ];
  const worst = ORDER.find((h) => counts[h] > 0) ?? "not-wired";
  return { total: rows.length, counts, worst };
}
