export const ROLE_TAG_VALUES = ["ACCOUNT_MANAGER", "CREATIVE", "PRODUCTION", "CLIENT"] as const;

export type RoleTagValue = (typeof ROLE_TAG_VALUES)[number];

export const ROLE_TAG_LABELS: Record<RoleTagValue, string> = {
  ACCOUNT_MANAGER: "Account Manager",
  CREATIVE: "Creative",
  PRODUCTION: "Production",
  CLIENT: "Client",
};
