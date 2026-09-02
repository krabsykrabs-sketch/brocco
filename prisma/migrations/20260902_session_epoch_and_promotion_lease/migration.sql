-- Additive. session_epoch: password/email changes invalidate older cookies.
-- promotion_claimed_at: lease for week promotion so a crash can't strand a week.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "session_epoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "plan_weeks" ADD COLUMN IF NOT EXISTS "promotion_claimed_at" TIMESTAMP(3);
