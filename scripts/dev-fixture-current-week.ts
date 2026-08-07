/**
 * Dev-only fixture: give the local seed user a training block that spans TODAY,
 * so every surface has something to render.
 *   npx tsx scripts/dev-fixture-current-week.ts
 *
 * The committed seed plan is dated March 2026. Against a later system clock the
 * Plan tab shows its not-started/finished state, the Calendar week is blank and
 * the goal tracker has nothing to count — which makes the app look broken when
 * it isn't. This builds a 20-week block centred on the current week, with real
 * activities behind it so done/missed reconciliation has something to reconcile.
 *
 * Refuses to run against anything but a local database.
 */
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
config();

const prisma = new PrismaClient();
const EMAIL = process.env.FIXTURE_EMAIL || "jan@brocco.run";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

function mondayOf(d: Date): Date {
  const wall = D(iso(d));
  const dow = wall.getUTCDay() === 0 ? 7 : wall.getUTCDay();
  return addDays(wall, -(dow - 1));
}

async function main() {
  const url = process.env.DATABASE_URL || "";
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error("Refusing to run: DATABASE_URL is not local. This is a dev fixture.");
  }

  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) throw new Error(`No user ${EMAIL}. Run \`npm run db:seed\` first.`);

  const thisMonday = mondayOf(new Date());
  const startWeek = -5;               // block began 5 weeks ago
  const totalWeeks = 20;
  const planStart = addDays(thisMonday, startWeek * 7);
  const planEnd = addDays(planStart, totalWeeks * 7 - 1);
  const raceDate = addDays(planEnd, 1);

  // Old plans step aside rather than being deleted — nothing here should throw
  // away data someone might still want to look at.
  await prisma.plan.updateMany({
    where: { userId: user.id, status: "active" },
    data: { status: "completed" },
  });

  const plan = await prisma.plan.create({
    data: {
      userId: user.id,
      name: "Barcelona Marathon",
      goal: "Sub 4:00 at Barcelona",
      startDate: planStart, endDate: planEnd, raceDate,
      status: "active",
      phases: { create: [
        { name: "Base",  orderIndex: 0, startWeek: 1,  endWeek: 8,  description: "Aerobic volume" },
        { name: "Build", orderIndex: 1, startWeek: 9,  endWeek: 16, description: "Threshold and race pace" },
        { name: "Peak",  orderIndex: 2, startWeek: 17, endWeek: 20, description: "Sharpen, then taper" },
      ] },
    },
    include: { phases: true },
  });

  const phaseFor = (w: number) =>
    plan.phases.find((p) => w >= p.startWeek && w <= p.endWeek)?.id ?? null;

  // Volume ramps with a down week every fourth, so the block chart has shape.
  for (let i = 0; i < totalWeeks; i++) {
    const weekNumber = i + 1;
    const base = 32 + i * 1.8;
    const down = weekNumber % 4 === 0;
    await prisma.planWeek.create({
      data: {
        planId: plan.id, phaseId: phaseFor(weekNumber), weekNumber,
        startDate: addDays(planStart, i * 7),
        detailLevel: i <= -startWeek + 1 ? "detailed" : "outline",
        targetKm: Math.round((down ? base * 0.7 : base) * 10) / 10,
        targetSessions: down ? 4 : 5,
        notes: down ? "Down week — let the last three weeks land." : null,
      },
    });
  }

  const currentWeekNumber = -startWeek + 1;
  const mk = (
    dayOffsetFromThisMonday: number, weekNumber: number, title: string, type: string,
    activityType: string, km: number | null, pace: string | null, durationMin: number | null,
    description: string | null = null, steps: unknown = undefined
  ) =>
    prisma.plannedWorkout.create({ data: {
      planId: plan.id, phaseId: phaseFor(weekNumber), weekNumber,
      date: addDays(thisMonday, dayOffsetFromThisMonday),
      title, workoutType: type as never, activityType: activityType as never,
      targetDistanceKm: km, targetPace: pace, targetDurationMin: durationMin,
      description, steps: steps as never, status: "planned" as never,
    } });

  // Last week — fully in the past, so it reconciles to done/missed.
  await mk(-7, currentWeekNumber - 1, "Easy Run", "easy", "run", 8, "6:00-6:30/km", null);
  await mk(-5, currentWeekNumber - 1, "Intervals", "interval", "run", 10, "4:30/km", null);
  await mk(-3, currentWeekNumber - 1, "Easy Run", "easy", "run", 8, "6:00-6:30/km", null);
  await mk(-1, currentWeekNumber - 1, "Long Run", "long", "run", 18, "6:00-6:30/km", null);

  // This week — the one under test.
  await mk(0, currentWeekNumber, "S&C: Core & Hip Stability", "strength", "other", null, null, 45,
    "Single-leg work, hip bridges, calf raises. Your ankle needs the volume more than your legs need the rest.");
  await mk(1, currentWeekNumber, "Easy Run", "easy", "run", 8, "6:00-6:30/km", null,
    "Conversational. If you can't talk, you're going too hard.");
  await mk(2, currentWeekNumber, "Intervals", "interval", "run", 11, "4:25-4:35/km", null,
    "The key session this week. 6x800m at 5k effort with 2 min jog recovery.",
    [
      { kind: "warmup", distance_km: 2.5, pace: "6:00/km" },
      { kind: "repeat", times: 6, steps: [
        { kind: "work", distance_km: 0.8, pace: "4:25-4:35/km", label: "800m rep" },
        { kind: "recovery", duration_min: 2, pace: "6:30/km" },
      ] },
      { kind: "cooldown", distance_km: 2, pace: "6:00/km" },
    ]);
  await mk(3, currentWeekNumber, "Easy Ride", "cross_training", "cycle", null, null, 120,
    "Z2 only. This is recovery that happens to move you forwards.");
  await mk(4, currentWeekNumber, "Easy Run", "easy", "run", 8, "6:00-6:30/km", null);
  await mk(6, currentWeekNumber, "Long Run", "long", "run", 20, "6:00-6:30/km", null,
    "Longest of the block so far. Take gels from 60 minutes.");

  // Next week — so swiping forward lands on something.
  await mk(7, currentWeekNumber + 1, "Easy Run", "easy", "run", 8, "6:00-6:30/km", null);
  await mk(9, currentWeekNumber + 1, "Tempo", "tempo", "run", 12, "5:00/km", null);
  await mk(13, currentWeekNumber + 1, "Long Run", "long", "run", 22, "6:00-6:30/km", null);

  // Actual activities: last week complete, this week partly done — including
  // two strength sessions so the goal tracker reads 2 of 4 rather than 0.
  const act = (dayOffset: number, name: string, type: string, km: number | null, min: number, pace: string | null, hr: number | null) =>
    prisma.activity.create({ data: {
      userId: user.id, source: "strava", name, activityType: type,
      distanceKm: km, durationMin: min, avgPacePerKm: pace, avgHeartRate: hr,
      startDate: addDays(thisMonday, dayOffset), startDateLocal: addDays(thisMonday, dayOffset),
    } });

  await act(-7, "Morning Run", "Run", 8.1, 50, "6:10/km", 138);
  await act(-5, "6x800m", "Run", 10.2, 52, "5:05/km", 162);
  await act(-3, "Easy shakeout", "Run", 8.0, 49, "6:08/km", 136);
  await act(-1, "Long one", "Run", 18.3, 112, "6:07/km", 145);
  await act(0, "Gym — lower body", "WeightTraining", null, 48, null, null);
  await act(1, "Morning Run", "Run", 8.2, 51, "6:12/km", 139);
  await act(2, "Ankle rehab", "WeightTraining", null, 25, null, null);

  // Two goals: one auto-counted and part-done, one that cannot be auto-counted
  // so the "ask how it went" path is visible too.
  const goalWeek = thisMonday;
  await prisma.weeklyGoal.deleteMany({ where: { userId: user.id, weekStart: goalWeek } });
  await prisma.weeklyGoal.createMany({ data: [
    { userId: user.id, weekStart: goalWeek, label: "Ankle strength", category: "strength" as never, targetCount: 4 },
    { userId: user.id, weekStart: goalWeek, label: "Mobility", category: "mobility" as never, targetCount: 2 },
  ] });

  console.log(`Fixture ready for ${EMAIL}`);
  console.log(`  plan     ${plan.name}: ${iso(planStart)} → ${iso(planEnd)} (${totalWeeks} weeks, race ${iso(raceDate)})`);
  console.log(`  today    ${iso(new Date())} — week ${currentWeekNumber} of ${totalWeeks}, Build phase`);
  console.log(`  goals    Ankle strength 4x (2 already done), Mobility 2x`);
  console.log(`\n  Log in as ${EMAIL} / broccorun2024`);
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
