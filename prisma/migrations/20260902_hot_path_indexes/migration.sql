-- Indexes for the app's hot query shapes. None of these tables had one for
-- the columns actually filtered on: every chat message scanned the whole
-- chat_messages table twice, /api/today scanned planned_workouts four times.
-- Plain CREATE INDEX (Prisma wraps each migration in a transaction, which
-- CONCURRENTLY does not allow); tables are small enough for the brief lock.
CREATE INDEX IF NOT EXISTS "activities_user_id_start_date_local_idx" ON "activities"("user_id", "start_date_local" DESC);
CREATE INDEX IF NOT EXISTS "activities_user_id_created_at_idx" ON "activities"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "planned_workouts_plan_id_date_idx" ON "planned_workouts"("plan_id", "date");
CREATE INDEX IF NOT EXISTS "chat_messages_session_id_created_at_idx" ON "chat_messages"("session_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "chat_sessions_user_id_type_updated_at_idx" ON "chat_sessions"("user_id", "type", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "user_profiles_strava_athlete_id_idx" ON "user_profiles"("strava_athlete_id");
CREATE INDEX IF NOT EXISTS "health_log_user_id_status_idx" ON "health_log"("user_id", "status");
CREATE INDEX IF NOT EXISTS "plans_user_id_status_idx" ON "plans"("user_id", "status");
CREATE INDEX IF NOT EXISTS "weekly_tasks_plan_id_week_number_idx" ON "weekly_tasks"("plan_id", "week_number");
CREATE INDEX IF NOT EXISTS "plan_adjustment_log_user_id_created_at_idx" ON "plan_adjustment_log"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "plan_adjustment_log_workout_id_idx" ON "plan_adjustment_log"("workout_id");
