-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "last_opener_at" TIMESTAMP(3),
ADD COLUMN     "pantry_staples" JSONB;

