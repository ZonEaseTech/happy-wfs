CREATE TABLE "DeviceEnrollToken" (
    "id" TEXT NOT NULL,
    "lookupId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "label" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByMachineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceEnrollToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceEnrollToken_lookupId_key" ON "DeviceEnrollToken"("lookupId");
CREATE INDEX "DeviceEnrollToken_accountId_createdAt_idx" ON "DeviceEnrollToken"("accountId", "createdAt" DESC);

ALTER TABLE "DeviceEnrollToken" ADD CONSTRAINT "DeviceEnrollToken_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
