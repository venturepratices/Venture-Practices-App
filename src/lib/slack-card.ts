import type { NotificationTier } from "@/lib/notification-tier";

/**
 * Builds Slack Block Kit "cards" instead of the flat mrkdwn paragraphs this
 * app sent originally.
 *
 * The problem being solved is specifically visual, not editorial: Slack hides
 * the sender's name and avatar on every message that follows another from the
 * same sender, so several notifications arriving together ran into each other
 * with nothing separating one message's detail lines from the next one's
 * headline. Every message also had an identical shape (emoji, bold line,
 * bullets, link), so an overdue task looked exactly like a new comment.
 *
 * A coloured attachment stripe plus a divider and a two-column field grid
 * gives each message a visible boundary and a distinguishable silhouette even
 * when Slack collapses the author line.
 *
 * Deliberately limited to primitives Slack actually renders — there is no
 * underline, no coloured or resized text (colour only exists as the
 * attachment stripe), no bold inside a `header` block, no tables and no
 * nested lists, so none of those are offered here.
 */

export type SlackCardField = { label: string; value: string };

export type SlackCard = {
  /**
   * Small muted line ABOVE the headline — "Task · Status changed", "Project ·
   * You're up next" — so the card answers "what kind of notification is
   * this" before the reader has parsed the headline's wording at all.
   */
  kicker?: string | null;
  /** Bold label on the first line — the *kind* of event ("Task assigned to you"). */
  headline: string;
  /** The thing itself, plain, on the second line — usually a task/asset title. */
  subject?: string | null;
  /**
   * Label prefixed onto `subject` ("Task:", "Campaign:") so a bare name never
   * appears with nothing saying what it is. Defaults to "What" when a subject
   * is set but no more specific label was supplied.
   */
  subjectLabel?: string | null;
  /** Rendered as a two-column labelled grid. Slack caps this at 10; extras are dropped. */
  fields?: SlackCardField[];
  /** Rendered as a bullet list — alongside `fields` when both are present, not instead of. */
  bullets?: string[];
  /** Small muted line under the details — a comment excerpt, a caveat. */
  context?: string | null;
  /** Both must be set for a button to render. */
  buttonLabel?: string | null;
  buttonUrl?: string | null;
  color: string;
  /** Prefixed to the headline. Only worth spending on genuinely urgent events. */
  emoji?: string | null;
};

/** Stripe colour per tier — the app's own coral/teal, with slate for low-signal Ambient rows. */
export const TIER_COLOR: Record<NotificationTier, string> = {
  CRITICAL: "#f16857",
  IMPORTANT: "#2d94c0",
  AMBIENT: "#7d8994",
};

/** Team-facing channel broadcasts share one colour regardless of the underlying event's urgency. */
export const CHANNEL_COLOR = "#2d94c0";

/** Slack renders at most 10 fields in a section, and truncates long field text outright. */
const MAX_FIELDS = 10;
const MAX_FIELD_CHARS = 300;
// How long a single detail line can run and still count as a grid cell
// rather than a full sentence — kept generous so genuinely informative lines
// (e.g. "Backup storage: 5 MB across 3 snapshots (oldest: 2026-08-01)") land
// in the scannable grid instead of getting relegated to a bullet.
const FIELD_VALUE_MAX = 160;

function truncate(value: string, max: number): string {
  const clean = value.trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Escapes the three characters Slack treats as markup control characters.
 * User-authored strings (task titles, client names, comment excerpts) flow
 * into these messages, so an unescaped `<` would silently swallow the rest of
 * a line as a malformed link.
 */
function escapeSlack(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type SlackBlock = Record<string, unknown>;

export function buildSlackCard(card: SlackCard): {
  attachments: { color: string; blocks: SlackBlock[]; fallback: string }[];
} {
  const emoji = card.emoji ? `${card.emoji} ` : "";
  const headline = `${emoji}${escapeSlack(card.headline)}`;

  const blocks: SlackBlock[] = [];

  // An opening rule mirrors the closing one at the bottom of the card, so
  // every notification is visually bookended — a line marks where it starts,
  // a line marks where it ends — instead of relying on the colored stripe
  // alone to signal a new message has begun.
  blocks.push({ type: "divider" });

  if (card.kicker) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: escapeSlack(truncate(card.kicker, 100)) }],
    });
  }

  // Headline and subject share one section so Slack keeps them tight
  // together — as separate blocks it inserts a gap that reads as if they
  // were unrelated lines. The subject itself always carries a label
  // ("Task:", "Campaign:") so a bare name is never dropped in with no
  // indication of what it is — the exact complaint that led to this field
  // existing.
  const subjectLabel = card.subjectLabel ?? "What";
  const lead = card.subject
    ? `*${headline}*\n*${escapeSlack(subjectLabel)}:* ${escapeSlack(card.subject)}`
    : `*${headline}*`;
  blocks.push({ type: "section", text: { type: "mrkdwn", text: lead } });

  const fields = (card.fields ?? []).filter((f) => f.value.trim().length > 0).slice(0, MAX_FIELDS);
  const bullets = (card.bullets ?? []).filter((b) => b.trim().length > 0);

  if (fields.length > 0 || bullets.length > 0) {
    blocks.push({ type: "divider" });
  }
  if (fields.length > 0) {
    blocks.push({
      type: "section",
      fields: fields.map((f) => ({
        type: "mrkdwn",
        text: `*${escapeSlack(truncate(f.label, 60))}*\n${escapeSlack(truncate(f.value, MAX_FIELD_CHARS))}`,
      })),
    });
  }
  if (bullets.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: bullets.map((b) => `• ${escapeSlack(b)}`).join("\n") },
    });
  }

  if (card.context) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: escapeSlack(truncate(card.context, 400)) }],
    });
  }

  if (card.buttonLabel && card.buttonUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: truncate(card.buttonLabel, 75), emoji: false },
          url: card.buttonUrl,
        },
      ],
    });
  }

  // A closing rule at the very bottom of every card. Slack has no way to draw
  // a line BETWEEN two separate messages (each notification is its own
  // chat.postMessage call) — the closest real equivalent is making every
  // card visibly close itself out, so consecutive DMs read as a stack of
  // distinct sealed boxes instead of one continuous colored column.
  blocks.push({ type: "divider" });

  // Deliberately no top-level `text` alongside `attachments` — Slack renders
  // that as a separate plain line ABOVE the coloured card, which is exactly
  // the "why does this look like two things" problem this format exists to
  // fix. `fallback` still gives Slack something to show in mobile push
  // previews and screen readers; chat.postMessage doesn't require top-level
  // `text` once `attachments` is present.
  const preview = card.subject ? `${headline} — ${escapeSlack(card.subject)}` : headline;

  return {
    attachments: [{ color: card.color, blocks, fallback: preview }],
  };
}

// A label short enough to be a real field name, paired with a value short
// enough to sit in a grid cell rather than needing to read as a sentence —
// e.g. `Client: Journey Smiles` or `Now: In Progress`, not `Assigned by DJ`
// (no colon, stays a bullet) or a multi-clause sentence that happens to
// contain a colon (excluded by the value-length cap below).
const FIELD_LINE = new RegExp(`^([A-Za-z][\\w /()'-]{1,24}):\\s*(.{1,${FIELD_VALUE_MAX}})$`);

/**
 * Every existing notify()/notifyChannel() call site already writes a
 * `title`/`lines` pair as flat strings — this splits that same content into
 * a card's headline/subject and fields/bullets, so all ~30 call sites across
 * the app upgrade to the boxed-card look with no changes to any of them.
 * Call sites that want more control can pass explicit headline/subject/fields
 * instead, which this only fills gaps for (see notify.ts).
 */
export function deriveCardFromLegacy(title: string, lines: string[] | undefined) {
  // Titles are always single-line, so plain `.` (no dotAll flag) is fine here.
  const quoted = title.match(/^(.+?):\s*"(.*)"$/);
  const plain = quoted ? null : title.match(/^(.{2,40}?):\s*(.+)$/);
  const headline = quoted?.[1] ?? plain?.[1] ?? title;
  const subject = quoted?.[2] ?? plain?.[2] ?? null;

  const fields: SlackCardField[] = [];
  const bullets: string[] = [];
  for (const line of lines ?? []) {
    const match = line.match(FIELD_LINE);
    if (match) {
      fields.push({ label: match[1], value: match[2] });
    } else {
      bullets.push(line);
    }
  }

  return { headline, subject, fields, bullets };
}
