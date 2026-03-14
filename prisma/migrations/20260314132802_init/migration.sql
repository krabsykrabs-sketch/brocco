-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('active', 'completed', 'draft');

-- CreateEnum
CREATE TYPE "WorkoutType" AS ENUM ('easy', 'long', 'tempo', 'interval', 'race_pace', 'recovery', 'rest', 'cross_training', 'race', 'strength');

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('run', 'cycle', 'swim', 'hike', 'strength', 'rest', 'other');

-- CreateEnum
CREATE TYPE "WorkoutStatus" AS ENUM ('planned', 'completed', 'skipped', 'modified');

-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('strava', 'manual');

-- CreateEnum
CREATE TYPE "HealthEntryType" AS ENUM ('injury', 'note', 'race_result', 'weight');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('minor', 'moderate', 'severe');

-- CreateEnum
CREATE TYPE "HealthStatus" AS ENUM ('active', 'resolved');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant', 'tool_result');

-- CreateEnum
CREATE TYPE "PendingChangeStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "AdjustAction" AS ENUM ('update_targets', 'swap_rest_day', 'mark_covered');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "invite_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "goal_race" TEXT,
    "goal_race_date" DATE,
    "goal_time" TEXT,
    "years_running" INTEGER,
    "weekly_km_baseline" DECIMAL(6,2),
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
    "strava_access_token" TEXT,
    "strava_refresh_token" TEXT,
    "strava_athlete_id" TEXT,
    "strava_token_expires_at" TIMESTAMP(3),
    "ai_preferences" JSONB,
    "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "race_date" DATE,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_phases" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "description" TEXT,
    "start_week" INTEGER NOT NULL,
    "end_week" INTEGER NOT NULL,

    CONSTRAINT "plan_phases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planned_workouts" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "phase_id" UUID,
    "week_number" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "workout_type" "WorkoutType" NOT NULL,
    "activity_type" "ActivityKind" NOT NULL DEFAULT 'run',
    "target_distance_km" DECIMAL(6,2),
    "target_pace" TEXT,
    "target_pace_secs" INTEGER,
    "target_duration_min" INTEGER,
    "description" TEXT,
    "status" "WorkoutStatus" NOT NULL DEFAULT 'planned',
    "matched_activity_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planned_workouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source" "ActivitySource" NOT NULL,
    "strava_id" TEXT,
    "name" TEXT NOT NULL,
    "activity_type" TEXT NOT NULL,
    "distance_km" DECIMAL(8,2),
    "duration_min" DECIMAL(8,2) NOT NULL,
    "moving_time_min" DECIMAL(8,2),
    "avg_pace_per_km" TEXT,
    "pace_seconds_per_km" INTEGER,
    "avg_heart_rate" INTEGER,
    "max_heart_rate" INTEGER,
    "elevation_gain_m" DECIMAL(8,2),
    "avg_cadence" INTEGER,
    "calories" INTEGER,
    "perceived_effort" INTEGER,
    "start_date" TIMESTAMP(3) NOT NULL,
    "start_date_local" TIMESTAMP(3) NOT NULL,
    "splits" JSONB,
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_log" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "entry_type" "HealthEntryType" NOT NULL,
    "description" TEXT NOT NULL,
    "body_part" TEXT,
    "severity" "Severity",
    "status" "HealthStatus" DEFAULT 'active',
    "value" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" JSONB NOT NULL,
    "display_text" TEXT,
    "context_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_plan_changes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "chat_message_id" UUID NOT NULL,
    "changes" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "PendingChangeStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_plan_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_adjustment_log" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workout_id" UUID NOT NULL,
    "action" "AdjustAction" NOT NULL,
    "before_state" JSONB NOT NULL,
    "after_state" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "undone" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_adjustment_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite_codes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "used_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "invite_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "activities_strava_id_key" ON "activities"("strava_id");

-- CreateIndex
CREATE UNIQUE INDEX "invite_codes_code_key" ON "invite_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "invite_codes_used_by_key" ON "invite_codes"("used_by");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_phases" ADD CONSTRAINT "plan_phases_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "plan_phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_matched_activity_id_fkey" FOREIGN KEY ("matched_activity_id") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_log" ADD CONSTRAINT "health_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_plan_changes" ADD CONSTRAINT "pending_plan_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_plan_changes" ADD CONSTRAINT "pending_plan_changes_chat_message_id_fkey" FOREIGN KEY ("chat_message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_adjustment_log" ADD CONSTRAINT "plan_adjustment_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_adjustment_log" ADD CONSTRAINT "plan_adjustment_log_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "planned_workouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_used_by_fkey" FOREIGN KEY ("used_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
