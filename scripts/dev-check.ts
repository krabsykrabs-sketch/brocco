/* Dev-only sanity check: counts existing data and seeds life-planner test fixtures. */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [users, plans, workouts, msgs, activities, events, todos, notes] = await Promise.all([
    prisma.user.count(),
    prisma.plan.count(),
    prisma.plannedWorkout.count(),
    prisma.chatMessage.count(),
    prisma.activity.count(),
    prisma.event.count(),
    prisma.todo.count(),
    prisma.note.count(),
  ]);
  console.log({ users, plans, workouts, msgs, activities, events, todos, notes });

  const user = await prisma.user.findFirst({ where: { email: "jan@brocco.run" } });
  if (!user) {
    console.log("No jan@brocco.run user found");
    return;
  }
  console.log("user id:", user.id);

  if (process.argv.includes("--fixtures")) {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await prisma.event.create({
      data: {
        userId: user.id,
        title: "Dentist",
        category: "health",
        startAt: new Date(`${today}T15:00:00.000Z`),
        endAt: new Date(`${today}T15:45:00.000Z`),
      },
    });
    await prisma.event.create({
      data: {
        userId: user.id,
        title: "Standup",
        category: "work",
        startAt: new Date(`${today}T10:00:00.000Z`),
        endAt: new Date(`${today}T10:15:00.000Z`),
        recurrence: "daily",
      },
    });
    await prisma.event.create({
      data: {
        userId: user.id,
        title: "Anna's birthday",
        category: "birthday",
        allDay: true,
        startAt: new Date(`${tomorrow}T00:00:00.000Z`),
        recurrence: "yearly",
      },
    });
    const list = await prisma.taskList.create({ data: { userId: user.id, name: "Groceries" } });
    await prisma.todo.createMany({
      data: [
        { userId: user.id, title: "Renew passport", dueDate: new Date(`${today}T00:00:00.000Z`), priority: "high" },
        { userId: user.id, title: "Milk", listId: list.id },
        { userId: user.id, title: "Water plants", recurrence: "weekly", dueDate: new Date(`${today}T00:00:00.000Z`) },
      ],
    });
    await prisma.note.create({
      data: { userId: user.id, title: "Locker code", body: "4821", tags: ["gym"] },
    });
    console.log("fixtures created");
  }
}

main().finally(() => prisma.$disconnect());
