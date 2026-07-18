-- AlterTable
ALTER TABLE "planned_workouts" ADD COLUMN     "steps" JSONB;

-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "intervals_api_key" TEXT,
ADD COLUMN     "intervals_athlete_id" TEXT;

