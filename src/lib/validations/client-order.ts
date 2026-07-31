import { z } from "zod";

export const SERVICE_STATUS_VALUES = ["ACTIVE", "PAUSED", "CANCELLED"] as const;
export type ServiceStatusValue = (typeof SERVICE_STATUS_VALUES)[number];

export const serviceSchema = z.object({
  name: z.string().trim().min(1, "Service name is required").max(120),
  feeCents: z.number().int().min(0),
  status: z.enum(SERVICE_STATUS_VALUES),
});

export const createClientOrderSchema = z.object({
  title: z.string().trim().max(160).optional().nullable(),
  services: z.array(serviceSchema).min(1, "Add at least one service"),
  adBudgetCents: z.number().int().min(0).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  // Present only when amending a specific existing order line (the Change
  // Order flow) — absent means "start a brand-new, independent order line."
  fromOrderId: z.string().trim().min(1).optional().nullable(),
  // Values only — the route resolves each against the CURRENT OrderTemplate
  // to build the frozen {key,label,type,value} snapshot server-side, so a
  // client can't spoof a field's label/type.
  customFieldValues: z
    .array(z.object({ key: z.string(), value: z.string().trim().max(4000).nullable() }))
    .optional(),
});

export type Service = z.infer<typeof serviceSchema>;
