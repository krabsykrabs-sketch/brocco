-- Flexible weekly goals: "do this N times this week", days unspecified.
-- User-scoped rather than plan-scoped so a strength-only athlete can use them.

CREATE TABLE IF NOT EXISTS "weekly_goals" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"      UUID         NOT NULL,
    "week_start"   DATE         NOT NULL,
    "category"     "TaskCategory" NOT NULL,
    "label"        TEXT         NOT NULL,
    "target_count" INTEGER      NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "weekly_goals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "weekly_goals_user_id_week_start_label_key"
    ON "weekly_goals" ("user_id", "week_start", "label");
CREATE INDEX IF NOT EXISTS "weekly_goals_user_id_week_start_idx"
    ON "weekly_goals" ("user_id", "week_start");

ALTER TABLE "weekly_goals"
    ADD CONSTRAINT "weekly_goals_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One activity credited to one goal. Written eagerly so a session counts
-- immediately; `provisional` marks credits the coach should confirm, and
-- `dismissed` remembers a rejection so the reconciler stops re-crediting it.
CREATE TABLE IF NOT EXISTS "weekly_goal_credits" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "goal_id"     UUID         NOT NULL,
    "activity_id" UUID         NOT NULL,
    "provisional" BOOLEAN      NOT NULL DEFAULT false,
    "dismissed"   BOOLEAN      NOT NULL DEFAULT false,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "weekly_goal_credits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "weekly_goal_credits_goal_id_activity_id_key"
    ON "weekly_goal_credits" ("goal_id", "activity_id");
CREATE INDEX IF NOT EXISTS "weekly_goal_credits_activity_id_idx"
    ON "weekly_goal_credits" ("activity_id");

ALTER TABLE "weekly_goal_credits"
    ADD CONSTRAINT "weekly_goal_credits_goal_id_fkey"
    FOREIGN KEY ("goal_id") REFERENCES "weekly_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "weekly_goal_credits"
    ADD CONSTRAINT "weekly_goal_credits_activity_id_fkey"
    FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
