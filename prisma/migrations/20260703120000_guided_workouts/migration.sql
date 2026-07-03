-- CreateTable
CREATE TABLE "guided_workouts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "focus" TEXT,
    "duration_min" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'brocco',
    "planned_workout_id" UUID,
    "times_completed" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guided_workouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guided_workouts_user_id_created_at_idx" ON "guided_workouts"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "guided_workouts_planned_workout_id_idx" ON "guided_workouts"("planned_workout_id");

-- AddForeignKey
ALTER TABLE "guided_workouts" ADD CONSTRAINT "guided_workouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
