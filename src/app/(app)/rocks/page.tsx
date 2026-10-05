import { notFound } from "next/navigation";

import { LEADERSHIP_MEMBER_WHERE, parseQuarterKey, quarterKeyFor } from "@/lib/leadership";
import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { RocksBoard } from "@/components/leadership/rocks-board";

export default async function RocksPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  if (!(await canUseCapability("canUseLeadership"))) notFound();
  const params = await searchParams;
  const quarter = params.q && parseQuarterKey(params.q) ? params.q : quarterKeyFor();

  const [rocks, leadershipMembers] = await Promise.all([
    prisma.rock.findMany({
      where: { quarter, archivedAt: null },
      include: { owner: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.teamMember.findMany({ where: LEADERSHIP_MEMBER_WHERE, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <RocksBoard
      quarter={quarter}
      leadershipMembers={leadershipMembers}
      rocks={rocks.map((rock) => ({
        id: rock.id,
        title: rock.title,
        doneDefinition: rock.doneDefinition,
        isCompany: rock.isCompany,
        status: rock.status,
        dueDate: rock.dueDate.toISOString(),
        owner: rock.owner,
      }))}
    />
  );
}
