-- CreateEnum
CREATE TYPE "TaskCategory" AS ENUM ('strength', 'mobility', 'nutrition', 'recovery', 'other');
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'done');

-- CreateTable
CREATE TABLE "weekly_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "week_number" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "category" "TaskCategory" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_tasks_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "weekly_tasks" ADD CONSTRAINT "weekly_tasks_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
