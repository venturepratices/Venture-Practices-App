import { NotebookText } from "lucide-react";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { endOfDay } from "@/lib/utils";
import { InfoTip } from "@/components/info-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { ClientNoteFilters } from "@/components/clients/client-note-filters";
import { ClientNoteItem } from "@/components/clients/client-note-item";
import { NewClientNoteForm } from "@/components/clients/new-client-note-form";

type SearchParams = {
  q?: string;
  authorId?: string;
  from?: string;
  to?: string;
};

export default async function ClientNotesPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { clientId } = await params;
  const filters = await searchParams;

  const where: Prisma.ClientNoteWhereInput = { clientId };
  if (filters.q) where.body = { contains: filters.q, mode: "insensitive" };
  if (filters.authorId) where.authorId = filters.authorId;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: new Date(filters.from) } : {}),
      ...(filters.to ? { lte: endOfDay(filters.to) } : {}),
    };
  }

  const [notes, teamMembers] = await Promise.all([
    prisma.clientNote.findMany({
      where,
      include: { author: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const hasFilters = Boolean(filters.q || filters.authorId || filters.from || filters.to);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Notes
          <InfoTip>
            A shared log of the latest activity on this client — summarize an email, call, or update here so the whole
            team sees it, not just whoever it landed on. Newest first.
          </InfoTip>
        </h2>
      </div>

      <div className="mt-4">
        <NewClientNoteForm clientId={clientId} />
      </div>

      <div className="mt-4">
        <ClientNoteFilters teamMembers={teamMembers} />
      </div>

      <div className="mt-4 rounded-lg border divide-y">
        {notes.length === 0 ? (
          <EmptyState icon={NotebookText} title={hasFilters ? "No notes match these filters." : "No notes yet."} />
        ) : (
          notes.map((note) => <ClientNoteItem key={note.id} clientId={clientId} note={note} />)
        )}
      </div>
    </div>
  );
}
