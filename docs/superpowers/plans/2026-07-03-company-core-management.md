# Company Core Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an instance-level company identity layer with owner/admin/member roles, invite links, and a Core company management UI for Happy.

**Architecture:** Keep the company layer as a sidecar to the existing personal-account model: add `Company`, `CompanyMembership`, and `CompanyInvite` tables, expose authenticated `/v1/company` APIs, and add Settings pages that consume those APIs. Existing sessions, machines, friends, shares, and account-owned data remain unchanged in this version.

**Tech Stack:** Prisma + PostgreSQL, Fastify + Zod, Vitest, Expo Router + React Native, existing Happy app components (`ItemList`, `ItemGroup`, `Item`, `Modal`, `Toast`), Happy i18n (`t()` with `packages/happy-app/sources/text/translations/*`).

---

## Source Spec

Design document: `docs/superpowers/specs/2026-07-03-company-core-management-design.md`

Confirmed product decisions:

- Tenant model: instance-level company.
- Join flow: admin-created invite links.
- Roles: `owner`, `admin`, `member`.
- Existing accounts: full backfill into the default company.
- Management UI scope: Core management only.
- Invite delivery: copy invite link.
- Implementation strategy: sidecar company layer.
- Backend, frontend, and acceptance strategy are approved.

## Execution Guardrails

- Do not commit code in this implementation. The user explicitly requested review before any commit.
- Preserve existing personal-account behavior for sessions, machines, shares, friends, and access keys.
- Keep all permission enforcement on the backend. UI gating is convenience only.
- Use TDD for backend role/invite logic and API-client behavior.
- For every user-facing frontend string, update all translation files under `packages/happy-app/sources/text/translations/` plus the default structure file when required by the type system.
- Run package-level checks after each package is modified:
  - `cd packages/happy-server && yarn build`
  - `cd packages/happy-app && yarn typecheck`

## File Structure

### Backend files

- Modify: `packages/happy-server/prisma/schema.prisma`
  - Add `CompanyRole`, `Company`, `CompanyMembership`, and `CompanyInvite`.
  - Add `Account.companyMemberships` and `Account.companyInvitesCreated` relations.
- Create: `packages/happy-server/prisma/migrations/20260703000000_add_company_core/migration.sql`
  - Create tables, constraints, indexes, default company, account membership backfill, and fallback owner promotion.
- Create: `packages/happy-server/sources/app/company/companyTypes.ts`
  - Shared server-side type aliases and role constants.
- Create: `packages/happy-server/sources/app/company/companyTokens.ts`
  - Raw invite token generation and SHA-256 token hashing.
- Create: `packages/happy-server/sources/app/company/companyPresenter.ts`
  - API formatting for companies, memberships, members, invites, and capability flags.
- Create: `packages/happy-server/sources/app/company/companyBootstrap.ts`
  - Startup idempotent default-company and membership bootstrap.
- Create: `packages/happy-server/sources/app/company/companyService.ts`
  - Domain service for loading company context, role checks, member management, invite creation, invite revocation, and invite acceptance.
- Test: `packages/happy-server/sources/app/company/companyTokens.test.ts`
- Test: `packages/happy-server/sources/app/company/companyService.test.ts`
- Create: `packages/happy-server/sources/app/api/routes/companyRoutes.ts`
  - Fastify routes for `/v1/company`.
- Test: `packages/happy-server/sources/app/api/routes/companyRoutes.test.ts`
- Modify: `packages/happy-server/sources/app/api/api.ts`
  - Call startup bootstrap and register company routes.

### Frontend files

- Create: `packages/happy-app/sources/sync/companyTypes.ts`
  - Zod schemas and TypeScript types matching server responses.
- Create: `packages/happy-app/sources/sync/apiCompany.ts`
  - Authenticated fetch functions for company profile, members, invites, invite creation/revocation, and invite acceptance.
- Test: `packages/happy-app/sources/sync/apiCompany.test.ts`
- Create: `packages/happy-app/sources/components/company/companyRole.ts`
  - UI helpers for role labels, role ordering, and action availability.
- Test: `packages/happy-app/sources/components/company/companyRole.test.ts`
- Create: `packages/happy-app/sources/components/company/CompanyMemberRow.tsx`
  - Reusable member row with avatar, username, role badge, and optional action entry point.
- Create: `packages/happy-app/sources/components/company/CompanyInviteRow.tsx`
  - Reusable invite row with role, use count, expiration, status, and optional revoke action.
- Modify: `packages/happy-app/sources/components/SettingsView.tsx`
  - Add Company entry under Settings.
- Modify: `packages/happy-app/sources/components/desktopRoutes/registrations.ts`
  - Register company settings pages for desktop routing.
- Modify: `packages/happy-app/sources/app/(app)/_layout.tsx`
  - Add Expo Router screen definitions for company settings and invite join.
- Create: `packages/happy-app/sources/app/(app)/settings/company.tsx`
  - Company profile and navigation page.
- Create: `packages/happy-app/sources/app/(app)/settings/company/members.tsx`
  - Member list and role/removal actions.
- Create: `packages/happy-app/sources/app/(app)/settings/company/invites.tsx`
  - Invite list, create invite, copy link, revoke invite.
- Create: `packages/happy-app/sources/app/(app)/company/join/[token].tsx`
  - Invite accept page.
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: every file in `packages/happy-app/sources/text/translations/`
  - Add `company` translation group and Settings labels.

## API Contract

Use these response shapes consistently on server and app.

```ts
export type CompanyRole = 'owner' | 'admin' | 'member';

export type CompanyCapabilityFlags = {
    canEditCompany: boolean;
    canManageMembers: boolean;
    canManageOwners: boolean;
    canManageInvites: boolean;
};

export type CompanySummary = {
    id: string;
    name: string;
    slug: string;
    createdAt: number;
    updatedAt: number;
};

export type CompanyMembershipSummary = {
    companyId: string;
    accountId: string;
    role: CompanyRole;
    joinedAt: number;
    createdAt: number;
    updatedAt: number;
};

export type CompanyMember = CompanyMembershipSummary & {
    profile: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        username: string | null;
        avatar: {
            path: string;
            url: string;
            width?: number;
            height?: number;
            thumbhash?: string;
        } | null;
    };
};

export type CompanyInvite = {
    id: string;
    companyId: string;
    role: CompanyRole;
    createdByUserId: string;
    createdBy: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        username: string | null;
    } | null;
    expiresAt: number | null;
    maxUses: number | null;
    useCount: number;
    revokedAt: number | null;
    createdAt: number;
    updatedAt: number;
};

export type CompanyOverviewResponse = {
    company: CompanySummary;
    membership: CompanyMembershipSummary;
    capabilities: CompanyCapabilityFlags;
};

export type CompanyMembersResponse = {
    members: CompanyMember[];
};

export type CompanyInvitesResponse = {
    invites: CompanyInvite[];
};

export type CompanyInviteCreateResponse = {
    invite: CompanyInvite;
    token: string;
    url: string | null;
};

export type CompanyInviteAcceptResponse = {
    company: CompanySummary;
    membership: CompanyMembershipSummary;
    alreadyMember: boolean;
};
```

## Endpoint Contract

| Method | Path | Minimum role | Behavior |
| --- | --- | --- | --- |
| `GET` | `/v1/company` | `member` | Return company, current membership, and capability flags. |
| `PATCH` | `/v1/company` | `owner` or `admin` | Update `name` and `slug`. |
| `GET` | `/v1/company/members` | `member` | Return up to 50 members, optionally filtered by `query`. |
| `PATCH` | `/v1/company/members/:accountId` | `owner` or `admin` | Change role or remove membership, subject to role rules. |
| `POST` | `/v1/company/invites` | `owner` or `admin` | Create invite, return token once. |
| `GET` | `/v1/company/invites` | `owner` or `admin` | Return invite metadata without raw token. |
| `DELETE` | `/v1/company/invites/:id` | `owner` or `admin` | Set `revokedAt`. |
| `POST` | `/v1/company/invites/accept` | authenticated account | Accept token if valid. |

## Permission Rules

Implement these rules in `companyService.ts` and mirror them in frontend helper tests for UI visibility.

```ts
export const COMPANY_ROLE_ORDER: Record<CompanyRole, number> = {
    member: 0,
    admin: 1,
    owner: 2,
};

export function hasCompanyRole(role: CompanyRole, minimum: CompanyRole): boolean {
    return COMPANY_ROLE_ORDER[role] >= COMPANY_ROLE_ORDER[minimum];
}

export function getCompanyCapabilities(role: CompanyRole): CompanyCapabilityFlags {
    return {
        canEditCompany: role === 'owner' || role === 'admin',
        canManageMembers: role === 'owner' || role === 'admin',
        canManageOwners: role === 'owner',
        canManageInvites: role === 'owner' || role === 'admin',
    };
}
```

Backend member-management rules:

- `member`: cannot update company, create invites, revoke invites, change roles, or remove members.
- `admin`: can edit profile, list members, create/revoke member invites, and remove `member` users only.
- `owner`: can edit profile, list members, create/revoke invites, change roles, and remove users.
- No actor can remove or demote the last `owner`.
- Admins cannot promote members to `admin` or `owner`.
- Admins cannot remove or modify `admin` or `owner` memberships.
- Invite creation defaults to `member`. If a request includes `role`, admins may only request `member`; owners may request `member`, `admin`, or `owner`.

---

## Task 0: Baseline and workspace safety

**Files:** none

- [ ] **Step 0.1: Confirm worktree state before implementation**

Run:

```bash
git status --short
```

Expected before implementation:

```text
?? docs/superpowers/plans/2026-07-03-company-core-management.md
?? docs/superpowers/specs/2026-07-03-company-core-management-design.md
```

If additional modified files appear, inspect them before editing and preserve user-owned work.

- [ ] **Step 0.2: Confirm package scripts**

Run:

```bash
cat packages/happy-server/package.json | sed -n '1,60p'
cat packages/happy-app/package.json | sed -n '1,40p'
```

Expected checks:

- `happy-server` has `build`, `test`, `migrate`, and `generate` scripts.
- `happy-app` has `typecheck` and `test` scripts.

- [ ] **Step 0.3: Record no-commit rule in local execution notes**

When implementation starts, keep changes uncommitted for user review. Do not run `git commit`.

---

## Task 1: Add Prisma company schema and migration

**Files:**

- Modify: `packages/happy-server/prisma/schema.prisma`
- Create: `packages/happy-server/prisma/migrations/20260703000000_add_company_core/migration.sql`

- [ ] **Step 1.1: Add Prisma enum and models**

In `packages/happy-server/prisma/schema.prisma`, add these models near the account/social models and add the two relation fields to `model Account`.

```prisma
enum CompanyRole {
  owner
  admin
  member
}

model Company {
  id          String              @id @default(cuid())
  name        String
  slug        String              @unique
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
  memberships CompanyMembership[]
  invites     CompanyInvite[]
}

model CompanyMembership {
  companyId String
  company   Company     @relation(fields: [companyId], references: [id], onDelete: Cascade)
  accountId String
  account   Account     @relation(fields: [accountId], references: [id], onDelete: Cascade)
  role      CompanyRole @default(member)
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt
  joinedAt  DateTime    @default(now())

  @@id([companyId, accountId])
  @@index([accountId])
  @@index([companyId, role])
}

model CompanyInvite {
  id              String       @id @default(cuid())
  companyId       String
  company         Company      @relation(fields: [companyId], references: [id], onDelete: Cascade)
  tokenHash       String       @unique
  role            CompanyRole  @default(member)
  createdByUserId String
  createdByUser   Account      @relation("CompanyInviteCreatedBy", fields: [createdByUserId], references: [id], onDelete: Cascade)
  expiresAt       DateTime?
  maxUses         Int?
  useCount        Int          @default(0)
  revokedAt       DateTime?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@index([companyId, revokedAt, expiresAt])
  @@index([createdByUserId])
}
```

Add these relation fields inside `model Account` with the other list relations.

```prisma
  companyMemberships  CompanyMembership[]
  companyInvitesCreated CompanyInvite[] @relation("CompanyInviteCreatedBy")
```

- [ ] **Step 1.2: Create migration SQL**

Create `packages/happy-server/prisma/migrations/20260703000000_add_company_core/migration.sql` with this SQL.

```sql
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
```

- [ ] **Step 1.3: Validate Prisma schema**

Run:

```bash
cd packages/happy-server && yarn prisma validate
```

Expected: Prisma reports the schema is valid.

- [ ] **Step 1.4: Generate Prisma client**

Run:

```bash
cd packages/happy-server && yarn generate
```

Expected: Prisma client generation completes and exposes `CompanyRole`.

- [ ] **Step 1.5: Build server after schema changes**

Run:

```bash
cd packages/happy-server && yarn build
```

Expected: TypeScript compiles. If it fails, fix the Prisma schema or migration before moving on.

---

## Task 2: Add backend company token and role helpers

**Files:**

- Create: `packages/happy-server/sources/app/company/companyTypes.ts`
- Create: `packages/happy-server/sources/app/company/companyTokens.ts`
- Test: `packages/happy-server/sources/app/company/companyTokens.test.ts`

- [ ] **Step 2.1: Create role constants**

Create `packages/happy-server/sources/app/company/companyTypes.ts`.

```ts
import type { CompanyRole } from '@prisma/client';

export type CompanyCapabilityFlags = {
    canEditCompany: boolean;
    canManageMembers: boolean;
    canManageOwners: boolean;
    canManageInvites: boolean;
};

export const COMPANY_ROLE_ORDER: Record<CompanyRole, number> = {
    member: 0,
    admin: 1,
    owner: 2,
};

export function hasCompanyRole(role: CompanyRole, minimum: CompanyRole): boolean {
    return COMPANY_ROLE_ORDER[role] >= COMPANY_ROLE_ORDER[minimum];
}

export function getCompanyCapabilities(role: CompanyRole): CompanyCapabilityFlags {
    return {
        canEditCompany: role === 'owner' || role === 'admin',
        canManageMembers: role === 'owner' || role === 'admin',
        canManageOwners: role === 'owner',
        canManageInvites: role === 'owner' || role === 'admin',
    };
}
```

- [ ] **Step 2.2: Write token helper tests first**

Create `packages/happy-server/sources/app/company/companyTokens.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { createInviteToken, hashInviteToken } from './companyTokens';

describe('company invite tokens', () => {
    it('creates URL-safe opaque tokens', () => {
        const token = createInviteToken();
        expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    });

    it('hashes the same token consistently without returning the token itself', () => {
        const token = 'sample-token';
        expect(hashInviteToken(token)).toBe(hashInviteToken(token));
        expect(hashInviteToken(token)).not.toBe(token);
    });

    it('hashes different tokens differently', () => {
        expect(hashInviteToken('a')).not.toBe(hashInviteToken('b'));
    });
});
```

- [ ] **Step 2.3: Run token tests and verify failure**

Run:

```bash
cd packages/happy-server && npx vitest run sources/app/company/companyTokens.test.ts
```

Expected: fail because `companyTokens.ts` does not exist.

- [ ] **Step 2.4: Implement token helpers**

Create `packages/happy-server/sources/app/company/companyTokens.ts`.

```ts
import { createHash, randomBytes } from 'crypto';

export function createInviteToken(): string {
    return randomBytes(32).toString('base64url');
}

export function hashInviteToken(token: string): string {
    return createHash('sha256').update(token).digest('base64url');
}
```

- [ ] **Step 2.5: Run token tests and build**

Run:

```bash
cd packages/happy-server && npx vitest run sources/app/company/companyTokens.test.ts && yarn build
```

Expected: token tests pass and server typecheck passes.

---

## Task 3: Add backend presenters and bootstrap

**Files:**

- Create: `packages/happy-server/sources/app/company/companyPresenter.ts`
- Create: `packages/happy-server/sources/app/company/companyBootstrap.ts`
- Modify: `packages/happy-server/sources/app/api/api.ts`

- [ ] **Step 3.1: Create presenter helpers**

Create `packages/happy-server/sources/app/company/companyPresenter.ts`.

```ts
import type { Account, Company, CompanyInvite, CompanyMembership } from '@prisma/client';
import { getPublicUrl } from '@/storage/files';
import { getCompanyCapabilities } from './companyTypes';

type AvatarJson = {
    path?: string;
    url?: string;
    width?: number;
    height?: number;
    thumbhash?: string;
};

function formatAvatar(avatar: unknown) {
    if (!avatar || typeof avatar !== 'object' || !('path' in avatar)) {
        return null;
    }
    const value = avatar as AvatarJson;
    if (!value.path) {
        return null;
    }
    return {
        path: value.path,
        url: value.url || getPublicUrl(value.path),
        width: value.width,
        height: value.height,
        thumbhash: value.thumbhash,
    };
}

export function formatCompany(company: Company) {
    return {
        id: company.id,
        name: company.name,
        slug: company.slug,
        createdAt: company.createdAt.getTime(),
        updatedAt: company.updatedAt.getTime(),
    };
}

export function formatMembership(membership: CompanyMembership) {
    return {
        companyId: membership.companyId,
        accountId: membership.accountId,
        role: membership.role,
        joinedAt: membership.joinedAt.getTime(),
        createdAt: membership.createdAt.getTime(),
        updatedAt: membership.updatedAt.getTime(),
    };
}

export function formatCompanyOverview(company: Company, membership: CompanyMembership) {
    return {
        company: formatCompany(company),
        membership: formatMembership(membership),
        capabilities: getCompanyCapabilities(membership.role),
    };
}

export function formatCompanyMember(membership: CompanyMembership & { account: Account }) {
    return {
        ...formatMembership(membership),
        profile: {
            id: membership.account.id,
            firstName: membership.account.firstName,
            lastName: membership.account.lastName,
            username: membership.account.username,
            avatar: formatAvatar(membership.account.avatar),
        },
    };
}

export function formatCompanyInvite(invite: CompanyInvite & { createdByUser?: Account | null }) {
    return {
        id: invite.id,
        companyId: invite.companyId,
        role: invite.role,
        createdByUserId: invite.createdByUserId,
        createdBy: invite.createdByUser ? {
            id: invite.createdByUser.id,
            firstName: invite.createdByUser.firstName,
            lastName: invite.createdByUser.lastName,
            username: invite.createdByUser.username,
        } : null,
        expiresAt: invite.expiresAt ? invite.expiresAt.getTime() : null,
        maxUses: invite.maxUses,
        useCount: invite.useCount,
        revokedAt: invite.revokedAt ? invite.revokedAt.getTime() : null,
        createdAt: invite.createdAt.getTime(),
        updatedAt: invite.updatedAt.getTime(),
    };
}
```

- [ ] **Step 3.2: Create idempotent bootstrap helper**

Create `packages/happy-server/sources/app/company/companyBootstrap.ts`.

```ts
import { CompanyRole } from '@prisma/client';
import { db } from '@/storage/db';
import { log } from '@/utils/log';

export const DEFAULT_COMPANY_ID = 'company_default';
export const DEFAULT_COMPANY_SLUG = 'default';

function defaultCompanyName() {
    return process.env.HAPPY_COMPANY_NAME?.trim() || 'Happy Company';
}

export async function ensureDefaultCompany() {
    return db.company.upsert({
        where: { id: DEFAULT_COMPANY_ID },
        update: {
            name: defaultCompanyName(),
            slug: DEFAULT_COMPANY_SLUG,
        },
        create: {
            id: DEFAULT_COMPANY_ID,
            name: defaultCompanyName(),
            slug: DEFAULT_COMPANY_SLUG,
        },
    });
}

async function selectConfiguredOwnerAccountId(): Promise<string | null> {
    const configuredId = process.env.HAPPY_COMPANY_OWNER_ACCOUNT_ID?.trim();
    if (configuredId) {
        const account = await db.account.findUnique({ where: { id: configuredId }, select: { id: true } });
        return account?.id || null;
    }

    const configuredUsername = process.env.HAPPY_COMPANY_OWNER_USERNAME?.trim();
    if (configuredUsername) {
        const account = await db.account.findUnique({ where: { username: configuredUsername }, select: { id: true } });
        return account?.id || null;
    }

    const firstAccount = await db.account.findFirst({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
    });
    return firstAccount?.id || null;
}

export async function ensureDefaultCompanyMemberships() {
    const company = await ensureDefaultCompany();
    const accounts = await db.account.findMany({ select: { id: true } });

    for (const account of accounts) {
        await db.companyMembership.upsert({
            where: {
                companyId_accountId: {
                    companyId: company.id,
                    accountId: account.id,
                },
            },
            update: {},
            create: {
                companyId: company.id,
                accountId: account.id,
                role: CompanyRole.member,
            },
        });
    }

    const ownerCount = await db.companyMembership.count({
        where: { companyId: company.id, role: CompanyRole.owner },
    });
    if (ownerCount === 0) {
        const ownerAccountId = await selectConfiguredOwnerAccountId();
        if (ownerAccountId) {
            await db.companyMembership.update({
                where: {
                    companyId_accountId: {
                        companyId: company.id,
                        accountId: ownerAccountId,
                    },
                },
                data: { role: CompanyRole.owner },
            });
            log({ module: 'company', level: 'info' }, `Selected default company owner account ${ownerAccountId}`);
        } else {
            log({ module: 'company', level: 'warn' }, 'Default company has no accounts, owner selection skipped');
        }
    }

    return company;
}
```

- [ ] **Step 3.3: Wire bootstrap into API startup**

In `packages/happy-server/sources/app/api/api.ts`, import and call bootstrap before route registration.

```ts
import { ensureDefaultCompanyMemberships } from '@/app/company/companyBootstrap';
```

Inside `startApi()`, after authentication setup and before route registration:

```ts
    await ensureDefaultCompanyMemberships();
```

- [ ] **Step 3.4: Build server**

Run:

```bash
cd packages/happy-server && yarn build
```

Expected: server typecheck passes.

---

## Task 4: Add backend company service with tests

**Files:**

- Create: `packages/happy-server/sources/app/company/companyService.ts`
- Test: `packages/happy-server/sources/app/company/companyService.test.ts`

- [ ] **Step 4.1: Write service tests for role and invite behavior**

Create `packages/happy-server/sources/app/company/companyService.test.ts`. Use Vitest hoisted mocks for `@/storage/db` following existing route test style.

Required test cases:

```ts
import { CompanyRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, dbMock, resetState } = vi.hoisted(() => {
    const state = {
        companies: [] as any[],
        memberships: [] as any[],
        invites: [] as any[],
        accounts: [] as any[],
    };
    const resetState = () => {
        state.companies = [{ id: 'company_default', name: 'Happy Company', slug: 'default', createdAt: new Date(0), updatedAt: new Date(0) }];
        state.accounts = [];
        state.memberships = [];
        state.invites = [];
    };
    const dbMock = {
        company: {},
        companyMembership: {},
        companyInvite: {},
        account: {},
        $transaction: vi.fn(async (callback: any) => callback(dbMock)),
    };
    return { state, dbMock, resetState };
});

vi.mock('@/storage/db', () => ({ db: dbMock }));

import {
    createCompanyInvite,
    listCompanyMembers,
    revokeCompanyInvite,
    updateCompanyMember,
    acceptCompanyInvite,
    getCompanyOverviewForUser,
} from './companyService';

function seedAccount(id: string, role: CompanyRole) {
    const account = {
        id,
        publicKey: `${id}-pk`,
        firstName: id,
        lastName: null,
        username: id,
        avatar: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
    };
    state.accounts.push(account);
    state.memberships.push({
        companyId: 'company_default',
        accountId: id,
        role,
        joinedAt: new Date(0),
        createdAt: new Date(0),
        updatedAt: new Date(0),
        account,
    });
    return account;
}

describe('companyService', () => {
    beforeEach(() => {
        resetState();
    });

    it('returns overview for a member', async () => {
        seedAccount('member-1', CompanyRole.member);
        await expect(getCompanyOverviewForUser('member-1')).resolves.toMatchObject({
            company: { id: 'company_default' },
            membership: { accountId: 'member-1', role: CompanyRole.member },
            capabilities: { canManageInvites: false },
        });
    });

    it('allows members to list members', async () => {
        seedAccount('member-1', CompanyRole.member);
        await expect(listCompanyMembers('member-1', {})).resolves.toHaveLength(1);
    });

    it('rejects member invite creation', async () => {
        seedAccount('member-1', CompanyRole.member);
        await expect(createCompanyInvite('member-1', {})).rejects.toMatchObject({ statusCode: 403 });
    });

    it('allows admin to create member invite', async () => {
        seedAccount('admin-1', CompanyRole.admin);
        await expect(createCompanyInvite('admin-1', { role: CompanyRole.member })).resolves.toMatchObject({
            invite: { role: CompanyRole.member },
            token: expect.any(String),
        });
    });

    it('rejects admin owner invite creation', async () => {
        seedAccount('admin-1', CompanyRole.admin);
        await expect(createCompanyInvite('admin-1', { role: CompanyRole.owner })).rejects.toMatchObject({ statusCode: 403 });
    });

    it('allows owner to promote a member', async () => {
        seedAccount('owner-1', CompanyRole.owner);
        seedAccount('member-1', CompanyRole.member);
        await expect(updateCompanyMember('owner-1', 'member-1', { role: CompanyRole.admin })).resolves.toMatchObject({ role: CompanyRole.admin });
    });

    it('rejects admin role changes', async () => {
        seedAccount('admin-1', CompanyRole.admin);
        seedAccount('member-1', CompanyRole.member);
        await expect(updateCompanyMember('admin-1', 'member-1', { role: CompanyRole.admin })).rejects.toMatchObject({ statusCode: 403 });
    });

    it('allows admin to remove a member', async () => {
        seedAccount('admin-1', CompanyRole.admin);
        seedAccount('member-1', CompanyRole.member);
        await expect(updateCompanyMember('admin-1', 'member-1', { remove: true })).resolves.toMatchObject({ removed: true });
    });

    it('rejects removing the last owner', async () => {
        seedAccount('owner-1', CompanyRole.owner);
        await expect(updateCompanyMember('owner-1', 'owner-1', { remove: true })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('accepts a valid invite for a non-member', async () => {
        seedAccount('owner-1', CompanyRole.owner);
        state.accounts.push({ id: 'new-1', username: 'new-1', firstName: null, lastName: null, avatar: null, createdAt: new Date(1), updatedAt: new Date(1) });
        const created = await createCompanyInvite('owner-1', {});
        await expect(acceptCompanyInvite('new-1', created.token)).resolves.toMatchObject({
            membership: { accountId: 'new-1', role: CompanyRole.member },
            alreadyMember: false,
        });
    });

    it('does not increment use count for an already-member accept', async () => {
        seedAccount('owner-1', CompanyRole.owner);
        const created = await createCompanyInvite('owner-1', {});
        await expect(acceptCompanyInvite('owner-1', created.token)).resolves.toMatchObject({ alreadyMember: true });
    });

    it('rejects expired, revoked, and overused invites', async () => {
        seedAccount('owner-1', CompanyRole.owner);
        state.accounts.push({ id: 'new-1', username: 'new-1', firstName: null, lastName: null, avatar: null, createdAt: new Date(1), updatedAt: new Date(1) });
        const expired = await createCompanyInvite('owner-1', { expiresAt: new Date(Date.now() - 1000).getTime() });
        await expect(acceptCompanyInvite('new-1', expired.token)).rejects.toMatchObject({ statusCode: 410 });
        const revoked = await createCompanyInvite('owner-1', {});
        await revokeCompanyInvite('owner-1', revoked.invite.id);
        await expect(acceptCompanyInvite('new-1', revoked.token)).rejects.toMatchObject({ statusCode: 410 });
        state.accounts.push({ id: 'new-2', username: 'new-2', firstName: null, lastName: null, avatar: null, createdAt: new Date(2), updatedAt: new Date(2) });
        const overused = await createCompanyInvite('owner-1', { maxUses: 1 });
        await acceptCompanyInvite('new-1', overused.token);
        await expect(acceptCompanyInvite('new-2', overused.token)).rejects.toMatchObject({ statusCode: 410 });
    });
});
```

Use the tests as the executable specification. Fill the in-memory `dbMock` methods in the same test file so they match the service calls exactly.

- [ ] **Step 4.2: Run service tests and verify failure**

Run:

```bash
cd packages/happy-server && npx vitest run sources/app/company/companyService.test.ts
```

Expected: fail because `companyService.ts` does not exist and the mock methods are not wired.

- [ ] **Step 4.3: Implement service errors and context loading**

In `companyService.ts`, define local error helpers.

```ts
import { CompanyRole } from '@prisma/client';
import { db } from '@/storage/db';
import { DEFAULT_COMPANY_ID, ensureDefaultCompanyMemberships } from './companyBootstrap';
import { createInviteToken, hashInviteToken } from './companyTokens';
import { formatCompany, formatCompanyInvite, formatCompanyMember, formatCompanyOverview, formatMembership } from './companyPresenter';

export class CompanyServiceError extends Error {
    constructor(readonly statusCode: number, message: string) {
        super(message);
    }
}

function forbidden(message = 'Forbidden'): never {
    throw new CompanyServiceError(403, message);
}

function notFound(message = 'Not found'): never {
    throw new CompanyServiceError(404, message);
}

function gone(message = 'Invite is no longer valid'): never {
    throw new CompanyServiceError(410, message);
}

function conflict(message: string): never {
    throw new CompanyServiceError(409, message);
}
```

Add helpers:

```ts
async function getDefaultCompanyOrCreate() {
    const company = await db.company.findUnique({ where: { id: DEFAULT_COMPANY_ID } });
    if (company) {
        return company;
    }
    return ensureDefaultCompanyMemberships();
}

async function getMembershipOrThrow(accountId: string) {
    const company = await getDefaultCompanyOrCreate();
    const membership = await db.companyMembership.findUnique({
        where: { companyId_accountId: { companyId: company.id, accountId } },
    });
    if (!membership) {
        forbidden('Account is not a company member');
    }
    return { company, membership };
}

async function assertNotLastOwner(companyId: string, accountId: string) {
    const target = await db.companyMembership.findUnique({
        where: { companyId_accountId: { companyId, accountId } },
    });
    if (target?.role !== CompanyRole.owner) {
        return;
    }
    const ownerCount = await db.companyMembership.count({ where: { companyId, role: CompanyRole.owner } });
    if (ownerCount <= 1) {
        conflict('Cannot remove or demote the last owner');
    }
}
```

- [ ] **Step 4.4: Implement read operations**

Add:

```ts
export async function getCompanyOverviewForUser(accountId: string) {
    const { company, membership } = await getMembershipOrThrow(accountId);
    return formatCompanyOverview(company, membership);
}

export async function listCompanyMembers(accountId: string, options: { query?: string; limit?: number }) {
    const { company } = await getMembershipOrThrow(accountId);
    const query = options.query?.trim();
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 50);
    const members = await db.companyMembership.findMany({
        where: {
            companyId: company.id,
            ...(query ? {
                account: {
                    OR: [
                        { username: { contains: query, mode: 'insensitive' } },
                        { firstName: { contains: query, mode: 'insensitive' } },
                        { lastName: { contains: query, mode: 'insensitive' } },
                    ],
                },
            } : {}),
        },
        include: { account: true },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        take: limit,
    });
    return members.map(formatCompanyMember);
}
```

- [ ] **Step 4.5: Implement profile update and member management**

Add:

```ts
export async function updateCompanyProfile(accountId: string, body: { name?: string; slug?: string }) {
    const { company, membership } = await getMembershipOrThrow(accountId);
    if (membership.role !== CompanyRole.owner && membership.role !== CompanyRole.admin) {
        forbidden();
    }
    const name = body.name?.trim();
    const slug = body.slug?.trim().toLowerCase();
    const updated = await db.company.update({
        where: { id: company.id },
        data: {
            ...(name ? { name } : {}),
            ...(slug ? { slug } : {}),
        },
    });
    return formatCompany(updated);
}

export async function updateCompanyMember(actorAccountId: string, targetAccountId: string, body: { role?: CompanyRole; remove?: boolean }) {
    const { company, membership: actor } = await getMembershipOrThrow(actorAccountId);
    if (actor.role !== CompanyRole.owner && actor.role !== CompanyRole.admin) {
        forbidden();
    }
    const target = await db.companyMembership.findUnique({
        where: { companyId_accountId: { companyId: company.id, accountId: targetAccountId } },
    });
    if (!target) {
        notFound('Company member not found');
    }

    if (body.remove) {
        if (actor.role === CompanyRole.admin && target.role !== CompanyRole.member) {
            forbidden('Admins can only remove members');
        }
        await assertNotLastOwner(company.id, targetAccountId);
        await db.companyMembership.delete({
            where: { companyId_accountId: { companyId: company.id, accountId: targetAccountId } },
        });
        return { removed: true as const };
    }

    if (!body.role) {
        return formatMembership(target);
    }
    if (actor.role !== CompanyRole.owner) {
        forbidden('Only owners can change roles');
    }
    if (target.role === CompanyRole.owner && body.role !== CompanyRole.owner) {
        await assertNotLastOwner(company.id, targetAccountId);
    }
    const updated = await db.companyMembership.update({
        where: { companyId_accountId: { companyId: company.id, accountId: targetAccountId } },
        data: { role: body.role },
    });
    return formatMembership(updated);
}
```

- [ ] **Step 4.6: Implement invite creation, listing, revocation, and acceptance**

Add:

```ts
export async function listCompanyInvites(accountId: string) {
    const { company, membership } = await getMembershipOrThrow(accountId);
    if (membership.role !== CompanyRole.owner && membership.role !== CompanyRole.admin) {
        forbidden();
    }
    const invites = await db.companyInvite.findMany({
        where: { companyId: company.id },
        include: { createdByUser: true },
        orderBy: { createdAt: 'desc' },
    });
    return invites.map(formatCompanyInvite);
}

function normalizeInviteRole(actorRole: CompanyRole, requestedRole?: CompanyRole) {
    const role = requestedRole ?? CompanyRole.member;
    if (actorRole === CompanyRole.admin && role !== CompanyRole.member) {
        forbidden('Admins can only create member invites');
    }
    return role;
}

export async function createCompanyInvite(accountId: string, body: { role?: CompanyRole; expiresAt?: number; maxUses?: number }) {
    const { company, membership } = await getMembershipOrThrow(accountId);
    if (membership.role !== CompanyRole.owner && membership.role !== CompanyRole.admin) {
        forbidden();
    }
    const token = createInviteToken();
    const invite = await db.companyInvite.create({
        data: {
            companyId: company.id,
            tokenHash: hashInviteToken(token),
            role: normalizeInviteRole(membership.role, body.role),
            createdByUserId: accountId,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            maxUses: typeof body.maxUses === 'number' ? body.maxUses : null,
        },
        include: { createdByUser: true },
    });
    return {
        invite: formatCompanyInvite(invite),
        token,
    };
}

export async function revokeCompanyInvite(accountId: string, inviteId: string) {
    const { company, membership } = await getMembershipOrThrow(accountId);
    if (membership.role !== CompanyRole.owner && membership.role !== CompanyRole.admin) {
        forbidden();
    }
    const invite = await db.companyInvite.findFirst({ where: { id: inviteId, companyId: company.id } });
    if (!invite) {
        notFound('Company invite not found');
    }
    const updated = await db.companyInvite.update({
        where: { id: inviteId },
        data: { revokedAt: new Date() },
        include: { createdByUser: true },
    });
    return formatCompanyInvite(updated);
}

export async function acceptCompanyInvite(accountId: string, token: string) {
    return db.$transaction(async (tx) => {
        const tokenHash = hashInviteToken(token);
        const invite = await tx.companyInvite.findUnique({
            where: { tokenHash },
            include: { company: true },
        });
        if (!invite) {
            notFound('Company invite not found');
        }
        if (invite.revokedAt || (invite.expiresAt && invite.expiresAt.getTime() <= Date.now())) {
            gone();
        }
        if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
            gone();
        }

        const existing = await tx.companyMembership.findUnique({
            where: { companyId_accountId: { companyId: invite.companyId, accountId } },
        });
        if (existing) {
            return {
                company: formatCompany(invite.company),
                membership: formatMembership(existing),
                alreadyMember: true,
            };
        }

        const membership = await tx.companyMembership.create({
            data: {
                companyId: invite.companyId,
                accountId,
                role: invite.role,
            },
        });
        await tx.companyInvite.update({
            where: { id: invite.id },
            data: { useCount: { increment: 1 } },
        });
        return {
            company: formatCompany(invite.company),
            membership: formatMembership(membership),
            alreadyMember: false,
        };
    });
}
```

- [ ] **Step 4.7: Complete in-memory mocks and run service tests**

Run:

```bash
cd packages/happy-server && npx vitest run sources/app/company/companyService.test.ts
```

Expected: all company service tests pass.

- [ ] **Step 4.8: Build server**

Run:

```bash
cd packages/happy-server && yarn build
```

Expected: server typecheck passes.

---

## Task 5: Add backend company API routes

**Files:**

- Create: `packages/happy-server/sources/app/api/routes/companyRoutes.ts`
- Test: `packages/happy-server/sources/app/api/routes/companyRoutes.test.ts`
- Modify: `packages/happy-server/sources/app/api/api.ts`

- [ ] **Step 5.1: Write route tests first**

Create `packages/happy-server/sources/app/api/routes/companyRoutes.test.ts` using Fastify injection and service mocks.

Required route test cases:

```ts
import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fastify } from '../types';

const serviceMock = vi.hoisted(() => ({
    getCompanyOverviewForUser: vi.fn(),
    updateCompanyProfile: vi.fn(),
    listCompanyMembers: vi.fn(),
    updateCompanyMember: vi.fn(),
    createCompanyInvite: vi.fn(),
    listCompanyInvites: vi.fn(),
    revokeCompanyInvite: vi.fn(),
    acceptCompanyInvite: vi.fn(),
}));

vi.mock('@/app/company/companyService', () => serviceMock);

import { companyRoutes } from './companyRoutes';

async function createApp(userId = 'user-1') {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate('authenticate', async (request: any) => {
        request.userId = userId;
    });
    companyRoutes(typed);
    await typed.ready();
    return typed;
}

describe('companyRoutes', () => {
    let app: Fastify;

    beforeEach(async () => {
        vi.clearAllMocks();
        app = await createApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it('GET /v1/company returns current overview', async () => {
        serviceMock.getCompanyOverviewForUser.mockResolvedValue({ company: { id: 'company_default' }, membership: { role: 'owner' }, capabilities: { canManageInvites: true } });
        const res = await app.inject({ method: 'GET', url: '/v1/company' });
        expect(res.statusCode).toBe(200);
        expect(serviceMock.getCompanyOverviewForUser).toHaveBeenCalledWith('user-1');
        expect(res.json().company.id).toBe('company_default');
    });

    it('POST /v1/company/invites returns token and url', async () => {
        serviceMock.createCompanyInvite.mockResolvedValue({ invite: { id: 'invite-1' }, token: 'token-1' });
        const res = await app.inject({ method: 'POST', url: '/v1/company/invites', payload: {} });
        expect(res.statusCode).toBe(201);
        expect(res.json()).toMatchObject({ token: 'token-1' });
    });

    it('maps service errors to response status codes', async () => {
        serviceMock.listCompanyInvites.mockRejectedValue({ statusCode: 403, message: 'Forbidden' });
        const res = await app.inject({ method: 'GET', url: '/v1/company/invites' });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Forbidden' });
    });
});
```

Include these additional route cases in the same `describe('companyRoutes')` block:

```ts
    it('PATCH /v1/company forwards profile updates', async () => {
        serviceMock.updateCompanyProfile.mockResolvedValue({ id: 'company_default', name: 'Acme', slug: 'acme' });
        const res = await app.inject({ method: 'PATCH', url: '/v1/company', payload: { name: 'Acme' } });
        expect(res.statusCode).toBe(200);
        expect(serviceMock.updateCompanyProfile).toHaveBeenCalledWith('user-1', { name: 'Acme' });
        expect(res.json().company.name).toBe('Acme');
    });

    it('GET /v1/company/members forwards query and limit', async () => {
        serviceMock.listCompanyMembers.mockResolvedValue([{ accountId: 'member-1', role: 'member' }]);
        const res = await app.inject({ method: 'GET', url: '/v1/company/members?query=mem&limit=10' });
        expect(res.statusCode).toBe(200);
        expect(serviceMock.listCompanyMembers).toHaveBeenCalledWith('user-1', { query: 'mem', limit: 10 });
        expect(res.json().members).toHaveLength(1);
    });

    it('PATCH /v1/company/members/:accountId forwards member updates', async () => {
        serviceMock.updateCompanyMember.mockResolvedValue({ accountId: 'member-1', role: 'admin' });
        const res = await app.inject({ method: 'PATCH', url: '/v1/company/members/member-1', payload: { role: 'admin' } });
        expect(res.statusCode).toBe(200);
        expect(serviceMock.updateCompanyMember).toHaveBeenCalledWith('user-1', 'member-1', { role: 'admin' });
        expect(res.json().role).toBe('admin');
    });

    it('DELETE /v1/company/invites/:id revokes an invite', async () => {
        serviceMock.revokeCompanyInvite.mockResolvedValue({ id: 'invite-1', revokedAt: 1 });
        const res = await app.inject({ method: 'DELETE', url: '/v1/company/invites/invite-1' });
        expect(res.statusCode).toBe(200);
        expect(serviceMock.revokeCompanyInvite).toHaveBeenCalledWith('user-1', 'invite-1');
        expect(res.json().invite.revokedAt).toBe(1);
    });

    it('POST /v1/company/invites/accept forwards token acceptance', async () => {
        serviceMock.acceptCompanyInvite.mockResolvedValue({ alreadyMember: false, company: { id: 'company_default' }, membership: { accountId: 'user-1' } });
        const res = await app.inject({ method: 'POST', url: '/v1/company/invites/accept', payload: { token: 'token-1234567890123456' } });
        expect(res.statusCode).toBe(200);
        expect(serviceMock.acceptCompanyInvite).toHaveBeenCalledWith('user-1', 'token-1234567890123456');
        expect(res.json().alreadyMember).toBe(false);
    });
```

- [ ] **Step 5.2: Run route tests and verify failure**

Run:

```bash
cd packages/happy-server && npx vitest run sources/app/api/routes/companyRoutes.test.ts
```

Expected: fail because `companyRoutes.ts` does not exist.

- [ ] **Step 5.3: Implement route schemas and error mapping**

Create `packages/happy-server/sources/app/api/routes/companyRoutes.ts`.

```ts
import { CompanyRole } from '@prisma/client';
import { z } from 'zod';
import {
    acceptCompanyInvite,
    createCompanyInvite,
    getCompanyOverviewForUser,
    listCompanyInvites,
    listCompanyMembers,
    revokeCompanyInvite,
    updateCompanyMember,
    updateCompanyProfile,
} from '@/app/company/companyService';
import { Fastify } from '../types';

const roleSchema = z.nativeEnum(CompanyRole);
const companySlugSchema = z.string().trim().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
const companyUpdateSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    slug: companySlugSchema.optional(),
}).refine((value) => value.name !== undefined || value.slug !== undefined, { message: 'No changes provided' });
const membersQuerySchema = z.object({
    query: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
});
const accountParamsSchema = z.object({ accountId: z.string() });
const inviteParamsSchema = z.object({ id: z.string() });
const updateMemberSchema = z.object({
    role: roleSchema.optional(),
    remove: z.boolean().optional(),
}).refine((value) => value.role !== undefined || value.remove === true, { message: 'No member action provided' });
const createInviteSchema = z.object({
    role: roleSchema.optional(),
    expiresAt: z.number().int().positive().optional(),
    maxUses: z.number().int().min(1).max(1000).optional(),
});
const acceptInviteSchema = z.object({ token: z.string().min(16) });

function buildInviteUrl(request: any, token: string) {
    const publicAppUrl = process.env.HAPPY_PUBLIC_APP_URL?.replace(/\/+$/, '');
    if (publicAppUrl) {
        return `${publicAppUrl}/company/join/${encodeURIComponent(token)}`;
    }
    const origin = request.headers.origin;
    if (typeof origin === 'string' && origin.length > 0) {
        return `${origin.replace(/\/+$/, '')}/company/join/${encodeURIComponent(token)}`;
    }
    return null;
}

function sendServiceError(reply: any, error: unknown) {
    const statusCode = typeof (error as any)?.statusCode === 'number' ? (error as any).statusCode : 500;
    const message = typeof (error as any)?.message === 'string' ? (error as any).message : 'Internal server error';
    return reply.code(statusCode).send({ error: message });
}
```

- [ ] **Step 5.4: Implement route handlers**

Continue `companyRoutes.ts`.

```ts
export function companyRoutes(app: Fastify) {
    app.get('/v1/company', { preHandler: app.authenticate }, async (request, reply) => {
        try {
            return reply.send(await getCompanyOverviewForUser(request.userId));
        } catch (error) {
            return sendServiceError(reply, error);
        }
    });

    app.patch('/v1/company', {
        preHandler: app.authenticate,
        schema: { body: companyUpdateSchema },
    }, async (request, reply) => {
        try {
            const company = await updateCompanyProfile(request.userId, request.body);
            return reply.send({ company });
        } catch (error) {
            return sendServiceError(reply, error);
        }
    });

    app.get('/v1/company/members', {
        preHandler: app.authenticate,
        schema: { querystring: membersQuerySchema },
    }, async (request, reply) => {
        try {
            const members = await listCompanyMembers(request.userId, request.query);
            return reply.send({ members });
        } catch (error) {
            return sendServiceError(reply, error);
        }
    });

    app.patch('/v1/company/members/:accountId', {
        preHandler: app.authenticate,
        schema: { params: accountParamsSchema, body: updateMemberSchema },
    }, async (request, reply) => {
        try {
            const result = await updateCompanyMember(request.userId, request.params.accountId, request.body);
            return reply.send(result);
        } catch (error) {
            return sendServiceError(reply, error);
        }
    });

    app.post('/v1/company/invites', {
        preHandler: app.authenticate,
        schema: { body: createInviteSchema },
    }, async (request, reply) => {
        try {
            const result = await createCompanyInvite(request.userId, request.body);
            return reply.code(201).send({
                invite: result.invite,
                token: result.token,
                url: buildInviteUrl(request, result.token),
            });
        } catch (error) {
            return sendServiceError(reply, error);
        }
    });

    app.get('/v1/company/invites', { preHandler: app.authenticate }, async (request, reply) => {
        try {
            return reply.send({ invites: await listCompanyInvites(request.userId) });
        } catch (error) {
            return sendServiceError(reply, error);
        }
    });

    app.delete('/v1/company/invites/:id', {
        preHandler: app.authenticate,
        schema: { params: inviteParamsSchema },
    }, async (request, reply) => {
        try {
            const invite = await revokeCompanyInvite(request.userId, request.params.id);
            return reply.send({ invite });
        } catch (error) {
            return sendServiceError(reply, error);
        }
    });

    app.post('/v1/company/invites/accept', {
        preHandler: app.authenticate,
        schema: { body: acceptInviteSchema },
    }, async (request, reply) => {
        try {
            return reply.send(await acceptCompanyInvite(request.userId, request.body.token));
        } catch (error) {
            return sendServiceError(reply, error);
        }
    });
}
```

- [ ] **Step 5.5: Register route module**

In `packages/happy-server/sources/app/api/api.ts`, import and register routes.

```ts
import { companyRoutes } from './routes/companyRoutes';
```

Call it near `userRoutes(typed)`:

```ts
    userRoutes(typed);
    companyRoutes(typed);
```

- [ ] **Step 5.6: Run backend route tests and build**

Run:

```bash
cd packages/happy-server && npx vitest run sources/app/api/routes/companyRoutes.test.ts && yarn build
```

Expected: route tests pass and server typecheck passes.

---

## Task 6: Add frontend company API client and helper tests

**Files:**

- Create: `packages/happy-app/sources/sync/companyTypes.ts`
- Create: `packages/happy-app/sources/sync/apiCompany.ts`
- Test: `packages/happy-app/sources/sync/apiCompany.test.ts`
- Create: `packages/happy-app/sources/components/company/companyRole.ts`
- Test: `packages/happy-app/sources/components/company/companyRole.test.ts`

- [ ] **Step 6.1: Create frontend Zod types**

Create `packages/happy-app/sources/sync/companyTypes.ts`.

```ts
import * as z from 'zod';

export const CompanyRoleSchema = z.enum(['owner', 'admin', 'member']);
export type CompanyRole = z.infer<typeof CompanyRoleSchema>;

export const CompanyCapabilityFlagsSchema = z.object({
    canEditCompany: z.boolean(),
    canManageMembers: z.boolean(),
    canManageOwners: z.boolean(),
    canManageInvites: z.boolean(),
});
export type CompanyCapabilityFlags = z.infer<typeof CompanyCapabilityFlagsSchema>;

export const CompanySummarySchema = z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
});
export type CompanySummary = z.infer<typeof CompanySummarySchema>;

export const CompanyMembershipSummarySchema = z.object({
    companyId: z.string(),
    accountId: z.string(),
    role: CompanyRoleSchema,
    joinedAt: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
});
export type CompanyMembershipSummary = z.infer<typeof CompanyMembershipSummarySchema>;

export const CompanyMemberSchema = CompanyMembershipSummarySchema.extend({
    profile: z.object({
        id: z.string(),
        firstName: z.string().nullable(),
        lastName: z.string().nullable(),
        username: z.string().nullable(),
        avatar: z.object({
            path: z.string(),
            url: z.string(),
            width: z.number().optional(),
            height: z.number().optional(),
            thumbhash: z.string().optional(),
        }).nullable(),
    }),
});
export type CompanyMember = z.infer<typeof CompanyMemberSchema>;

export const CompanyInviteSchema = z.object({
    id: z.string(),
    companyId: z.string(),
    role: CompanyRoleSchema,
    createdByUserId: z.string(),
    createdBy: z.object({
        id: z.string(),
        firstName: z.string().nullable(),
        lastName: z.string().nullable(),
        username: z.string().nullable(),
    }).nullable(),
    expiresAt: z.number().nullable(),
    maxUses: z.number().nullable(),
    useCount: z.number(),
    revokedAt: z.number().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
});
export type CompanyInvite = z.infer<typeof CompanyInviteSchema>;

export const CompanyOverviewResponseSchema = z.object({
    company: CompanySummarySchema,
    membership: CompanyMembershipSummarySchema,
    capabilities: CompanyCapabilityFlagsSchema,
});
export type CompanyOverviewResponse = z.infer<typeof CompanyOverviewResponseSchema>;

export const CompanyMembersResponseSchema = z.object({ members: z.array(CompanyMemberSchema) });
export const CompanyInvitesResponseSchema = z.object({ invites: z.array(CompanyInviteSchema) });
export const CompanyInviteCreateResponseSchema = z.object({
    invite: CompanyInviteSchema,
    token: z.string(),
    url: z.string().nullable(),
});
export const CompanyInviteAcceptResponseSchema = z.object({
    company: CompanySummarySchema,
    membership: CompanyMembershipSummarySchema,
    alreadyMember: z.boolean(),
});

export type CompanyInviteCreateResponse = z.infer<typeof CompanyInviteCreateResponseSchema>;
export type CompanyInviteAcceptResponse = z.infer<typeof CompanyInviteAcceptResponseSchema>;
```

- [ ] **Step 6.2: Write API client tests first**

Create `packages/happy-app/sources/sync/apiCompany.test.ts` with fetch stubs like `apiPortProxy.test.ts`.

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthCredentials } from '@/auth/tokenStorage';
import {
    acceptCompanyInvite,
    buildCompanyInviteUrl,
    createCompanyInvite,
    getCompanyOverview,
    listCompanyInvites,
    listCompanyMembers,
    revokeCompanyInvite,
    updateCompanyMember,
    updateCompanyProfile,
} from './apiCompany';

vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://happy.example/api/' }));
vi.mock('@/utils/time', () => ({ backoff: <T>(callback: () => Promise<T>) => callback() }));

const credentials: AuthCredentials = { token: 'token-1', secret: 'secret-1' };

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
    return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('apiCompany', () => {
    it('fetches company overview', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({
            company: { id: 'company_default', name: 'Happy Company', slug: 'default', createdAt: 1, updatedAt: 2 },
            membership: { companyId: 'company_default', accountId: 'user-1', role: 'owner', joinedAt: 1, createdAt: 1, updatedAt: 1 },
            capabilities: { canEditCompany: true, canManageMembers: true, canManageOwners: true, canManageInvites: true },
        }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(getCompanyOverview(credentials)).resolves.toMatchObject({ company: { slug: 'default' } });
        expect(fetchMock).toHaveBeenCalledWith('https://happy.example/api/v1/company', {
            method: 'GET',
            headers: { Authorization: 'Bearer token-1' },
        });
    });

    it('creates an invite with authenticated JSON POST', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({
            invite: {
                id: 'invite-1', companyId: 'company_default', role: 'member', createdByUserId: 'user-1', createdBy: null,
                expiresAt: null, maxUses: null, useCount: 0, revokedAt: null, createdAt: 1, updatedAt: 1,
            },
            token: 'token-1',
            url: 'https://app.example/company/join/token-1',
        }, { status: 201 }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(createCompanyInvite(credentials, {})).resolves.toMatchObject({ token: 'token-1' });
        expect(fetchMock).toHaveBeenCalledWith('https://happy.example/api/v1/company/invites', {
            method: 'POST',
            headers: { Authorization: 'Bearer token-1', 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
    });

    it('builds local invite URLs when server returns only a token', () => {
        expect(buildCompanyInviteUrl('https://app.example/', 'abc token')).toBe('https://app.example/company/join/abc%20token');
        expect(buildCompanyInviteUrl('happy://', 'abc')).toBe('happy://company/join/abc');
    });
});
```

Include these additional API-client test cases in the same `describe('apiCompany')` block:

```ts
    it('lists company members with query parameters', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ members: [] }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(listCompanyMembers(credentials, { query: 'ali', limit: 10 })).resolves.toEqual({ members: [] });
        expect(fetchMock).toHaveBeenCalledWith('https://happy.example/api/v1/company/members?query=ali&limit=10', {
            method: 'GET',
            headers: { Authorization: 'Bearer token-1' },
        });
    });

    it('updates company profile', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ company: { id: 'company_default', name: 'Acme', slug: 'acme', createdAt: 1, updatedAt: 2 } }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(updateCompanyProfile(credentials, { name: 'Acme' })).resolves.toMatchObject({ company: { name: 'Acme' } });
        expect(fetchMock).toHaveBeenCalledWith('https://happy.example/api/v1/company', {
            method: 'PATCH',
            headers: { Authorization: 'Bearer token-1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Acme' }),
        });
    });

    it('updates company member role', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ accountId: 'member-1', role: 'admin' }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(updateCompanyMember(credentials, 'member-1', { role: 'admin' })).resolves.toMatchObject({ role: 'admin' });
        expect(fetchMock).toHaveBeenCalledWith('https://happy.example/api/v1/company/members/member-1', {
            method: 'PATCH',
            headers: { Authorization: 'Bearer token-1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'admin' }),
        });
    });

    it('lists invites and revokes an invite', async () => {
        const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
            if (init.method === 'GET') return jsonResponse({ invites: [] });
            return jsonResponse({ invite: { id: 'invite-1' } });
        });
        vi.stubGlobal('fetch', fetchMock);
        await expect(listCompanyInvites(credentials)).resolves.toEqual({ invites: [] });
        await expect(revokeCompanyInvite(credentials, 'invite-1')).resolves.toMatchObject({ invite: { id: 'invite-1' } });
    });

    it('accepts an invite token', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({
            company: { id: 'company_default', name: 'Happy Company', slug: 'default', createdAt: 1, updatedAt: 1 },
            membership: { companyId: 'company_default', accountId: 'user-1', role: 'member', joinedAt: 1, createdAt: 1, updatedAt: 1 },
            alreadyMember: false,
        }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(acceptCompanyInvite(credentials, 'token-1')).resolves.toMatchObject({ alreadyMember: false });
        expect(fetchMock).toHaveBeenCalledWith('https://happy.example/api/v1/company/invites/accept', {
            method: 'POST',
            headers: { Authorization: 'Bearer token-1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'token-1' }),
        });
    });
```

- [ ] **Step 6.3: Implement API client**

Create `packages/happy-app/sources/sync/apiCompany.ts`.

```ts
import type { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';
import {
    CompanyInviteAcceptResponseSchema,
    CompanyInviteCreateResponseSchema,
    CompanyInvitesResponseSchema,
    CompanyMembersResponseSchema,
    CompanyOverviewResponseSchema,
    type CompanyInviteAcceptResponse,
    type CompanyInviteCreateResponse,
    type CompanyOverviewResponse,
    type CompanyRole,
} from './companyTypes';

function apiUrl(path: string) {
    return `${getServerUrl().replace(/\/+$/, '')}${path}`;
}

function authHeaders(credentials: AuthCredentials) {
    return { Authorization: `Bearer ${credentials.token}` };
}

function jsonHeaders(credentials: AuthCredentials) {
    return { ...authHeaders(credentials), 'Content-Type': 'application/json' };
}

async function parseJson<T>(response: Response, schema: { parse(value: unknown): T }, message: string): Promise<T> {
    if (!response.ok) {
        throw new Error(`${message}: ${response.status}`);
    }
    return schema.parse(await response.json());
}

export function buildCompanyInviteUrl(appOrigin: string, token: string) {
    if (appOrigin.endsWith('://')) {
        return `${appOrigin}company/join/${encodeURIComponent(token)}`;
    }
    return `${appOrigin.replace(/\/+$/, '')}/company/join/${encodeURIComponent(token)}`;
}

export async function getCompanyOverview(credentials: AuthCredentials): Promise<CompanyOverviewResponse> {
    return backoff(async () => parseJson(
        await fetch(apiUrl('/v1/company'), { method: 'GET', headers: authHeaders(credentials) }),
        CompanyOverviewResponseSchema,
        'Failed to get company overview'
    ));
}

export async function updateCompanyProfile(credentials: AuthCredentials, input: { name?: string; slug?: string }) {
    return backoff(async () => parseJson(
        await fetch(apiUrl('/v1/company'), { method: 'PATCH', headers: jsonHeaders(credentials), body: JSON.stringify(input) }),
        CompanyOverviewResponseSchema.pick({ company: true }),
        'Failed to update company'
    ));
}

export async function listCompanyMembers(credentials: AuthCredentials, options: { query?: string; limit?: number } = {}) {
    const params = new URLSearchParams();
    if (options.query) params.set('query', options.query);
    if (options.limit) params.set('limit', String(options.limit));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return backoff(async () => parseJson(
        await fetch(apiUrl(`/v1/company/members${suffix}`), { method: 'GET', headers: authHeaders(credentials) }),
        CompanyMembersResponseSchema,
        'Failed to list company members'
    ));
}

export async function updateCompanyMember(credentials: AuthCredentials, accountId: string, input: { role?: CompanyRole; remove?: boolean }) {
    const response = await fetch(apiUrl(`/v1/company/members/${encodeURIComponent(accountId)}`), {
        method: 'PATCH',
        headers: jsonHeaders(credentials),
        body: JSON.stringify(input),
    });
    if (!response.ok) {
        throw new Error(`Failed to update company member: ${response.status}`);
    }
    return response.json();
}

export async function listCompanyInvites(credentials: AuthCredentials) {
    return backoff(async () => parseJson(
        await fetch(apiUrl('/v1/company/invites'), { method: 'GET', headers: authHeaders(credentials) }),
        CompanyInvitesResponseSchema,
        'Failed to list company invites'
    ));
}

export async function createCompanyInvite(credentials: AuthCredentials, input: { role?: CompanyRole; expiresAt?: number; maxUses?: number }): Promise<CompanyInviteCreateResponse> {
    return backoff(async () => parseJson(
        await fetch(apiUrl('/v1/company/invites'), { method: 'POST', headers: jsonHeaders(credentials), body: JSON.stringify(input) }),
        CompanyInviteCreateResponseSchema,
        'Failed to create company invite'
    ));
}

export async function revokeCompanyInvite(credentials: AuthCredentials, inviteId: string) {
    const response = await fetch(apiUrl(`/v1/company/invites/${encodeURIComponent(inviteId)}`), {
        method: 'DELETE',
        headers: authHeaders(credentials),
    });
    if (!response.ok) {
        throw new Error(`Failed to revoke company invite: ${response.status}`);
    }
    return response.json();
}

export async function acceptCompanyInvite(credentials: AuthCredentials, token: string): Promise<CompanyInviteAcceptResponse> {
    return backoff(async () => parseJson(
        await fetch(apiUrl('/v1/company/invites/accept'), {
            method: 'POST',
            headers: jsonHeaders(credentials),
            body: JSON.stringify({ token }),
        }),
        CompanyInviteAcceptResponseSchema,
        'Failed to accept company invite'
    ));
}
```

- [ ] **Step 6.4: Add frontend role helper tests and implementation**

Create `packages/happy-app/sources/components/company/companyRole.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { canCurrentUserManageMember, getCompanyRoleLabelKey } from './companyRole';

describe('companyRole helpers', () => {
    it('returns translation keys for roles', () => {
        expect(getCompanyRoleLabelKey('owner')).toBe('company.roles.owner');
        expect(getCompanyRoleLabelKey('admin')).toBe('company.roles.admin');
        expect(getCompanyRoleLabelKey('member')).toBe('company.roles.member');
    });

    it('allows admins to remove members only', () => {
        expect(canCurrentUserManageMember('admin', 'member', 'remove')).toBe(true);
        expect(canCurrentUserManageMember('admin', 'admin', 'remove')).toBe(false);
        expect(canCurrentUserManageMember('admin', 'owner', 'remove')).toBe(false);
        expect(canCurrentUserManageMember('admin', 'member', 'role')).toBe(false);
    });

    it('allows owners to manage role changes and removals', () => {
        expect(canCurrentUserManageMember('owner', 'admin', 'role')).toBe(true);
        expect(canCurrentUserManageMember('owner', 'owner', 'remove')).toBe(true);
    });

    it('denies members all management actions', () => {
        expect(canCurrentUserManageMember('member', 'member', 'remove')).toBe(false);
    });
});
```

Create `packages/happy-app/sources/components/company/companyRole.ts`.

```ts
import type { CompanyRole } from '@/sync/companyTypes';

export function getCompanyRoleLabelKey(role: CompanyRole) {
    return `company.roles.${role}` as const;
}

export function canCurrentUserManageMember(actorRole: CompanyRole, targetRole: CompanyRole, action: 'role' | 'remove') {
    if (actorRole === 'owner') {
        return true;
    }
    if (actorRole === 'admin') {
        return action === 'remove' && targetRole === 'member';
    }
    return false;
}
```

- [ ] **Step 6.5: Run frontend API/helper tests and typecheck**

Run:

```bash
cd packages/happy-app && npx vitest run sources/sync/apiCompany.test.ts sources/components/company/companyRole.test.ts && yarn typecheck
```

Expected: tests pass and app typecheck passes.

---

## Task 7: Add frontend navigation, Settings entry, and translations

**Files:**

- Modify: `packages/happy-app/sources/components/SettingsView.tsx`
- Modify: `packages/happy-app/sources/components/desktopRoutes/registrations.ts`
- Modify: `packages/happy-app/sources/app/(app)/_layout.tsx`
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/ca.ts`
- Modify: `packages/happy-app/sources/text/translations/en.ts`
- Modify: `packages/happy-app/sources/text/translations/es.ts`
- Modify: `packages/happy-app/sources/text/translations/it.ts`
- Modify: `packages/happy-app/sources/text/translations/ja.ts`
- Modify: `packages/happy-app/sources/text/translations/pl.ts`
- Modify: `packages/happy-app/sources/text/translations/pt.ts`
- Modify: `packages/happy-app/sources/text/translations/ru.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hans.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hant.ts`

- [ ] **Step 7.1: Add translation keys**

Add these keys to `_default.ts` and every translation file. English can be the source text for non-Chinese languages in the first patch if existing translation style allows English fallback; keep all keys structurally present.

```ts
company: {
    title: 'Company',
    subtitle: 'Manage company profile, members, and invites',
    profile: 'Company Profile',
    name: 'Name',
    slug: 'Identifier',
    role: 'Role',
    members: 'Members',
    membersSubtitle: 'View and manage company members',
    invites: 'Invites',
    invitesSubtitle: 'Create and revoke invite links',
    createInvite: 'Create Invite',
    copyInviteLink: 'Copy Invite Link',
    revokeInvite: 'Revoke Invite',
    acceptInvite: 'Accept Invite',
    joinCompany: 'Join Company',
    alreadyMember: 'You are already a member of this company.',
    inviteAccepted: 'Invite accepted.',
    inviteInvalid: 'This invite link is invalid or no longer available.',
    inviteLoginRequired: 'Sign in or create an account to accept this invite.',
    noMembers: 'No company members found.',
    noInvites: 'No invites yet.',
    editProfile: 'Edit company profile',
    saveProfileFailed: 'Failed to save company profile',
    loadFailed: 'Failed to load company information',
    createInviteFailed: 'Failed to create invite',
    revokeInviteFailed: 'Failed to revoke invite',
    acceptInviteFailed: 'Failed to accept invite',
    removeMember: 'Remove Member',
    removeMemberConfirm: ({ name }: { name: string }) => `Remove ${name} from the company?`,
    changeRole: 'Change Role',
    rolePrompt: 'Enter owner, admin, member, or remove.',
    lastOwnerHint: 'The last owner cannot be removed or demoted.',
    inviteCopied: 'Invite link copied',
    activeInvite: 'Active',
    revokedInvite: 'Revoked',
    expiredInvite: 'Expired',
    uses: ({ count }: { count: number }) => `${count} uses`,
    expiresAt: ({ date }: { date: string }) => `Expires ${date}`,
    roles: {
        owner: 'Owner',
        admin: 'Admin',
        member: 'Member',
    },
}
```

Chinese Simplified values:

```ts
company: {
    title: '公司',
    subtitle: '管理公司资料、成员和邀请链接',
    profile: '公司资料',
    name: '名称',
    slug: '标识',
    role: '角色',
    members: '成员',
    membersSubtitle: '查看和管理公司成员',
    invites: '邀请',
    invitesSubtitle: '创建和撤销邀请链接',
    createInvite: '创建邀请',
    copyInviteLink: '复制邀请链接',
    revokeInvite: '撤销邀请',
    acceptInvite: '接受邀请',
    joinCompany: '加入公司',
    alreadyMember: '你已经是该公司的成员。',
    inviteAccepted: '已接受邀请。',
    inviteInvalid: '该邀请链接无效或已不可用。',
    inviteLoginRequired: '请先登录或创建账号，然后接受邀请。',
    noMembers: '没有找到公司成员。',
    noInvites: '还没有邀请。',
    editProfile: '编辑公司资料',
    saveProfileFailed: '保存公司资料失败',
    loadFailed: '加载公司信息失败',
    createInviteFailed: '创建邀请失败',
    revokeInviteFailed: '撤销邀请失败',
    acceptInviteFailed: '接受邀请失败',
    removeMember: '移除成员',
    removeMemberConfirm: ({ name }: { name: string }) => `将 ${name} 从公司移除？`,
    changeRole: '更改角色',
    rolePrompt: '输入 owner、admin、member 或 remove。',
    lastOwnerHint: '最后一个所有者不能被移除或降级。',
    inviteCopied: '邀请链接已复制',
    activeInvite: '有效',
    revokedInvite: '已撤销',
    expiredInvite: '已过期',
    uses: ({ count }: { count: number }) => `已使用 ${count} 次`,
    expiresAt: ({ date }: { date: string }) => `到期时间：${date}`,
    roles: {
        owner: '所有者',
        admin: '管理员',
        member: '成员',
    },
}
```

- [ ] **Step 7.2: Add Settings entry**

In `SettingsView.tsx`, add a Company item in the `Features` section near Account.

```tsx
                <Item
                    title={t('company.title')}
                    subtitle={t('company.subtitle')}
                    icon={<Ionicons name="business-outline" size={29} color="#007AFF" />}
                    onPress={() => openDesktop('/settings/company', { title: t('company.title') })}
                />
```

- [ ] **Step 7.3: Register desktop routes**

In `desktopRoutes/registrations.ts`, add title keys:

```ts
    '/settings/company': 'company.title',
    '/settings/company/members': 'company.members',
    '/settings/company/invites': 'company.invites',
```

Add route registrations:

```ts
registerDesktopRoute('/settings/company', () => import('@/app/(app)/settings/company'));
registerDesktopRoute('/settings/company/members', () => import('@/app/(app)/settings/company/members'));
registerDesktopRoute('/settings/company/invites', () => import('@/app/(app)/settings/company/invites'));
```

- [ ] **Step 7.4: Add screen definitions**

In `packages/happy-app/sources/app/(app)/_layout.tsx`, add screens near other Settings screens.

```tsx
            <Stack.Screen
                name="settings/company"
                options={{
                    headerTitle: t('company.title'),
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="settings/company/members"
                options={{
                    headerTitle: t('company.members'),
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="settings/company/invites"
                options={{
                    headerTitle: t('company.invites'),
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="company/join/[token]"
                options={{
                    headerTitle: t('company.joinCompany'),
                    headerBackTitle: t('common.back'),
                }}
            />
```

- [ ] **Step 7.5: Typecheck translations and navigation**

Run:

```bash
cd packages/happy-app && yarn typecheck
```

Expected: app typecheck passes with all translation files structurally aligned.

---

## Task 8: Add frontend company profile page and reusable rows

**Files:**

- Create: `packages/happy-app/sources/components/company/CompanyMemberRow.tsx`
- Create: `packages/happy-app/sources/components/company/CompanyInviteRow.tsx`
- Create: `packages/happy-app/sources/app/(app)/settings/company.tsx`

- [ ] **Step 8.1: Create member row component**

Create `CompanyMemberRow.tsx`.

```tsx
import React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Avatar } from '@/components/Avatar';
import { Item } from '@/components/Item';
import { t } from '@/text';
import type { CompanyMember } from '@/sync/companyTypes';
import { getCompanyRoleLabelKey } from './companyRole';

function getMemberName(member: CompanyMember) {
    return [member.profile.firstName, member.profile.lastName].filter(Boolean).join(' ') || member.profile.username || member.profile.id;
}

export function CompanyMemberRow({ member, onPress }: { member: CompanyMember; onPress?: () => void }) {
    const avatar = member.profile.avatar;
    return (
        <Item
            title={getMemberName(member)}
            subtitle={member.profile.username ? `@${member.profile.username}` : member.profile.id}
            leftElement={<Avatar id={member.accountId} size={40} imageUrl={avatar?.url || avatar?.path} thumbhash={avatar?.thumbhash} />}
            rightElement={<View style={styles.badge}><Text style={styles.badgeText}>{t(getCompanyRoleLabelKey(member.role))}</Text></View>}
            onPress={onPress}
            showChevron={!!onPress}
            iconContainerStyle={{ marginRight: 20 }}
        />
    );
}

const styles = StyleSheet.create((theme) => ({
    badge: {
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    badgeText: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        fontWeight: '600',
    },
}));
```

- [ ] **Step 8.2: Create invite row component**

Create `CompanyInviteRow.tsx`.

```tsx
import React from 'react';
import { Item } from '@/components/Item';
import { t } from '@/text';
import type { CompanyInvite } from '@/sync/companyTypes';
import { getCompanyRoleLabelKey } from './companyRole';

function getInviteStatus(invite: CompanyInvite) {
    if (invite.revokedAt) return t('company.revokedInvite');
    if (invite.expiresAt && invite.expiresAt <= Date.now()) return t('company.expiredInvite');
    return t('company.activeInvite');
}

export function CompanyInviteRow({ invite, onRevoke }: { invite: CompanyInvite; onRevoke?: () => void }) {
    const parts = [
        t(getCompanyRoleLabelKey(invite.role)),
        t('company.uses', { count: invite.useCount }),
        invite.expiresAt ? t('company.expiresAt', { date: new Date(invite.expiresAt).toLocaleDateString() }) : null,
    ].filter(Boolean);

    return (
        <Item
            title={getInviteStatus(invite)}
            subtitle={parts.join(' • ')}
            detail={invite.revokedAt ? undefined : t('company.revokeInvite')}
            onPress={invite.revokedAt ? undefined : onRevoke}
            showChevron={false}
        />
    );
}
```

- [ ] **Step 8.3: Create company profile page**

Create `packages/happy-app/sources/app/(app)/settings/company.tsx`.

```tsx
import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDesktopRoute } from '@/components/desktopRoutes';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useAuth } from '@/auth/AuthContext';
import { getCompanyOverview, updateCompanyProfile } from '@/sync/apiCompany';
import type { CompanyOverviewResponse } from '@/sync/companyTypes';
import { getCompanyRoleLabelKey } from '@/components/company/companyRole';

export default function CompanySettingsScreen() {
    const { isInDrawer, open: openDesktop } = useDesktopRoute();
    const auth = useAuth();
    const [overview, setOverview] = React.useState<CompanyOverviewResponse | null>(null);
    const [loading, setLoading] = React.useState(true);

    const load = React.useCallback(async () => {
        if (!auth.credentials) return;
        setLoading(true);
        try {
            setOverview(await getCompanyOverview(auth.credentials));
        } catch {
            Modal.alert(t('common.error'), t('company.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [auth.credentials]);

    React.useEffect(() => { load(); }, [load]);

    const editName = async () => {
        if (!auth.credentials || !overview?.capabilities.canEditCompany) return;
        const name = await Modal.prompt(t('company.name'), t('company.editProfile'), { defaultValue: overview.company.name, confirmText: t('common.save') });
        if (!name?.trim()) return;
        try {
            await updateCompanyProfile(auth.credentials, { name: name.trim() });
            await load();
        } catch {
            Modal.alert(t('common.error'), t('company.saveProfileFailed'));
        }
    };

    const openMembers = () => openDesktop('/settings/company/members', { title: t('company.members') });
    const openInvites = () => openDesktop('/settings/company/invites', { title: t('company.invites') });

    return (
        <ItemList>
            {!isInDrawer && <Stack.Screen options={{ headerTitle: t('company.title'), headerBackTitle: t('common.back') }} />}
            <ItemGroup title={t('company.profile')}>
                <Item title={t('company.name')} detail={overview?.company.name || (loading ? t('common.loading') : '')} onPress={overview?.capabilities.canEditCompany ? editName : undefined} showChevron={!!overview?.capabilities.canEditCompany} />
                <Item title={t('company.slug')} detail={overview?.company.slug || ''} showChevron={false} />
                <Item title={t('company.role')} detail={overview ? t(getCompanyRoleLabelKey(overview.membership.role)) : ''} showChevron={false} />
            </ItemGroup>
            <ItemGroup>
                <Item title={t('company.members')} subtitle={t('company.membersSubtitle')} icon={<Ionicons name="people-outline" size={29} color="#007AFF" />} onPress={openMembers} />
                {overview?.capabilities.canManageInvites && (
                    <Item title={t('company.invites')} subtitle={t('company.invitesSubtitle')} icon={<Ionicons name="link-outline" size={29} color="#34C759" />} onPress={openInvites} />
                )}
            </ItemGroup>
            <View style={{ height: 24 }} />
        </ItemList>
    );
}
```

- [ ] **Step 8.4: Typecheck app**

Run:

```bash
cd packages/happy-app && yarn typecheck
```

Expected: app typecheck passes.

---

## Task 9: Add members management page

**Files:**

- Create: `packages/happy-app/sources/app/(app)/settings/company/members.tsx`

- [ ] **Step 9.1: Create members page**

Create `packages/happy-app/sources/app/(app)/settings/company/members.tsx`.

```tsx
import React from 'react';
import { View, Text } from 'react-native';
import { Stack } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { useDesktopRoute } from '@/components/desktopRoutes';
import { CompanyMemberRow } from '@/components/company/CompanyMemberRow';
import { canCurrentUserManageMember } from '@/components/company/companyRole';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useAuth } from '@/auth/AuthContext';
import { getCompanyOverview, listCompanyMembers, updateCompanyMember } from '@/sync/apiCompany';
import type { CompanyMember, CompanyOverviewResponse } from '@/sync/companyTypes';

function getMemberName(member: CompanyMember) {
    return [member.profile.firstName, member.profile.lastName].filter(Boolean).join(' ') || member.profile.username || member.profile.id;
}

export default function CompanyMembersScreen() {
    const { isInDrawer } = useDesktopRoute();
    const auth = useAuth();
    const [overview, setOverview] = React.useState<CompanyOverviewResponse | null>(null);
    const [members, setMembers] = React.useState<CompanyMember[]>([]);

    const load = React.useCallback(async () => {
        if (!auth.credentials) return;
        try {
            const [nextOverview, nextMembers] = await Promise.all([
                getCompanyOverview(auth.credentials),
                listCompanyMembers(auth.credentials),
            ]);
            setOverview(nextOverview);
            setMembers(nextMembers.members);
        } catch {
            Modal.alert(t('common.error'), t('company.loadFailed'));
        }
    }, [auth.credentials]);

    React.useEffect(() => { load(); }, [load]);

    const removeMember = async (member: CompanyMember) => {
        if (!auth.credentials) return;
        const confirmed = await Modal.confirm(
            t('company.removeMember'),
            t('company.removeMemberConfirm', { name: getMemberName(member) }),
            { confirmText: t('company.removeMember'), destructive: true }
        );
        if (!confirmed) return;
        try {
            await updateCompanyMember(auth.credentials, member.accountId, { remove: true });
            await load();
        } catch {
            Modal.alert(t('common.error'), t('company.lastOwnerHint'));
        }
    };

    const actorRole = overview?.membership.role;

    return (
        <ItemList>
            {!isInDrawer && <Stack.Screen options={{ headerTitle: t('company.members'), headerBackTitle: t('common.back') }} />}
            <ItemGroup title={t('company.members')}>
                {members.length === 0 ? (
                    <View style={styles.empty}><Text style={styles.emptyText}>{t('company.noMembers')}</Text></View>
                ) : members.map((member) => (
                    <CompanyMemberRow
                        key={member.accountId}
                        member={member}
                        onPress={actorRole && canCurrentUserManageMember(actorRole, member.role, 'remove') ? () => removeMember(member) : undefined}
                    />
                ))}
            </ItemGroup>
        </ItemList>
    );
}

const styles = StyleSheet.create((theme) => ({
    empty: { alignItems: 'center', padding: 32 },
    emptyText: { color: theme.colors.textSecondary, textAlign: 'center' },
}));
```

- [ ] **Step 9.2: Add owner role-change action**

Extend the row press behavior for owners with a choice modal:

- If current actor is owner and target is not the last owner according to backend enforcement, show role choices `owner`, `admin`, `member`, and remove.
- Use `updateCompanyMember(credentials, member.accountId, { role })` for role changes.
- Keep remove action available to owner and admin according to `canCurrentUserManageMember`.
- If backend returns `409`, show `t('company.lastOwnerHint')`.

Concrete handler shape:

```ts
const manageMember = async (member: CompanyMember) => {
    if (!auth.credentials || !actorRole) return;
    if (actorRole === 'admin') {
        await removeMember(member);
        return;
    }
    const rawAction = await Modal.prompt(
        t('company.changeRole'),
        t('company.rolePrompt'),
        { defaultValue: member.role, placeholder: 'owner/admin/member/remove', confirmText: t('common.save') }
    );
    const action = rawAction?.trim().toLowerCase();
    if (!action) return;
    if (action !== 'owner' && action !== 'admin' && action !== 'member' && action !== 'remove') {
        Modal.alert(t('common.error'), t('company.rolePrompt'));
        return;
    }
    try {
        if (action === 'remove') {
            await updateCompanyMember(auth.credentials, member.accountId, { remove: true });
        } else {
            await updateCompanyMember(auth.credentials, member.accountId, { role: action });
        }
        await load();
    } catch {
        Modal.alert(t('common.error'), t('company.lastOwnerHint'));
    }
};
```

- [ ] **Step 9.3: Typecheck app**

Run:

```bash
cd packages/happy-app && yarn typecheck
```

Expected: app typecheck passes.

---

## Task 10: Add invites page and invite accept page

**Files:**

- Create: `packages/happy-app/sources/app/(app)/settings/company/invites.tsx`
- Create: `packages/happy-app/sources/app/(app)/company/join/[token].tsx`

- [ ] **Step 10.1: Create invites management page**

Create `packages/happy-app/sources/app/(app)/settings/company/invites.tsx`.

```tsx
import React from 'react';
import { Platform, View, Text } from 'react-native';
import { Stack } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { StyleSheet } from 'react-native-unistyles';
import { useDesktopRoute } from '@/components/desktopRoutes';
import { CompanyInviteRow } from '@/components/company/CompanyInviteRow';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { showCopiedToast } from '@/components/Toast';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useAuth } from '@/auth/AuthContext';
import { buildCompanyInviteUrl, createCompanyInvite, listCompanyInvites, revokeCompanyInvite } from '@/sync/apiCompany';
import type { CompanyInvite } from '@/sync/companyTypes';

function getAppOrigin() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
        return window.location.origin;
    }
    return 'happy://';
}

export default function CompanyInvitesScreen() {
    const { isInDrawer } = useDesktopRoute();
    const auth = useAuth();
    const [invites, setInvites] = React.useState<CompanyInvite[]>([]);

    const load = React.useCallback(async () => {
        if (!auth.credentials) return;
        try {
            setInvites((await listCompanyInvites(auth.credentials)).invites);
        } catch {
            Modal.alert(t('common.error'), t('company.loadFailed'));
        }
    }, [auth.credentials]);

    React.useEffect(() => { load(); }, [load]);

    const createInvite = async () => {
        if (!auth.credentials) return;
        try {
            const created = await createCompanyInvite(auth.credentials, {});
            const url = created.url || buildCompanyInviteUrl(getAppOrigin(), created.token);
            await Clipboard.setStringAsync(url);
            showCopiedToast();
            Modal.alert(t('company.createInvite'), t('company.inviteCopied'));
            await load();
        } catch {
            Modal.alert(t('common.error'), t('company.createInviteFailed'));
        }
    };

    const revoke = async (invite: CompanyInvite) => {
        if (!auth.credentials) return;
        const confirmed = await Modal.confirm(t('company.revokeInvite'), t('company.revokeInvite'), { confirmText: t('company.revokeInvite'), destructive: true });
        if (!confirmed) return;
        try {
            await revokeCompanyInvite(auth.credentials, invite.id);
            await load();
        } catch {
            Modal.alert(t('common.error'), t('company.revokeInviteFailed'));
        }
    };

    return (
        <ItemList>
            {!isInDrawer && <Stack.Screen options={{ headerTitle: t('company.invites'), headerBackTitle: t('common.back') }} />}
            <ItemGroup>
                <Item title={t('company.createInvite')} subtitle={t('company.copyInviteLink')} onPress={createInvite} />
            </ItemGroup>
            <ItemGroup title={t('company.invites')}>
                {invites.length === 0 ? (
                    <View style={styles.empty}><Text style={styles.emptyText}>{t('company.noInvites')}</Text></View>
                ) : invites.map((invite) => (
                    <CompanyInviteRow key={invite.id} invite={invite} onRevoke={() => revoke(invite)} />
                ))}
            </ItemGroup>
        </ItemList>
    );
}

const styles = StyleSheet.create((theme) => ({
    empty: { alignItems: 'center', padding: 32 },
    emptyText: { color: theme.colors.textSecondary, textAlign: 'center' },
}));
```

- [ ] **Step 10.2: Create invite accept page**

Create `packages/happy-app/sources/app/(app)/company/join/[token].tsx`.

```tsx
import React from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useAuth } from '@/auth/AuthContext';
import { acceptCompanyInvite } from '@/sync/apiCompany';

export default function CompanyJoinScreen() {
    const auth = useAuth();
    const params = useLocalSearchParams<{ token?: string }>();
    const token = Array.isArray(params.token) ? params.token[0] : params.token;
    const [message, setMessage] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);

    const accept = async () => {
        if (!token || !auth.credentials) return;
        setLoading(true);
        try {
            const result = await acceptCompanyInvite(auth.credentials, token);
            setMessage(result.alreadyMember ? t('company.alreadyMember') : t('company.inviteAccepted'));
        } catch {
            setMessage(t('company.inviteInvalid'));
        } finally {
            setLoading(false);
        }
    };

    React.useEffect(() => {
        if (auth.credentials && token) {
            accept();
        }
    }, [auth.credentials, token]);

    return (
        <ItemList>
            <Stack.Screen options={{ headerTitle: t('company.joinCompany'), headerBackTitle: t('common.back') }} />
            <ItemGroup title={t('company.joinCompany')}>
                {!auth.credentials ? (
                    <Item title={t('company.inviteLoginRequired')} onPress={() => router.push('/')} />
                ) : (
                    <Item title={message || t('common.loading')} loading={loading} showChevron={false} />
                )}
                {auth.credentials && token && message !== t('company.inviteAccepted') && (
                    <Item title={t('common.retry')} onPress={accept} loading={loading} showChevron={false} />
                )}
            </ItemGroup>
        </ItemList>
    );
}
```

- [ ] **Step 10.3: Typecheck app**

Run:

```bash
cd packages/happy-app && yarn typecheck
```

Expected: app typecheck passes.

---

## Task 11: Backend full verification

**Files:** backend files from Tasks 1-5

- [ ] **Step 11.1: Run focused backend tests**

Run:

```bash
cd packages/happy-server && npx vitest run sources/app/company/companyTokens.test.ts sources/app/company/companyService.test.ts sources/app/api/routes/companyRoutes.test.ts
```

Expected: all focused backend tests pass.

- [ ] **Step 11.2: Run server typecheck**

Run:

```bash
cd packages/happy-server && yarn build
```

Expected: server typecheck passes.

- [ ] **Step 11.3: Validate Prisma migration locally without resetting shared data**

Run in a local development database only:

```bash
cd packages/happy-server && yarn migrate
```

Expected:

- Migration `20260703000000_add_company_core` applies.
- `Company` has one default row with slug `default`.
- Every existing `Account` has one `CompanyMembership`.
- If at least one account exists, at least one membership has role `owner`.

Do not run `migrate:reset` against shared, test, staging, or production databases.

---

## Task 12: Frontend full verification

**Files:** frontend files from Tasks 6-10

- [ ] **Step 12.1: Run focused frontend tests**

Run:

```bash
cd packages/happy-app && npx vitest run sources/sync/apiCompany.test.ts sources/components/company/companyRole.test.ts
```

Expected: focused frontend tests pass.

- [ ] **Step 12.2: Run frontend typecheck**

Run:

```bash
cd packages/happy-app && yarn typecheck
```

Expected: app typecheck passes.

- [ ] **Step 12.3: Manual frontend smoke checks**

Run the app in development mode and verify:

```bash
cd packages/happy-app && yarn web
```

Manual checks:

1. Settings shows a Company entry.
2. Company page shows name, slug, and current role.
3. Owner/admin sees Members and Invites entries.
4. Member sees Members and does not see invite management controls.
5. Members page renders avatars, display names, usernames, and role badges.
6. Owner can change a member role and remove a member.
7. Admin can remove a member and cannot change roles.
8. Backend rejects last-owner removal or demotion and the UI shows the last-owner message.
9. Invites page creates an invite, copies the link, and displays the new invite.
10. Revoke action marks an invite revoked.
11. `/company/join/<token>` accepts a valid invite for an authenticated non-member.
12. `/company/join/<token>` shows safe error text for invalid, expired, revoked, or overused tokens.

---

## Task 13: Acceptance review package

**Files:** no new files required

- [ ] **Step 13.1: Capture changed files**

Run:

```bash
git status --short
```

Expected: only planned backend, frontend, translation, spec, and plan files are modified or created.

- [ ] **Step 13.2: Summarize verification evidence**

Prepare a short review note for the user containing:

- Backend focused test command and result.
- Server typecheck command and result.
- Frontend focused test command and result.
- Frontend typecheck command and result.
- Manual smoke checks completed.
- Any migrations that must be applied before deployment.

- [ ] **Step 13.3: Stop before commit**

Do not commit. Wait for the user's review and explicit approval.

---

## Acceptance Criteria Mapping

| Acceptance criterion | Implemented by |
| --- | --- |
| Default company exists after migration/bootstrap | Tasks 1 and 3 |
| Every existing account has a membership | Tasks 1 and 3 |
| At least one owner exists when accounts exist | Tasks 1 and 3 |
| Owner/admin can create and copy invite links | Tasks 4, 5, 6, and 10 |
| Valid invite links allow authenticated users to join | Tasks 4, 5, 6, and 10 |
| Expired, revoked, or overused invites are rejected | Task 4 service tests and Task 5 API route |
| Members can view company members but cannot manage roles/invites | Tasks 4, 5, 8, and 9 |
| Owner/admin role protections work including last-owner protection | Tasks 4 and 9 |
| Existing sessions, friends, shares, and machines continue unchanged | Sidecar-only schema/API in Tasks 1-5 |

## Rollback Notes

If this feature needs to be removed before production migration, revert the code changes and delete the un-applied migration directory. If the migration has already been applied to a database, create a forward rollback migration that drops `CompanyInvite`, `CompanyMembership`, `Company`, and `CompanyRole` only after confirming no production data needs to be preserved.

## Out-of-Scope for This Plan

- Company-scoped ownership of `Session`, `Machine`, `Memory`, `AccessKey`, `UserKVStore`, `PortProxy`, or `OrchestratorRun`.
- SSO/SAML/OIDC.
- Billing and subscription plans.
- Audit logs.
- Email delivery for invites.
- `@ People` mention UI in chat input. This plan creates the company-member data source needed by that separate feature.
