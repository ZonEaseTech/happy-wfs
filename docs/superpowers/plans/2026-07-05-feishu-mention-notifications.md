# Feishu Mention Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a separate Feishu webhook channel for collaboration `@` notes, without open_id mapping in V1.

**Architecture:** Store a second Feishu config under `Account.notificationConfig.feishuMention` while preserving the existing `feishu` config. The app sends a plaintext mention-notification preview only for collaboration mention messages; the server truncates it to 500 chars and posts one Feishu message to the session owner's mention webhook after the DB transaction commits.

**Tech Stack:** TypeScript, Zod, Fastify, Prisma JSON config, React Native/Expo settings screen, Vitest.

---

### Task 1: Wire schema and API contract

**Files:**
- Modify: `packages/happy-wire/src/notifications.ts`
- Modify: `packages/happy-app/sources/sync/apiNotifications.ts`
- Modify: `packages/happy-server/sources/app/api/routes/notificationRoutes.ts`
- Test: `packages/happy-server/sources/app/api/routes/notificationRoutes.test.ts`

- [x] Write failing tests for saving, reading, and testing the independent `feishuMention` config.
- [x] Extend shared notification schema with optional `feishuMention`.
- [x] Add app client helpers for mention config GET/PUT/test.
- [x] Implement server routes by reusing existing Feishu webhook validation and secret-preservation behavior.
- [x] Run `npx vitest run packages/happy-server/sources/app/api/routes/notificationRoutes.test.ts`.

### Task 2: Mention notification dispatch

**Files:**
- Modify: `packages/happy-wire/src/sessions.ts` or the current v3 message body schema owner file if different
- Modify: `packages/happy-app/sources/sync/sync.ts`
- Modify: `packages/happy-server/sources/app/api/routes/v3SessionRoutes.ts`
- Modify: `packages/happy-server/sources/app/session/sessionMentionNotification.ts`
- Modify: `packages/happy-server/sources/app/notifications/feishuAdapter.ts`
- Test: `packages/happy-server/sources/app/api/routes/v3SessionRoutes.test.ts`

- [x] Write a failing test that a collaboration mention with preview triggers one owner Feishu mention notification.
- [x] Write a failing test that duplicate local IDs do not send duplicate Feishu notifications.
- [x] Add optional `mentionPreview` to the v3 send-message body and app collaboration mention payload.
- [x] Build one Feishu message containing actor, all mentioned Happy users as text, session title/link, and max 500 chars of note body.
- [x] Keep feed and Expo push mention behavior unchanged.
- [x] Run `npx vitest run packages/happy-server/sources/app/api/routes/v3SessionRoutes.test.ts`.

### Task 3: Settings UI and translations

**Files:**
- Modify: `packages/happy-app/sources/app/(app)/settings/notifications-feishu.tsx`
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/*.ts`

- [x] Add a second settings card titled collaboration @ notification.
- [x] Add independent URL, secret, enabled switch, save dirty state, and test action.
- [x] Keep the existing webhook UI behavior unchanged.
- [x] Add translation keys across all existing locale files.
- [x] Run `cd packages/happy-app && yarn typecheck`.

### Task 4: Final verification

**Files:**
- Modified package set from previous tasks.

- [x] Run server route tests.
- [x] Run `cd packages/happy-server && yarn build`.
- [x] Run `cd packages/happy-app && yarn typecheck`.
- [x] Run `cd packages/happy-wire && yarn typecheck` if wire has a package script.
- [x] Review `git diff --check` and final diff for minimal scope.
