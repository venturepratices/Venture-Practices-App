import { CalendarClock } from "lucide-react";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { endOfDay } from "@/lib/utils";
import { InfoTip } from "@/components/info-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { MeetingNoteFilters } from "@/components/clients/meeting-note-filters";
import { MeetingNoteItem } from "@/components/clients/meeting-note-item";
import { NewMeetingNoteForm } from "@/components/clients/new-meeting-note-form";

type SearchParams = {
  q?: string;
  from?: string;
  to?: string;
};

export default async function ClientMeetingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { clientId } = await params;
  const filters = await searchParams;

  const where: Prisma.MeetingNoteWhereInput = { clientId };
  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q, mode: "insensitive" } },
      { summary: { contains: filters.q, mode: "insensitive" } },
      { transcript: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  if (filters.from || filters.to) {
    where.meetingDate = {
      ...(filters.from ? { gte: new Date(filters.from) } : {}),
      ...(filters.to ? { lte: endOfDay(filters.to) } : {}),
    };
  }

  const meetingNotes = await prisma.meetingNote.findMany({
    where,
    include: { author: { select: { name: true } } },
    orderBy: { meetingDate: "desc" },
  });

  const hasFilters = Boolean(filters.q || filters.from || filters.to);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Meeting Notes
          <InfoTip>
            Paste a Fathom (or any) meeting transcript and it's automatically summarized into key points, decisions,
            and action items. Newest meeting first.
          </InfoTip>
        </h2>
      </div>

      <div className="mt-4">
        <NewMeetingNoteForm clientId={clientId} />
      </div>

      <div className="mt-4">
        <MeetingNoteFilters />
      </div>

      <div className="mt-4 rounded-lg border divide-y">
        {meetingNotes.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={hasFilters ? "No meeting notes match these filters." : "No meeting notes yet."}
          />
        ) : (
          meetingNotes.map((meetingNote) => (
            <MeetingNoteItem key={meetingNote.id} clientId={clientId} meetingNote={meetingNote} />
          ))
        )}
      </div>
    </div>
  );
}
