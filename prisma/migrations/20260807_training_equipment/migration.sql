-- Kit the athlete owns, so strength and rehab work can be prescribed around
-- what they actually have. Nullable and additive: existing profiles read as
-- "nothing recorded", which is exactly what was true before.
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "training_equipment" JSONB;
