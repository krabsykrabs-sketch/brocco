-- Additive: free-text notes on activities, and tombstones so a deleted Strava
-- activity is not re-imported by the webhook / backfill / auto-sync upsert.
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "notes" TEXT;

CREATE TABLE IF NOT EXISTS "activity_tombstones" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "strava_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_tombstones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "activity_tombstones_user_id_strava_id_key"
    ON "activity_tombstones"("user_id", "strava_id");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'activity_tombstones_user_id_fkey'
    ) THEN
        ALTER TABLE "activity_tombstones"
            ADD CONSTRAINT "activity_tombstones_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
