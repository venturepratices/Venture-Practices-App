/**
 * Errors from the HighLevel sync, and the plain-language text shown for each.
 *
 * The "Sync now" button used to answer every failure with "the token may have
 * been revoked", which hid the real cause. A missing permission, a wrong
 * Location ID and a revoked token need different fixes, so each gets its own
 * sentence here. Nothing HighLevel sent back is echoed to the screen: the
 * sentence is chosen from the status number alone.
 */

/** HighLevel answered a request with a non-2xx status. */
export class HighLevelApiError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`HighLevel API ${status}: ${detail.slice(0, 300)}`);
    this.name = "HighLevelApiError";
    this.status = status;
  }
}

/** The token saved for a client could not be decrypted (for example the encryption key changed). */
export class HighLevelTokenUnreadableError extends Error {
  constructor() {
    super("The saved HighLevel token could not be decrypted");
    this.name = "HighLevelTokenUnreadableError";
  }
}

export const HIGHLEVEL_TOKEN_SCOPES = [
  "conversations.readonly",
  "conversations/message.readonly",
  "locations.readonly",
] as const;

/** One plain sentence (or two) saying what went wrong and what to do about it. */
export function describeSyncError(error: unknown): string {
  if (error instanceof HighLevelTokenUnreadableError) {
    return "The saved token could not be read, so nothing was sent to HighLevel. Save the token again on the Info tab.";
  }
  if (error instanceof HighLevelApiError) {
    const { status } = error;
    if (status === 401) {
      return "HighLevel refused the token (401). Copy the whole Private Integration Token again, save it on the Info tab, then press Sync now.";
    }
    if (status === 403) {
      return `HighLevel blocked this token (403). The token needs these permissions: ${HIGHLEVEL_TOKEN_SCOPES.join(", ")}. Turn them on in HighLevel, then save the token again.`;
    }
    if (status === 404 || status === 422) {
      return `HighLevel could not find that location (${status}). Check that the Location ID saved for this client is the one the token was made in.`;
    }
    if (status === 429) {
      return "HighLevel is limiting requests right now (429). Wait a minute, then press Sync now.";
    }
    if (status >= 500) {
      return `HighLevel is having trouble (${status}). Try again in a few minutes.`;
    }
    return `HighLevel answered with status ${status}. Try again, and tell an admin if it keeps happening.`;
  }
  return "Sync failed for an unexpected reason. It has been recorded for the team.";
}

/** The note shown when one part of the sync worked and the other did not. */
export function describeSyncWarning(part: "calls" | "messages", error: unknown): string {
  const lead =
    part === "messages"
      ? "Calls were saved, but message history was skipped."
      : "Messages were saved, but call details were skipped.";
  return `${lead} ${describeSyncError(error)}`;
}
