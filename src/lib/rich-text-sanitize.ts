import sanitizeHtml from "sanitize-html";

/**
 * The one HTML clean-up for every rich-text field (task comments, client
 * notes, meeting-note transcripts). The allow-list is exactly what
 * RichTextEditor's Tiptap extensions produce (StarterKit, TaskList/TaskItem,
 * TextStyle + Color, Highlight, Mention), so editor output passes through
 * unchanged and anything else (scripts, event handlers, other tags, other
 * styles, javascript:/data: links) is dropped.
 *
 * Runs on save in every route that writes those fields AND again at render in
 * RichTextContent, so rows stored before this existed are made safe too.
 * tests/lib/rich-text-sanitize-guard.test.ts fails if a new write path skips it.
 */

// One plain colour value: #hex, rgb()/rgba()/hsl()/hsla() holding only
// numbers and separators, or a colour keyword. No letters inside the
// parentheses, so url(...) and expression(...) can never match.
const COLOR = String.raw`(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?)\([\d\s.,%/+-]*\)|[a-z]+)`;
const COLOR_VALUE = new RegExp(`^${COLOR}$`, "i");
// The optional `;` and trailing spaces at the end of a style. Written as
// `(?:\s*;)?\s*$`, not `\s*;?\s*$`: in the second form two space runs touch
// with nothing required between them, so a long run of spaces followed by
// anything else takes time that grows with the square of its length (100000
// spaces took about 30 s). Both forms accept exactly the same text.
const STYLE_END = String.raw`(?:\s*;)?\s*$`;
// Color extension output, e.g. `color: #dc2626`.
const TEXT_COLOR_STYLE = new RegExp(String.raw`^\s*color\s*:\s*${COLOR}${STYLE_END}`, "i");
// Highlight extension output, e.g. `background-color: #fef08a; color: inherit`.
const HIGHLIGHT_STYLE = new RegExp(
  String.raw`^\s*background-color\s*:\s*${COLOR}(?:\s*;\s*color\s*:\s*inherit)?${STYLE_END}`,
  "i"
);

/** Keeps the attribute only if its whole value matches; preserves attribute order. */
function dropUnless(attribs: sanitizeHtml.Attributes, name: string, pattern: RegExp): sanitizeHtml.Attributes {
  if (attribs[name] === undefined || pattern.test(attribs[name])) return attribs;
  const rest = { ...attribs };
  delete rest[name];
  return rest;
}

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "em", "u", "s", "code", "pre", "blockquote",
    "ul", "ol", "li", "label", "input", "div",
    "a", "span", "mark",
  ],
  allowedAttributes: {
    a: ["target", "rel", "href"],
    ol: ["start", "type"],
    ul: ["data-type"],
    li: ["data-checked", "data-type"],
    input: ["type", "checked"],
    span: ["class", "style", "data-type", "data-id", "data-label", "data-mention-suggestion-char"],
    mark: ["data-color", "style"],
    code: ["class"],
  },
  allowedClasses: { span: ["mention"], code: ["language-*"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {},
  // Styles are checked by the strict patterns above instead of the library's
  // CSS parser, which it says can fail in the browser. That keeps server and
  // browser output identical and the editor's style text byte-for-byte.
  parseStyleAttributes: false,
  transformTags: {
    // Every editor link opens in a new tab with noopener noreferrer (Tiptap's
    // Link defaults); whatever target/rel was sent is replaced. href is
    // scheme-checked afterwards (http, https, mailto, or a relative link).
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        target: "_blank",
        rel: "noopener noreferrer nofollow",
        ...(attribs.href !== undefined ? { href: attribs.href } : {}),
      },
    }),
    span: (tagName, attribs) => ({ tagName, attribs: dropUnless(attribs, "style", TEXT_COLOR_STYLE) }),
    mark: (tagName, attribs) => ({
      tagName,
      attribs: dropUnless(dropUnless(attribs, "data-color", COLOR_VALUE), "style", HIGHLIGHT_STYLE),
    }),
  },
  // Checklist checkboxes are the only input the editor makes.
  exclusiveFilter: (frame) => frame.tag === "input" && frame.attribs.type !== "checkbox",
};

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}
