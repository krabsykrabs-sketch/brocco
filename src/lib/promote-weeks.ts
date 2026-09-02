import { prisma } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { buildCoachContext } from "@/lib/coach-context";
import { format } from "date-fns";
import { todayInTimezone, parseWall, addDaysWall, wallDateString } from "@/lib/schedule";
import { syncWorkoutsInBackground } from "@/lib/intervals-icu";
import { COACH_MODEL } from "@/lib/models";

const anthropic = new Anthropic();

/** Monday of the week containing the given "yyyy-MM-dd" date, as a UTC-anchored Date (server-TZ independent). */
function mondayOf(dateStr: string): Date {
  const d = parseWall(dateStr);
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return addDaysWall(d, -(dow - 1));
}

/**
 * Promote outline weeks to detailed and shift the rolling window forward.
 * Called on first visit each week or via cron.
 *
 * Logic:
 * 1. Find outline weeks whose start_date is within the next 7 days
 * 2. Promote them to 'detailed': generate full workout specs via Opus
 * 3. Find the next 'target' week and promote it to 'outline'
 * 4. Update actual_km on past weeks
 */
export async function promoteWeekDetails(userId: string): Promise<{ promoted: number }> {
  const plan = await prisma.plan.findFirst({
    where: { userId, status: "active" },
    select: { id: true, name: true, goal: true },
  });

  if (!plan) return { promoted: 0 };

  // Week boundaries in the USER's timezone — a Monday-00:30-Berlin visit on a
  // UTC server must not compute the previous week's Monday.
  const profileForTz = await prisma.userProfile.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  const today = todayInTimezone(profileForTz?.timezone || "Europe/Berlin");
  const thisMonday = mondayOf(today);
  const nextMonday = addDaysWall(thisMonday, 7);

  // Find outline weeks that should be promoted to detailed
  // (start_date is this week or next week)
  // Only this week and next. With no lower bound, coming back after a break
  // regenerated every PAST outline week — wiping what had actually been done.
  const outlineWeeks = await prisma.planWeek.findMany({
    where: {
      planId: plan.id,
      detailLevel: "outline",
      startDate: { gte: thisMonday, lte: addDaysWall(nextMonday, 6) },
    },
    orderBy: { weekNumber: "asc" },
    include: { phase: { select: { name: true } } },
  });

  // NOT an early return: the target→outline refill and the actualKm
  // backfill below must run even when there is nothing to promote, or a plan
  // generated with no outline weeks stalls forever at week 2.
  const context = outlineWeeks.length > 0 ? await buildCoachContext(userId) : "";
  const todayWall = parseWall(today);

  let promoted = 0;

  for (const week of outlineWeeks) {
    // Atomic claim: flip outline→detailed BEFORE the slow Opus call so a
    // concurrent request (second tab/device) skips instead of promoting the
    // same week twice. Reverted on failure.
    // A lease, not a level flip: flipping outline→detailed before the Opus
    // call meant a crash mid-generation left the week "detailed" with
    // placeholder rows forever. A stale lease (>10 min) is reclaimable.
    const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
    const claim = await prisma.planWeek.updateMany({
      where: {
        id: week.id,
        detailLevel: "outline",
        OR: [{ promotionClaimedAt: null }, { promotionClaimedAt: { lt: staleBefore } }],
      },
      data: { promotionClaimedAt: new Date() },
    });
    if (claim.count === 0) continue; // another request holds the lease

    const weekStart = format(new Date(week.startDate), "yyyy-MM-dd");
    const sessionTypes = (week.sessionTypes as string[]) || [];
    const phaseName = week.phase?.name || "Training";

    // Use Opus to generate detailed workouts for this week
    try {
      const response = await anthropic.messages
        .stream({
          model: COACH_MODEL,
          // Opus 5 thinks by default; a week of workout JSON plus thinking
          // needs headroom (streaming, so the ceiling is free).
          max_tokens: 16000,
          system: `You are Brocco, a running coach. Generate detailed workouts for one week of a training plan. Return ONLY a JSON array of workout objects. No other text.

Plan: ${plan.name} (${plan.goal})
Phase: ${phaseName}
Week ${week.weekNumber}, starting ${weekStart}
Target: ~${week.targetKm || 0}km, ${week.targetSessions || 0} sessions
Session types: ${sessionTypes.join(", ") || "mixed"}
${week.notes ? `Notes: ${week.notes}` : ""}

${context}

Each workout object must have: date (ISO), title, workout_type (easy/long/tempo/interval/race_pace/recovery/rest/cross_training/strength/race), target_distance_km (number), target_pace (string like "5:00-5:15/km"), description (string with warm-up, main set, cool-down details). For interval/tempo/race_pace workouts ALSO include steps: an array of structured steps for the watch — [{kind:"warmup",duration_min,pace},{kind:"repeat",times,steps:[{kind:"work",distance_km,pace},{kind:"recovery",duration_min,pace}]},{kind:"cooldown",duration_min,pace}] with pace like "4:25-4:35/km". Omit steps for easy/long/recovery runs.

Generate one workout per day (Mon-Sun). Include rest days. Unless the week is a race or taper week, include 1-2 short S&C sessions (workout_type "strength", activity_type "strength", target_duration_min 15-25, title like "S&C: Core & Hips", short description like "core + hip stability circuit") on easy or rest days, never the day before a hard session — these get a guided timer session in the app automatically.`,
          messages: [{ role: "user", content: "Generate the detailed workouts for this week as a JSON array." }],
        })
        .finalMessage();

      // find(), not content[0] — with thinking enabled the first block is a
      // thinking block and content[0] silently misses the JSON.
      const textBlock = response.content.find((b) => b.type === "text");
      const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
      // Extract JSON array from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("No JSON array in generation response");

      const generatedWorkouts = JSON.parse(jsonMatch[0]) as Array<{
        date: string;
        title: string;
        workout_type: string;
        activity_type?: string;
        target_distance_km?: number;
        target_pace?: string;
        target_duration_min?: number;
        description?: string;
        steps?: unknown;
      }>;

      if (generatedWorkouts.length === 0) throw new Error("Generation returned zero workouts");

      // Merge, never replace. Sessions that already happened, were skipped,
      // were adjusted by hand, or whose day has passed are kept exactly as
      // they are; only future rows that are still plain "planned" get swapped
      // for the detailed generation. (The old deleteMany on the whole week
      // erased Monday's completed run on a Wednesday promotion.)
      const kept = await prisma.plannedWorkout.findMany({
        where: {
          planId: plan.id,
          weekNumber: week.weekNumber,
          OR: [{ status: { not: "planned" } }, { date: { lt: todayWall } }],
        },
        select: { date: true },
      });
      const keptDays = new Set(kept.map((k) => wallDateString(k.date)));
      const fresh = generatedWorkouts.filter((w) => {
        const d = new Date(w.date);
        return !Number.isNaN(d.getTime()) && !keptDays.has(w.date.slice(0, 10));
      });

      await prisma.$transaction([
        prisma.plannedWorkout.deleteMany({
          where: { planId: plan.id, weekNumber: week.weekNumber, status: "planned", date: { gte: todayWall } },
        }),
        prisma.planWeek.update({
          where: { id: week.id },
          data: { detailLevel: "detailed", promotionClaimedAt: null },
        }),
        prisma.plannedWorkout.createMany({
          data: fresh.map((w) => ({
            planId: plan.id,
            phaseId: week.phaseId,
            weekNumber: week.weekNumber,
            date: new Date(w.date),
            title: w.title,
            workoutType: (w.workout_type || "easy") as "easy" | "long" | "tempo" | "interval" | "race_pace" | "recovery" | "rest" | "cross_training" | "strength" | "race" | "climbing",
            activityType: (w.activity_type || "run") as "run" | "cycle" | "swim" | "hike" | "strength" | "rest" | "other" | "climb",
            detailLevel: "detailed" as const,
            targetDistanceKm: w.target_distance_km ?? null,
            targetPace: w.target_pace || null,
            targetDurationMin: w.target_duration_min ?? null,
            description: w.description || null,
            steps: w.steps ?? undefined,
            status: "planned" as const,
          })),
        }),
      ]);

      promoted++;
    } catch (err) {
      console.error(`Failed to promote week ${week.weekNumber}:`, err);
      // Release the lease; the week is still "outline" with its workouts
      // intact and will be retried on the next trigger.
      await prisma.planWeek
        .update({ where: { id: week.id }, data: { promotionClaimedAt: null } })
        .catch(() => {});
    }
  }

  // Promote the next target week(s) to outline (maintain 2 outline weeks ahead)
  const currentOutlineCount = await prisma.planWeek.count({
    where: { planId: plan.id, detailLevel: "outline" },
  });

  const neededOutlines = Math.max(0, 2 - currentOutlineCount);
  if (neededOutlines > 0) {
    const targetWeeks = await prisma.planWeek.findMany({
      where: { planId: plan.id, detailLevel: "target" },
      orderBy: { weekNumber: "asc" },
      take: neededOutlines,
    });

    for (const tw of targetWeeks) {
      // Promote to outline with basic workouts
      await prisma.planWeek.update({
        where: { id: tw.id },
        data: { detailLevel: "outline" },
      });

      // Create outline workouts (type + approximate distance only)
      const sessionTypes = (tw.sessionTypes as string[]) || [];
      const twStart = new Date(tw.startDate);
      const kmPerSession = tw.targetKm ? Number(tw.targetKm) / Math.max(sessionTypes.length, tw.targetSessions || 1) : 8;

      const typeMap: Record<string, string> = {
        E: "easy", I: "interval", T: "tempo", L: "long", R: "rest",
        S: "strength", X: "cross_training", P: "race_pace", V: "recovery",
        // Climbing plans (see the PRIMARY SPORT prompt block): B boulder,
        // C routes/general climbing. R stays rest, S stays strength.
        B: "climbing", C: "climbing",
      };

      for (let d = 0; d < 7; d++) {
        const date = addDaysWall(twStart, d);
        const code = sessionTypes[d] || (d === 6 ? "R" : "E");
        const wt = typeMap[code] || "easy";
        const isRest = wt === "rest";
        const isClimb = wt === "climbing";

        await prisma.plannedWorkout.create({
          data: {
            planId: plan.id,
            phaseId: tw.phaseId,
            weekNumber: tw.weekNumber,
            date,
            title: isRest ? "Rest" : isClimb ? (code === "B" ? "Bouldering" : "Climbing session") : `${wt.charAt(0).toUpperCase() + wt.slice(1)} Run`,
            workoutType: wt as "easy" | "long" | "tempo" | "interval" | "race_pace" | "recovery" | "rest" | "cross_training" | "strength" | "race" | "climbing",
            detailLevel: "outline" as const,
            // Sessions-based sports carry no km — Brocco fills duration and
            // focus when the week is promoted to detailed.
            targetDistanceKm: isRest || isClimb ? null : Math.round(kmPerSession * 10) / 10,
            status: "planned" as const,
            ...(isClimb ? { activityType: "climb" as const } : {}),
          },
        });
      }
    }
  }

  // Update actual_km on past weeks
  const pastWeeks = await prisma.planWeek.findMany({
    where: {
      planId: plan.id,
      startDate: { lt: thisMonday },
      actualKm: null,
    },
  });

  for (const pw of pastWeeks) {
    const weekEnd = addDaysWall(new Date(pw.startDate), 6);
    const activities = await prisma.activity.findMany({
      where: {
        userId,
        startDateLocal: { gte: new Date(pw.startDate), lte: weekEnd },
        activityType: { in: ["Run", "TrailRun", "VirtualRun", "Treadmill"] },
      },
      select: { distanceKm: true },
    });
    const actualKm = activities.reduce((sum, a) => sum + (a.distanceKm ? Number(a.distanceKm) : 0), 0);
    await prisma.planWeek.update({
      where: { id: pw.id },
      data: { actualKm: Math.round(actualKm * 10) / 10 },
    });
  }

  if (promoted > 0) {
    syncWorkoutsInBackground(userId); // freshly detailed week → watch calendar
  }

  return { promoted };
}
