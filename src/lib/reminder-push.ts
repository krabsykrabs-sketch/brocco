import { prisma } from "@/lib/db";
import { getEventOccurrences, nowInTimezone, todayInTimezone, addDaysWall, parseWall, wallDateString } from "@/lib/schedule";
import { resolveFeatures } from "@/lib/features";
import { sendPushToUser, pushConfigured } from "@/lib/push";
import { serverTranslator } from "@/lib/i18n-server";
import { resolveLang } from "@/lib/i18n";

/**
 * In-process reminder scheduler: every minute, scan upcoming event reminders
 * for every user with push subscriptions and send a push when a reminder
 * window opens. Started once per server process from src/instrumentation.ts.
 *
 * Dedup is in-memory: a restart inside an open reminder window can re-send
 * one notification (the `tag` makes the device coalesce them) — acceptable
 * for this app; a sent-log table would be the upgrade if it ever isn't.
 */

const TICK_MS = 60 * 1000;
let started = false;
const sentKeys = new Map<string, string>(); // occurrenceKey -> date, for pruning

function pruneSent(today: string) {
  for (const [key, date] of sentKeys) {
    if (date < today) sentKeys.delete(key);
  }
}

export function startReminderScheduler() {
  if (started) return;
  started = true;
  if (!pushConfigured()) {
    console.log("[reminder-push] VAPID keys not configured — scheduler idle");
    return;
  }
  console.log("[reminder-push] scheduler started");
  setInterval(() => {
    tick().catch((err) => console.error("[reminder-push] tick failed:", err));
  }, TICK_MS);
}

export async function tick(): Promise<void> {
  // Only users who actually have a subscribed device
  const subs = await prisma.pushSubscription.findMany({
    select: { userId: true },
    distinct: ["userId"],
  });
  if (subs.length === 0) return;

  for (const { userId } of subs) {
    try {
      await checkUserReminders(userId);
    } catch (err) {
      console.error(`[reminder-push] user ${userId} failed:`, err);
    }
  }
}

async function checkUserReminders(userId: string): Promise<void> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { timezone: true, features: true, language: true },
  });
  if (!profile) return;
  if (!resolveFeatures(profile.features).calendar) return;
  const t = serverTranslator(resolveLang(profile.language));

  const tz = profile.timezone || "Europe/Berlin";
  const today = todayInTimezone(tz);
  const nowWall = nowInTimezone(tz); // yyyy-MM-ddTHH:mm
  pruneSent(today);

  // Reminders can be up to a day ahead (1440 min) — scan today and tomorrow
  const tomorrow = wallDateString(addDaysWall(parseWall(today), 1));
  const occurrences = await getEventOccurrences(userId, today, tomorrow);

  for (const occ of occurrences) {
    if (occ.reminderMinutes == null || occ.allDay || occ.continuation) continue;
    if (sentKeys.has(occ.occurrenceKey)) continue;

    // remindAt = start - reminderMinutes, in wall time
    const startMs = new Date(`${occ.start}:00.000Z`).getTime();
    const remindAtMs = startMs - occ.reminderMinutes * 60 * 1000;
    const nowMs = new Date(`${nowWall}:00.000Z`).getTime();

    if (nowMs >= remindAtMs && nowMs < startMs) {
      const minsLeft = Math.max(1, Math.round((startMs - nowMs) / 60000));
      const startTime = occ.start.slice(11, 16);
      sentKeys.set(occ.occurrenceKey, occ.date); // mark before sending — better to miss once than spam
      const result = await sendPushToUser(userId, {
        title: `⏰ ${occ.title}`,
        body: `${t("push.reminderBody", { time: startTime, min: minsLeft })}${occ.location ? ` · ${occ.location}` : ""}`,
        url: "/today",
        tag: `reminder-${occ.occurrenceKey}`,
      });
      console.log(`[reminder-push] ${occ.occurrenceKey}: sent=${result.sent} pruned=${result.pruned}`);
    }
  }
}
