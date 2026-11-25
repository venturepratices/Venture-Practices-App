import type {
  DiffSegment,
  EmailDiff,
  EmailDraft,
} from "./email-editor-types";

// Split after each newline so every line keeps its own "\n" (pre-wrap safe).
function splitLines(text: string): string[] {
  return text === "" ? [] : text.split(/(?<=\n)/);
}

/**
 * Line-based diff via longest-common-subsequence DP. Emails are small, so the
 * O(n*m) table is fine. On ties a removal is emitted before an addition so a
 * replaced block reads as del-then-add.
 */
export function diffText(before: string, after: string): DiffSegment[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "del", text: a[i++] });
    } else {
      out.push({ type: "add", text: b[j++] });
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}

// Inner text may not contain braces, so "{{{foo}}}" yields one tag: foo.
const VARIABLE_RE = /\{\{([^{}]+?)\}\}/g;

/** Names inside {{name}} tags: case-sensitive, deduped, first-seen order. */
export function extractVariables(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(VARIABLE_RE)) {
    seen.add(match[1].trim());
  }
  return [...seen];
}

/** Variables present in `before` but absent from `after` (losses only). */
export function missingVariables(before: string, after: string): string[] {
  const kept = new Set(extractVariables(after));
  return extractVariables(before).filter((name) => !kept.has(name));
}

export function diffEmail(before: EmailDraft, after: EmailDraft): EmailDiff {
  const subject = diffText(before.subject, after.subject);
  const body = diffText(before.body, after.body);
  const changed = [...subject, ...body].some((s) => s.type !== "same");
  return {
    subject,
    body,
    changed,
    // Body only: subjects rarely carry merge tags, so no confirmation prompt.
    droppedVariables: missingVariables(before.body, after.body),
  };
}
