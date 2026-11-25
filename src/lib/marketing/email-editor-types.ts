/**
 * Shared contract for the inline email editor.
 *
 * Four pieces hang off these types:
 *   - the NitroSend HTTP client (nitro-client.ts) that reads/writes drafts
 *   - the text diff helper (email-diff.ts) that produces segments to render
 *   - the server actions (follow-up-system/actions.ts) that enforce
 *     permission, write the audit row, and call the client
 *   - the email modal UI (email-modal.tsx) that drives the read → edit →
 *     review → saved flow
 *
 * Changing this file changes all four. Keep it narrow.
 */

export interface EmailDraft {
  subject: string;
  body: string;
}

export interface NitroEmailContent extends EmailDraft {
  flowId: string;
  /** Index of the step within sequence.steps (matches EmailModal's stepIndex). */
  stepIndex: number;
  /** ISO 8601 timestamp of the last Draft save, if known. */
  updatedAt?: string;
}

export interface SaveDraftInput {
  flowId: string;
  stepIndex: number;
  /** The content the user started from. Used for the audit row. */
  before: EmailDraft;
  /** The content the user wants to save. */
  after: EmailDraft;
  /**
   * Set true when the user has reviewed the dropped-variable warning and
   * still wants to save. Without it, a save that drops a merge tag returns
   * `needsConfirmation: true` instead of writing.
   */
  confirmedDrop?: boolean;
}

/**
 * Discriminated error kinds. The UI maps each to a human message; no code
 * reads the raw `message` text as an instruction.
 */
export type SaveDraftErrorKind =
  | "missing_key"
  | "unauthorized"
  | "forbidden"
  | "api_unreachable"
  | "rate_limited"
  | "flow_not_found"
  | "unknown";

export interface SaveDraftError {
  kind: SaveDraftErrorKind;
  message: string;
}

export interface SaveDraftResult {
  ok: boolean;
  /** Fresh `updatedAt` from NitroSend on a successful save. */
  updatedAt?: string;
  /**
   * Merge tags present in `before` but missing from `after`. Non-empty when
   * `ok` is false and `needsConfirmation` is true, or as an informational
   * field after a confirmed save.
   */
  droppedVariables?: string[];
  /**
   * True when the server refused the save because variables were dropped
   * and the user has not confirmed. UI should re-prompt and pass
   * `confirmedDrop: true` on the retry.
   */
  needsConfirmation?: boolean;
  error?: SaveDraftError;
}

export interface FetchDraftResult {
  ok: boolean;
  content?: NitroEmailContent;
  error?: SaveDraftError;
}

/* ---------------- diff ---------------- */

export type DiffSegmentType = "same" | "add" | "del";

export interface DiffSegment {
  type: DiffSegmentType;
  text: string;
}

export interface EmailDiff {
  subject: DiffSegment[];
  body: DiffSegment[];
  /** True when at least one segment in either field is add or del. */
  changed: boolean;
  /** Merge tags in `before` but missing from `after`. */
  droppedVariables: string[];
}
