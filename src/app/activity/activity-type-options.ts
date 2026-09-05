import {
  RUN_TYPES, CYCLE_TYPES, SWIM_TYPES, HIKE_TYPES, STRENGTH_TYPES, CLIMB_TYPES, YOGA_TYPES,
} from "@/lib/activity-types";

/**
 * The Strava-style activity types a session can be edited to. One flat list,
 * shared by the PATCH validator and the edit sheet's <select>, so the UI can
 * never offer a type the API would reject. "Workout" lives in STRENGTH_TYPES.
 */
export const EDITABLE_ACTIVITY_TYPES: readonly string[] = [
  ...RUN_TYPES, ...CYCLE_TYPES, ...SWIM_TYPES, ...HIKE_TYPES, ...STRENGTH_TYPES, ...CLIMB_TYPES, ...YOGA_TYPES,
];
