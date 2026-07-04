CREATE TABLE "BugReport" (
    "id" TEXT NOT NULL,
    "displayNumber" SERIAL NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdByNickname" TEXT,
    "sessionId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "visibility" TEXT NOT NULL DEFAULT 'shared',
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BugReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BugComment" (
    "id" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorNickname" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BugComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BugAttachment" (
    "id" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "commentId" TEXT,
    "uploadedByUserId" TEXT,
    "uploadedByNickname" TEXT,
    "path" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "thumbhash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BugAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BugStatusHistory" (
    "id" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorNickname" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BugStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BugShareConfig" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "accessCodeHash" BYTEA NOT NULL,
    "accessCodeVersion" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BugShareConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BugReport_displayNumber_key" ON "BugReport"("displayNumber");
CREATE INDEX "BugReport_ownerId_status_lastActivityAt_idx" ON "BugReport"("ownerId", "status", "lastActivityAt" DESC);
CREATE INDEX "BugReport_ownerId_lastActivityAt_idx" ON "BugReport"("ownerId", "lastActivityAt" DESC);
CREATE INDEX "BugReport_ownerId_deletedAt_lastActivityAt_idx" ON "BugReport"("ownerId", "deletedAt", "lastActivityAt" DESC);
CREATE INDEX "BugReport_sessionId_idx" ON "BugReport"("sessionId");
CREATE INDEX "BugComment_bugId_createdAt_idx" ON "BugComment"("bugId", "createdAt");
CREATE INDEX "BugAttachment_bugId_createdAt_idx" ON "BugAttachment"("bugId", "createdAt");
CREATE INDEX "BugAttachment_commentId_idx" ON "BugAttachment"("commentId");
CREATE INDEX "BugStatusHistory_bugId_createdAt_idx" ON "BugStatusHistory"("bugId", "createdAt");
CREATE UNIQUE INDEX "BugShareConfig_ownerId_key" ON "BugShareConfig"("ownerId");
CREATE UNIQUE INDEX "BugShareConfig_accessCodeHash_key" ON "BugShareConfig"("accessCodeHash");
CREATE INDEX "BugShareConfig_enabled_idx" ON "BugShareConfig"("enabled");

ALTER TABLE "BugReport"
ADD CONSTRAINT "BugReport_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BugReport"
ADD CONSTRAINT "BugReport_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BugReport"
ADD CONSTRAINT "BugReport_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BugComment"
ADD CONSTRAINT "BugComment_bugId_fkey"
FOREIGN KEY ("bugId") REFERENCES "BugReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BugComment"
ADD CONSTRAINT "BugComment_authorUserId_fkey"
FOREIGN KEY ("authorUserId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BugAttachment"
ADD CONSTRAINT "BugAttachment_bugId_fkey"
FOREIGN KEY ("bugId") REFERENCES "BugReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BugAttachment"
ADD CONSTRAINT "BugAttachment_commentId_fkey"
FOREIGN KEY ("commentId") REFERENCES "BugComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BugAttachment"
ADD CONSTRAINT "BugAttachment_uploadedByUserId_fkey"
FOREIGN KEY ("uploadedByUserId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BugStatusHistory"
ADD CONSTRAINT "BugStatusHistory_bugId_fkey"
FOREIGN KEY ("bugId") REFERENCES "BugReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BugStatusHistory"
ADD CONSTRAINT "BugStatusHistory_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BugShareConfig"
ADD CONSTRAINT "BugShareConfig_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
