-- Repair databases that applied the initial bug report migration before
-- the soft-delete column was added to the Prisma model.
ALTER TABLE "BugReport" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "BugReport_ownerId_deletedAt_lastActivityAt_idx"
ON "BugReport"("ownerId", "deletedAt", "lastActivityAt" DESC);
