/**
 * Activity type compatibility mapping.
 * Maps our workout activity types to Strava activity type strings.
 */

export const RUN_TYPES = ["Run", "TrailRun", "VirtualRun", "Treadmill"];
export const CYCLE_TYPES = ["Ride", "VirtualRide", "EBikeRide", "MountainBikeRide"];
export const SWIM_TYPES = ["Swim"];
export const HIKE_TYPES = ["Hike", "Walk"];
export const STRENGTH_TYPES = ["WeightTraining", "Workout"];

const TYPE_MAP: Record<string, string[]> = {
  run: RUN_TYPES,
  cycle: CYCLE_TYPES,
  swim: SWIM_TYPES,
  hike: HIKE_TYPES,
  strength: STRENGTH_TYPES,
  rest: [],
  other: [],
};

/** Check if a Strava activity type is compatible with a planned workout's activity type */
export function isCompatibleType(workoutActivityType: string, stravaActivityType: string): boolean {
  const valid = TYPE_MAP[workoutActivityType] || [];
  return valid.includes(stravaActivityType);
}

/** Check if a Strava activity type is a running activity */
export function isRunning(stravaActivityType: string): boolean {
  return RUN_TYPES.includes(stravaActivityType);
}
