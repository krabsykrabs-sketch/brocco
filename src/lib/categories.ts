/**
 * Event category display metadata — colors tuned for the cream Sticker
 * theme: `color` is the saturated stripe/dot hue (must hold its own next
 * to the ink outline), `bg` is a light tinted fill for chips/rows.
 */

export const EVENT_CATEGORY_META: Record<string, { label: string; color: string; bg: string; emoji: string }> = {
  work: { label: "Work", color: "#4a90d6", bg: "bg-[#e3eefa] border-ink", emoji: "💼" },
  family: { label: "Family", color: "#e8a13c", bg: "bg-[#faeed8] border-ink", emoji: "🏠" },
  training: { label: "Training", color: "#9ccb2e", bg: "bg-sprout border-ink", emoji: "🏃" },
  social: { label: "Social", color: "#a86fd1", bg: "bg-[#f0e6f8] border-ink", emoji: "🎉" },
  health: { label: "Health", color: "#d95f4c", bg: "bg-[#fae3de] border-ink", emoji: "🩺" },
  birthday: { label: "Birthday", color: "#e56fa8", bg: "bg-[#fae3ee] border-ink", emoji: "🎂" },
  other: { label: "Other", color: "#99a17e", bg: "bg-ghost border-ink", emoji: "📌" },
};

export function categoryMeta(category: string) {
  return EVENT_CATEGORY_META[category] || EVENT_CATEGORY_META.other;
}

export function getWorkoutTypeColor(type: string): string {
  switch (type) {
    case "easy": case "recovery": return "#9ccb2e";
    case "tempo": return "#e8813c";
    case "interval": return "#d9534c";
    case "race_pace": return "#c9662e";
    case "long": return "#4a90d6";
    case "cross_training": return "#3aa89b";
    case "strength": return "#a86fd1";
    case "rest": return "#99a17e";
    case "race": return "#e0b23c";
    default: return "#99a17e";
  }
}
