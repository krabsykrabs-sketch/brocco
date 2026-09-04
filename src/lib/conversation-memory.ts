import Anthropic from "@anthropic-ai/sdk";
import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { nowInTimezone } from "@/lib/schedule";
import { UTILITY_MODEL } from "@/lib/models";

const anthropic = new Anthropic();

/**
 * Cross-day conversation memory.
 *
 * Chat sessions are one-per-day, and history is loaded strictly per-session —
 * so before this existed, everything discussed yesterday (why a session was
 * missed, an injury update, a decision) was invisible today, and the coach
 * re-litigated settled topics. Finished sessions get condensed into a few
 * stored lines; the last few summaries are injected into the coach context
 * and the daily opener.
 */

/** The instant of the user's local midnight (start of their today). */
async function localDayStart(userId: string): Promise<Date> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  const localNow = nowInTimezone(profile?.timezone || "Europe/Berlin");
  const [hh, mm] = localNow.slice(11, 16).split(":").map(Number);
  return new Date(Date.now() - (hh * 60 + mm) * 60 * 1000);
}

/**
 * Summarize up to 3 finished (pre-today) general sessions that don't have a
 * summary yet. Fire-and-forget from session-creation and opener paths —
 * never awaited on a user-facing request.
 */
export async function summarizeStaleSessions(userId: string): Promise<void> {
  const dayStart = await localDayStart(userId);
  // Sessions that never received a message carry nothing worth keeping and
  // only clutter the sidebar — sweep the ones from earlier days.
  await prisma.chatSession
    .deleteMany({ where: { userId, createdAt: { lt: dayStart }, messages: { none: {} } } })
    .catch(() => {});
  // "Finished" = not the live thread. The live thread is the most recently
  // used one, unless it has been idle for three days (the rollover rule in
  // /api/chat/sessions) — summarising a thread that will continue tomorrow
  // would freeze its notes at the halfway point.
  const live = await prisma.chatSession.findFirst({
    where: { userId, type: "general", updatedAt: { gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  const stale = await prisma.chatSession.findMany({
    where: {
      userId,
      type: "general",
      summary: null,
      createdAt: { lt: dayStart },
      ...(live ? { id: { not: live.id } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, updatedAt: true },
  });

  for (const s of stale) {
    try {
      const messages = await prisma.chatMessage.findMany({
        where: { sessionId: s.id, role: { in: ["user", "assistant"] } },
        orderBy: { createdAt: "asc" },
        select: { role: true, displayText: true },
      });
      const userTurns = messages.filter((m) => m.role === "user" && (m.displayText || "").trim());
      if (userTurns.length < 2) {
        // Not a real conversation (opener only, or a single drive-by message)
        // — mark summarized-empty so it isn't re-examined every day.
        // Pin updatedAt: a memory write is not activity. Letting Prisma bump it
        // re-dated months-old sessions to today in the sidebar, three per open.
        await prisma.chatSession.update({ where: { id: s.id }, data: { summary: "", updatedAt: s.updatedAt } });
        continue;
      }

      // Newest turns win if the transcript is huge.
      const transcript = messages
        .map((m) => `${m.role === "user" ? "Athlete" : "Brocco"}: ${(m.displayText || "").trim()}`)
        .filter((l) => l.length > (l.startsWith("Athlete") ? 9 : 8))
        .join("\n")
        .slice(-24000);

      const response = await anthropic.messages.create({
        model: UTILITY_MODEL,
        max_tokens: 2000,
        output_config: { effort: "low" },
        system:
          `You condense a coaching conversation into memory notes for the coach's future self. Return ${transcript.length > 6000 ? "up to 12" : "1-5"} short lines, one fact per line, no bullets or headers${transcript.length > 6000 ? ', grouped under the plain-text headings DECISIONS, PLAN CHANGES, HEALTH, OPEN QUESTIONS (skip empty ones)' : ""}: decisions made, plan changes and the reasoning, reasons the athlete gave (e.g. why a session was missed), injuries, medical history or niggles mentioned, preferences expressed, follow-ups agreed and their dates. Concrete and specific; include dates/names when said. OMIT pleasantries, generic advice, and anything already obvious from training data (distances run, sessions completed). If the conversation contains nothing durable, return exactly: NOTHING`,
        messages: [{ role: "user", content: transcript }],
      });
      const block = response.content.find((b) => b.type === "text");
      const text = block && block.type === "text" ? block.text.trim() : "";
      const summary = !text || text === "NOTHING" ? "" : text.slice(0, transcript.length > 6000 ? 3500 : 1500);
      await prisma.chatSession.update({ where: { id: s.id }, data: { summary, updatedAt: s.updatedAt } });
    } catch (err) {
      // Leave summary null — retried on the next trigger.
      console.error(`[conversation-memory] failed to summarize session ${s.id}:`, err);
    }
  }
}

/**
 * The last few days' conversation notes, ready to inject into a prompt.
 * Empty string when there's nothing (new users, quiet weeks).
 */
export async function recentConversationSummaries(userId: string, limit = 3): Promise<string> {
  const sessions = await prisma.chatSession.findMany({
    where: { userId, type: "general", summary: { not: null } },
    orderBy: { createdAt: "desc" },
    take: limit + 2, // a few empties may sit in between
    select: { summary: true, createdAt: true },
  });
  const withContent = sessions.filter((s) => (s.summary || "").trim().length > 0).slice(0, limit);
  if (withContent.length === 0) return "";
  return withContent
    .map((s) => `[${format(s.createdAt, "MMM d")}]\n${s.summary}`)
    .join("\n");
}


/**
 * The tail of the most recent finished conversation, verbatim, when it ended
 * less than `maxAgeHours` ago. A summary is right for last week; for last
 * night the athlete's own words are cheap and far better — the opener that
 * greeted a long medical/plan discussion with an uninformed week check-in
 * had only a five-line digest of it, written seconds too late.
 */
export async function recentConversationTail(
  userId: string,
  opts: { excludeSessionId?: string; maxAgeHours?: number; maxMessages?: number; maxChars?: number } = {}
): Promise<{ text: string; endedAt: Date } | null> {
  const { excludeSessionId, maxAgeHours = 24, maxMessages = 14, maxChars = 4000 } = opts;
  const since = new Date(Date.now() - maxAgeHours * 3600 * 1000);
  const last = await prisma.chatMessage.findFirst({
    where: {
      role: "user",
      createdAt: { gte: since },
      session: { userId, type: "general", ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}) },
    },
    orderBy: { createdAt: "desc" },
    select: { sessionId: true, createdAt: true },
  });
  if (!last) return null;
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId: last.sessionId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "desc" },
    take: maxMessages,
    select: { role: true, displayText: true },
  });
  const lines = rows
    .reverse()
    .map((m) => `${m.role === "user" ? "Athlete" : "Brocco"}: ${(m.displayText || "").replace(/\s+/g, " ").trim()}`)
    .filter((l) => l.length > 9);
  let text = lines.join("\n");
  if (text.length > maxChars) text = "…" + text.slice(-maxChars);
  return text ? { text, endedAt: last.createdAt } : null;
}

let sweeperStarted = false;
/** Hourly in-process sweep, started from instrumentation.ts. Independent of
 * push: the reminder scheduler goes idle without VAPID keys, this must not. */
export function startConversationSweeper(): void {
  if (sweeperStarted) return;
  sweeperStarted = true;
  const run = () => sweepAllConversations().catch((err) => console.error("[conversation-memory] sweep failed:", err));
  setTimeout(run, 2 * 60 * 1000); // shortly after boot, then hourly
  setInterval(run, 60 * 60 * 1000);
}

/** Nightly/hourly sweep for every user with something to condense. */
export async function sweepAllConversations(): Promise<void> {
  const users = await prisma.chatSession.findMany({
    where: { type: "general", summary: null },
    distinct: ["userId"],
    select: { userId: true },
    take: 50,
  });
  for (const u of users) {
    await summarizeStaleSessions(u.userId).catch(() => {});
  }
}

/** Race a promise against a deadline; resolves undefined on timeout. */
export async function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
