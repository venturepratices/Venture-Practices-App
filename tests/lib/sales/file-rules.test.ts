import { describe, expect, it } from "vitest";

import { cleanFileName, contentDisposition, isSalesFilePathname, sniffFileType } from "@/lib/sales/file-rules";

// The pure rules behind a deal's final-version files: what a file really is
// (by its bytes, never its name or the browser's word for it), the name it is
// stored and downloaded under, and the download header. Review Focus 4: a file
// that lies about itself, and a name built to mislead.

/** One byte per character, so "\x03" is the byte 3. */
const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

/** A ZIP's opening bytes followed by its entry names, which ZIP stores uncompressed. */
const zip = (...names: string[]) => ascii(`PK\x03\x04\x14\x00${names.map((name) => `${name}\x00\x00PK\x01\x02`).join("")}`);

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d);
const RLO = String.fromCharCode(0x202e);

describe("sniffFileType", () => {
  it("recognises allowed files by their bytes", () => {
    expect(sniffFileType(ascii("%PDF-1.7\n%âãÏÓ\n1 0 obj"))).toBe("pdf");
    expect(sniffFileType(PNG)).toBe("png");
    expect(sniffFileType(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe("jpg");
    expect(sniffFileType(zip("[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"))).toBe("docx");
    expect(sniffFileType(zip("[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/worksheets/sheet1.xml"))).toBe("xlsx");
  });

  it("refuses files whose bytes are not an allowed type", () => {
    // A macro .docm renamed .docx, an Excel 4.0 macro sheet, ActiveX, an embedded OLE object.
    expect(sniffFileType(zip("[Content_Types].xml", "word/document.xml", "word/vbaProject.bin"))).toBeNull();
    expect(sniffFileType(zip("[Content_Types].xml", "xl/workbook.xml", "xl/macrosheets/sheet1.xml"))).toBeNull();
    expect(sniffFileType(zip("[Content_Types].xml", "xl/workbook.xml", "xl/activeX/activeX1.xml"))).toBeNull();
    expect(sniffFileType(zip("[Content_Types].xml", "word/document.xml", "word/embeddings/oleObject1.bin"))).toBeNull();
    // A ZIP that is neither (an OpenDocument file, or any other archive).
    expect(sniffFileType(zip("mimetype", "content.xml", "META-INF/manifest.xml"))).toBeNull();
    expect(sniffFileType(ascii("MZ\x90\x00\x03\x00\x00\x00"))).toBeNull();
    expect(sniffFileType(ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>'))).toBeNull();
    expect(sniffFileType(ascii("<!DOCTYPE html><html><body>"))).toBeNull();
    expect(sniffFileType(new Uint8Array(0))).toBeNull();
  });

  it("is not fooled by part names in another case, both main parts, or a cut-short signature", () => {
    // Office finds parts by name ignoring case, so the refusal does too.
    expect(sniffFileType(zip("word/document.xml", "word/VBAPROJECT.BIN"))).toBeNull();
    expect(sniffFileType(zip("xl/workbook.xml", "xl/MacroSheets/sheet1.xml"))).toBeNull();
    // A ZIP claiming to be both a document and a workbook is neither.
    expect(sniffFileType(zip("word/document.xml", "xl/workbook.xml"))).toBeNull();
    // An empty ZIP (end-of-archive record only), a PDF signature cut short, half a PNG signature.
    expect(sniffFileType(ascii("PK\x05\x06word/document.xml"))).toBeNull();
    expect(sniffFileType(ascii("%PDF"))).toBeNull();
    expect(sniffFileType(PNG.slice(0, 4))).toBeNull();
    // Text that only mentions the names is not a ZIP.
    expect(sniffFileType(ascii("word/document.xml"))).toBeNull();
  });
});

describe("cleanFileName", () => {
  it("cleans names", () => {
    expect(cleanFileName("Signed contract.pdf", "pdf")).toBe("Signed contract.pdf");
    expect(cleanFileName("..\\..\\backups\\x.pdf", "pdf")).toBe("x.pdf");
    expect(cleanFileName("a/b/../contract.PDF", "pdf")).toBe("contract.PDF");
    expect(cleanFileName(`contract${RLO}fdp.exe`, "pdf")).toBe("contractfdp.exe.pdf");
    expect(cleanFileName("photo.jpeg", "jpg")).toBe("photo.jpeg");
    expect(cleanFileName(" \u0000 ", "png")).toBe("file.png");
    expect(cleanFileName("..hidden.pdf", "pdf")).toBe("hidden.pdf");

    const long = cleanFileName(`${"a".repeat(300)}.pdf`, "pdf");
    expect(long).toHaveLength(200);
    expect(long).toBe(`${"a".repeat(196)}.pdf`);
  });

  it("drops control and direction characters and collapses spaces", () => {
    expect(cleanFileName("Q4\tproposal\r\n  final.docx", "docx")).toBe("Q4proposal final.docx");
    // C1 controls, the isolates (U+2066 to U+2069), and the marks U+200E, U+200F and U+061C.
    expect(cleanFileName("a\u0085b⁦c⁩d‎e‏f؜g.xlsx", "xlsx")).toBe("abcdefg.xlsx");
    expect(cleanFileName("logo.PNG", "png")).toBe("logo.PNG");
    expect(cleanFileName("scan.JPEG", "jpg")).toBe("scan.JPEG");
    // A name typed as another type keeps its words and ends in the real type.
    expect(cleanFileName("logo.png", "jpg")).toBe("logo.png.jpg");
    expect(cleanFileName(".pdf", "pdf")).toBe("pdf.pdf");
    expect(cleanFileName("...", "pdf")).toBe("file.pdf");
  });

  it("never cuts a character in half or keeps half of one", () => {
    // 300 four-byte emoji: the cut keeps whole characters, so the name stays valid text.
    const cut = cleanFileName(`${"\u{1F600}".repeat(300)}.pdf`, "pdf");
    expect(cut.length).toBeLessThanOrEqual(200);
    expect(cut.endsWith(".pdf")).toBe(true);
    expect(() => encodeURIComponent(cut)).not.toThrow();
    // With ".jpeg" the base has 195 units, an odd number: the cut stops at 194 rather than split the 98th emoji.
    const odd = cleanFileName(`${"\u{1F600}".repeat(300)}.jpeg`, "jpg");
    expect(odd).toBe(`${"\u{1F600}".repeat(97)}.jpeg`);
    expect(odd).toHaveLength(199);
    expect(() => encodeURIComponent(odd)).not.toThrow();
    // A lone half of a pair (never valid text) is dropped.
    expect(cleanFileName("half\ud800.pdf", "pdf")).toBe("half.pdf");
    expect(cleanFileName("half\udc00.pdf", "pdf")).toBe("half.pdf");
  });
});

describe("contentDisposition", () => {
  it("writes a safe download header", () => {
    expect(contentDisposition("Signed contract.pdf")).toBe(
      "attachment; filename=\"Signed contract.pdf\"; filename*=UTF-8''Signed%20contract.pdf",
    );
    expect(contentDisposition('Résumé "final".pdf')).toBe(
      "attachment; filename=\"R_sum_ _final_.pdf\"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22.pdf",
    );
  });

  it("encodes the characters RFC 5987 does not allow bare, and replaces a backslash", () => {
    expect(contentDisposition("Q4 (final)*'s.pdf")).toBe(
      "attachment; filename=\"Q4 (final)*'s.pdf\"; filename*=UTF-8''Q4%20%28final%29%2A%27s.pdf",
    );
    expect(contentDisposition("a\\b.pdf")).toBe("attachment; filename=\"a_b.pdf\"; filename*=UTF-8''a%5Cb.pdf");
    // One underscore per character, a four-byte one included.
    expect(contentDisposition("\u{1F600}.png")).toBe("attachment; filename=\"_.png\"; filename*=UTF-8''%F0%9F%98%80.png");
  });
});

describe("isSalesFilePathname", () => {
  it("accepts only a flat name under sales-files/", () => {
    expect(isSalesFilePathname("sales-files/0f8e2c1a-6a4b-4c3d-9e2f-1a2b3c4d5e6f.pdf")).toBe(true);
    expect(isSalesFilePathname("sales-files/abc.pdf")).toBe(true);
    expect(isSalesFilePathname("backups/2026-11-05.json")).toBe(false);
    expect(isSalesFilePathname("sales-files/../backups/2026-11-05.json")).toBe(false);
    expect(isSalesFilePathname("sales-files/a/b.pdf")).toBe(false);
    expect(isSalesFilePathname("sales-files/..pdf")).toBe(false);
    expect(isSalesFilePathname("sales-files/a%2F..%2Fb.pdf")).toBe(false);
    expect(isSalesFilePathname("archive/sales-files/x.pdf")).toBe(false);
    expect(isSalesFilePathname("sales-files/")).toBe(false);
  });
});
