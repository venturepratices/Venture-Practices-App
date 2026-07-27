import "dotenv/config";
import { prisma } from "@/lib/prisma";

const TEMPLATE_NAME = "Standard Direct Mail — 7 Stage";

// A sensible starting task list per stage, editable afterward from
// /settings/direct-mail-templates. daysBeforeMailDate is negative for tasks
// that happen after the mail date (e.g. pulling results).
const STAGES = [
  {
    stage: "PLANNING",
    tasks: [
      { title: "Approve geographies", roleTag: "ACCOUNT_MANAGER", daysBeforeMailDate: 28 },
      { title: "Confirm household counts", roleTag: "ACCOUNT_MANAGER", daysBeforeMailDate: 28 },
      { title: "Finalize in-home date", roleTag: "ACCOUNT_MANAGER", daysBeforeMailDate: 28 },
      { title: "Confirm budget", roleTag: "ACCOUNT_MANAGER", daysBeforeMailDate: 28 },
      { title: "Build campaign brief", roleTag: "ACCOUNT_MANAGER", daysBeforeMailDate: 28 },
    ],
  },
  {
    stage: "CREATIVE",
    tasks: [
      { title: "Request assets from client", roleTag: "CLIENT", daysBeforeMailDate: 28 },
      { title: "Verify uploaded assets", roleTag: "CREATIVE", daysBeforeMailDate: 25 },
      { title: "Assign designer", roleTag: "CREATIVE", daysBeforeMailDate: 25 },
      { title: "Design draft creative", roleTag: "CREATIVE", daysBeforeMailDate: 21 },
      { title: "Upload proof for review", roleTag: "CREATIVE", daysBeforeMailDate: 21 },
    ],
  },
  {
    stage: "REVIEW",
    tasks: [
      { title: "Internal review of proof", roleTag: "ACCOUNT_MANAGER", daysBeforeMailDate: 18 },
      { title: "Request revisions if needed", roleTag: "CREATIVE", daysBeforeMailDate: 16 },
    ],
  },
  {
    stage: "APPROVAL",
    tasks: [
      { title: "Send proof to client for approval", roleTag: "ACCOUNT_MANAGER", daysBeforeMailDate: 14 },
      { title: "Client approves final proof", roleTag: "CLIENT", daysBeforeMailDate: 12 },
    ],
  },
  {
    stage: "PRODUCTION",
    tasks: [
      { title: "Send files to print vendor", roleTag: "PRODUCTION", daysBeforeMailDate: 10 },
      { title: "Confirm print run scheduled", roleTag: "PRODUCTION", daysBeforeMailDate: 8 },
      { title: "Confirm mail house pickup", roleTag: "PRODUCTION", daysBeforeMailDate: 4 },
    ],
  },
  {
    stage: "MAILED",
    tasks: [
      { title: "Confirm in-home delivery", roleTag: "PRODUCTION", daysBeforeMailDate: 0 },
      { title: "Set up call tracking number", roleTag: "ACCOUNT_MANAGER", daysBeforeMailDate: 0 },
    ],
  },
  {
    stage: "RESULTS",
    tasks: [
      { title: "Pull response/lead report", roleTag: "ACCOUNT_MANAGER", daysBeforeMailDate: -14 },
      { title: "Share results with client", roleTag: "ACCOUNT_MANAGER", daysBeforeMailDate: -21 },
    ],
  },
] as const;

async function main() {
  const existing = await prisma.programTemplate.findUnique({ where: { name: TEMPLATE_NAME } });
  if (existing) {
    console.log(`Seed: template "${TEMPLATE_NAME}" already exists, skipping.`);
    return;
  }

  const template = await prisma.programTemplate.create({
    data: {
      name: TEMPLATE_NAME,
      product: null,
      stages: {
        create: STAGES.map((stage, stageIndex) => ({
          stage: stage.stage,
          sequenceNumber: stageIndex + 1,
          tasks: {
            create: stage.tasks.map((task, taskIndex) => ({
              title: task.title,
              roleTag: task.roleTag,
              daysBeforeMailDate: task.daysBeforeMailDate,
              sequenceNumber: taskIndex + 1,
            })),
          },
        })),
      },
    },
  });

  console.log(`Seed: created default template "${template.name}" (${template.id}).`);
}

main().finally(() => process.exit(0));
