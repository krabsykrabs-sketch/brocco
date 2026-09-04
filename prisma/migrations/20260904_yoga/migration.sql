-- Additive: yoga as a planned workout type / activity kind, and a kind on guided workouts.
ALTER TYPE "WorkoutType" ADD VALUE IF NOT EXISTS 'yoga';
ALTER TYPE "ActivityKind" ADD VALUE IF NOT EXISTS 'yoga';
ALTER TABLE "guided_workouts" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'sc';
