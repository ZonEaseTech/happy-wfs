CREATE TABLE "DeviceShareToken" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "deviceKey" BYTEA NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceShareToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceShareToken_tokenHash_key" ON "DeviceShareToken"("tokenHash");
CREATE INDEX "DeviceShareToken_accountId_createdAt_idx" ON "DeviceShareToken"("accountId", "createdAt" DESC);
CREATE INDEX "DeviceShareToken_machineId_idx" ON "DeviceShareToken"("machineId");

ALTER TABLE "DeviceShareToken" ADD CONSTRAINT "DeviceShareToken_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
