/* Dev-only: exercise the reminder scheduler tick directly. */
import { PrismaClient } from "@prisma/client";
import { tick } from "../src/lib/reminder-push";

const prisma = new PrismaClient();

function wall(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function main() {
  const mode = process.argv[2]; // "setup" | "tick" | "cleanup"
  const user = await prisma.user.findFirst({ where: { email: "jan@brocco.run" } });
  if (!user) throw new Error("seed user not found");

  if (mode === "setup") {
    // Event starting in 5 minutes (Berlin local == dev machine local), reminder 10 min before -> window open NOW
    const start = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.event.create({
      data: {
        userId: user.id,
        title: "Push test event",
        category: "other",
        startAt: new Date(`${wall(start)}:00.000Z`),
        reminderMinutes: 10,
      },
    });
    await prisma.pushSubscription.create({
      data: {
        userId: user.id,
        endpoint: "https://fcm.googleapis.com/fcm/send/fake-scheduler-test",
        p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
        auth: "tBHItJI5svbpez7KI4CCXg",
      },
    });
    console.log("setup done: event in 5min with 10min reminder + fake subscription");
  } else if (mode === "tick") {
    await tick();
    const remaining = await prisma.pushSubscription.count({ where: { userId: user.id } });
    console.log(`tick done; remaining subscriptions: ${remaining} (0 = dead sub pruned after attempted send)`);
  } else if (mode === "cleanup") {
    await prisma.event.deleteMany({ where: { userId: user.id, title: "Push test event" } });
    await prisma.pushSubscription.deleteMany({ where: { userId: user.id } });
    console.log("cleaned up");
  }
}

main().finally(() => prisma.$disconnect());
