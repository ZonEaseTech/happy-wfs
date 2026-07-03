CREATE TYPE "CompanyRole" AS ENUM ('owner', 'admin', 'member');

CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyMembership" (
    "companyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "role" "CompanyRole" NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyMembership_pkey" PRIMARY KEY ("companyId", "accountId")
);

CREATE TABLE "CompanyInvite" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" "CompanyRole" NOT NULL DEFAULT 'member',
    "createdByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");
CREATE INDEX "CompanyMembership_accountId_idx" ON "CompanyMembership"("accountId");
CREATE INDEX "CompanyMembership_companyId_role_idx" ON "CompanyMembership"("companyId", "role");
CREATE UNIQUE INDEX "CompanyInvite_tokenHash_key" ON "CompanyInvite"("tokenHash");
CREATE INDEX "CompanyInvite_companyId_revokedAt_expiresAt_idx" ON "CompanyInvite"("companyId", "revokedAt", "expiresAt");
CREATE INDEX "CompanyInvite_createdByUserId_idx" ON "CompanyInvite"("createdByUserId");

ALTER TABLE "CompanyMembership"
ADD CONSTRAINT "CompanyMembership_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyMembership"
ADD CONSTRAINT "CompanyMembership_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyInvite"
ADD CONSTRAINT "CompanyInvite_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyInvite"
ADD CONSTRAINT "CompanyInvite_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Company" ("id", "name", "slug", "createdAt", "updatedAt")
VALUES ('company_default', 'Happy Company', 'default', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "CompanyMembership" ("companyId", "accountId", "role", "createdAt", "updatedAt", "joinedAt")
SELECT 'company_default', "id", 'member'::"CompanyRole", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Account"
ON CONFLICT ("companyId", "accountId") DO NOTHING;

WITH first_account AS (
    SELECT "id"
    FROM "Account"
    ORDER BY "createdAt" ASC, "id" ASC
    LIMIT 1
)
UPDATE "CompanyMembership"
SET "role" = 'owner'::"CompanyRole", "updatedAt" = CURRENT_TIMESTAMP
WHERE "companyId" = 'company_default'
  AND "accountId" = (SELECT "id" FROM first_account)
  AND NOT EXISTS (
      SELECT 1
      FROM "CompanyMembership"
      WHERE "companyId" = 'company_default'
        AND "role" = 'owner'::"CompanyRole"
  );
