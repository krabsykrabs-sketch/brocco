import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** Unauthenticated liveness for Docker/Coolify: process up AND database reachable. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
