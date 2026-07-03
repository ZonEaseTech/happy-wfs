# Happy Bug Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Happy-owned Bug board where authenticated Happy users and shared-code users can submit, discuss, status-track, and start repair sessions from bugs with screenshots.

**Architecture:** Store Bug reports as first-class server records scoped to a Happy account. Add authenticated Happy APIs and separate public Bug-share APIs with independent share tokens, then integrate the existing `SessionsList` pending tab, new-session handoff, and `SessionView` external-context header pattern. Keep the UI minimal: only problem description and screenshots on create; everything else is generated or derived.

**Tech Stack:** Yarn 1.x monorepo, Expo / React Native / TypeScript, Fastify + Zod, Prisma/PostgreSQL, MinIO/S3 uploads, Vitest, existing Happy modal/navigation/storage patterns.

**Commit policy:** Do not commit during implementation unless the user explicitly approves. This plan intentionally omits commit steps because the user asked to inspect before any submission.

---

## Confirmed Product Rules

- The entry lives in `终端 > 待处理`; do not add a bottom-tab Bug entry.
- The top `待处理` tag is always visible, even when there are no sessions, GitHub tasks, or Bugs.
- The `待处理` tag shows a badge count for Happy Bugs whose status is `待处理`; when the count is zero, the tag remains visible without a red badge.
- Inside `待处理`, add type filters: `全部`, `GitHub`, `Bug`.
- GitHub tasks and Bug reports can coexist in `全部`.
- In `GitHub` filter, hide Bug operations.
- In `Bug` filter, show Bug-only operations: `＋ 新建 Bug`, `共享设置`.
- Create form fields are minimal: `问题说明` required, screenshots optional.
- Screenshot limit: at most 10 per submit/comment action, each image at most 20 MB.
- Shared `/bug` entry requires a generated access code and a nickname; it does not require a Happy account.
- Changing the shared access code immediately invalidates old public sessions and requires re-entry.
- Happy-created Bugs are shared-entry-visible by default.
- Statuses are strings, not Prisma enums: `pending`, `in_progress`, `verify`, `closed` displayed as `待处理`, `进行中`, `待验证`, `已关闭`.
- `打回待处理` is an action label/history event; it returns the current status to `pending`.
- Starting a repair session changes the Bug to `进行中` automatically.
- Agent completion does not automatically move a Bug to `待验证`; a Happy user manually changes it.
- Shared users and Happy users can close Bugs.
- Bug list sorts by most recent activity first.
- Bug cards show a display ID such as `BUG-1042`.
- Bug title is generated from the first characters of the problem description.
- A Bug-based session shows a header/right icon that opens Bug detail in a modal.
- The repair prompt includes problem description, screenshots, comments, and status history; screenshots are passed as session image attachments and referenced in the prompt.

---

## Investigation Notes

- Graph MCP tools were not exposed in this session, so code exploration used shell fallback after attempting tool discovery.
- Current pending-tab implementation is concentrated in `packages/happy-app/sources/components/SessionsList.tsx`.
- `SessionsList.tsx` already includes a `pending` tab in `visibleTabs` unconditionally, so the new work must preserve that behavior and add a Bug badge/count rather than reintroducing visibility gating.
- GitHub issue detail modal and start flow already exist:
  - `packages/happy-app/sources/components/GitHubIssueDetailModal.tsx`
  - `packages/happy-app/sources/components/githubIssueStartPrompt.ts`
  - `storeTempData()` handoff to `/new` in `SessionsList.tsx`
- Session header linked external-context pattern already exists in `packages/happy-app/sources/-session/SessionView.tsx` via `buildLinkedGitHubIssue()` and the ticket icon.
- New-session page can already receive temp data with prompt/title/icon/externalContext in `packages/happy-app/sources/utils/tempDataStore.ts` and `packages/happy-app/sources/app/(app)/new/index.tsx`.
- Server route registration is in `packages/happy-server/sources/app/api/api.ts`.
- Server uploads currently have multipart fileSize `10 MB` in `api.ts`; Bug screenshots need a `20 MB` route-level or global limit.
- Prisma schema is in `packages/happy-server/prisma/schema.prisma`; server rules say avoid Prisma enums, so Bug status is a string.
- Public share routes show existing hashed-token patterns in `packages/happy-server/sources/app/api/routes/publicShareRoutes.ts`, but Bug public access must use a separate auth mechanism so it cannot authenticate as the Happy owner on normal endpoints.
- App user-facing strings must use `t()` and update all translations: `en`, `ru`, `pl`, `es`, `ca`, `it`, `pt`, `ja`, `zh-Hans`, `zh-Hant`.

---

## File Structure

### Shared App Types and API Client

- Create: `packages/happy-app/sources/sync/apiBugs.ts`
  - Authenticated Happy Bug API client and public Bug-share API client.
- Create: `packages/happy-app/sources/sync/bugTypes.ts`
  - App-side Bug DTO types, status helpers, display labels, title generation, and upload limits.
- Create: `packages/happy-app/sources/sync/bugTypes.test.ts`
  - Unit tests for status labels, `打回待处理` activity wording, title generation, and search matching.

### Server Bug Domain

- Create: `packages/happy-server/sources/app/bugs/bugTypes.ts`
  - Server-side constants and Zod/domain types.
- Create: `packages/happy-server/sources/app/bugs/bugPresenter.ts`
  - Converts Prisma rows to API DTOs.
- Create: `packages/happy-server/sources/app/bugs/bugService.ts`
  - All Bug DB operations: list, create, detail, comment, status change, upload attachment record, share config.
- Create: `packages/happy-server/sources/app/bugs/bugShareToken.ts`
  - Public Bug-share JWT signing/verification and version validation.
- Create: `packages/happy-server/sources/app/bugs/bugImageUpload.ts`
  - S3 upload helper for Bug screenshots.
- Create: `packages/happy-server/sources/app/bugs/bugService.test.ts`
  - Unit tests with DB/service mocks for transitions, last activity sorting, and share version invalidation.

### Server Routes and Schema

- Modify: `packages/happy-server/prisma/schema.prisma`
  - Add Bug models and relations.
- Create: `packages/happy-server/prisma/migrations/20260703180000_add_bug_reports/migration.sql`
  - Migration generated by Prisma after schema changes.
- Create: `packages/happy-server/sources/app/api/routes/bugRoutes.ts`
  - Authenticated Happy Bug routes.
- Create: `packages/happy-server/sources/app/api/routes/bugPublicRoutes.ts`
  - Public shared-code Bug routes.
- Create: `packages/happy-server/sources/app/api/routes/bugRoutes.test.ts`
  - Route tests for authenticated actions.
- Create: `packages/happy-server/sources/app/api/routes/bugPublicRoutes.test.ts`
  - Route tests for public login, nickname, expired version, list/create/comment/status.
- Modify: `packages/happy-server/sources/app/api/api.ts`
  - Register Bug routes and raise multipart file limit to 20 MB.

### Happy App UI

- Modify: `packages/happy-app/sources/components/SessionsList.tsx`
  - Add pending type filters, Bug count badge, mixed pending item rendering, Bug-only actions, and Bug start flow.
- Create: `packages/happy-app/sources/components/BugReportDetailModal.tsx`
  - Modal for viewing description, screenshots, comments, status history, commenting, uploading screenshots, status changes, and starting repair sessions.
- Create: `packages/happy-app/sources/components/BugReportCreateModal.tsx`
  - Minimal internal Bug create modal: required description + optional screenshots.
- Create: `packages/happy-app/sources/components/BugShareSettingsModal.tsx`
  - Shows `/bug` entry, generated access code, rotate/edit action, and copy controls.
- Create: `packages/happy-app/sources/components/BugReportItem.tsx`
  - Bug card UI for the pending list.
- Create: `packages/happy-app/sources/components/bugReportStartPrompt.ts`
  - Prompt builder for starting repair sessions from Bugs.
- Create: `packages/happy-app/sources/components/bugReportStartPrompt.test.ts`
  - Unit tests for prompt including description, screenshots, comments, history, and no-commit reminder.
- Modify: `packages/happy-app/sources/utils/tempDataStore.ts`
  - Allow initial image attachments to be passed to `/new`.
- Modify: `packages/happy-app/sources/app/(app)/new/index.tsx`
  - Initialize image attachments from temp session data so Bug screenshots are sent as session images.
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`
  - Detect `externalContext.source === 'happy-bug'` and show a Bug detail button in the header.

### Public Bug Page

- Create: `packages/happy-app/sources/app/(app)/bug/index.tsx`
  - Public Bug board at `/bug`: access code screen, nickname screen, list, detail, create, comment, screenshot upload, status changes.
- Create: `packages/happy-app/sources/hooks/useBugShareBoard.ts`
  - Public board state, persisted nickname/token, polling/refresh, immediate re-login on share version invalidation.
- Modify: `packages/happy-app/sources/app/(app)/_layout.tsx`
  - Register `bug/index` route with `headerShown: false`.

### Image Upload and i18n

- Modify: `packages/happy-app/sources/hooks/useImagePicker.ts`
  - Honor `maxSizeBytes` option and support Bug-specific 20 MB image limit without changing chat defaults.
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: all files under `packages/happy-app/sources/text/translations/*.ts`
  - Add Bug UI strings for all locales.

---

## Data Model

Add the following Prisma model shape. Keep statuses as strings to match server rules that say to avoid enums.

```prisma
model Account {
  // Add these relation fields to the existing Account model body.
  ownedBugReports        BugReport[]       @relation("OwnedBugReports")
  bugReportsCreatedBy    BugReport[]       @relation("BugReportsCreatedBy")
  bugComments            BugComment[]      @relation("BugCommentsByUser")
  bugAttachments         BugAttachment[]   @relation("BugAttachmentsByUser")
  bugStatusHistory       BugStatusHistory[] @relation("BugStatusHistoryByUser")
  bugShareConfig         BugShareConfig?
}

model Session {
  // Add this relation field to the existing Session model body.
  linkedBugReports BugReport[]
}

model BugReport {
  id                String             @id @default(cuid())
  displayNumber     Int                @unique @default(autoincrement())
  ownerId           String
  owner             Account            @relation("OwnedBugReports", fields: [ownerId], references: [id], onDelete: Cascade)
  createdByUserId   String?
  createdByUser     Account?           @relation("BugReportsCreatedBy", fields: [createdByUserId], references: [id], onDelete: SetNull)
  createdByNickname String?
  sessionId         String?
  session           Session?           @relation(fields: [sessionId], references: [id], onDelete: SetNull)
  title             String
  description       String
  status            String             @default("pending")
  visibility        String             @default("shared")
  lastActivityAt    DateTime           @default(now())
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
  comments          BugComment[]
  attachments       BugAttachment[]
  statusHistory     BugStatusHistory[]

  @@index([ownerId, status, lastActivityAt(sort: Desc)])
  @@index([ownerId, lastActivityAt(sort: Desc)])
  @@index([sessionId])
}

model BugComment {
  id              String     @id @default(cuid())
  bugId           String
  bug             BugReport  @relation(fields: [bugId], references: [id], onDelete: Cascade)
  authorUserId    String?
  authorUser      Account?   @relation("BugCommentsByUser", fields: [authorUserId], references: [id], onDelete: SetNull)
  authorNickname  String?
  body            String
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
  attachments     BugAttachment[]

  @@index([bugId, createdAt])
}

model BugAttachment {
  id              String      @id @default(cuid())
  bugId           String
  bug             BugReport   @relation(fields: [bugId], references: [id], onDelete: Cascade)
  commentId       String?
  comment         BugComment? @relation(fields: [commentId], references: [id], onDelete: Cascade)
  uploadedByUserId String?
  uploadedByUser   Account?   @relation("BugAttachmentsByUser", fields: [uploadedByUserId], references: [id], onDelete: SetNull)
  uploadedByNickname String?
  path            String
  url             String
  mimeType        String
  sizeBytes       Int
  width           Int?
  height          Int?
  thumbhash       String?
  createdAt       DateTime    @default(now())

  @@index([bugId, createdAt])
  @@index([commentId])
}

model BugStatusHistory {
  id              String    @id @default(cuid())
  bugId           String
  bug             BugReport @relation(fields: [bugId], references: [id], onDelete: Cascade)
  actorUserId     String?
  actorUser       Account?  @relation("BugStatusHistoryByUser", fields: [actorUserId], references: [id], onDelete: SetNull)
  actorNickname   String?
  action          String
  fromStatus      String?
  toStatus        String
  note            String?
  createdAt       DateTime  @default(now())

  @@index([bugId, createdAt])
}

model BugShareConfig {
  id                String   @id @default(cuid())
  ownerId           String   @unique
  owner             Account  @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  accessCodeHash    Bytes    @unique
  accessCodeVersion Int      @default(1)
  enabled           Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([enabled])
}
```

---

## API Contract

### Authenticated Happy APIs

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/bugs?status=&query=&limit=` | List owner's Bugs, most recent activity first. Response includes `pendingCount`. |
| `POST` | `/v1/bugs` | Create Bug from Happy. Body: `{ description, visibility? }`. Default `visibility: shared`. |
| `GET` | `/v1/bugs/:bugId` | Detail with comments, attachments, history. |
| `POST` | `/v1/bugs/:bugId/comments` | Add comment. Body: `{ body }`. |
| `PATCH` | `/v1/bugs/:bugId/status` | Change status. Body: `{ status, action? }`. Use `action: "return_to_pending"` for `打回待处理`. |
| `POST` | `/v1/bugs/:bugId/attachments` | Upload one screenshot. Multipart: `file`, optional `commentId`. |
| `GET` | `/v1/bugs/share-config` | Get share config metadata; never returns current access code. |
| `POST` | `/v1/bugs/share-config` | Create or rotate access code. Body may contain `{ accessCode? }`; if absent, server generates one. Returns plaintext code once. |
| `POST` | `/v1/bugs/:bugId/start-session` | Record session link and move Bug to `进行中` after app creates or starts creating the repair session. |

### Public Shared-Code APIs

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/bug-share/login` | Body `{ accessCode, nickname }`; returns Bug-share bearer token bound to config id + version + nickname. |
| `GET` | `/v1/bug-share/bugs` | Public list for the board tied to token. |
| `POST` | `/v1/bug-share/bugs` | Create public Bug. Body `{ description }`. |
| `GET` | `/v1/bug-share/bugs/:bugId` | Public detail. |
| `POST` | `/v1/bug-share/bugs/:bugId/comments` | Add public comment. |
| `PATCH` | `/v1/bug-share/bugs/:bugId/status` | Public status change or close. |
| `POST` | `/v1/bug-share/bugs/:bugId/attachments` | Public upload one screenshot. |

### Public token invalidation behavior

- Token payload contains `configId`, `ownerId`, `nickname`, `version`, and `exp`.
- Every public route loads `BugShareConfig` by `configId` and checks `enabled === true` and `accessCodeVersion === payload.version`.
- When Happy user rotates/changes the access code, increment `accessCodeVersion` and replace `accessCodeHash`.
- Old public tokens then receive `401` with error code `bug_share_expired`, and the app clears token + asks for access code again.

---

## Task 1: Add shared Bug types and pure helpers

**Files:**
- Create: `packages/happy-app/sources/sync/bugTypes.ts`
- Create: `packages/happy-app/sources/sync/bugTypes.test.ts`

- [ ] **Step 1: Add failing helper tests**

Create `packages/happy-app/sources/sync/bugTypes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
    BUG_IMAGE_LIMITS,
    bugDisplayId,
    bugStatusLabel,
    buildBugTitle,
    formatBugStatusHistoryAction,
    matchesBugSearch,
    type BugReportSummary,
} from './bugTypes';

describe('bugTypes', () => {
    it('formats display ids and status labels', () => {
        expect(bugDisplayId(1042)).toBe('BUG-1042');
        expect(bugStatusLabel('pending')).toBe('待处理');
        expect(bugStatusLabel('in_progress')).toBe('进行中');
        expect(bugStatusLabel('verify')).toBe('待验证');
        expect(bugStatusLabel('closed')).toBe('已关闭');
    });

    it('uses explicit return-to-pending wording for status history', () => {
        expect(formatBugStatusHistoryAction({ action: 'return_to_pending', fromStatus: 'verify', toStatus: 'pending' })).toBe('打回待处理：待验证 → 待处理');
        expect(formatBugStatusHistoryAction({ action: 'status_change', fromStatus: 'pending', toStatus: 'in_progress' })).toBe('状态变更：待处理 → 进行中');
    });

    it('builds a title from the first characters of the problem description', () => {
        expect(buildBugTitle('  提交订单后页面一直转圈，无法完成支付，需要刷新后才恢复。  ')).toBe('提交订单后页面一直转圈，无法完成支付，需要刷新后才恢复。');
        expect(buildBugTitle('a'.repeat(80))).toBe(`${'a'.repeat(36)}…`);
    });

    it('matches bug search by display id, title, description, nickname, and status label', () => {
        const bug: BugReportSummary = {
            id: 'bug-1',
            displayNumber: 1042,
            displayId: 'BUG-1042',
            title: '提交订单后页面一直转圈',
            description: '支付成功后没有跳转',
            status: 'pending',
            visibility: 'shared',
            createdByNickname: '测试李',
            attachmentCount: 2,
            commentCount: 1,
            lastActivityAt: Date.UTC(2026, 6, 3),
            createdAt: Date.UTC(2026, 6, 3),
            updatedAt: Date.UTC(2026, 6, 3),
        };
        expect(matchesBugSearch(bug, '#1042')).toBe(true);
        expect(matchesBugSearch(bug, '支付成功')).toBe(true);
        expect(matchesBugSearch(bug, '测试李')).toBe(true);
        expect(matchesBugSearch(bug, '待处理')).toBe(true);
        expect(matchesBugSearch(bug, '不存在')).toBe(false);
    });

    it('keeps screenshot limits explicit', () => {
        expect(BUG_IMAGE_LIMITS.maxImages).toBe(10);
        expect(BUG_IMAGE_LIMITS.maxSizeBytes).toBe(20 * 1024 * 1024);
    });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd packages/happy-app && npx vitest run sources/sync/bugTypes.test.ts
```

Expected: fails because `bugTypes.ts` does not exist.

- [ ] **Step 3: Implement Bug types and helpers**

Create `packages/happy-app/sources/sync/bugTypes.ts`:

```ts
export const BUG_IMAGE_LIMITS = {
    maxImages: 10,
    maxSizeBytes: 20 * 1024 * 1024,
} as const;

export type BugStatus = 'pending' | 'in_progress' | 'verify' | 'closed';
export type BugVisibility = 'shared' | 'private';
export type BugStatusHistoryAction = 'created' | 'status_change' | 'return_to_pending' | 'comment' | 'attachment' | 'start_session' | 'closed';

export interface BugAttachment {
    id: string;
    url: string;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    thumbhash: string | null;
    uploadedByNickname: string | null;
    createdAt: number;
}

export interface BugComment {
    id: string;
    body: string;
    authorNickname: string | null;
    createdAt: number;
    attachments: BugAttachment[];
}

export interface BugStatusHistoryEntry {
    id: string;
    action: BugStatusHistoryAction;
    fromStatus: BugStatus | null;
    toStatus: BugStatus;
    actorNickname: string | null;
    note: string | null;
    createdAt: number;
}

export interface BugReportSummary {
    id: string;
    displayNumber: number;
    displayId: string;
    title: string;
    description: string;
    status: BugStatus;
    visibility: BugVisibility;
    createdByNickname: string | null;
    attachmentCount: number;
    commentCount: number;
    lastActivityAt: number;
    createdAt: number;
    updatedAt: number;
}

export interface BugReportDetail extends BugReportSummary {
    sessionId: string | null;
    attachments: BugAttachment[];
    comments: BugComment[];
    statusHistory: BugStatusHistoryEntry[];
}

export function bugDisplayId(displayNumber: number): string {
    return `BUG-${displayNumber}`;
}

export function bugStatusLabel(status: BugStatus): string {
    switch (status) {
        case 'pending': return '待处理';
        case 'in_progress': return '进行中';
        case 'verify': return '待验证';
        case 'closed': return '已关闭';
    }
}

export function buildBugTitle(description: string): string {
    const normalized = description.trim().replace(/\s+/g, ' ');
    if (normalized.length <= 36) return normalized;
    return `${normalized.slice(0, 36)}…`;
}

export function formatBugStatusHistoryAction(entry: Pick<BugStatusHistoryEntry, 'action' | 'fromStatus' | 'toStatus'>): string {
    if (entry.action === 'return_to_pending') {
        return `打回待处理：${entry.fromStatus ? bugStatusLabel(entry.fromStatus) : '无状态'} → ${bugStatusLabel(entry.toStatus)}`;
    }
    if (entry.action === 'start_session') {
        return `开启修复会话：${entry.fromStatus ? bugStatusLabel(entry.fromStatus) : '无状态'} → ${bugStatusLabel(entry.toStatus)}`;
    }
    if (entry.action === 'closed') {
        return `关闭 Bug：${entry.fromStatus ? bugStatusLabel(entry.fromStatus) : '无状态'} → ${bugStatusLabel(entry.toStatus)}`;
    }
    if (entry.fromStatus) {
        return `状态变更：${bugStatusLabel(entry.fromStatus)} → ${bugStatusLabel(entry.toStatus)}`;
    }
    return bugStatusLabel(entry.toStatus);
}

export function matchesBugSearch(bug: BugReportSummary, query: string): boolean {
    const normalized = query.trim().replace(/^#/, '').toLowerCase();
    if (!normalized) return true;
    const haystack = [
        bug.displayId,
        String(bug.displayNumber),
        bug.title,
        bug.description,
        bug.createdByNickname ?? '',
        bugStatusLabel(bug.status),
    ].join('\n').toLowerCase();
    return haystack.includes(normalized);
}
```

- [ ] **Step 4: Run the helper test and verify it passes**

```bash
cd packages/happy-app && npx vitest run sources/sync/bugTypes.test.ts
```

Expected: pass.

---

## Task 2: Add server schema, migration, presenter, and service skeleton

**Files:**
- Modify: `packages/happy-server/prisma/schema.prisma`
- Create: `packages/happy-server/prisma/migrations/20260703180000_add_bug_reports/migration.sql`
- Create: `packages/happy-server/sources/app/bugs/bugTypes.ts`
- Create: `packages/happy-server/sources/app/bugs/bugPresenter.ts`
- Create: `packages/happy-server/sources/app/bugs/bugService.ts`
- Create: `packages/happy-server/sources/app/bugs/bugService.test.ts`

- [ ] **Step 1: Add service tests for title, activity, and transitions**

Create `packages/happy-server/sources/app/bugs/bugService.test.ts` with unit tests that mock `@/storage/db` and cover:

```ts
import { describe, expect, it } from 'vitest';
import { buildBugTitle, normalizeBugStatusChange } from './bugService';

describe('bugService pure helpers', () => {
    it('generates compact titles from descriptions', () => {
        expect(buildBugTitle('  页面空白，控制台有 500 错误  ')).toBe('页面空白，控制台有 500 错误');
        expect(buildBugTitle('测'.repeat(50))).toBe(`${'测'.repeat(36)}…`);
    });

    it('normalizes return-to-pending as a pending status with explicit action', () => {
        expect(normalizeBugStatusChange('verify', { status: 'pending', action: 'return_to_pending' })).toEqual({
            fromStatus: 'verify',
            toStatus: 'pending',
            action: 'return_to_pending',
        });
    });

    it('normalizes close as closed action', () => {
        expect(normalizeBugStatusChange('in_progress', { status: 'closed' })).toEqual({
            fromStatus: 'in_progress',
            toStatus: 'closed',
            action: 'closed',
        });
    });
});
```

- [ ] **Step 2: Run the service test and verify it fails**

```bash
cd packages/happy-server && npx vitest run sources/app/bugs/bugService.test.ts
```

Expected: fails because service files do not exist.

- [ ] **Step 3: Add Prisma schema models**

Modify `packages/happy-server/prisma/schema.prisma` using the model definitions in the **Data Model** section. Add Account and Session relation fields exactly there so `prisma generate` produces relation-safe types.

- [ ] **Step 4: Generate migration and Prisma client**

```bash
cd packages/happy-server && yarn prisma migrate dev --name add_bug_reports
cd packages/happy-server && yarn generate
```

Expected: Prisma creates `packages/happy-server/prisma/migrations/20260703180000_add_bug_reports/migration.sql` and regenerates client types.

- [ ] **Step 5: Implement server Bug constants**

Create `packages/happy-server/sources/app/bugs/bugTypes.ts`:

```ts
import { z } from 'zod';

export const BUG_STATUSES = ['pending', 'in_progress', 'verify', 'closed'] as const;
export const BUG_VISIBILITIES = ['shared', 'private'] as const;
export const BUG_IMAGE_LIMITS = {
    maxImages: 10,
    maxSizeBytes: 20 * 1024 * 1024,
} as const;

export const BugStatusSchema = z.enum(BUG_STATUSES);
export const BugVisibilitySchema = z.enum(BUG_VISIBILITIES);

export type BugStatus = z.infer<typeof BugStatusSchema>;
export type BugVisibility = z.infer<typeof BugVisibilitySchema>;
export type BugActor = { userId?: string; nickname: string };
```

- [ ] **Step 6: Implement presenter**

Create `packages/happy-server/sources/app/bugs/bugPresenter.ts` with exported functions:

```ts
import type { BugStatus, BugVisibility } from './bugTypes';

export function bugDisplayId(displayNumber: number): string {
    return `BUG-${displayNumber}`;
}

export function presentBugSummary(row: any) {
    return {
        id: row.id,
        displayNumber: row.displayNumber,
        displayId: bugDisplayId(row.displayNumber),
        title: row.title,
        description: row.description,
        status: row.status as BugStatus,
        visibility: row.visibility as BugVisibility,
        createdByNickname: row.createdByNickname,
        attachmentCount: row._count?.attachments ?? row.attachments?.length ?? 0,
        commentCount: row._count?.comments ?? row.comments?.length ?? 0,
        lastActivityAt: row.lastActivityAt.getTime(),
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
    };
}

export function presentBugDetail(row: any) {
    return {
        ...presentBugSummary(row),
        sessionId: row.sessionId ?? null,
        attachments: (row.attachments ?? []).map(presentBugAttachment),
        comments: (row.comments ?? []).map((comment: any) => ({
            id: comment.id,
            body: comment.body,
            authorNickname: comment.authorNickname,
            createdAt: comment.createdAt.getTime(),
            attachments: (comment.attachments ?? []).map(presentBugAttachment),
        })),
        statusHistory: (row.statusHistory ?? []).map((entry: any) => ({
            id: entry.id,
            action: entry.action,
            fromStatus: entry.fromStatus,
            toStatus: entry.toStatus,
            actorNickname: entry.actorNickname,
            note: entry.note,
            createdAt: entry.createdAt.getTime(),
        })),
    };
}

export function presentBugAttachment(row: any) {
    return {
        id: row.id,
        url: row.url,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        width: row.width,
        height: row.height,
        thumbhash: row.thumbhash,
        uploadedByNickname: row.uploadedByNickname,
        createdAt: row.createdAt.getTime(),
    };
}
```

- [ ] **Step 7: Implement service helpers and DB operations**

Create `packages/happy-server/sources/app/bugs/bugService.ts`. It must export pure helpers used by tests:

```ts
import { createHash } from 'crypto';
import { db } from '@/storage/db';
import { inTx } from '@/storage/inTx';
import { randomKeyNaked } from '@/utils/randomKeyNaked';
import { BUG_IMAGE_LIMITS, BugStatusSchema, BugVisibilitySchema, type BugActor, type BugStatus } from './bugTypes';
import { presentBugDetail, presentBugSummary } from './bugPresenter';

export function buildBugTitle(description: string): string {
    const normalized = description.trim().replace(/\s+/g, ' ');
    if (normalized.length <= 36) return normalized;
    return `${normalized.slice(0, 36)}…`;
}

export function normalizeBugStatusChange(currentStatus: string, input: { status: string; action?: string }) {
    const parsed = BugStatusSchema.parse(input.status);
    const action = input.action === 'return_to_pending'
        ? 'return_to_pending'
        : parsed === 'closed'
            ? 'closed'
            : 'status_change';
    return { fromStatus: currentStatus, toStatus: parsed, action };
}

export function hashBugShareAccessCode(accessCode: string): Buffer {
    return createHash('sha256').update(accessCode, 'utf8').digest();
}

export function generateBugShareAccessCode(): string {
    return randomKeyNaked(10);
}
```

Then add service functions with these exported names and full bodies in the same file. Use Prisma transactions for multi-row updates, and keep each function idempotent where repeated client requests can occur:

- `listBugsForOwner(ownerId, input)` returns `{ bugs, pendingCount }`, where `bugs` are presented summaries sorted by `lastActivityAt desc`.
- `getBugForOwner(ownerId, bugId)` returns one presented detail row or throws `{ statusCode: 404, message: 'Bug not found' }`.
- `createBugForOwner(ownerId, actor, input)` creates the Bug, initial history, and returns the presented detail.
- `addBugComment(ownerId, bugId, actor, body)` creates a comment, bumps `lastActivityAt`, and returns `{ bug, commentId }`.
- `changeBugStatus(ownerId, bugId, actor, input)` updates status/history/activity and returns the presented detail.
- `linkBugSession(ownerId, bugId, sessionId, actor)` validates session ownership, links it, changes status to `in_progress`, and returns the presented detail.
- `createOrRotateBugShareConfig(ownerId, accessCode)` creates or rotates the shared access code and returns `{ config, accessCode }`, with plaintext access code available only in this return value.
- `getBugShareConfig(ownerId)` returns share metadata without plaintext access code.

Implementation rules for those functions:

- `createBugForOwner` trims description, rejects empty text, stores `title = buildBugTitle(description)`, default `visibility = shared`, status `pending`, and creates initial `BugStatusHistory` action `created`.
- `listBugsForOwner` filters `ownerId`, optional status, optional query against display number/title/description/nickname in memory after DB fetch when necessary, returns `{ bugs, pendingCount }`.
- `addBugComment` creates a comment, updates `BugReport.lastActivityAt`, and creates history action `comment` only if history should include comments. Keep comments visible in detail regardless.
- `changeBugStatus` writes `BugStatusHistory` on every effective status change, with `action = return_to_pending` when requested.
- `linkBugSession` validates the session belongs to `ownerId`, sets `sessionId`, changes status to `in_progress`, writes `start_session` history, and updates `lastActivityAt`.
- `createOrRotateBugShareConfig` hashes the access code, increments `accessCodeVersion` if a config exists, and returns plaintext code only in that response.

- [ ] **Step 8: Run service tests**

```bash
cd packages/happy-server && npx vitest run sources/app/bugs/bugService.test.ts
```

Expected: pass.

---

## Task 3: Add server routes and public Bug-share token auth

**Files:**
- Create: `packages/happy-server/sources/app/bugs/bugShareToken.ts`
- Create: `packages/happy-server/sources/app/bugs/bugImageUpload.ts`
- Create: `packages/happy-server/sources/app/api/routes/bugRoutes.ts`
- Create: `packages/happy-server/sources/app/api/routes/bugPublicRoutes.ts`
- Create: `packages/happy-server/sources/app/api/routes/bugRoutes.test.ts`
- Create: `packages/happy-server/sources/app/api/routes/bugPublicRoutes.test.ts`
- Modify: `packages/happy-server/sources/app/api/api.ts`

- [ ] **Step 1: Write public token tests**

Create `packages/happy-server/sources/app/bugs/bugShareToken.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createBugShareToken, verifyBugShareToken } from './bugShareToken';

describe('bugShareToken', () => {
    it('round-trips config id, owner id, nickname, and version', () => {
        const token = createBugShareToken({ configId: 'cfg-1', ownerId: 'owner-1', nickname: '测试李', version: 3 });
        expect(verifyBugShareToken(token)).toMatchObject({
            configId: 'cfg-1',
            ownerId: 'owner-1',
            nickname: '测试李',
            version: 3,
        });
    });

    it('returns null for invalid tokens', () => {
        expect(verifyBugShareToken('not-a-token')).toBeNull();
    });
});
```

- [ ] **Step 2: Implement separate Bug public token helper**

Create `packages/happy-server/sources/app/bugs/bugShareToken.ts`:

```ts
import jwt from 'jsonwebtoken';

export interface BugShareTokenPayload {
    configId: string;
    ownerId: string;
    nickname: string;
    version: number;
}

const issuer = 'happy-bug-share';

function secret(): string {
    const value = process.env.HANDY_MASTER_SECRET;
    if (!value) throw new Error('HANDY_MASTER_SECRET is required');
    return `${value}:bug-share`;
}

export function createBugShareToken(payload: BugShareTokenPayload): string {
    return jwt.sign(payload, secret(), { issuer, expiresIn: '30d' });
}

export function verifyBugShareToken(token: string): BugShareTokenPayload | null {
    try {
        const decoded = jwt.verify(token, secret(), { issuer });
        if (!decoded || typeof decoded !== 'object') return null;
        const candidate = decoded as Record<string, unknown>;
        if (typeof candidate.configId !== 'string') return null;
        if (typeof candidate.ownerId !== 'string') return null;
        if (typeof candidate.nickname !== 'string') return null;
        if (typeof candidate.version !== 'number') return null;
        return {
            configId: candidate.configId,
            ownerId: candidate.ownerId,
            nickname: candidate.nickname,
            version: candidate.version,
        };
    } catch {
        return null;
    }
}
```

- [ ] **Step 3: Add Bug image upload helper**

Create `packages/happy-server/sources/app/bugs/bugImageUpload.ts`. Reuse `processImage`, `s3client`, `s3bucket`, `s3public`, and `randomKey` patterns from `chatImageUpload.ts`. The helper must reject non-JPEG/PNG/WebP images and files over `BUG_IMAGE_LIMITS.maxSizeBytes` before S3 upload.

Core exported signature:

```ts
export async function uploadBugImage(args: {
    ownerId: string;
    bugId: string;
    imageBuffer: Buffer;
    mimeType: string;
    sizeBytes: number;
}): Promise<{ url: string; path: string; width: number | null; height: number | null; thumbhash: string | null; mimeType: string; sizeBytes: number }>;
```

- [ ] **Step 4: Add authenticated Bug routes**

Create `packages/happy-server/sources/app/api/routes/bugRoutes.ts` and wire each endpoint to `bugService`. Keep route handlers thin and use `preHandler: app.authenticate`.

Route schemas:

```ts
const createBugBody = z.object({
    description: z.string().trim().min(1),
    visibility: z.enum(['shared', 'private']).optional(),
});

const statusBody = z.object({
    status: z.enum(['pending', 'in_progress', 'verify', 'closed']),
    action: z.enum(['return_to_pending']).optional(),
});

const commentBody = z.object({
    body: z.string().trim().min(1),
});
```

- [ ] **Step 5: Add public Bug routes**

Create `packages/happy-server/sources/app/api/routes/bugPublicRoutes.ts`.

Public route handler rules:

- `POST /v1/bug-share/login` hashes `accessCode`, loads enabled `BugShareConfig`, rejects not found, trims nickname, returns `{ token, nickname }`.
- All other public routes read `Authorization: Bearer <bugShareToken>`, verify with `verifyBugShareToken`, load `BugShareConfig`, compare `accessCodeVersion`, and reject mismatches with status `401` and body `{ error: 'bug_share_expired' }`.
- Public actor is `{ nickname: payload.nickname }` and owner is `payload.ownerId`.
- Public create always uses `visibility: 'shared'`.

- [ ] **Step 6: Register routes and file limit**

Modify `packages/happy-server/sources/app/api/api.ts`:

```ts
import { bugRoutes } from './routes/bugRoutes';
import { bugPublicRoutes } from './routes/bugPublicRoutes';
```

Update multipart registration:

```ts
app.register(import('@fastify/multipart'), {
    limits: {
        fileSize: 20 * 1024 * 1024,
    }
});
```

Register near other routes:

```ts
bugRoutes(typed);
bugPublicRoutes(typed);
```

- [ ] **Step 7: Add route tests**

Follow the style of `companyRoutes.test.ts`: mock service functions and assert route wiring.

Minimum route test coverage:

- Authenticated `GET /v1/bugs` passes `request.userId` to `listBugsForOwner`.
- Authenticated `POST /v1/bugs` rejects blank description.
- Authenticated `PATCH /v1/bugs/:bugId/status` forwards `action: 'return_to_pending'`.
- Public login rejects wrong access code.
- Public token with old version returns `401` and `bug_share_expired`.
- Public create uses nickname from token.

- [ ] **Step 8: Run server route tests and build**

```bash
cd packages/happy-server && npx vitest run sources/app/bugs/bugShareToken.test.ts sources/app/api/routes/bugRoutes.test.ts sources/app/api/routes/bugPublicRoutes.test.ts
cd packages/happy-server && yarn build
```

Expected: tests pass and TypeScript build passes.

---

## Task 4: Add app API client and repair prompt builder

**Files:**
- Create: `packages/happy-app/sources/sync/apiBugs.ts`
- Create: `packages/happy-app/sources/components/bugReportStartPrompt.ts`
- Create: `packages/happy-app/sources/components/bugReportStartPrompt.test.ts`
- Modify: `packages/happy-app/sources/utils/tempDataStore.ts`
- Modify: `packages/happy-app/sources/app/(app)/new/index.tsx`

- [ ] **Step 1: Write prompt-builder tests**

Create `packages/happy-app/sources/components/bugReportStartPrompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BugReportDetail } from '@/sync/bugTypes';
import { buildBugReportStartPrompt, buildBugInitialImages } from './bugReportStartPrompt';

const bug: BugReportDetail = {
    id: 'bug-1',
    displayNumber: 1042,
    displayId: 'BUG-1042',
    title: '提交订单后页面一直转圈',
    description: '提交订单后页面一直转圈，无法完成支付。',
    status: 'verify',
    visibility: 'shared',
    createdByNickname: '测试李',
    attachmentCount: 1,
    commentCount: 1,
    sessionId: null,
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1,
    attachments: [{ id: 'att-1', url: 'https://files.example/a.png', mimeType: 'image/png', sizeBytes: 100, width: 800, height: 600, thumbhash: null, uploadedByNickname: '测试李', createdAt: 1 }],
    comments: [{ id: 'c-1', body: '补充：只在生产出现。', authorNickname: '王五', createdAt: 2, attachments: [] }],
    statusHistory: [{ id: 'h-1', action: 'return_to_pending', fromStatus: 'verify', toStatus: 'pending', actorNickname: '王五', note: null, createdAt: 3 }],
};

describe('bugReportStartPrompt', () => {
    it('includes description, comments, history, screenshot references, and no-commit reminder', () => {
        const prompt = buildBugReportStartPrompt(bug);
        expect(prompt).toContain('BUG-1042');
        expect(prompt).toContain('提交订单后页面一直转圈，无法完成支付。');
        expect(prompt).toContain('附件 1');
        expect(prompt).toContain('补充：只在生产出现。');
        expect(prompt).toContain('打回待处理');
        expect(prompt).toContain('请勿提交任何代码，让我检查通过再说');
    });

    it('builds initial images from Bug attachments', () => {
        expect(buildBugInitialImages(bug)).toEqual([{ uri: 'https://files.example/a.png', width: 800, height: 600, mimeType: 'image/png' }]);
    });
});
```

- [ ] **Step 2: Implement prompt builder**

Create `packages/happy-app/sources/components/bugReportStartPrompt.ts`:

```ts
import type { LocalImage } from '@/components/ImagePreview';
import { bugStatusLabel, formatBugStatusHistoryAction, type BugReportDetail } from '@/sync/bugTypes';

export function buildBugInitialImages(bug: BugReportDetail): LocalImage[] {
    return bug.attachments.map((attachment) => ({
        uri: attachment.url,
        width: attachment.width ?? 1024,
        height: attachment.height ?? 768,
        mimeType: attachment.mimeType,
    }));
}

export function buildBugReportStartPrompt(bug: BugReportDetail): string {
    const attachmentLines = bug.attachments.map((attachment, index) => (
        `- 附件 ${index + 1}：原始提交截图，${attachment.uploadedByNickname ?? '匿名用户'} 上传，URL：${attachment.url}`
    ));
    const commentLines = bug.comments.map((comment, index) => (
        `- 评论 ${index + 1}（${comment.authorNickname ?? '匿名用户'}）：${comment.body}`
    ));
    const historyLines = bug.statusHistory.map((entry, index) => (
        `- 历史 ${index + 1}（${entry.actorNickname ?? '系统'}）：${formatBugStatusHistoryAction(entry)}${entry.note ? `，备注：${entry.note}` : ''}`
    ));

    return [
        `请基于 Happy Bug ${bug.displayId} 开始修复。`,
        '',
        `标题：${bug.title}`,
        `当前状态：${bugStatusLabel(bug.status)}`,
        `提交人：${bug.createdByNickname ?? '匿名用户'}`,
        '',
        '问题说明：',
        bug.description,
        '',
        '截图附件：',
        attachmentLines.length > 0 ? attachmentLines.join('\n') : '- 无',
        '',
        '评论补充：',
        commentLines.length > 0 ? commentLines.join('\n') : '- 无',
        '',
        '状态历史：',
        historyLines.length > 0 ? historyLines.join('\n') : '- 无',
        '',
        '请先分析根因和修复方案，再做最小必要修改。请勿提交任何代码，让我检查通过再说。',
    ].join('\n');
}
```

- [ ] **Step 3: Add API client**

Create `packages/happy-app/sources/sync/apiBugs.ts` with these exported functions:

```ts
export async function listBugs(credentials: AuthCredentials, options?: { status?: BugStatus; query?: string; limit?: number }): Promise<{ bugs: BugReportSummary[]; pendingCount: number }>;
export async function createBug(credentials: AuthCredentials, input: { description: string; visibility?: BugVisibility }): Promise<BugReportDetail>;
export async function getBug(credentials: AuthCredentials, bugId: string): Promise<BugReportDetail>;
export async function addBugComment(credentials: AuthCredentials, bugId: string, body: string): Promise<BugReportDetail>;
export async function changeBugStatus(credentials: AuthCredentials, bugId: string, input: { status: BugStatus; action?: 'return_to_pending' }): Promise<BugReportDetail>;
export async function uploadBugAttachment(credentials: AuthCredentials, bugId: string, image: LocalImage, commentId?: string): Promise<BugReportDetail>;
export async function getBugShareConfig(credentials: AuthCredentials): Promise<{ enabled: boolean; updatedAt: number } | null>;
export async function createOrRotateBugShareConfig(credentials: AuthCredentials, input?: { accessCode?: string }): Promise<{ accessCode: string; url: string; version: number }>;
export async function linkBugSession(credentials: AuthCredentials, bugId: string, sessionId: string): Promise<BugReportDetail>;
export async function loginBugShare(accessCode: string, nickname: string): Promise<{ token: string; nickname: string }>;
export async function listPublicBugs(token: string, options?: { status?: BugStatus; query?: string }): Promise<{ bugs: BugReportSummary[]; pendingCount: number }>;
export async function createPublicBug(token: string, input: { description: string }): Promise<BugReportDetail>;
export async function getPublicBug(token: string, bugId: string): Promise<BugReportDetail>;
export async function addPublicBugComment(token: string, bugId: string, body: string): Promise<BugReportDetail>;
export async function changePublicBugStatus(token: string, bugId: string, input: { status: BugStatus; action?: 'return_to_pending' }): Promise<BugReportDetail>;
export async function uploadPublicBugAttachment(token: string, bugId: string, image: LocalImage, commentId?: string): Promise<BugReportDetail>;
```

Implementation details:

- Use `getServerUrl()` for the base URL.
- Authenticated calls use `Authorization: Bearer ${credentials.token}`.
- Public calls use `Authorization: Bearer ${bugShareToken}` but only to Bug-share endpoints.
- If public response status is `401` and body error is `bug_share_expired`, throw a typed `BugShareExpiredError` so the hook can clear token and show the access-code screen.
- Upload uses `FormData` with one `file` per request; callers loop for multiple screenshots.

- [ ] **Step 4: Extend temp data for initial images**

Modify `packages/happy-app/sources/utils/tempDataStore.ts`:

```ts
import type { LocalImage } from '@/components/ImagePreview';

export interface NewSessionData {
    // existing fields...
    initialImages?: LocalImage[];
}
```

Modify `packages/happy-app/sources/app/(app)/new/index.tsx` image initialization effect:

```ts
React.useEffect(() => {
    if (tempSessionData?.initialImages && tempSessionData.initialImages.length > 0) {
        initImages(tempSessionData.initialImages);
        return;
    }
    if (persistedDraft?.images && persistedDraft.images.length > 0) {
        initImages(persistedDraft.images);
    }
}, []);
```

- [ ] **Step 5: Run app prompt tests and typecheck**

```bash
cd packages/happy-app && npx vitest run sources/components/bugReportStartPrompt.test.ts sources/sync/bugTypes.test.ts
cd packages/happy-app && yarn typecheck
```

Expected: tests pass and typecheck passes.

---

## Task 5: Integrate Bugs into `终端 > 待处理`

**Files:**
- Modify: `packages/happy-app/sources/components/SessionsList.tsx`
- Create: `packages/happy-app/sources/components/BugReportItem.tsx`
- Create: `packages/happy-app/sources/components/BugReportCreateModal.tsx`
- Create: `packages/happy-app/sources/components/BugShareSettingsModal.tsx`
- Create: `packages/happy-app/sources/components/BugReportDetailModal.tsx`

- [ ] **Step 1: Add a Bug card component**

Create `BugReportItem.tsx` using the style of `GitHubIssueItem`. Props:

```ts
export const BugReportItem = React.memo(({ bug, onPress }: {
    bug: BugReportSummary;
    onPress: (bug: BugReportSummary) => void;
}) => { /* render */ });
```

Required visible content:

- Type marker: `🐞 Bug`
- Display ID: `BUG-1042`
- Title: generated title
- Meta: `状态 待处理/进行中/待验证/已关闭 · 昵称 · 2 张截图 · 5 条评论`
- Chevron forward icon

- [ ] **Step 2: Add pending type filter state**

In `SessionsList.tsx`, add:

```ts
type PendingItemType = 'all' | 'github' | 'bug';
type PendingListItem =
    | { type: 'github'; issue: GitHubIssue; sortAt: number }
    | { type: 'bug'; bug: BugReportSummary; sortAt: number };
```

Add local state:

```ts
const [pendingItemType, setPendingItemType] = useLocalSettingMutable('pendingItemType');
const [pendingBugs, setPendingBugs] = React.useState<BugReportSummary[]>([]);
const [pendingBugCount, setPendingBugCount] = React.useState(0);
const [pendingBugsLoading, setPendingBugsLoading] = React.useState(false);
const [pendingBugsError, setPendingBugsError] = React.useState<string | null>(null);
```

Also update `LocalSettingsSchema` and defaults in `packages/happy-app/sources/sync/localSettings.ts`:

```ts
pendingItemType: z.enum(['all', 'github', 'bug']).describe('Device-local pending list type filter'),
```

Default:

```ts
pendingItemType: 'all',
```

- [ ] **Step 3: Add Bug loading**

In `SessionsList.tsx`, add `loadPendingBugs()` that calls `listBugs(auth.credentials, { query: pendingIssueSearchText, limit: 100 })`, updates `pendingBugs`, `pendingBugCount`, and error state. Run it when `activeTab === 'pending'` and when refresh is triggered. Keep GitHub loading untouched.

- [ ] **Step 4: Add mixed pending list**

Build mixed data:

```ts
const pendingListItems = React.useMemo<PendingListItem[]>(() => {
    const githubItems = pendingItemType === 'bug' ? [] : filteredPendingIssues.map(issue => ({
        type: 'github' as const,
        issue,
        sortAt: new Date(issue.updatedAt).getTime() || 0,
    }));
    const bugItems = pendingItemType === 'github' ? [] : pendingBugs.map(bug => ({
        type: 'bug' as const,
        bug,
        sortAt: bug.lastActivityAt,
    }));
    return [...bugItems, ...githubItems].sort((a, b) => b.sortAt - a.sortAt);
}, [filteredPendingIssues, pendingBugs, pendingItemType]);
```

- [ ] **Step 5: Add pending header filters and Bug actions**

Extend `SessionsListHeader` props:

```ts
pendingItemType: PendingItemType;
pendingBugCount: number;
onPendingItemTypeChange: (type: PendingItemType) => void;
onCreateBug: () => void;
onConfigureBugShare: () => void;
```

Header behavior:

- Top tab row still always includes `待处理`.
- `待处理` chip shows badge when `pendingBugCount > 0`.
- When active tab is `pending`, render second-row chips `全部 / GitHub / Bug`.
- Search placeholder changes:
  - `全部`: `搜索 BUG-1042 / #1212 / 标题 / 说明`
  - `GitHub`: `搜索 #1212 / 标题 / 仓库`
  - `Bug`: `搜索 BUG-1042 / 问题说明 / 昵称`
- Show GitHub project filter only when `pendingItemType !== 'bug'`.
- Show `＋ 新建 Bug` and `共享设置` only when `pendingItemType !== 'github'`.

- [ ] **Step 6: Add Bug create and share settings modals**

`BugReportCreateModal.tsx`:

- Description `TextInput` is required.
- Use `useImagePicker({ maxImages: 10, maxSizeBytes: 20 * 1024 * 1024 })`.
- On create: call `createBug`, then upload selected images sequentially via `uploadBugAttachment`.
- On success: close modal, update list state, and open detail modal.

`BugShareSettingsModal.tsx`:

- Shows `/bug` URL from current app origin.
- Button `生成/重置共享密码` calls `createOrRotateBugShareConfig`.
- Shows plaintext code only immediately after creation/rotation.
- Warns: “修改后旧密码和已打开页面会立即失效，需要重新输入。”

- [ ] **Step 7: Add Bug detail modal**

`BugReportDetailModal.tsx` supports:

- View display ID/title/status/description.
- View screenshots grid.
- View comments.
- View status history with `打回待处理` wording.
- Add comment.
- Upload screenshots.
- Change status: `待处理`, `进行中`, `待验证`, `已关闭`, plus action button `打回待处理` when current status is not `pending`.
- Start repair session callback for Happy internal modal only.

- [ ] **Step 8: Start repair session from Bug**

In `SessionsList.tsx`, add `handleStartBug(bugDetail)`:

```ts
const prompt = buildBugReportStartPrompt(bugDetail);
const dataId = storeTempData({
    prompt,
    agentType: 'codex',
    sessionType: 'worktree',
    sessionTitle: `${bugDetail.displayId} ${bugDetail.title}`,
    sessionIcon: '🐞',
    initialImages: buildBugInitialImages(bugDetail),
    externalContext: {
        source: 'happy-bug',
        resourceType: 'bug',
        resourceId: bugDetail.id,
        title: `${bugDetail.displayId} ${bugDetail.title}`,
        extra: {
            displayId: bugDetail.displayId,
            displayNumber: bugDetail.displayNumber,
            status: bugDetail.status,
        },
    },
});
router.push(`/new?dataId=${encodeURIComponent(dataId)}`);
```

After session creation, call `linkBugSession(credentials, bugId, sessionId)` from `/new` after `machineSpawnNewSession` returns. To avoid adding Bug-specific code directly to generic new-session state, add optional `onCreatedContext` data in `NewSessionData`:

```ts
onCreatedContext?: { type: 'happy-bug'; bugId: string };
```

Then in `/new`, after successful `result.sessionId`, if `onCreatedContext.type === 'happy-bug'`, call `linkBugSession(sync.getCredentials(), bugId, result.sessionId)`.

- [ ] **Step 9: Run focused app typecheck**

```bash
cd packages/happy-app && yarn typecheck
```

Expected: passes.

---

## Task 6: Add public `/bug` shared board

**Files:**
- Create: `packages/happy-app/sources/hooks/useBugShareBoard.ts`
- Create: `packages/happy-app/sources/app/(app)/bug/index.tsx`
- Modify: `packages/happy-app/sources/app/(app)/_layout.tsx`

- [ ] **Step 1: Add route registration**

Modify `packages/happy-app/sources/app/(app)/_layout.tsx`:

```tsx
<Stack.Screen
    name="bug/index"
    options={{
        headerShown: false,
    }}
/>
```

- [ ] **Step 2: Implement public board hook**

Create `useBugShareBoard.ts` with state:

```ts
type BugShareBoardState = 'login-code' | 'login-nickname' | 'loading' | 'loaded' | 'expired' | 'error';
```

Hook behavior:

- Persist `bugShareToken`, `bugShareNickname`, and last `bugShareAccessCode` in `AsyncStorage` only for convenience.
- First screen asks access code.
- If no nickname, ask nickname.
- Login calls `loginBugShare(accessCode, nickname)` and stores token/nickname.
- `BugShareExpiredError` clears token and sets state to `expired`; UI says old password expired and asks for new code.
- Loaded board calls `listPublicBugs` and refreshes after create/comment/status/upload.

- [ ] **Step 3: Implement `/bug` screen**

Create `packages/happy-app/sources/app/(app)/bug/index.tsx`:

- Access-code screen: title `Happy Bug`, secure input, submit button.
- Nickname screen: single nickname input, submit button.
- Board screen:
  - Header: `Bug 反馈` and nickname badge.
  - Status chips: `全部 / 待处理 / 进行中 / 待验证 / 已关闭`.
  - Button: `提交 Bug`.
  - List Bug cards using `BugReportItem`.
  - Detail uses `BugReportDetailModal` in public mode: comments/status/uploads allowed, start-session hidden.
- Create public Bug form uses only required description + optional screenshots.

- [ ] **Step 4: Public upload flow**

When public user creates a Bug with screenshots:

```ts
const detail = await createPublicBug(token, { description });
let current = detail;
for (const image of images.slice(0, BUG_IMAGE_LIMITS.maxImages)) {
    current = await uploadPublicBugAttachment(token, detail.id, image);
}
return current;
```

When public user comments with screenshots:

- First create comment.
- Then upload screenshots with returned `commentId` if API returns the updated detail and comment can be found by created timestamp/body; simpler implementation: add a server endpoint that returns `commentId` in comment response, and have `addPublicBugComment` return `{ bug, commentId }`.

Use the simpler server response shape for both authenticated and public comment endpoints:

```ts
{ bug: BugReportDetail, commentId: string }
```

- [ ] **Step 5: Run app typecheck**

```bash
cd packages/happy-app && yarn typecheck
```

Expected: passes.

---

## Task 7: Add linked Bug detail in session header

**Files:**
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`
- Reuse: `packages/happy-app/sources/components/BugReportDetailModal.tsx`
- Reuse: `packages/happy-app/sources/sync/apiBugs.ts`

- [ ] **Step 1: Add linked Bug extractor**

In `SessionView.tsx`, next to `buildLinkedGitHubIssue`, add:

```ts
function buildLinkedHappyBug(session: Session | null | undefined): { bugId: string; displayId: string; title: string } | null {
    const context = session?.metadata?.externalContext;
    if (!context || context.source !== 'happy-bug' || context.resourceType !== 'bug') return null;
    const extra = context.extra && typeof context.extra === 'object' ? context.extra as Record<string, unknown> : {};
    return {
        bugId: context.resourceId,
        displayId: readString(extra.displayId) || context.title?.match(/^(BUG-\d+)/)?.[1] || 'BUG',
        title: readString(context.title) || readString(extra.displayId) || 'Bug',
    };
}
```

- [ ] **Step 2: Add open handler**

In `SessionView`, create `linkedHappyBug` with `React.useMemo`, then handler:

```ts
const handleOpenLinkedHappyBug = React.useCallback(async () => {
    if (!linkedHappyBug) return;
    const credentials = sync.getCredentials();
    if (!credentials) return;
    try {
        const bug = await getBug(credentials, linkedHappyBug.bugId);
        Modal.show({
            component: BugReportDetailModal,
            props: {
                bug,
                mode: 'happy',
                showStartSession: false,
                onBugUpdated: () => undefined,
            },
        });
    } catch (error) {
        Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
    }
}, [linkedHappyBug]);
```

- [ ] **Step 3: Add header icon**

In the header-right block before the GitHub ticket icon or beside it:

```tsx
{linkedHappyBug && (
    <Pressable
        {...webTooltip('打开 Bug 详情')}
        onPress={handleOpenLinkedHappyBug}
        hitSlop={15}
        accessibilityRole="button"
        accessibilityLabel="打开 Bug 详情"
        style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginRight: 2 }}
    >
        <Ionicons name="bug-outline" size={21} color={theme.colors.header.tint} />
    </Pressable>
)}
```

- [ ] **Step 4: Verify manually and with typecheck**

```bash
cd packages/happy-app && yarn typecheck
```

Manual check:

- Start a Bug repair session.
- Open the session.
- Confirm a Bug icon appears in the header.
- Click it and confirm the detail modal opens.
- Add comment/change status in modal and confirm the Bug list updates after refresh.

---

## Task 8: Extend image picker limits without changing chat defaults

**Files:**
- Modify: `packages/happy-app/sources/hooks/useImagePicker.ts`
- Create or modify: `packages/happy-app/sources/utils/chatAttachmentLimits.test.ts` if needed

- [ ] **Step 1: Make `maxSizeBytes` effective**

Current `useImagePicker` accepts `maxSizeBytes` but does not use it in `shouldPassthrough`. Change the helper to accept the limit:

```ts
function shouldPassthrough(mimeType: string, width: number, height: number, fileSize: number | undefined, maxSizeBytes: number): boolean {
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') return false;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) return false;
    if (fileSize != null && fileSize > maxSizeBytes) return false;
    return true;
}
```

In `useImagePicker` destructuring:

```ts
const {
    maxImages = DEFAULT_MAX_IMAGES,
    maxSizeBytes = MAX_SIZE_BYTES,
    allowedTypes = DEFAULT_ALLOWED_TYPES,
} = options;
```

Use `maxSizeBytes` for all calls and reject files over the limit with a modal message before compression when the original file size is known.

- [ ] **Step 2: Use Bug limits in Bug create/comment UI**

All Bug create/comment upload components must call:

```ts
useImagePicker({
    maxImages: BUG_IMAGE_LIMITS.maxImages,
    maxSizeBytes: BUG_IMAGE_LIMITS.maxSizeBytes,
});
```

- [ ] **Step 3: Typecheck app**

```bash
cd packages/happy-app && yarn typecheck
```

Expected: passes.

---

## Task 9: Add i18n strings

**Files:**
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/en.ts`
- Modify: `packages/happy-app/sources/text/translations/ru.ts`
- Modify: `packages/happy-app/sources/text/translations/pl.ts`
- Modify: `packages/happy-app/sources/text/translations/es.ts`
- Modify: `packages/happy-app/sources/text/translations/ca.ts`
- Modify: `packages/happy-app/sources/text/translations/it.ts`
- Modify: `packages/happy-app/sources/text/translations/pt.ts`
- Modify: `packages/happy-app/sources/text/translations/ja.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hans.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hant.ts`

- [ ] **Step 1: Add Bug string namespace**

Add keys under `bug`:

```ts
bug: {
    title: 'Bug',
    boardTitle: 'Bug 反馈',
    typeAll: '全部',
    typeGithub: 'GitHub',
    typeBug: 'Bug',
    newBug: '新建 Bug',
    shareSettings: '共享设置',
    description: '问题说明',
    descriptionPlaceholder: '请描述你遇到的问题',
    screenshots: '截图',
    submit: '提交 Bug',
    accessCode: '共享密码',
    accessCodePlaceholder: '请输入共享密码',
    nickname: '昵称',
    nicknamePlaceholder: '请输入你的昵称',
    statusPending: '待处理',
    statusInProgress: '进行中',
    statusVerify: '待验证',
    statusClosed: '已关闭',
    returnToPending: '打回待处理',
    startRepairSession: '开启修复会话',
    openBugDetail: '打开 Bug 详情',
    comment: '评论',
    addComment: '补充评论',
    uploadScreenshots: '上传截图',
    shareCodeRotated: '共享密码已更新，旧密码和已打开页面会立即失效。',
    shareExpired: '共享密码已失效，请重新输入。',
}
```

- [ ] **Step 2: Fill all translations**

For non-Chinese locales, English fallback is acceptable if an exact translation is not available. Do not leave missing keys.

- [ ] **Step 3: Replace hard-coded user-visible Bug strings**

Use `t('bug.newBug')`, `t('bug.shareSettings')`, etc. Internal status history strings included in stored history may remain Chinese because the user explicitly required `打回待处理` to display that way.

- [ ] **Step 4: Run app typecheck**

```bash
cd packages/happy-app && yarn typecheck
```

Expected: passes.

---

## Task 10: End-to-end verification checklist

**Files:**
- No new files unless tests reveal a missing focused test.

- [ ] **Step 1: Server verification**

```bash
cd packages/happy-server && npx vitest run sources/app/bugs/bugShareToken.test.ts sources/app/bugs/bugService.test.ts sources/app/api/routes/bugRoutes.test.ts sources/app/api/routes/bugPublicRoutes.test.ts
cd packages/happy-server && yarn build
```

Expected: all pass.

- [ ] **Step 2: App verification**

```bash
cd packages/happy-app && npx vitest run sources/sync/bugTypes.test.ts sources/components/bugReportStartPrompt.test.ts
cd packages/happy-app && yarn typecheck
```

Expected: all pass.

- [ ] **Step 3: Wire verification**

If shared wire types are modified, run:

```bash
cd packages/happy-wire && yarn typecheck
```

Expected: passes. If `happy-wire` remains untouched, skip this command and state it was skipped because no wire files changed.

- [ ] **Step 4: Manual Happy internal flow**

- Open `终端`.
- Confirm `待处理` tag appears even when no list data exists.
- Confirm Bug pending count badge appears only when there are `待处理` Bugs.
- Switch `全部 / GitHub / Bug` filters.
- Confirm GitHub filter hides Bug operations.
- Create Bug with description only.
- Create Bug with screenshots.
- Open detail modal.
- Add comment and screenshot.
- Change status to `进行中`, `待验证`, `已关闭`.
- Use `打回待处理` and confirm history displays that exact text.
- Start repair session and confirm status becomes `进行中`.

- [ ] **Step 5: Manual public `/bug` flow**

- Open Happy internal Bug share settings and generate an access code.
- Open `/bug` in a fresh browser profile.
- Enter access code and nickname.
- Submit Bug with description and optional screenshot.
- Confirm other public view can see the Bug and status.
- Add comment and screenshot as public user.
- Change status and close as public user.
- Rotate access code internally.
- Confirm old public page immediately asks for access code again on next request.

- [ ] **Step 6: Manual linked-session flow**

- From Bug detail, start repair session.
- Confirm new session title includes `BUG-xxxx`.
- Confirm initial message includes description, screenshots references, comments, status history, and no-commit reminder.
- Confirm screenshots arrive as image attachments.
- Open session header Bug icon.
- Confirm Bug detail modal opens and supports comment/status/upload.

---

## Risks and Mitigations

- **Public token accidentally authenticates as Happy user:** use a separate Bug-share JWT helper and never call `app.authenticate` for public Bug endpoints.
- **Old shared code remains valid after rotation:** every public endpoint must compare token `version` with `BugShareConfig.accessCodeVersion` from DB.
- **Multipart limit conflicts with existing chat upload:** raise Fastify multipart file limit to 20 MB, keep chat image compression behavior unchanged, and upload Bug images one file per request.
- **SessionsList becomes too large:** if implementation grows hard to review, split Bug-specific rendering into `BugReportItem`, `BugReportDetailModal`, `BugReportCreateModal`, and `BugShareSettingsModal` rather than expanding `SessionsList.tsx` further.
- **Bug screenshots fail as session image attachments on native:** first implementation relies on existing remote URI upload behavior. If native fails during manual verification, add a server-side `copyBugAttachmentToChatImage` endpoint or send screenshots as URL references in prompt while keeping web image attachments.
- **Global `/bug` ambiguity in multi-user deployments:** access code maps to a unique `BugShareConfig` by hash, so the code itself selects the owner board. Generated codes are random and stored hashed with a unique constraint.
