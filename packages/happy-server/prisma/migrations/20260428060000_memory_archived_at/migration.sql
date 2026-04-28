-- AlterTable
ALTER TABLE "Memory" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Memory_accountId_archivedAt_idx" ON "Memory"("accountId", "archivedAt");
