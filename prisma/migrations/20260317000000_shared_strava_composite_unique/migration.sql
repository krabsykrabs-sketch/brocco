-- DropIndex
DROP INDEX IF EXISTS "activities_strava_id_key";

-- CreateIndex: composite unique on (user_id, strava_id) to allow multiple users with same Strava account
CREATE UNIQUE INDEX "activities_user_id_strava_id_key" ON "activities"("user_id", "strava_id");
