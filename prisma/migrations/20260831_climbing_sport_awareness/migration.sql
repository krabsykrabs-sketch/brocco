-- Additive only: new enum values and one nullable column. Existing rows,
-- plans, and users are untouched (null primary_sport = running default).
ALTER TYPE "ActivityKind" ADD VALUE IF NOT EXISTS 'climb';
ALTER TYPE "WorkoutType" ADD VALUE IF NOT EXISTS 'climbing';
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "primary_sport" TEXT;
