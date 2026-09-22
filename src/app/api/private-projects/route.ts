import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Private projects have no admin/capability gating at all — every signed-in
// member can have their own, and every route here scopes strictly to
// session.user.id. There's no "view someone else's private projects" case,
// not even for an admin (see PrivateProject in prisma/schema.prisma).

const createSchema = z.object({
  label: z.string().trim().min(1, "Name is required").max(80),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projects = await prisma.privateProject.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { tasks: true } } },
  });

  return NextResponse.json(projects);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const project = await prisma.privateProject.create({
    data: { label: parsed.data.label, ownerId: session.user.id },
    include: { _count: { select: { tasks: true } } },
  });

  return NextResponse.json(project, { status: 201 });
}
