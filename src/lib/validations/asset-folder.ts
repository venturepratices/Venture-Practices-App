import { z } from "zod";

import { ANNOTATION_COLORS } from "@/lib/asset-annotation";

const colorSchema = z
  .string()
  .refine((c) => ANNOTATION_COLORS.some((preset) => preset.value === c), "Unknown color")
  .optional()
  .nullable();

export const createAssetFolderSchema = z.object({
  name: z.string().trim().min(1, "Folder name is required").max(80),
  color: colorSchema,
});

export const updateAssetFolderSchema = z.object({
  name: z.string().trim().min(1, "Folder name is required").max(80).optional(),
  color: colorSchema,
});
