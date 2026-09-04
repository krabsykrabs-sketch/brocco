"use client";

import type { Segment } from "@/lib/guided-workout";
import type { DictKey } from "@/lib/dict";

/**
 * The yoga player's centre: the pose diagram inside a slow progress ring
 * (no digits — a hold shouldn't feel like a countdown), the pose name, the
 * breath/alignment cue, and an optional in/out pacing line driven by the
 * elapsed time so it stays in step after pause/resume.
 */

interface FlowStageProps {
  seg: Segment;
  /** 0–1, how far through the hold we are. */
  pct: number;
  /** Seconds elapsed in this hold — drives the breath pacing. */
  elapsedSec: number;
  showBreath: boolean;
  artSrc: string | null;
  /** Extra perspectives (top/front/side) shown small under the pose name. */
  artViews?: Array<{ src: string; view: "top" | "front" | "side" | "back" | "primary" }>;
  t: (key: DictKey) => string;
}

/** ~5 s in, ~5 s out: a slow, unhurried rhythm that suits a held pose. */
const BREATH_SEC = 5;
const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

export default function FlowStage({ seg, pct, elapsedSec, showBreath, artSrc, artViews = [], t }: FlowStageProps) {
  const extraViews = artViews.filter((v) => v.view !== "primary");
  const VIEW_KEY: Record<string, DictKey> = { top: "art.viewTop", front: "art.viewFront", side: "art.viewSide", back: "art.viewBack" };
  const inhale = Math.floor(elapsedSec / BREATH_SEC) % 2 === 0;
  const breathing = showBreath && seg.kind === "work";

  return (
    <div className="flex flex-col items-center w-full max-w-sm">
      {seg.context && <p className="label-xs mb-3">{seg.context}</p>}

      <div className="relative w-56 h-56 md:w-64 md:h-64" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full -rotate-90">
          <circle cx="50" cy="50" r={RING_R} fill="none" stroke="var(--color-ghost)" strokeWidth="5" />
          <circle
            cx="50"
            cy="50"
            r={RING_R}
            fill="none"
            stroke="var(--color-brocco)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - Math.min(1, Math.max(0, pct)))}
            style={{ transition: "stroke-dashoffset 0.25s linear" }}
          />
        </svg>
        <div className="absolute inset-4 rounded-full bg-card border-2 border-ink flex items-center justify-center overflow-hidden">
          {artSrc ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={artSrc} alt="" className="w-[78%] h-[78%] object-contain" />
          ) : (
            <span className="text-6xl" aria-hidden="true">🧘</span>
          )}
        </div>
      </div>

      <h1 className="text-3xl md:text-4xl font-extrabold text-ink mt-5 mb-1">{seg.label}</h1>
      {extraViews.length > 0 && (
        <div className="flex justify-center gap-4 mb-1">
          {extraViews.map((v) => (
            <figure key={v.src} className="flex flex-col items-center m-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.src} alt="" className="w-20 h-20 object-contain rounded-xl bg-card border-2 border-shade" />
              <figcaption className="text-[10px] text-sage font-bold mt-0.5">{t(VIEW_KEY[v.view])}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {seg.note && <p className="text-sm text-moss font-semibold max-w-xs">{seg.note}</p>}

      {/* Fixed-height slot so the layout doesn't jump when pacing is off or during "Settle in" */}
      <div className="h-10 mt-4 flex items-center justify-center gap-3">
        {breathing && (
          <>
            <span
              className="w-3 h-3 rounded-full bg-sky/70 flex-shrink-0"
              style={{ transform: inhale ? "scale(1.9)" : "scale(0.8)", transition: `transform ${BREATH_SEC}s ease-in-out` }}
            />
            <p className="text-sm text-sage font-bold" aria-live="polite">
              {inhale ? t("player.breatheIn") : t("player.breatheOut")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
