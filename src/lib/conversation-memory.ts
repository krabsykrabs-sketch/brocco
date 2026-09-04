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
  const stale = await prisma.chatSession.findMany({
    where: { userId, type: "general", summary: null, createdAt: { lt: dayStart } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true },
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
        await prisma.chatSession.update({ where: { id: s.id }, data: { summary: "" } });
        continue;
      }

      // Newest turns win if the transcript is huge.
      const transcript = messages
        .map((m) => `${m.role === "user" ? "Athlete" : "Brocco"}: ${(m.displayText || "").trim()}`)
        .filter((l) => l.length > (l.startsWith("Athlete") ? 9 : 8))
        .join("\n")
        .slice(-10000);

      const response = await anthropic.messages.create({
        model: UTILITY_MODEL,
        max_tokens: 2000,
        output_config: { effort: "low" },
        system:
          "You condense a coaching conversation into memory notes for the coach's future self. Return 1-5 short lines, one fact per line, no bullets or headers: decisions made, reasons the athlete gave (e.g. why a session was missed), injuries or niggles mentioned, preferences expressed, follow-ups agreed. Concrete and specific; include dates/names when said. OMIT pleasantries, generic advice, and anything already obvious from training data (distances run, sessions completed). If the conversation contains nothing durable, return exactly: NOTHING",
        messages: [{ role: "user", content: transcript }],
      });
      const block = response.content.find((b) => b.type === "text");
      const text = block && block.type === "text" ? block.text.trim() : "";
      const summary = !text || text === "NOTHING" ? "" : text.slice(0, 1500);
      await prisma.chatSession.update({ where: { id: s.id }, data: { summary } });
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
