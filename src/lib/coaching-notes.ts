import Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { UTILITY_MODEL } from "@/lib/models";

const anthropic = new Anthropic();

/**
 * Coaching notes are deep-merged forever (save_profile coaching_notes_update)
 * and the coach invents a new key for most things it learns, so they only
 * grow. In production they reached ~32k characters — over half of the
 * context sent with every chat message. Past this size they get condensed.
 */
const CONSOLIDATE_ABOVE_CHARS = 6000;
const TARGET_CHARS = 3500;

/**
 * Keys starting with "_" are bookkeeping (the pre-consolidation backup) and
 * never reach the prompt.
 */
const ARCHIVE_KEY = "_before_consolidation";

export function renderCoachingNotes(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const lines: string[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.startsWith("_") || value == null) continue;
    lines.push(`- ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
  return lines.length > 0 ? `COACHING NOTES:\n${lines.join("\n")}\n` : "";
}

function renderedSize(raw: unknown): number {
  return renderCoachingNotes(raw).length;
}

/**
 * Rewrites oversized coaching notes into a compact object: durable facts
 * kept, duplicates merged, one-off and dated items that have passed dropped.
 * The previous version is kept under ARCHIVE_KEY (unrendered) so nothing is
 * lost for good. Fire-and-forget: the request that triggers it still sends
 * the old notes; the next one gets the compact version.
 *
 * Only writes if the notes haven't changed while the model was working — a
 * save_profile in the same moment must not be overwritten.
 */
export async function consolidateCoachingNotesIfLarge(userId: string): Promise<void> {
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { coachingNotes: true, timezone: true },
    });
    const notes = profile?.coachingNotes;
    if (!notes || typeof notes !== "object" || Array.isArray(notes)) return;
    if (renderedSize(notes) <= CONSOLIDATE_ABOVE_CHARS) return;

    const visible = Object.fromEntries(
      Object.entries(notes as Record<string, unknown>).filter(([k]) => !k.startsWith("_"))
    );
    const today = new Date().toISOString().slice(0, 10);

    const response = await anthropic.messages.create({
      model: UTILITY_MODEL,
      max_tokens: 8000,
      output_config: { effort: "low" },
      system:
        `You maintain an endurance coach's notes about one athlete. Today is ${today}. Rewrite the notes below into a compact JSON object of at most ${TARGET_CHARS} characters. ` +
        `KEEP every durable fact: injuries and medical history, physical limitations, preferences (days, times, sports, terrain, food), goals and race history, life constraints, how the athlete likes to be coached, and agreements still in force. ` +
        `MERGE duplicates and near-duplicates into one statement; when two notes conflict, keep the newer one. ` +
        `DROP one-off items whose date has passed (a session missed weeks ago, "test the knee Thursday" long after Thursday), small talk, and anything that is just training data (distances run, sessions completed). ` +
        `Use a handful of descriptive snake_case keys (e.g. injury_history, preferences, goals, race_history, life_constraints, coaching_style, open_followups); values are short strings, one fact per sentence. Keep the language the notes are written in. ` +
        `Return ONLY the JSON object.`,
      messages: [{ role: "user", content: JSON.stringify(visible) }],
    });

    const block = response.content.find((b) => b.type === "text");
    const text = block && block.type === "text" ? block.text : "";
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    let condensed: Record<string, unknown>;
    try {
      condensed = JSON.parse(json);
    } catch {
      console.warn(`[coaching-notes] consolidation returned no parseable JSON (user=${userId.slice(0, 8)})`);
      return;
    }
    if (!condensed || typeof condensed !== "object" || Array.isArray(condensed) || Object.keys(condensed).length === 0) return;
    // A "condensed" version that isn't smaller is a failed run, not progress.
    if (renderedSize(condensed) >= renderedSize(notes)) return;

    const updated = await prisma.userProfile.updateMany({
      where: { userId, coachingNotes: { equals: notes as Prisma.InputJsonValue } },
      data: { coachingNotes: { ...condensed, [ARCHIVE_KEY]: visible } as Prisma.InputJsonValue },
    });
    console.log(
      `[coaching-notes] consolidated ${renderedSize(notes)} → ${renderedSize(condensed)} chars ` +
        `(user=${userId.slice(0, 8)}${updated.count === 0 ? ", skipped: notes changed meanwhile" : ""})`
    );
  } catch (err) {
    console.error(`[coaching-notes] consolidation failed (user=${userId.slice(0, 8)}):`, err);
  }
}
