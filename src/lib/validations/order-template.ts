import { z } from "zod";

export const ORDER_FIELD_TYPES = ["TEXT", "NUMBER", "DATE", "LONGTEXT"] as const;
export type OrderFieldTypeValue = (typeof ORDER_FIELD_TYPES)[number];

export const orderTemplateFieldSchema = z.object({
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1, "Label is required").max(80),
  type: z.enum(ORDER_FIELD_TYPES),
  required: z.boolean(),
});

export const createOrderTemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
});

export const updateOrderTemplateSchema = z.object({
  customFields: z.array(orderTemplateFieldSchema).max(20),
});

export type OrderTemplateField = z.infer<typeof orderTemplateFieldSchema>;
