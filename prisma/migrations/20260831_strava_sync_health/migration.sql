-- Additive: sync health fields so Strava failures become visible.
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "strava_last_sync_error" TEXT;
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "strava_needs_reconnect" BOOLEAN NOT NULL DEFAULT false;
