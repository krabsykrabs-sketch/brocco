import { NextRequest, NextResponse } from "next/server";
import type { Activity, Prisma } from "@prisma/client";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { format } from "date-fns";
import { isCompatibleType } from "@/lib/activity-types";
import { userTranslator } from "@/lib/i18n-server";
import { EDITABLE_ACTIVITY_TYPES } from "@/app/activity/activity-type-options";

// Day-based: find a planned workout on the same date whose SPORT matches
// the activity — the same isCompatibleType rule every other surface uses.
// Without it a Tuesday bike ride "matched" the day's tempo run and rendered
// a nonsense planned-vs-actual comparison.
async function findMatchedWorkout(userId: string, activity: Activity) {
  const localDate = format(new Date(activity.startDateLocal), "yyyy-MM-dd");
  const dayStart = new Date(localDate + "T00:00:00.000Z");
  const dayEnd = new Date(localDate + "T23:59:59.999Z");

  const dayWorkouts = await prisma.plannedWorkout.findMany({
    where: {
      plan: { userId, status: "active" },
      date: { gte: dayStart, lte: dayEnd },
      workoutType: { not: "rest" },
    },
    select: {
      id: true,
      title: true,
      workoutType: true,
      activityType: true,
      targetDistanceKm: true,
      targetPace: true,
      targetDurationMin: true,
      description: true,
    },
  });
  const pw = dayWorkouts.find((w) => isCompatibleType(w.activityType, activity.activityType));
  if (!pw) return null;
  return {
    id: pw.id,
    title: pw.title,
    workoutType: pw.workoutType,
    targetDistanceKm: pw.targetDistanceKm ? Number(pw.targetDistanceKm) : null,
    targetPace: pw.targetPace,
    targetDurationMin: pw.targetDurationMin,
    description: pw.description,
  };
}

/** The wire shape of one activity — GET and PATCH return exactly this. */
async function serialize(userId: string, activity: Activity) {
  const matchedWorkout = await findMatchedWorkout(userId, activity);
  return {
    id: activity.id,
    source: activity.source,
    stravaId: activity.stravaId,
    name: activity.name,
    activityType: activity.activityType,
    distanceKm: activity.distanceKm ? Number(activity.distanceKm) : null,
    durationMin: Number(activity.durationMin),
    movingTimeMin: activity.movingTimeMin ? Number(activity.movingTimeMin) : null,
    avgPacePerKm: activity.avgPacePerKm,
    paceSecondsPerKm: activity.paceSecondsPerKm,
    avgHeartRate: activity.avgHeartRate,
    maxHeartRate: activity.maxHeartRate,
    elevationGainM: activity.elevationGainM ? Number(activity.elevationGainM) : null,
    avgCadence: activity.avgCadence,
    avgWatts: activity.avgWatts,
    calories: activity.calories,
    perceivedEffort: activity.perceivedEffort,
    notes: activity.notes,
    startDate: activity.startDate,
    startDateLocal: activity.startDateLocal,
    splits: activity.splits,
    laps: activity.laps,
    activityAnalysis: activity.activityAnalysis,
    matchedWorkout,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const activity = await prisma.activity.findFirst({
    where: { id, userId: session.userId },
  });

  if (!activity) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ activity: await serialize(session.userId, activity) });
}

/** A finite number, or undefined when the field was not sent at all. null passes through. */
function numberField(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * PATCH /api/activities/[id] — the athlete corrects a session: a wrong
 * "Done" tap, a mis-typed distance, or the RPE and a note added afterwards.
 * Partial: only the fields present in the body change. Pace is re-derived
 * when distance or duration move so the detail page stays self-consistent.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.userId;
  const t = await userTranslator(userId);

  const { id } = await params;
  const existing = await prisma.activity.findFirst({ where: { id, userId } });
  if (!existing) {
    return NextResponse.json({ error: t("api.activity.notFound") }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: t("api.activity.nothingToUpdate") }, { status: 400 });
  }

  const data: Prisma.ActivityUpdateInput = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 120) {
      return NextResponse.json({ error: t("api.activity.invalidName") }, { status: 400 });
    }
    data.name = name;
  }

  if (body.activityType !== undefined) {
    const type = typeof body.activityType === "string" ? body.activityType : "";
    if (!EDITABLE_ACTIVITY_TYPES.includes(type)) {
      return NextResponse.json({ error: t("api.activity.invalidType") }, { status: 400 });
    }
    data.activityType = type;
  }

  const distanceKm = numberField(body.distanceKm);
  if (distanceKm !== undefined) {
    if (distanceKm !== null && (Number.isNaN(distanceKm) || distanceKm < 0 || distanceKm > 500)) {
      return NextResponse.json({ error: t("api.activity.invalidDistance") }, { status: 400 });
    }
    data.distanceKm = distanceKm === null ? null : Math.round(distanceKm * 100) / 100;
  }

  const durationMin = numberField(body.durationMin);
  if (durationMin !== undefined) {
    if (durationMin === null || Number.isNaN(durationMin) || durationMin < 1 || durationMin > 1440) {
      return NextResponse.json({ error: t("api.activity.invalidDuration") }, { status: 400 });
    }
    data.durationMin = Math.round(durationMin * 100) / 100;
  }

  const perceivedEffort = numberField(body.perceivedEffort);
  if (perceivedEffort !== undefined) {
    if (
      perceivedEffort !== null &&
      (Number.isNaN(perceivedEffort) || !Number.isInteger(perceivedEffort) || perceivedEffort < 1 || perceivedEffort > 10)
    ) {
      return NextResponse.json({ error: t("api.activity.invalidEffort") }, { status: 400 });
    }
    data.perceivedEffort = perceivedEffort;
  }

  if (body.notes !== undefined) {
    if (body.notes === null || body.notes === "") {
      data.notes = null;
    } else if (typeof body.notes === "string" && body.notes.length <= 1000) {
      data.notes = body.notes.trim() || null;
    } else {
      return NextResponse.json({ error: t("api.activity.invalidNotes") }, { status: 400 });
    }
  }

  if (body.startDateLocal !== undefined) {
    const d = typeof body.startDateLocal === "string" ? new Date(body.startDateLocal) : null;
    if (!d || Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: t("api.activity.invalidDate") }, { status: 400 });
    }
    // Manual activities store the same instant in both columns; keep that.
    data.startDateLocal = d;
    if (existing.source === "manual") data.startDate = d;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: t("api.activity.nothingToUpdate") }, { status: 400 });
  }

  // Distance or duration moved → pace is stale. Moving time (Strava) beats
  // elapsed time when we have it; no distance means no pace.
  if (distanceKm !== undefined || durationMin !== undefined) {
    const km = distanceKm !== undefined ? distanceKm : existing.distanceKm ? Number(existing.distanceKm) : null;
    const minutes =
      existing.movingTimeMin != null && durationMin === undefined
        ? Number(existing.movingTimeMin)
        : durationMin !== undefined && durationMin !== null
          ? durationMin
          : Number(existing.durationMin);
    if (km && km > 0 && minutes > 0) {
      const secPerKm = Math.round((minutes * 60) / km);
      data.paceSecondsPerKm = secPerKm;
      data.avgPacePerKm = `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, "0")}`;
    } else {
      data.paceSecondsPerKm = null;
      data.avgPacePerKm = null;
    }
  }

  const updated = await prisma.activity.update({ where: { id: existing.id }, data });
  return NextResponse.json({ activity: await serialize(userId, updated) });
}

/**
 * DELETE /api/activities/[id] — gone from history. A Strava-sourced row
 * leaves a tombstone behind so the next webhook update, backfill or
 * auto-sync pass does not upsert it straight back.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.userId;
  const t = await userTranslator(userId);

  const { id } = await params;
  const existing = await prisma.activity.findFirst({
    where: { id, userId },
    select: { id: true, stravaId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: t("api.activity.notFound") }, { status: 404 });
  }

  await prisma.$transaction([
    ...(existing.stravaId
      ? [
          prisma.activityTombstone.upsert({
            where: { userId_stravaId: { userId, stravaId: existing.stravaId } },
            update: {},
            create: { userId, stravaId: existing.stravaId },
          }),
        ]
      : []),
    prisma.activity.delete({ where: { id: existing.id } }),
  ]);

  return NextResponse.json({ ok: true });
}
