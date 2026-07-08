import "dotenv/config";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import bcrypt from "bcryptjs";
import ws from "ws";

import { PrismaClient } from "../src/generated/prisma/client";

neonConfig.webSocketConstructor = ws;

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = "campaignmanager@venturepractices.com";
  const temporaryPassword = "VenturePM-" + Math.random().toString(36).slice(2, 10);

  const existing = await prisma.teamMember.findUnique({ where: { email } });
  if (existing) {
    console.log(`Seed: team member ${email} already exists, skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  await prisma.teamMember.create({
    data: {
      name: "Campaign Manager",
      email,
      passwordHash,
      role: "AGENCY",
    },
  });

  console.log("Seed: created first team member.");
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${temporaryPassword}`);
  console.log("  (Change this from the Team screen after first login.)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
