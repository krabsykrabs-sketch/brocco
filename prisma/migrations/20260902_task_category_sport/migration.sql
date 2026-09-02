-- Additive: weekly goals/tasks can be "3 climbing sessions" — RockClimbing used to credit no category at all.
ALTER TYPE "TaskCategory" ADD VALUE IF NOT EXISTS 'sport';
