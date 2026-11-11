import { TEXT_FIELD_MAX } from "@/lib/sales/constants";
import { isValidDateString } from "@/lib/sales/format";

// Checks a value typed into a deal's custom field (Details in the deal panel)
// and turns it into the text that is stored. Pure, with no database access, so
// the panel can check a value before saving and the server checks it again.

export type CustomFieldShape = {
  fieldType: "TEXT" | "NUMBER" | "DATE" | "SELECT";
  options: string[];
};

export const FIELD_TOO_LONG = "Keep it under 500 characters.";

// A plain number, or thousands groups of exactly three digits; either with decimals.
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const GROUPED_NUMBER = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;

/**
 * The stored form of a typed value: trimmed text, a number without thousands
 * commas, a date as "YYYY-MM-DD" (Ruling 16), or one of the listed options.
 * Blank means "clear the field" (value null).
 */
export function normalizeFieldValue(
  field: CustomFieldShape,
  raw: string | null,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const text = raw?.trim() ?? "";
  if (text === "") return { ok: true, value: null };
  if (text.length > TEXT_FIELD_MAX) return { ok: false, error: FIELD_TOO_LONG };

  switch (field.fieldType) {
    case "DATE":
      return isValidDateString(text) ? { ok: true, value: text } : { ok: false, error: "Enter a real date." };
    case "NUMBER":
      return PLAIN_NUMBER.test(text) || GROUPED_NUMBER.test(text)
        ? { ok: true, value: text.replace(/,/g, "") }
        : { ok: false, error: "Enter a number." };
    case "SELECT":
      return field.options.includes(text) ? { ok: true, value: text } : { ok: false, error: "Pick one of the listed options." };
    case "TEXT":
      return { ok: true, value: text };
  }
}
