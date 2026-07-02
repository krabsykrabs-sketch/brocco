-- CreateTable
CREATE TABLE "weekly_reviews" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_reviews_user_id_week_start_key" ON "weekly_reviews"("user_id", "week_start");

-- AddForeignKey
ALTER TABLE "weekly_reviews" ADD CONSTRAINT "weekly_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
