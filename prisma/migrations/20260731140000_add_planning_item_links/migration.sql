-- Mirrors TaskLink/ClientLink — reference links attached to a planning idea.
CREATE TABLE "PlanningItemLink" (
  "id" TEXT NOT NULL,
  "planningItemId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlanningItemLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlanningItemLink_planningItemId_idx" ON "PlanningItemLink"("planningItemId");

ALTER TABLE "PlanningItemLink" ADD CONSTRAINT "PlanningItemLink_planningItemId_fkey"
  FOREIGN KEY ("planningItemId") REFERENCES "PlanningItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
