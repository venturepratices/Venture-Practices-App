import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { ensureSalesSeed } from "@/lib/sales/seed";

// Creates the starting Sales pipelines, stages and custom fields. Safe to re-run:
// it only adds what is missing. Run with: npx tsx scripts/seed-sales.ts
async function main() {
  const created = await ensureSalesSeed();
  console.log(`Created ${created.pipelines} pipelines / ${created.stages} stages / ${created.fields} custom fields.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
