-- Add 'kitchen' to ChatSessionType for the dedicated kitchen chat
ALTER TYPE "ChatSessionType" ADD VALUE IF NOT EXISTS 'kitchen';
