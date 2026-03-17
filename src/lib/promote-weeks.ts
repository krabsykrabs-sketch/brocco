import { prisma } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { buildCoachContext } from "@/lib/coach-context";
import { format, startOfWeek, addDays } from "date-fns";

const anthropic = new Anthropic();

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

  const now = new Date();
  const thisMonday = startOfWeek(now, { weekStartsOn: 1 });
  const nextMonday = addDays(thisMonday, 7);

  // Find outline weeks that should be promoted to detailed
  // (start_date is this week or next week)
  const outlineWeeks = await prisma.planWeek.findMany({
    where: {
      planId: plan.id,
      detailLevel: "outline",
      startDate: { lte: addDays(nextMonday, 6) },
    },
    orderBy: { weekNumber: "asc" },
    include: { phase: { select: { name: true } } },
  });

  if (outlineWeeks.length === 0) return { promoted: 0 };

  // Build context for Opus to generate detailed workouts
  const context = await buildCoachContext(userId);
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  const userName = (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name || "Runner";

  let promoted = 0;

  for (const week of outlineWeeks) {
    // Delete existing outline workouts for this week (will be replaced with detailed ones)
    await prisma.plannedWorkout.deleteMany({
      where: { planId: plan.id, weekNumber: week.weekNumber },
    });

    const weekStart = format(new Date(week.startDate), "yyyy-MM-dd");
    const sessionTypes = (week.sessionTypes as string[]) || [];
    const phaseName = week.phase?.name || "Training";

    // Use Opus to generate detailed workouts for this week
    try {
      const response = await anthropic.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 4096,
        system: `You are Brocco, a running coach. Generate detailed workouts for one week of a training plan. Return ONLY a JSON array of workout objects. No other text.

Plan: ${plan.name} (${plan.goal})
Phase: ${phaseName}
Week ${week.weekNumber}, starting ${weekStart}
Target: ~${week.targetKm || 0}km, ${week.targetSessions || 0} sessions
Session types: ${sessionTypes.join(", ") || "mixed"}
${week.notes ? `Notes: ${week.notes}` : ""}

${context}

Each workout object must have: date (ISO), title, workout_type (easy/long/tempo/interval/race_pace/recovery/rest/cross_training/strength/race), target_distance_km (number), target_pace (string like "5:00-5:15/km"), description (string with warm-up, main set, cool-down details).

Generate one workout per day (Mon-Sun). Include rest days.`,
        messages: [{ role: "user", content: "Generate the detailed workouts for this week as a JSON array." }],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      // Extract JSON array from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) continue;

      const generatedWorkouts = JSON.parse(jsonMatch[0]) as Array<{
        date: string;
        title: string;
        workout_type: string;
        activity_type?: string;
        target_distance_km?: number;
        target_pace?: string;
        target_duration_min?: number;
        description?: string;
      }>;

      // Create detailed workouts
      await prisma.plannedWorkout.createMany({
        data: generatedWorkouts.map((w) => ({
          planId: plan.id,
          phaseId: week.phaseId,
          weekNumber: week.weekNumber,
          date: new Date(w.date),
          title: w.title,
          workoutType: (w.workout_type || "easy") as "easy" | "long" | "tempo" | "interval" | "race_pace" | "recovery" | "rest" | "cross_training" | "strength" | "race",
          activityType: (w.activity_type || "run") as "run" | "cycle" | "swim" | "hike" | "strength" | "rest" | "other",
          detailLevel: "detailed" as const,
          targetDistanceKm: w.target_distance_km ?? null,
          targetPace: w.target_pace || null,
          targetDurationMin: w.target_duration_min ?? null,
          description: w.description || null,
          status: "planned" as const,
        })),
      });

      // Mark week as detailed
      await prisma.planWeek.update({
        where: { id: week.id },
        data: { detailLevel: "detailed" },
      });

      promoted++;
    } catch (err) {
      console.error(`Failed to promote week ${week.weekNumber}:`, err);
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
      };

      for (let d = 0; d < 7; d++) {
        const date = addDays(twStart, d);
        const code = sessionTypes[d] || (d === 6 ? "R" : "E");
        const wt = typeMap[code] || "easy";
        const isRest = wt === "rest";

        await prisma.plannedWorkout.create({
          data: {
            planId: plan.id,
            phaseId: tw.phaseId,
            weekNumber: tw.weekNumber,
            date,
            title: isRest ? "Rest" : `${wt.charAt(0).toUpperCase() + wt.slice(1)} Run`,
            workoutType: wt as "easy" | "long" | "tempo" | "interval" | "race_pace" | "recovery" | "rest" | "cross_training" | "strength" | "race",
            detailLevel: "outline" as const,
            targetDistanceKm: isRest ? null : Math.round(kmPerSession * 10) / 10,
            status: "planned" as const,
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
    const weekEnd = addDays(new Date(pw.startDate), 6);
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

  return { promoted };
}
