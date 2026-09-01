-- Additive: UI + Brocco output language. Null = not chosen (client detects).
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "language" TEXT;
