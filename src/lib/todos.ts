import { prisma } from "@/lib/db";
import type { Todo, RecurrenceFreq } from "@prisma/client";
import { addDays, addWeeks, addMonths, addYears } from "date-fns";
import { parseWall, wallDateString } from "@/lib/schedule";

function nextDueDate(current: Date, freq: RecurrenceFreq, interval: number): Date {
  const i = Math.max(1, interval);
  switch (freq) {
    case "daily": return addDays(current, i);
    case "weekly": return addWeeks(current, i);
    case "monthly": return addMonths(current, i);
    case "yearly": return addYears(current, i);
    default: return current;
  }
}

/**
 * Toggle a todo's done state. Completing a recurring todo spawns the next
 * occurrence (due date advanced from the completed one's due date).
 * Returns the updated todo and the regenerated next occurrence, if any.
 */
export async function setTodoDone(
  userId: string,
  todoId: string,
  done: boolean
): Promise<{ todo: Todo; nextOccurrence: Todo | null } | null> {
  const todo = await prisma.todo.findFirst({ where: { id: todoId, userId } });
  if (!todo) return null;

  const updated = await prisma.todo.update({
    where: { id: todoId },
    data: { done, completedAt: done ? new Date() : null },
  });

  let nextOccurrence: Todo | null = null;
  if (done && !todo.done && todo.recurrence !== "none" && todo.dueDate) {
    // Don't double-spawn if the next occurrence already exists (same title + recurrence, open)
    const next = nextDueDate(todo.dueDate, todo.recurrence, todo.recurrenceInterval);
    const existing = await prisma.todo.findFirst({
      where: { userId, title: todo.title, done: false, recurrence: todo.recurrence, dueDate: next },
    });
    if (!existing) {
      nextOccurrence = await prisma.todo.create({
        data: {
          userId,
          listId: todo.listId,
          title: todo.title,
          notes: todo.notes,
          dueDate: next,
          dueTime: todo.dueTime,
          priority: todo.priority,
          recurrence: todo.recurrence,
          recurrenceInterval: todo.recurrenceInterval,
          position: todo.position,
        },
      });
    }
  }

  return { todo: updated, nextOccurrence };
}

/** Find a task list by (case-insensitive) name, creating it if needed. */
export async function resolveListByName(userId: string, name: string): Promise<{ id: string; name: string; created: boolean }> {
  const existing = await prisma.taskList.findFirst({
    where: { userId, name: { equals: name, mode: "insensitive" } },
  });
  if (existing) return { id: existing.id, name: existing.name, created: false };
  const count = await prisma.taskList.count({ where: { userId } });
  const list = await prisma.taskList.create({ data: { userId, name, position: count } });
  return { id: list.id, name: list.name, created: true };
}

/** Parse a "yyyy-MM-dd" due date defensively. Returns null for missing/invalid input. */
export function parseDueDate(s: unknown): Date | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  return parseWall(s.slice(0, 10));
}

export { wallDateString };
