import { FILE_NAME_MAX, FILE_PATH_PREFIX } from "@/lib/sales/constants";

// The rules for a deal's final-version files that need no database or store:
// what a file really is (read from its bytes, never from its name or the type
// the browser claims), the name it is stored and downloaded under, the
// download header, and which stored pathnames a download may fetch. No prisma
// and no server-only imports, so client code may load it too.

/** The only kinds of file a deal takes (A7): no CSV, TXT, SVG or unknown bytes. */
export const FILE_TYPES = {
  pdf: { ext: "pdf", contentType: "application/pdf" },
  docx: { ext: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  xlsx: { ext: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  png: { ext: "png", contentType: "image/png" },
  jpg: { ext: "jpg", contentType: "image/jpeg" },
} as const;

export type FileTypeKey = keyof typeof FILE_TYPES;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\3\4", a ZIP's first local file header

/** The main part that makes a ZIP a Word document or an Excel workbook. */
const DOCX_PART = "word/document.xml";
const XLSX_PART = "xl/workbook.xml";
/**
 * Parts that carry code or other programs: VBA macros (a .docm or .xlsm renamed),
 * Excel 4.0 macro sheets, ActiveX controls and embedded OLE objects.
 */
const REFUSED_PARTS = ["vbaproject.bin", "macrosheets/", "/activex/", "embeddings/oleobject"];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return bytes.length >= magic.length && magic.every((byte, i) => bytes[i] === byte);
}

/**
 * The bytes as text with A-Z lowered, one character per byte, so part names can
 * be searched ignoring case (Office finds parts by name ignoring case). A ZIP
 * keeps its entry names uncompressed in the local headers and the central
 * directory, so the names are there to find.
 */
function lowerAsciiText(bytes: Uint8Array): string {
  const lowered = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    lowered[i] = byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
  }
  // windows-1252 maps every byte to exactly one character and leaves ASCII as is.
  return new TextDecoder("windows-1252").decode(lowered);
}

/**
 * What a file is, by its first bytes: PDF, PNG, JPEG, or a ZIP that holds a
 * Word document or an Excel workbook and nothing that runs code. Anything else
 * (an .exe renamed .pdf, SVG, HTML, a macro file, an empty file) is null.
 */
export function sniffFileType(bytes: Uint8Array): FileTypeKey | null {
  if (startsWith(bytes, PDF_MAGIC)) return "pdf";
  if (startsWith(bytes, PNG_MAGIC)) return "png";
  if (startsWith(bytes, JPEG_MAGIC)) return "jpg";
  if (!startsWith(bytes, ZIP_MAGIC)) return null;

  const text = lowerAsciiText(bytes);
  if (REFUSED_PARTS.some((part) => text.includes(part))) return null;
  const isDocx = text.includes(DOCX_PART);
  const isXlsx = text.includes(XLSX_PART);
  // A ZIP that claims to be both is neither.
  if (isDocx === isXlsx) return null;
  return isDocx ? "docx" : "xlsx";
}

/**
 * Characters a stored name never keeps: C0 and C1 controls (U+0000 to U+001F,
 * U+007F to U+009F), the direction embeddings and overrides (U+202A to U+202E)
 * and isolates (U+2066 to U+2069) that can make "fdp.exe" read as "exe.pdf",
 * the direction marks U+200E, U+200F and U+061C, and half of a surrogate pair
 * with no other half (not valid text, and it would break the download header).
 */
const UNSAFE_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩‎‏؜]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** `text` cut to at most `max` UTF-16 units, at a whole character, so a pair is never split. */
function cutToLength(text: string, max: number): string {
  let cut = "";
  for (const char of text) {
    if (cut.length + char.length > max) break;
    cut += char;
  }
  return cut;
}

/**
 * The name a file is stored and downloaded under, from the name it came with
 * and the type its bytes showed: only what follows the last `/` or `\`,
 * without unsafe characters, spaces collapsed, no leading dots, ending in the
 * real type's extension (appended when it does not; `.jpeg` also counts for
 * jpg), at most 200 characters with the extension kept. Nothing left becomes
 * "file.<ext>".
 */
export function cleanFileName(raw: string, ext: string): string {
  const lastPart = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = lastPart
    .replace(UNSAFE_CHARACTERS, "")
    .replace(/\s+/g, " ")
    .trim()
    // Leading dots (a hidden file, or what is left of "../"), and any space they hid behind.
    .replace(/^[.\s]+/, "");
  if (cleaned === "") return `file.${ext}`;

  const endings = ext === "jpg" ? [".jpg", ".jpeg"] : [`.${ext}`];
  const lower = cleaned.toLowerCase();
  const ending = endings.find((candidate) => lower.endsWith(candidate));
  // Keep the extension as typed ("contract.PDF"); append the real one when it is missing.
  const base = ending ? cleaned.slice(0, cleaned.length - ending.length) : cleaned;
  const suffix = ending ? cleaned.slice(cleaned.length - ending.length) : `.${ext}`;
  const cutBase = cutToLength(base, FILE_NAME_MAX - suffix.length).trimEnd();
  return cutBase === "" ? `file${suffix}` : `${cutBase}${suffix}`;
}

/**
 * The download header for a stored name: always an attachment, never shown in
 * the page. `filename` is a plain ASCII copy (anything outside 0x20 to 0x7E,
 * and every double quote and backslash, becomes "_"); `filename*` carries the
 * real name (RFC 5987), with the four characters encodeURIComponent leaves
 * alone but RFC 5987 does not allow bare (', (, ) and *) encoded too.
 */
export function contentDisposition(name: string): string {
  const asciiCopy = Array.from(name, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || code > 0x7e || char === '"' || char === "\\" ? "_" : char;
  }).join("");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiCopy}"; filename*=UTF-8''${encoded}`;
}

/** A flat name with one extension directly under `sales-files/`: no folders, no "..", nothing encoded. */
const SALES_FILE_PATHNAME = new RegExp(`^${FILE_PATH_PREFIX}[A-Za-z0-9-]+\\.[a-z0-9]+$`);

/** Whether a stored pathname is one a Sales download may fetch (never a backup or any other file in the store). */
export function isSalesFilePathname(pathname: string): boolean {
  return SALES_FILE_PATHNAME.test(pathname);
}
