import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

/** GET /api/notes?q=search */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = new URL(request.url).searchParams.get("q")?.trim() || "";
  const notes = await prisma.note.findMany({
    where: {
      userId: session.userId,
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { body: { contains: q, mode: "insensitive" } },
              { tags: { has: q.toLowerCase() } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      tags: n.tags,
      updatedAt: n.updatedAt.toISOString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const title = String(body.title || "").trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const note = await prisma.note.create({
    data: {
      userId: session.userId,
      title,
      body: body.body || "",
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    },
  });
  return NextResponse.json({ note: { id: note.id } }, { status: 201 });
}
