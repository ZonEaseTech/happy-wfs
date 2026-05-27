-- CreateTable
CREATE TABLE "PortProxy" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "localHost" TEXT NOT NULL DEFAULT '127.0.0.1',
    "localPort" INTEGER NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'http',
    "slug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "accessMode" TEXT NOT NULL DEFAULT 'private',
    "lastAccessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortProxy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortProxy_slug_key" ON "PortProxy"("slug");

-- CreateIndex
CREATE INDEX "PortProxy_accountId_updatedAt_idx" ON "PortProxy"("accountId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "PortProxy_machineId_enabled_idx" ON "PortProxy"("machineId", "enabled");

-- CreateIndex
CREATE INDEX "PortProxy_slug_idx" ON "PortProxy"("slug");

-- AddForeignKey
ALTER TABLE "PortProxy" ADD CONSTRAINT "PortProxy_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
