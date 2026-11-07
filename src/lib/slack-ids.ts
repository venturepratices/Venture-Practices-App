/**
 * The shapes of the Slack IDs people can type into the app. Slack IDs are a
 * letter that says what they are, then upper-case letters and digits: 9 or
 * 11 characters today, kept to 20 here to match the database fields' limit.
 * Safe to import from client components (no server imports).
 */

/** A person: U, or W for Enterprise Grid accounts. */
export const SLACK_MEMBER_ID_PATTERN = /^[UW][A-Z0-9]{8,19}$/;

/** A channel: C for a channel, G for an older private channel. */
export const SLACK_CHANNEL_ID_PATTERN = /^[CG][A-Z0-9]{8,19}$/;
