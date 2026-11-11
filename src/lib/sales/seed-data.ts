// The pipelines, stages and custom fields Sales starts with (spec sections 5 and 6).
// Pure data whose only import is the client-safe constants file, so it is safe
// to load anywhere, client or server.
// Admins edit these rows later; the seed never overwrites an existing row.

import { DEFAULT_ROTTING_DAYS } from "@/lib/sales/constants";

export type SeedStage = {
  /** kebab-case of the name, unique within its pipeline */
  key: string;
  name: string;
  /** 1-based, in board order */
  position: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
  requiresValue: boolean;
  isNoShow: boolean;
  /** Days an open deal can sit here before it rots. null on won and lost stages. */
  rottingDays: number | null;
};

export type SeedPipeline = {
  key: string;
  name: string;
  kind: "SALES" | "CONSULTING" | "DELIVERY";
  position: number;
  stages: SeedStage[];
};

export type SeedField = {
  key: string;
  label: string;
  entity: "DEAL" | "LEAD";
  fieldType: "TEXT" | "NUMBER" | "DATE" | "SELECT";
  options: string[];
  /** Empty = shown on every pipeline. */
  pipelineKeys: string[];
  position: number;
};

/** "No Show/Cancel" -> "no-show-cancel" */
function kebab(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type StageSpec = [name: string, probability: number, flag?: "won" | "lost" | "noShow"];

function buildStages(specs: StageSpec[]): SeedStage[] {
  return specs.map(([name, probability, flag], index) => ({
    key: kebab(name),
    name,
    position: index + 1,
    probability,
    isWon: flag === "won",
    isLost: flag === "lost",
    requiresValue: name === "Proposal Sent",
    isNoShow: flag === "noShow",
    rottingDays: flag === "won" || flag === "lost" ? null : DEFAULT_ROTTING_DAYS,
  }));
}

// Delivery pipelines hold deals that are already won, so the spec gives no
// probabilities for them. 0 means "not a forecast".
const DELIVERY_PROBABILITY = 0;

export const SALES_SEED_PIPELINES: SeedPipeline[] = [
  {
    key: "direct-mail",
    name: "Direct Mail",
    kind: "SALES",
    position: 1,
    stages: buildStages([
      ["New Opt-In", 10],
      ["Appointment Scheduled", 20],
      ["No Show", 20, "noShow"],
      ["Demo Complete", 30],
      ["Proposal Sent", 70],
      ["Follow-Up", 85],
      ["Contract Signed", 100, "won"],
      ["Sent to Onboarding", 100, "won"],
    ]),
  },
  {
    key: "new-mover-mail",
    name: "New Mover Mail",
    kind: "SALES",
    position: 2,
    stages: buildStages([
      ["New Lead - Check Availability", 20],
      ["90 Day Trial/Get Started", 30],
      ["Demo Scheduled", 40],
      ["No Show/Cancel", 20, "noShow"],
      ["Proposal Sent", 60],
      ["Follow-Up", 85],
      ["Deal Won", 100, "won"],
    ]),
  },
  {
    key: "marketing-agency",
    name: "Marketing Agency Services",
    kind: "CONSULTING",
    position: 3,
    stages: buildStages([
      ["Discovery Call Booked", 10],
      ["Discovery Call Completed", 25],
      ["DISC and Values Debrief Scheduled", 35],
      ["Proposal Sent", 75],
      ["Deal Won", 100, "won"],
      ["Deal Lost Nurture", 100, "lost"],
    ]),
  },
  {
    key: "client-delivery",
    name: "Client Delivery",
    kind: "DELIVERY",
    position: 4,
    stages: buildStages([
      ["Agreement Signed", DELIVERY_PROBABILITY],
      ["Payment Confirmed", DELIVERY_PROBABILITY],
      ["Onboarding", DELIVERY_PROBABILITY],
      ["Creative and Approvals", DELIVERY_PROBABILITY],
      ["Production", DELIVERY_PROBABILITY],
      ["First Mailing Live", DELIVERY_PROBABILITY],
      ["Reporting", DELIVERY_PROBABILITY, "won"],
    ]),
  },
  {
    key: "consulting-delivery",
    name: "Consulting Delivery",
    kind: "DELIVERY",
    position: 5,
    stages: buildStages([
      ["Kickoff", DELIVERY_PROBABILITY],
      ["Active Engagement", DELIVERY_PROBABILITY],
      ["Milestone Review", DELIVERY_PROBABILITY],
      ["Ongoing Advisory", DELIVERY_PROBABILITY],
      ["Renewal or Completion", DELIVERY_PROBABILITY, "won"],
    ]),
  },
];

const MAIL_PIPELINES = ["direct-mail", "new-mover-mail"];
const CONSULTING_PIPELINES = ["marketing-agency"];

type FieldSpec = Omit<SeedField, "key" | "position" | "options" | "pipelineKeys"> &
  Partial<Pick<SeedField, "options" | "pipelineKeys">>;

function buildFields(specs: FieldSpec[]): SeedField[] {
  return specs.map((spec, index) => ({
    key: kebab(spec.label),
    label: spec.label,
    entity: spec.entity,
    fieldType: spec.fieldType,
    options: spec.options ?? [],
    pipelineKeys: spec.pipelineKeys ?? [],
    position: index + 1,
  }));
}

export const SALES_SEED_FIELDS: SeedField[] = buildFields([
  // 6.1 All deal pipelines
  { label: "Target Start Date", entity: "DEAL", fieldType: "DATE" },
  {
    label: "How would you like to start?",
    entity: "DEAL",
    fieldType: "SELECT",
    options: ["90-day trial", "Full program", "Not sure yet"],
  },
  // 6.2 Direct Mail and New Mover Mail deals
  { label: "Territory Hold Expiry", entity: "DEAL", fieldType: "DATE", pipelineKeys: MAIL_PIPELINES },
  { label: "Mailing Count", entity: "DEAL", fieldType: "NUMBER", pipelineKeys: MAIL_PIPELINES },
  { label: "Mailing Number", entity: "DEAL", fieldType: "NUMBER", pipelineKeys: MAIL_PIPELINES },
  // 6.3 Consulting deals
  {
    label: "Engagement Type",
    entity: "DEAL",
    fieldType: "SELECT",
    options: ["Growth strategy", "Start-up", "Marketing systems"],
    pipelineKeys: CONSULTING_PIPELINES,
  },
  { label: "Term", entity: "DEAL", fieldType: "NUMBER", pipelineKeys: CONSULTING_PIPELINES },
  {
    label: "Fee Structure",
    entity: "DEAL",
    fieldType: "SELECT",
    options: ["Monthly retainer", "Project fee", "Both"],
    pipelineKeys: CONSULTING_PIPELINES,
  },
  // 6.4 Lead fields
  {
    label: "Form Source",
    entity: "LEAD",
    fieldType: "SELECT",
    options: ["Check Availability", "Direct inquiry", "Referral"],
  },
  { label: "Practice ZIP", entity: "LEAD", fieldType: "TEXT" },
  { label: "Practice Name", entity: "LEAD", fieldType: "TEXT" },
]);
