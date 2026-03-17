-- CreateEnum
CREATE TYPE "WeekDetailLevel" AS ENUM ('detailed', 'outline', 'target');
CREATE TYPE "WorkoutDetailLevel" AS ENUM ('detailed', 'outline');

-- CreateTable
CREATE TABLE "plan_weeks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "phase_id" UUID,
    "week_number" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "detail_level" "WeekDetailLevel" NOT NULL,
    "target_km" DECIMAL(6,1),
    "target_sessions" INTEGER,
    "session_types" JSONB,
    "notes" TEXT,
    "actual_km" DECIMAL(6,1),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_weeks_plan_id_week_number_key" ON "plan_weeks"("plan_id", "week_number");

-- AddForeignKey
ALTER TABLE "plan_weeks" ADD CONSTRAINT "plan_weeks_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_weeks" ADD CONSTRAINT "plan_weeks_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "plan_phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: add detail_level to planned_workouts
ALTER TABLE "planned_workouts" ADD COLUMN "detail_level" "WorkoutDetailLevel" NOT NULL DEFAULT 'detailed';
