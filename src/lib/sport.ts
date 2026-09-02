/**
 * One place that turns profile.primarySport into the words and rules the
 * rest of the app needs. Everything outside the chat used to assume
 * running — "Running: 0.0 km of 0 km" in a climber's weekly review.
 */
export interface SportProfile {
  /** Lower-cased free text as saved, or null for the running default. */
  sport: string | null;
  isClimbing: boolean;
  /** Sessions and minutes, not kilometres. True for any non-running sport. */
  sessionsBased: boolean;
  /** "runner" | "climber" | "athlete" */
  athleteNoun: string;
  /** "running coach" | "climbing coach" | "<sport> coach" */
  coachNoun: string;
}

export function sportProfile(primarySport: string | null | undefined): SportProfile {
  const sport = (primarySport || "").trim().toLowerCase() || null;
  const isClimbing = !!sport && sport.includes("climb");
  const isRunning = !sport || sport === "running" || sport === "run";
  return {
    sport: isRunning ? null : sport,
    isClimbing,
    sessionsBased: !isRunning,
    athleteNoun: isRunning ? "runner" : isClimbing ? "climber" : "athlete",
    coachNoun: isRunning ? "running coach" : `${sport} coach`,
  };
}

/** Minutes of recorded training in a list of activities (durationMin may be Decimal/number/null). */
export function totalMinutes(activities: Array<{ durationMin: unknown }>): number {
  return Math.round(activities.reduce((s, a) => s + (a.durationMin ? Number(a.durationMin) : 0), 0));
}
