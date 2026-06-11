/** Event category display metadata — colors match the workout-type palette family. */

export const EVENT_CATEGORY_META: Record<string, { label: string; color: string; bg: string; emoji: string }> = {
  work: { label: "Work", color: "#60a5fa", bg: "bg-blue-900/30 border-blue-800/40", emoji: "💼" },
  family: { label: "Family", color: "#f59e0b", bg: "bg-amber-900/30 border-amber-800/40", emoji: "🏠" },
  training: { label: "Training", color: "#4ade80", bg: "bg-green-900/30 border-green-800/40", emoji: "🏃" },
  social: { label: "Social", color: "#c084fc", bg: "bg-purple-900/30 border-purple-800/40", emoji: "🎉" },
  health: { label: "Health", color: "#f87171", bg: "bg-red-900/30 border-red-800/40", emoji: "🩺" },
  birthday: { label: "Birthday", color: "#f472b6", bg: "bg-pink-900/30 border-pink-800/40", emoji: "🎂" },
  other: { label: "Other", color: "#9ca3af", bg: "bg-gray-900/50 border-gray-800/40", emoji: "📌" },
};

export function categoryMeta(category: string) {
  return EVENT_CATEGORY_META[category] || EVENT_CATEGORY_META.other;
}

export function getWorkoutTypeColor(type: string): string {
  switch (type) {
    case "easy": case "recovery": return "#4ade80";
    case "tempo": return "#fb923c";
    case "interval": return "#ef4444";
    case "race_pace": return "#ea580c";
    case "long": return "#3b82f6";
    case "cross_training": return "#14b8a6";
    case "strength": return "#a855f7";
    case "rest": return "#6b7280";
    case "race": return "#eab308";
    default: return "#6b7280";
  }
}
