import { describe, expect, it } from "vitest";

import { clientSchema } from "@/lib/validations/client";
import { createClientOrderSchema, serviceSchema } from "@/lib/validations/client-order";
import { createTaskSchema, updateTaskSchema } from "@/lib/validations/task";

describe("clientSchema", () => {
  const base = { name: "Journey Smiles", status: "ACTIVE" as const };

  it("accepts a minimal valid client (only name + status)", () => {
    const result = clientSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = clientSchema.safeParse({ ...base, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid status not in the enum", () => {
    const result = clientSchema.safeParse({ ...base, status: "DELETED" });
    expect(result.success).toBe(false);
  });

  it("lowercases and trims a contact email", () => {
    const result = clientSchema.safeParse({ ...base, contactEmail: "  Ben@VenturePractices.com  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.contactEmail).toBe("ben@venturepractices.com");
  });

  it("rejects a malformed contact email rather than silently nulling it", () => {
    const result = clientSchema.safeParse({ ...base, contactEmail: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("treats an empty-string contact email as 'not provided', not a validation error", () => {
    const result = clientSchema.safeParse({ ...base, contactEmail: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.contactEmail).toBeNull();
  });

  it("treats an empty-string optional text field (e.g. address) as null, not an empty string", () => {
    const result = clientSchema.safeParse({ ...base, address: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.address).toBeNull();
  });

  it("rejects a malformed website URL", () => {
    const result = clientSchema.safeParse({ ...base, website: "not a url" });
    expect(result.success).toBe(false);
  });

  it("accepts a real website URL", () => {
    const result = clientSchema.safeParse({ ...base, website: "https://venturepractices.com" });
    expect(result.success).toBe(true);
  });
});

describe("serviceSchema / createClientOrderSchema", () => {
  const validService = { name: "SEO Retainer", feeCents: 150000, status: "ACTIVE" as const };

  it("accepts a valid service line", () => {
    expect(serviceSchema.safeParse(validService).success).toBe(true);
  });

  it("rejects a negative fee — money can never go below zero", () => {
    expect(serviceSchema.safeParse({ ...validService, feeCents: -1 }).success).toBe(false);
  });

  it("rejects a non-integer fee (fractional cents make no sense)", () => {
    expect(serviceSchema.safeParse({ ...validService, feeCents: 100.5 }).success).toBe(false);
  });

  it("rejects an order with zero services — 'add at least one service' is enforced, not just suggested", () => {
    const result = createClientOrderSchema.safeParse({ services: [] });
    expect(result.success).toBe(false);
  });

  it("accepts a minimal valid order with one service and nothing else", () => {
    const result = createClientOrderSchema.safeParse({ services: [validService] });
    expect(result.success).toBe(true);
  });

  it("rejects a negative ad budget the same way it rejects a negative fee", () => {
    const result = createClientOrderSchema.safeParse({ services: [validService], adBudgetCents: -500 });
    expect(result.success).toBe(false);
  });
});

describe("createTaskSchema / updateTaskSchema", () => {
  it("requires a non-empty title on create", () => {
    expect(createTaskSchema.safeParse({ title: "" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "Write copy" }).success).toBe(true);
  });

  it("allows title to be omitted entirely on update (partial edit)", () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(true);
  });

  it("rejects an update with an explicitly empty title, distinct from an omitted one", () => {
    expect(updateTaskSchema.safeParse({ title: "" }).success).toBe(false);
  });

  it("rejects a deadline that isn't a real ISO datetime string", () => {
    expect(createTaskSchema.safeParse({ title: "x", deadline: "next tuesday" }).success).toBe(false);
  });

  it("accepts a null deadline (clearing it) and a real ISO deadline", () => {
    expect(createTaskSchema.safeParse({ title: "x", deadline: null }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: "x", deadline: "2026-08-20T00:00:00.000Z" }).success).toBe(true);
  });

  it("rejects an occurrence value outside the fixed enum", () => {
    expect(createTaskSchema.safeParse({ title: "x", occurrence: "RECURRING_DAILY" }).success).toBe(false);
  });

  it("rejects a kind value outside the fixed enum", () => {
    expect(createTaskSchema.safeParse({ title: "x", kind: "MARKETING" }).success).toBe(false);
  });
});
