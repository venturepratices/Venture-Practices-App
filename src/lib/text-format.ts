/**
 * Strips HTML markup down to plain text, for one-line row/card previews of a
 * rich-text field (Task.description) where full formatting would either
 * break (raw tags visible) or be pointless (a truncated snippet has no room
 * for bullets/bold anyway). Full rendering only happens in the task detail
 * panel, via RichTextContent.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every TeamMember id mentioned in a rich-text field's HTML — reads the
 * `data-id` attribute Tiptap's Mention extension stamps onto each mention
 * span (see RichTextEditor). Order-independent regex (doesn't assume
 * attribute order) so it survives Tiptap serialization changes.
 */
export function extractMentionedTeamMemberIds(html: string): string[] {
  const ids = new Set<string>();
  const spanRegex = /<span[^>]*data-type="mention"[^>]*>/g;
  const idRegex = /data-id="([^"]+)"/;
  let match: RegExpExecArray | null;
  while ((match = spanRegex.exec(html))) {
    const idMatch = idRegex.exec(match[0]);
    if (idMatch) ids.add(idMatch[1]);
  }
  return [...ids];
}
