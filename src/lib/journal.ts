/**
 * Shared constants + helpers for the mood/journal feature.
 *
 * Design notes (from the July 2026 research pass): the winning pattern in
 * this space is Daylio's — a check-in must be possible in two taps with no
 * typing, and the payoff is correlation insights, not the log itself. So
 * moods are a plain 1–5 scale with optional context tags, and the insight
 * surface is the weekly review (mood × training load), not a stats page.
 */

export const MOOD_EMOJI: Record<number, string> = {
  1: "😞",
  2: "😕",
  3: "😐",
  4: "🙂",
  5: "😄",
};

export const MOOD_LABELS: Record<number, string> = {
  1: "Rough",
  2: "Meh",
  3: "OK",
  4: "Good",
  5: "Great",
};

/** Context tags offered on the check-in card (free-form tags also allowed). */
export const MOOD_TAGS = [
  "training",
  "work",
  "family",
  "sleep",
  "health",
  "social",
  "weather",
] as const;

export function moodEmoji(mood: number | null | undefined): string {
  return mood ? MOOD_EMOJI[mood] ?? "" : "";
}

export function moodLabel(mood: number | null | undefined): string {
  return mood ? MOOD_LABELS[mood] ?? "" : "";
}

export interface JournalEntryLike {
  day: string;
  mood: number | null;
  tags: string[];
  text: string | null;
}

/**
 * Compact plain-text rendering of recent entries for Brocco's context and
 * the weekly review — one line per entry, newest first.
 */
export function renderJournalText(entries: JournalEntryLike[]): string {
  if (entries.length === 0) return "(no journal entries)";
  return entries
    .map((e) => {
      const mood = e.mood ? `mood ${e.mood}/5 (${moodLabel(e.mood)})` : "journal";
      const tags = e.tags.length ? ` [${e.tags.join(", ")}]` : "";
      const text = e.text ? ` — ${e.text.length > 200 ? e.text.slice(0, 200) + "…" : e.text}` : "";
      return `${e.day}: ${mood}${tags}${text}`;
    })
    .join("\n");
}

/** Average mood over a set of entries, or null if none carry a mood. */
export function averageMood(entries: JournalEntryLike[]): number | null {
  const moods = entries.filter((e) => e.mood != null).map((e) => e.mood as number);
  if (moods.length === 0) return null;
  return Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 10) / 10;
}
