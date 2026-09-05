"use client";

import { useT } from "@/app/features-provider";

/**
 * Perceived effort, 1–10, as a row of tappable pills. Shared by the edit
 * sheet and the player's finish screen so "7" means the same thing in both.
 * Colour leans from sprout (easy) through sun to clay (all-out) so the row
 * reads at a glance without a legend.
 */
const PILL_BG = [
  "bg-sprout", "bg-sprout", "bg-sprout",
  "bg-[#faeed8]", "bg-[#faeed8]", "bg-[#faeed8]",
  "bg-[#f7d9b0]", "bg-[#f7d9b0]",
  "bg-clay-soft", "bg-clay-soft",
];

export default function RpePills({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: number | null;
  onChange: (rpe: number) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const t = useT();
  return (
    <div>
      <div role="radiogroup" aria-label={t("activity.rpeLabel")} className="grid grid-cols-10 gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${n}/10`}
              disabled={disabled}
              onClick={() => onChange(n)}
              className={`${compact ? "h-8 text-xs" : "h-10 text-sm"} rounded-lg border-2 font-extrabold tabular-nums transition-transform sticker-press disabled:opacity-50 ${
                active
                  ? `${PILL_BG[n - 1]} border-ink text-ink shadow-[2px_2px_0_var(--color-shade)] scale-105`
                  : "bg-card border-shade text-moss hover:border-ink"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-sage font-bold mt-1.5">{t("activity.rpeHint")}</p>
    </div>
  );
}
