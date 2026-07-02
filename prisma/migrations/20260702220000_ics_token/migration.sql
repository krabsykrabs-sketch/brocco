-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN "ics_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_ics_token_key" ON "user_profiles"("ics_token");
