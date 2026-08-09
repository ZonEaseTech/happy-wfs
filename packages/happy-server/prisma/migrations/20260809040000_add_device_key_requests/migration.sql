CREATE TABLE "DeviceKeyRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "label" TEXT,
    "response" TEXT,
    "approvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceKeyRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeviceKeyRequest_accountId_createdAt_idx" ON "DeviceKeyRequest"("accountId", "createdAt" DESC);

ALTER TABLE "DeviceKeyRequest" ADD CONSTRAINT "DeviceKeyRequest_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
