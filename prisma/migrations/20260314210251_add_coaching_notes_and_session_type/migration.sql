-- CreateEnum
CREATE TYPE "ChatSessionType" AS ENUM ('general', 'onboarding');

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "type" "ChatSessionType" NOT NULL DEFAULT 'general';

-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "coaching_notes" JSONB NOT NULL DEFAULT '{}';
