import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const p = new PrismaClient();
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
async function main() {
  const u = await p.user.create({ data: {
    email: "legacy-test@test.local", name: "Legacy", passwordHash: await bcrypt.hash("legacytest123", 12),
    profile: { create: { timezone: "Europe/Berlin" } },
  }});
  // A plan shaped like the ones generated before PlanWeek existed: NO weeks rows.
  const plan = await p.plan.create({ data: {
    userId: u.id, name: "Valencia Marathon 2026", goal: "sub 3:30",
    startDate: D("2026-07-27"), endDate: D("2026-09-06"), raceDate: D("2026-09-06"), status: "active",
    phases: { create: [{ name: "Base", orderIndex: 0, startWeek: 1, endWeek: 6 }] },
  }});
  for (let wk = 1; wk <= 6; wk++) {
    for (const [d, title, type, km] of [[0,"Easy Run","easy",8],[2,"Intervals","interval",10],[5,"Long Run","long",18]] as const) {
      await p.plannedWorkout.create({ data: {
        planId: plan.id, weekNumber: wk, date: new Date(D("2026-07-27").getTime() + ((wk-1)*7+d)*86400000),
        title, workoutType: type as never, activityType: "run", targetDistanceKm: km, status: "planned" as never,
      }});
    }
  }
  console.log("legacy user ready:", u.id, "| weeks rows:", await p.planWeek.count({ where: { planId: plan.id } }));
}
main().finally(() => p.$disconnect());
