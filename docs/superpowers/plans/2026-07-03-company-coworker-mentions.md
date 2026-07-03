# Company Coworker Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This workspace is intentionally uncommitted; do not commit, push, or deploy until the user reviews.

**Goal:** Let Happy chat collaboration mentions resolve and share to company coworkers as well as friends, including unique display-name mentions such as `@7c00`.

**Architecture:** Keep the existing human-only collaboration message path. Extend the app mention candidate model from friends-only to people candidates (friends + company members), fetch full profiles only at send time for non-friend coworkers so encryption keys remain sourced from the existing user profile API, and extend server direct-share eligibility from friends-only to friends-or-same-company. Stop default company bootstrap from re-adding every account after production cleanup.

**Tech Stack:** React Native/Expo app, Vitest, Fastify server, Prisma-backed access-control helpers.

---

### Task 1: Mention parsing and autocomplete tests

**Files:**
- Modify: `packages/happy-app/sources/utils/chatFriendMentions.test.ts`
- Modify: `packages/happy-app/sources/components/autocomplete/suggestions.test.ts`

- [ ] Add tests showing `@qiuxiang` resolves by username from mixed people candidates.
- [ ] Add tests showing `@7c00` resolves only when the display name is unique.
- [ ] Add tests showing duplicate display-name aliases are treated as plain text.
- [ ] Add autocomplete tests showing company coworkers are returned alongside friends and files, and their insert text is `@username`.
- [ ] Run `cd packages/happy-app && npx vitest run sources/utils/chatFriendMentions.test.ts sources/components/autocomplete/suggestions.test.ts`; expected RED before implementation.

### Task 2: App mention candidate implementation

**Files:**
- Modify: `packages/happy-app/sources/utils/chatFriendMentions.ts`
- Modify: `packages/happy-app/sources/components/autocomplete/suggestions.ts`
- Modify: `packages/happy-app/sources/components/AgentInputSuggestionView.tsx`
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/*.ts` for the coworker label

- [ ] Introduce a narrow `MentionableUser` type with id, username, firstName, lastName, avatar.
- [ ] Resolve mentions by username first, then by exact unique display name.
- [ ] Keep file/email mention guards unchanged.
- [ ] Add coworker autocomplete suggestions after friends and before files.
- [ ] Add translated coworker label.
- [ ] Re-run focused app mention tests; expected GREEN.

### Task 3: App send path for coworker targets

**Files:**
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`

- [ ] Load company members when sharing is manageable.
- [ ] Merge accepted friends + company member profiles as mention candidates, excluding self and deduping by id.
- [ ] Before sharing, fetch full `UserProfile`s for mentioned coworkers that are not already accepted friends via `getUserProfiles`.
- [ ] Preserve the existing human-only collaboration flow: valid people mentions do not call AI, send confirmation first, best-effort share, then save collaboration message.
- [ ] Run app focused tests and `cd packages/happy-app && yarn typecheck`.

### Task 4: Server share access-control and bootstrap safety

**Files:**
- Create: `packages/happy-server/sources/app/share/accessControl.test.ts`
- Modify: `packages/happy-server/sources/app/share/accessControl.ts`
- Modify: `packages/happy-server/sources/app/api/routes/shareRoutes.ts`
- Modify: `packages/happy-server/sources/app/company/companyService.test.ts`
- Modify: `packages/happy-server/sources/app/company/companyBootstrap.ts`

- [ ] Add tests for friend sharing, same-company coworker sharing, unrelated-user rejection.
- [ ] Add a bootstrap test showing `ensureDefaultCompanyMemberships` does not upsert all accounts and only creates/promotes the selected owner when needed.
- [ ] Implement `canDirectShareWithUser` (friends OR shared company membership) and use it in share routes.
- [ ] Update error text to mention friends or company members.
- [ ] Change default company bootstrap to stop auto-adding all accounts; when no owner exists, upsert only the selected owner.
- [ ] Run `cd packages/happy-server && npx vitest run sources/app/share/accessControl.test.ts sources/app/company/companyService.test.ts` and `cd packages/happy-server && yarn build`.

### Task 5: Final verification

- [ ] Run app focused tests.
- [ ] Run server focused tests.
- [ ] Run `cd packages/happy-app && yarn typecheck`.
- [ ] Run `cd packages/happy-server && yarn build`.
- [ ] Run `git diff --check`.
- [ ] Report exact verification outputs and changed files; do not commit.
