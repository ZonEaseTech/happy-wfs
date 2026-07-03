# Company Core Management Design

Date: 2026-07-03
Status: Draft for user review
Scope: Happy instance-level company foundation and Core management console

## Summary

Happy currently uses a personal account model with friends, direct session sharing, and account-owned sessions/machines. This design adds an instance-level company identity layer without immediately rewriting all existing business records to be tenant-scoped.

The first version introduces:

- A single default company for the Happy instance.
- Company membership for all existing accounts.
- Three roles: `owner`, `admin`, and `member`.
- Invite links created and copied by company admins/owners.
- A Core company management console for company profile, members, and invites.

This design intentionally does not include SSO, billing, audit logs, domain auto-join, or company-wide machine/session ownership changes.

## Confirmed Decisions

| Area | Decision |
| --- | --- |
| Tenant model | Instance-level company |
| Join flow | Admin-created invite links |
| Roles | `owner`, `admin`, `member` |
| Existing user migration | Add all existing accounts to the default company |
| Implementation strategy | Sidecar company identity layer |
| Management UI scope | Core management only |
| Invite delivery | Copy invite link |
| Explicit non-goals | Audit log, SSO, billing, company machine pool |

## Current State

The existing system already has useful building blocks:

- `Account` is the primary identity model.
- `UserRelationship` supports friend/requested/pending relationships.
- `/v1/friends` and `/v1/user/search` support social discovery.
- `SessionShare` supports per-session sharing with access levels.
- `SessionMessage.sentBy` and `sentByName` support collaborative message attribution.
- The app has settings pages under `packages/happy-app/sources/app/(app)/settings/`.
- The app has reusable list components such as `ItemList`, `ItemGroup`, and user profile cards.

The system does not yet have:

- Company/organization records.
- Membership or role records.
- Company invites.
- Tenant-wide membership search.
- Company management settings pages.

## Goals

1. Establish a company identity layer for the current Happy instance.
2. Preserve all existing account/session/machine/share behavior.
3. Add a Core management console for company profile, members, and invites.
4. Provide a clean data source for future `@ People` mentions.
5. Keep the first implementation small enough to verify safely.

## Non-Goals

This design does not include:

- Multi-company SaaS support.
- Company-scoped `Session`, `Machine`, `Memory`, `AccessKey`, `UserKVStore`, `PortProxy`, or `OrchestratorRun` ownership changes.
- SSO, SAML, OIDC, or email-domain auto-join.
- Email delivery for invites.
- Billing, usage plans, or company subscriptions.
- Audit logs.
- Guest/external collaborator roles.
- Company-wide machine pools or default session sharing policies.

## Data Model

### `Company`

Represents the single company for this Happy instance.

Suggested fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Primary key, cuid |
| `name` | string | Display name |
| `slug` | string | Stable readable identifier; unique |
| `createdAt` | DateTime | Created timestamp |
| `updatedAt` | DateTime | Updated timestamp |

### `CompanyRole`

Suggested enum:

- `owner`
- `admin`
- `member`

### `CompanyMembership`

Connects an `Account` to the instance company.

Suggested fields:

| Field | Type | Notes |
| --- | --- | --- |
| `companyId` | string | FK to `Company` |
| `accountId` | string | FK to `Account` |
| `role` | `CompanyRole` | `owner`, `admin`, or `member` |
| `createdAt` | DateTime | Creation timestamp |
| `updatedAt` | DateTime | Updated timestamp |
| `joinedAt` | DateTime | When the account became active in the company |

Suggested constraints:

- Unique membership per `(companyId, accountId)`.
- Index by `(companyId, role)`.
- Index by `accountId`.

### `CompanyInvite`

Represents a copyable invite link.

Suggested fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Primary key, cuid |
| `companyId` | string | FK to `Company` |
| `tokenHash` | bytes/string | Store only a hash, never the raw token |
| `role` | `CompanyRole` | Default `member`; first version should generally create member invites |
| `createdByUserId` | string | FK to `Account` |
| `expiresAt` | DateTime nullable | Default 7 days |
| `maxUses` | int nullable | Optional use limit |
| `useCount` | int | Defaults to 0 |
| `revokedAt` | DateTime nullable | Set when invite is revoked |
| `createdAt` | DateTime | Created timestamp |
| `updatedAt` | DateTime | Updated timestamp |

Security notes:

- Raw invite tokens are only returned once at creation time.
- Database stores a token hash.
- Accept flow hashes the provided token and looks up the invite by hash.

## Bootstrap and Migration

### Default Company Creation

During migration or startup bootstrap:

1. Create the default company if it does not exist.
2. Use a configurable name such as `Happy Company` unless a deploy-specific value is provided.
3. Use a stable slug such as `default` unless configured otherwise.

### Existing Account Membership

All existing accounts should be added to the default company as `member` unless they already have a membership.

### Owner Selection

Owner selection order:

1. Explicit configured owner account id or username, if provided.
2. Earliest created account as fallback.

At least one owner must exist after migration.

The migration or bootstrap log should report the selected owner in a non-sensitive way.

## Role and Permission Rules

### Owner

Owners can:

- View company profile.
- Edit company profile.
- View members.
- Create, view, and revoke invites.
- Promote/demote admins and members.
- Add another owner.
- Remove members and admins.

Owners cannot:

- Remove or demote the last remaining owner.

### Admin

Admins can:

- View company profile.
- Edit basic company profile fields if allowed by product copy.
- View members.
- Create, view, and revoke member invites.
- Remove members.

Admins cannot:

- Promote users to owner/admin.
- Demote owners/admins.
- Remove owners/admins.
- Remove or demote the last owner.

### Member

Members can:

- View company profile.
- View company members.
- Appear in future `@ People` suggestions.

Members cannot:

- Create invites.
- Revoke invites.
- Change roles.
- Remove members.

## API Design

All company management APIs require authentication.

### `GET /v1/company`

Returns:

- Default company profile.
- Current user's membership and role.
- Basic capability flags for UI rendering.

Minimum role: `member`.

### `PATCH /v1/company`

Updates basic company profile fields such as name and slug.

Minimum role: `owner` or `admin`, depending on final product policy.

### `GET /v1/company/members`

Returns company members.

Minimum role: `member`.

Suggested query params:

- `query` for username/name search.
- `limit` and cursor/pagination if needed.

### `PATCH /v1/company/members/:accountId`

Updates a member role or removes/deactivates a member.

Minimum role:

- `admin` for managing `member` users only.
- `owner` for managing `admin` and `owner` roles.

Required backend protections:

- Reject demoting/removing the last owner.
- Reject admin attempts to modify owner/admin records.
- Reject member attempts to modify any membership.

### `POST /v1/company/invites`

Creates an invite link.

Minimum role: `owner` or `admin`.

Default behavior:

- Role defaults to `member`.
- Expiration defaults to 7 days.
- Optional `maxUses` may be supported.

Returns:

- Invite metadata.
- Raw invite URL once.

### `GET /v1/company/invites`

Lists company invites.

Minimum role: `owner` or `admin`.

Should include:

- Role.
- Expiration.
- Use count.
- Revoked status.
- Creator display info.

Should not include raw tokens.

### `DELETE /v1/company/invites/:id`

Revokes an invite.

Minimum role: `owner` or `admin`.

Implementation should set `revokedAt` rather than hard-deleting the record.

### `POST /v1/company/invites/accept`

Accepts an invite token for the authenticated account.

Rules:

- Reject unknown token.
- Reject expired token.
- Reject revoked token.
- Reject token beyond `maxUses`.
- If already a member, return success with current membership and do not increment use count unnecessarily.
- Otherwise create or restore membership with the invite role and increment use count atomically.

## Frontend Design

### Navigation

Add a Company entry under Settings.

Suggested routes:

- `/settings/company`
- `/settings/company/members`
- `/settings/company/invites`
- `/company/join/[token]`

### Company Profile Page

Shows:

- Company name.
- Slug/identifier.
- Current user's role.
- Owner/admin editing controls when allowed.

Members see a read-only page.

### Members Page

Shows:

- Member list.
- Search/filter input.
- Avatar/display name/username.
- Role badges.
- Role action menu for allowed users.
- Remove member action where allowed.

Behavior:

- Members get read-only view.
- Admins can manage members.
- Owners can manage admins, members, and owner additions.
- Last-owner protections should be reflected in UI and enforced by API.

### Invites Page

Shows:

- Active and historical invites.
- Create invite button for owner/admin.
- Copy link action for newly created invite.
- Revoke action for active invites.
- Expiration and use count.

First version uses copy links only. It does not send emails.

### Invite Accept Page

Route: `/company/join/[token]`

States:

- Not logged in: prompt user to log in, then continue accepting invite.
- Logged in and valid token: show company and role, allow accept.
- Already member: show already joined state.
- Expired/revoked/invalid token: show non-destructive error.

## Relationship to Future `@ People`

This foundation should make future chat mentions straightforward:

- `@ People` suggestions can query company members.
- Existing friend suggestions can be merged with company members or replaced by company members.
- The first `@ People` version should not require strict tenant scoping of all sessions.

The existing `@` file mention behavior should be redesigned later as a mixed suggestion menu or with separate source labels.

## Testing Strategy

### Backend Tests

Cover:

- Default company creation.
- Existing accounts added to default company.
- Owner selection by configured owner and fallback owner.
- Role-based access checks.
- Invite creation.
- Invite acceptance.
- Expired invite rejection.
- Revoked invite rejection.
- Max-use invite rejection.
- Already-member invite acceptance idempotency.
- Last-owner demotion/removal protection.

### Frontend Tests

Cover:

- Company settings entry renders.
- Company page renders editable controls based on role.
- Members page renders member list and role badges.
- Role menu only shows allowed actions.
- Invite page can create and display copyable invite link.
- Invite page can revoke invite.
- Join page handles logged-out, valid, already-member, invalid, expired, and revoked states.

### Verification Commands

For modified packages:

- `packages/happy-server`: `yarn build`
- `packages/happy-app`: `yarn typecheck`
- Focused Vitest tests with `npx vitest run path/to/file.test.ts`

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Wrong owner selected during migration | Support explicit owner config and log selected owner |
| Invite link leakage | Store token hash only, default expiration, support revocation and max uses |
| Permission bypass | Enforce all role rules on the backend, not just UI |
| Breaking existing personal data flows | Keep company layer sidecar for v1; do not change session/machine/share ownership queries |
| Scope creep into enterprise features | Keep audit, SSO, billing, and company machine pool out of v1 |

## Implementation Order

1. Add Prisma models and migration.
2. Add bootstrap/migration logic for the default company and memberships.
3. Add backend company service helpers and role guards.
4. Add company API routes and backend tests.
5. Add app API client types/functions.
6. Add Settings company entry and Core management pages.
7. Add invite accept page.
8. Add frontend tests.
9. Run focused verification for server and app.

## Acceptance Criteria

The feature is ready when:

- A default company exists after migration/bootstrap.
- Every existing account has a company membership.
- At least one owner exists.
- Owner/admin can create and copy invite links.
- Valid invite links allow authenticated users to join the company.
- Expired, revoked, or overused invites are rejected.
- Members can view company members but cannot manage roles or invites.
- Owner/admin role protections work, including last-owner protection.
- Existing sessions, friends, shares, and machines continue to work as before.
