-- Additive: pin flag on guided workouts + per-session history table.
ALTER TABLE "guided_workouts" ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "guided_workout_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "guided_workout_id" UUID,
    "title" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed" BOOLEAN NOT NULL DEFAULT true,
    "bailed_at_exercise" INTEGER,
    "duration_min" INTEGER NOT NULL,
    "activity_id" UUID,

    CONSTRAINT "guided_workout_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "guided_workout_sessions_user_id_finished_at_idx" ON "guided_workout_sessions"("user_id", "finished_at");
CREATE INDEX IF NOT EXISTS "guided_workout_sessions_guided_workout_id_idx" ON "guided_workout_sessions"("guided_workout_id");

ALTER TABLE "guided_workout_sessions" ADD CONSTRAINT "guided_workout_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guided_workout_sessions" ADD CONSTRAINT "guided_workout_sessions_guided_workout_id_fkey" FOREIGN KEY ("guided_workout_id") REFERENCES "guided_workouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
