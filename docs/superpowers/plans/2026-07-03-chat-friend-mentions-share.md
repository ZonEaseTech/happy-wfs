# Chat Friend Mentions Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can type or select `@username` in the session chat input, confirm sharing, and then share the current session with mentioned friends using `edit` access before sending the message.

**Architecture:** Extend the existing `@` autocomplete to return friend suggestions before file suggestions, then add a send-time guard in `SessionView` that resolves mentioned friends, confirms new shares, creates direct shares through the existing sharing API, and only then sends the message. Keep the first implementation frontend-only and reuse existing session-share crypto/API paths.

**Tech Stack:** React Native / Expo, TypeScript, Vitest, Zustand storage selectors, existing Happy direct-sharing APIs and encryption helpers.

**Commit policy:** Do not commit during implementation unless the user explicitly approves. This plan intentionally omits commit steps because the user asked to inspect before any submission.

---

## File Structure

- Modify: `packages/happy-app/sources/components/AgentInputSuggestionView.tsx`
  - Add a friend suggestion row UI that matches existing file suggestion rows.
- Modify: `packages/happy-app/sources/components/autocomplete/suggestions.ts`
  - Extend suggestion types and merge friend suggestions before file suggestions for `@` queries.
- Create: `packages/happy-app/sources/utils/chatFriendMentions.ts`
  - Pure parsing/resolution helpers for `@username` text mentions.
- Create: `packages/happy-app/sources/utils/chatFriendMentions.test.ts`
  - Unit tests for mention parsing, dedupe, unknown users, and file mention avoidance.
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`
  - Load accepted friends, pass them to autocomplete, detect mentioned friends on send, confirm, share, and then send.
- Create: `packages/happy-app/sources/-session/sessionMentionSharing.ts`
  - Side-effect helper that verifies recipient keys, encrypts the session data key, creates `edit` shares, and returns user-facing errors.
- Create: `packages/happy-app/sources/-session/sessionMentionSharing.test.ts`
  - Unit tests for filtering already-shared friends and share request construction.
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/en.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hans.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hant.ts`
- Modify: `packages/happy-app/sources/text/translations/ja.ts`
- Modify: `packages/happy-app/sources/text/translations/es.ts`
- Modify: `packages/happy-app/sources/text/translations/pt.ts`
- Modify: `packages/happy-app/sources/text/translations/ru.ts`
- Modify: `packages/happy-app/sources/text/translations/it.ts`
- Modify: `packages/happy-app/sources/text/translations/pl.ts`
- Modify: `packages/happy-app/sources/text/translations/ca.ts`
  - Add localized strings for friend suggestion label and confirmation prompt.

---

## Task 1: Add pure mention parsing and friend resolution

**Files:**
- Create: `packages/happy-app/sources/utils/chatFriendMentions.ts`
- Create: `packages/happy-app/sources/utils/chatFriendMentions.test.ts`

- [ ] **Step 1: Write the failing parser tests**

Create `packages/happy-app/sources/utils/chatFriendMentions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { UserProfile } from '@/sync/friendTypes';
import {
    extractFriendMentionUsernames,
    resolveMentionedFriends,
} from './chatFriendMentions';

function friend(id: string, username: string): UserProfile {
    return {
        id,
        username,
        firstName: username,
        lastName: null,
        avatar: null,
        bio: null,
        status: 'friend',
        publicKey: `public-${id}`,
        contentPublicKey: `content-${id}`,
        contentPublicKeySig: `sig-${id}`,
    };
}

describe('chat friend mentions', () => {
    it('extracts unique usernames from plain chat text', () => {
        expect(extractFriendMentionUsernames('please ask @alice and @bob, cc @alice')).toEqual(['alice', 'bob']);
    });

    it('matches usernames case-insensitively while returning the canonical friend record', () => {
        const friends = [friend('u1', 'Alice'), friend('u2', 'bob')];
        expect(resolveMentionedFriends('ping @alice and @BOB', friends).map(item => item.id)).toEqual(['u1', 'u2']);
    });

    it('ignores file-style @ mentions so existing file autocomplete remains safe', () => {
        expect(extractFriendMentionUsernames('open @workspace/AGENTS.md and @src/App.tsx')).toEqual([]);
    });

    it('ignores emails and unknown usernames', () => {
        const friends = [friend('u1', 'alice')];
        expect(extractFriendMentionUsernames('email a@b.com and ping @missing')).toEqual(['missing']);
        expect(resolveMentionedFriends('email a@b.com and ping @missing', friends)).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the parser test and verify it fails**

Run:

```bash
cd packages/happy-app && npx vitest run sources/utils/chatFriendMentions.test.ts
```

Expected: fail because `chatFriendMentions.ts` does not exist.

- [ ] **Step 3: Implement the pure parser**

Create `packages/happy-app/sources/utils/chatFriendMentions.ts`:

```ts
import type { UserProfile } from '@/sync/friendTypes';

// Keep the username grammar conservative. File mentions such as @src/App.tsx
// are ignored by requiring the next character after the username not to be '/'.
const FRIEND_MENTION_RE = /(^|[^A-Za-z0-9_./-])@([A-Za-z0-9][A-Za-z0-9_-]{0,38})(?![A-Za-z0-9_/-])/g;

export function extractFriendMentionUsernames(text: string): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const match of text.matchAll(FRIEND_MENTION_RE)) {
        const username = match[2];
        if (!username) continue;
        const key = username.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(username);
    }
    return result;
}

export function resolveMentionedFriends(text: string, friends: UserProfile[]): UserProfile[] {
    const byUsername = new Map<string, UserProfile>();
    for (const friend of friends) {
        byUsername.set(friend.username.toLowerCase(), friend);
    }
    return extractFriendMentionUsernames(text)
        .map(username => byUsername.get(username.toLowerCase()))
        .filter((item): item is UserProfile => !!item);
}
```

- [ ] **Step 4: Run the parser test and verify it passes**

Run:

```bash
cd packages/happy-app && npx vitest run sources/utils/chatFriendMentions.test.ts
```

Expected: pass.

---

## Task 2: Add friend autocomplete suggestions before file suggestions

**Files:**
- Modify: `packages/happy-app/sources/components/AgentInputSuggestionView.tsx`
- Modify: `packages/happy-app/sources/components/autocomplete/suggestions.ts`

- [ ] **Step 1: Add a failing suggestion test**

Create or extend `packages/happy-app/sources/components/autocomplete/suggestions.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@/sync/friendTypes';
import { getFriendMentionSuggestions } from './suggestions';

function friend(id: string, username: string, firstName = username): UserProfile {
    return {
        id,
        username,
        firstName,
        lastName: null,
        avatar: null,
        bio: null,
        status: 'friend',
        publicKey: `public-${id}`,
        contentPublicKey: `content-${id}`,
        contentPublicKeySig: `sig-${id}`,
    };
}

describe('friend mention suggestions', () => {
    it('returns matching friends in canonical @username insert format', async () => {
        const suggestions = await getFriendMentionSuggestions('@al', [
            friend('u1', 'alice', 'Alice'),
            friend('u2', 'bob', 'Bob'),
        ]);

        expect(suggestions.map(item => ({ key: item.key, text: item.text }))).toEqual([
            { key: 'friend-u1', text: '@alice' },
        ]);
    });

    it('limits friend suggestions before they are merged with file suggestions', async () => {
        const friends = Array.from({ length: 10 }, (_, index) => friend(`u${index}`, `alice${index}`));
        const suggestions = await getFriendMentionSuggestions('@alice', friends);
        expect(suggestions).toHaveLength(5);
    });
});
```

- [ ] **Step 2: Run the suggestion test and verify it fails**

Run:

```bash
cd packages/happy-app && npx vitest run sources/components/autocomplete/suggestions.test.ts
```

Expected: fail because `getFriendMentionSuggestions` does not exist.

- [ ] **Step 3: Add friend suggestion UI**

Modify `packages/happy-app/sources/components/AgentInputSuggestionView.tsx` by adding this component above `FileMentionSuggestion`:

```tsx
interface FriendMentionProps {
    displayName: string;
    username: string;
    avatarUrl?: string | null;
    thumbhash?: string | null;
}

export const FriendMentionSuggestion = React.memo(({ displayName, username }: FriendMentionProps) => {
    return (
        <View style={styles.suggestionContainer}>
            <View style={styles.iconContainer}>
                <Ionicons name="person" size={18} color={styles.iconColor.color} />
            </View>
            <View style={{ flex: 1 }}>
                <Text style={styles.fileNameText} numberOfLines={1}>{displayName}</Text>
                <Text style={styles.descriptionText} numberOfLines={1}>@{username}</Text>
            </View>
            <Text style={styles.labelText}>{t('agentInput.suggestion.friendLabel')}</Text>
        </View>
    );
});
```

- [ ] **Step 4: Extend suggestion types and friend matching**

Modify `packages/happy-app/sources/components/autocomplete/suggestions.ts`:

```ts
import { CommandSuggestion, FileMentionSuggestion, FriendMentionSuggestion } from '@/components/AgentInputSuggestionView';
import type { UserProfile } from '@/sync/friendTypes';
import { getDisplayName } from '@/sync/friendTypes';
```

Add a shared type:

```ts
export type AgentInputSuggestion = {
    key: string;
    text: string;
    component: React.ComponentType;
};
```

Change existing return type annotations to `Promise<AgentInputSuggestion[]>`.

Add this function before `getFileMentionSuggestions`:

```ts
export async function getFriendMentionSuggestions(query: string, friends: UserProfile[]): Promise<AgentInputSuggestion[]> {
    const searchTerm = query.slice(1).trim().toLowerCase();
    const matches = friends
        .filter(friend => {
            if (!searchTerm) return true;
            const displayName = getDisplayName(friend).toLowerCase();
            const username = friend.username.toLowerCase();
            return username.includes(searchTerm) || displayName.includes(searchTerm);
        })
        .slice(0, 5);

    return matches.map(friend => ({
        key: `friend-${friend.id}`,
        text: `@${friend.username}`,
        component: () => React.createElement(FriendMentionSuggestion, {
            displayName: getDisplayName(friend),
            username: friend.username,
            avatarUrl: friend.avatar?.url || friend.avatar?.path || null,
            thumbhash: friend.avatar?.thumbhash || null,
        }),
    }));
}
```

Update `getSuggestions` signature and `@` branch:

```ts
export async function getSuggestions(
    sessionId: string,
    query: string,
    options: { friends?: UserProfile[]; includeFriends?: boolean } = {},
): Promise<AgentInputSuggestion[]> {
    if (!query || query.length === 0) return [];

    if (query.startsWith('/')) return getCommandSuggestions(sessionId, query);
    if (query.startsWith('$')) return getCommandSuggestions(sessionId, query, 'skill');

    if (query.startsWith('@')) {
        const [friendSuggestions, fileSuggestions] = await Promise.all([
            options.includeFriends === false ? Promise.resolve([]) : getFriendMentionSuggestions(query, options.friends ?? []),
            getFileMentionSuggestions(sessionId, query),
        ]);
        return [...friendSuggestions, ...fileSuggestions];
    }

    return [];
}
```

- [ ] **Step 5: Run the suggestion test and verify it passes**

Run:

```bash
cd packages/happy-app && npx vitest run sources/components/autocomplete/suggestions.test.ts
```

Expected: pass.

---

## Task 3: Add localized strings

**Files:**
- Modify all files listed in the File Structure text translation section.

- [ ] **Step 1: Add translation keys to `_default.ts` and locale files**

Add these keys under the existing `agentInput.suggestion` object:

```ts
friendLabel: 'Friend',
```

Add these keys under the existing `session.sharing` object:

```ts
mentionShareConfirmTitle: 'Share current session?',
mentionShareConfirmMessage: 'This message mentions {names}. Share the current session with them using edit access before sending?',
mentionShareConfirmAction: 'Share and send',
mentionShareFailed: 'Failed to share the session. The message was not sent.',
```

Use these locale values:

- `en.ts` and `_default.ts`: same English strings above.
- `zh-Hans.ts`:

```ts
friendLabel: '好友',
mentionShareConfirmTitle: '共享当前会话？',
mentionShareConfirmMessage: '这条消息提到了 {names}。发送前要以可发消息权限把当前会话共享给他们吗？',
mentionShareConfirmAction: '共享并发送',
mentionShareFailed: '共享会话失败，消息未发送。',
```

- `zh-Hant.ts`:

```ts
friendLabel: '好友',
mentionShareConfirmTitle: '共享目前會話？',
mentionShareConfirmMessage: '這則訊息提到了 {names}。傳送前要以可傳送訊息權限將目前會話共享給他們嗎？',
mentionShareConfirmAction: '共享並傳送',
mentionShareFailed: '共享會話失敗，訊息未傳送。',
```

For `ja.ts`, `es.ts`, `pt.ts`, `ru.ts`, `it.ts`, `pl.ts`, and `ca.ts`, use English fallback strings if a precise translation is not available.

- [ ] **Step 2: Run a targeted typecheck after text changes**

Run:

```bash
cd packages/happy-app && yarn typecheck
```

Expected: pass. If generated translation types fail, inspect `packages/happy-app/sources/text/README.md` and follow the existing project workflow for translation type updates.

---

## Task 4: Add share-planning and direct-share helper

**Files:**
- Create: `packages/happy-app/sources/-session/sessionMentionSharing.ts`
- Create: `packages/happy-app/sources/-session/sessionMentionSharing.test.ts`

- [ ] **Step 1: Write failing share-planning tests**

Create `packages/happy-app/sources/-session/sessionMentionSharing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SessionShare } from '@/sync/sharingTypes';
import type { UserProfile } from '@/sync/friendTypes';
import { getMentionShareTargets } from './sessionMentionSharing';

function friend(id: string, username: string): UserProfile {
    return {
        id,
        username,
        firstName: username,
        lastName: null,
        avatar: null,
        bio: null,
        status: 'friend',
        publicKey: `public-${id}`,
        contentPublicKey: `content-${id}`,
        contentPublicKeySig: `sig-${id}`,
    };
}

function share(userId: string): SessionShare {
    return {
        id: `share-${userId}`,
        sessionId: 'session-1',
        sharedWithUser: {
            id: userId,
            username: userId,
            firstName: userId,
            lastName: null,
            avatar: null,
        },
        accessLevel: 'edit',
        createdAt: 1,
        updatedAt: 1,
    };
}

describe('session mention sharing', () => {
    it('filters already shared mentioned friends', () => {
        const alice = friend('u1', 'alice');
        const bob = friend('u2', 'bob');
        const targets = getMentionShareTargets([alice, bob], [share('u1')]);
        expect(targets.map(item => item.id)).toEqual(['u2']);
    });

    it('dedupes mentioned friends by id', () => {
        const alice = friend('u1', 'alice');
        const targets = getMentionShareTargets([alice, alice], []);
        expect(targets.map(item => item.id)).toEqual(['u1']);
    });
});
```

- [ ] **Step 2: Run the share helper test and verify it fails**

Run:

```bash
cd packages/happy-app && npx vitest run sources/-session/sessionMentionSharing.test.ts
```

Expected: fail because `sessionMentionSharing.ts` does not exist.

- [ ] **Step 3: Implement share target filtering and share creation helper**

Create `packages/happy-app/sources/-session/sessionMentionSharing.ts`:

```ts
import { t } from '@/text';
import { HappyError } from '@/utils/errors';
import type { UserProfile } from '@/sync/friendTypes';
import type { SessionShare } from '@/sync/sharingTypes';
import { createSessionShare } from '@/sync/apiSharing';
import { encryptDataKeyForRecipientV0, verifyRecipientContentPublicKeyBinding } from '@/sync/directShareEncryption';
import { sync } from '@/sync/sync';

export function getMentionShareTargets(mentionedFriends: UserProfile[], existingShares: SessionShare[]): UserProfile[] {
    const alreadyShared = new Set(existingShares.map(share => share.sharedWithUser.id));
    const seen = new Set<string>();
    const targets: UserProfile[] = [];
    for (const friend of mentionedFriends) {
        if (alreadyShared.has(friend.id)) continue;
        if (seen.has(friend.id)) continue;
        seen.add(friend.id);
        targets.push(friend);
    }
    return targets;
}

export async function shareSessionWithMentionedFriends(sessionId: string, targets: UserProfile[]): Promise<void> {
    if (targets.length === 0) return;

    const credentials = sync.getCredentials();
    const dataKey = sync.getSessionDataKey(sessionId);
    if (!dataKey) {
        throw new HappyError(t('errors.sessionNotFound'), false);
    }

    for (const friend of targets) {
        if (!friend.contentPublicKey || !friend.contentPublicKeySig) {
            throw new HappyError(t('session.sharing.recipientMissingKeys'), false);
        }
        const isValidBinding = verifyRecipientContentPublicKeyBinding({
            signingPublicKeyHex: friend.publicKey,
            contentPublicKeyB64: friend.contentPublicKey,
            contentPublicKeySigB64: friend.contentPublicKeySig,
        });
        if (!isValidBinding) {
            throw new HappyError(t('errors.operationFailed'), false);
        }

        const encryptedDataKey = encryptDataKeyForRecipientV0(dataKey, friend.contentPublicKey);
        await createSessionShare(credentials, sessionId, {
            userId: friend.id,
            accessLevel: 'edit',
            encryptedDataKey,
        });
    }
}
```

- [ ] **Step 4: Run the share helper test and verify it passes**

Run:

```bash
cd packages/happy-app && npx vitest run sources/-session/sessionMentionSharing.test.ts
```

Expected: pass.

---

## Task 5: Wire autocomplete and send-time confirmation into SessionView

**Files:**
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`

- [ ] **Step 1: Import dependencies**

Add imports near existing imports:

```ts
import { useAcceptedFriends } from '@/sync/storage';
import { getSessionShares } from '@/sync/apiSharing';
import { getDisplayName } from '@/sync/friendTypes';
import { resolveMentionedFriends } from '@/utils/chatFriendMentions';
import { getMentionShareTargets, shareSessionWithMentionedFriends } from './sessionMentionSharing';
```

If `useAcceptedFriends` is already available from the grouped storage import, add it to that import instead of creating a duplicate import.

- [ ] **Step 2: Add accepted friends and share permission guard**

Inside `SessionViewLoaded`, near other session-derived values, add:

```ts
const acceptedFriends = useAcceptedFriends();
const canManageSharing = !session.accessLevel || session.accessLevel === 'admin';
```

- [ ] **Step 3: Pass friends into autocomplete**

Replace the existing autocomplete prop:

```tsx
autocompleteSuggestions={(query) => getSuggestions(sessionId, query)}
```

with:

```tsx
autocompleteSuggestions={(query) => getSuggestions(sessionId, query, {
    friends: acceptedFriends,
    includeFriends: canManageSharing,
})}
```

- [ ] **Step 4: Add send-time share confirmation helper**

Inside `SessionViewLoaded`, before the `agentInput` declaration, add:

```ts
const confirmAndShareMentionedFriends = React.useCallback(async (messageText: string): Promise<boolean> => {
    if (!canManageSharing) return true;

    const mentionedFriends = resolveMentionedFriends(messageText, acceptedFriends);
    if (mentionedFriends.length === 0) return true;

    const credentials = sync.getCredentials();
    const existingShares = await getSessionShares(credentials, sessionId).catch(() => []);
    const targets = getMentionShareTargets(mentionedFriends, existingShares);
    if (targets.length === 0) return true;

    const names = targets.map(getDisplayName).join(', ');
    const confirmed = await Modal.confirm(
        t('session.sharing.mentionShareConfirmTitle'),
        t('session.sharing.mentionShareConfirmMessage', { names }),
        {
            confirmText: t('session.sharing.mentionShareConfirmAction'),
            cancelText: t('common.cancel'),
        },
    );
    if (!confirmed) return false;

    try {
        await shareSessionWithMentionedFriends(sessionId, targets);
        return true;
    } catch (error) {
        const message = error instanceof HappyError ? error.message : t('session.sharing.mentionShareFailed');
        Modal.alert(t('common.error'), message);
        return false;
    }
}, [acceptedFriends, canManageSharing, sessionId]);
```

- [ ] **Step 5: Gate the existing send flow**

Inside the `onSend` handler, after `/duplicate` handling and before preparing attachments, add:

```ts
const mentionSharingReady = await confirmAndShareMentionedFriends(messageToSend);
if (!mentionSharingReady) {
    return;
}
```

This placement ensures that cancellation or sharing failure leaves the draft text and attachments intact.

- [ ] **Step 6: Run focused typecheck**

Run:

```bash
cd packages/happy-app && yarn typecheck
```

Expected: pass.

---

## Task 6: Add a focused source-level send guard test if practical

**Files:**
- Create or modify: `packages/happy-app/sources/-session/sessionMentionSharing.integration.test.ts`

- [ ] **Step 1: Add a test for target planning and cancellation semantics at helper level**

If mounting `SessionView` is too expensive, add this helper-level test instead of a component mount:

```ts
import { describe, expect, it } from 'vitest';
import type { UserProfile } from '@/sync/friendTypes';
import { resolveMentionedFriends } from '@/utils/chatFriendMentions';
import { getMentionShareTargets } from './sessionMentionSharing';

function friend(id: string, username: string): UserProfile {
    return {
        id,
        username,
        firstName: username,
        lastName: null,
        avatar: null,
        bio: null,
        status: 'friend',
        publicKey: `public-${id}`,
        contentPublicKey: `content-${id}`,
        contentPublicKeySig: `sig-${id}`,
    };
}

describe('mention share send guard inputs', () => {
    it('creates no share targets when a typed mention does not match an accepted friend', () => {
        const friends = [friend('u1', 'alice')];
        const mentioned = resolveMentionedFriends('hello @missing', friends);
        expect(getMentionShareTargets(mentioned, [])).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the focused tests**

Run:

```bash
cd packages/happy-app && npx vitest run sources/utils/chatFriendMentions.test.ts sources/components/autocomplete/suggestions.test.ts sources/-session/sessionMentionSharing.test.ts sources/-session/sessionMentionSharing.integration.test.ts
```

Expected: pass.

---

## Task 7: Full verification

**Files:**
- No new files.

- [ ] **Step 1: Run happy-app typecheck**

Run:

```bash
cd packages/happy-app && yarn typecheck
```

Expected: pass.

- [ ] **Step 2: Run focused Vitest suite**

Run:

```bash
cd packages/happy-app && npx vitest run sources/utils/chatFriendMentions.test.ts sources/components/autocomplete/suggestions.test.ts sources/-session/sessionMentionSharing.test.ts sources/-session/sessionMentionSharing.integration.test.ts
```

Expected: pass.

- [ ] **Step 3: Manual smoke test on web**

Run:

```bash
cd packages/happy-app && yarn web
```

Manual checks:

1. Open a session where the current user can manage sharing.
2. Type `@` and verify friends appear before files.
3. Select a friend and verify `@username` is inserted.
4. Send the message and verify the confirmation prompt appears.
5. Click Cancel and verify the message is not sent and the input remains intact.
6. Send again, confirm sharing, and verify the message sends.
7. Open session sharing management and verify the friend now has `edit` access.
8. Send another message mentioning the same friend and verify no confirmation appears.
9. Type an unknown `@notafriend` and verify it sends as plain text without a prompt.
10. Type a file mention such as `@workspace/AGENTS.md` and verify it does not trigger sharing.

---

## Self-Review

- Spec coverage: covered unified `@` panel, friend-first ordering, manual mention parsing, `edit` sharing, send-time confirmation, already-shared filtering, unknown/non-friend plain text behavior, and failure-not-send behavior.
- Placeholder scan: no TBD/TODO placeholders are present.
- Type consistency: shared types use existing `UserProfile`, `SessionShare`, and `ShareAccessLevel` values. New helper names are consistent across tasks.
- Scope check: this is a frontend-only MVP. Backend mention metadata, push notifications, and rich text chips remain explicitly out of scope.
