CREATE TABLE "PublicShareLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublicShareLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicShareLink_code_key" ON "PublicShareLink"("code");

CREATE INDEX "PublicShareLink_accountId_url_idx" ON "PublicShareLink"("accountId", "url");
