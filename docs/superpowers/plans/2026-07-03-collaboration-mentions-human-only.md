# Collaboration Mentions Human-Only Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make valid friend/coworker `@mentions` in chat behave as collaboration messages: share the session, notify mentioned people, save a human-visible message, and never trigger or enter AI context.

**Architecture:** Keep normal AI prompts on the existing `/v3/sessions/:id/send` path. Add a separate human-only mention path that stores encrypted user messages through `/v3/sessions/:id/messages` with explicit metadata and mention target IDs, so the server can create feed/push notifications without decrypting content. The UI renders those messages with a collaboration style, and CLI/MCP history compaction filters them from AI-facing summaries/context.

**Tech Stack:** React Native/Expo, TypeScript, Zod, Fastify, Prisma/PostgreSQL, Vitest, Expo push token storage, encrypted session messages.

---

## Confirmed Requirements

1. If a message contains at least one valid friend/coworker mention, it is a collaboration message and must not call AI.
2. Unknown `@xxx` mentions are plain text and follow the normal AI send path.
3. Multiple valid mentions share/notify all valid mentioned people.
4. The original text is saved as a human-authored message.
5. Collaboration messages are human-visible but excluded from future AI context/summaries.
6. The chat UI shows collaboration-message styling.
7. Partial share failures use best-effort semantics: save if at least one target is reachable, and show which targets failed.
8. Every valid `@mention` creates a notification/feed reminder, even if that person already has session access.
9. This plan does not clean production company members. That remains a separate destructive-data task.

---

## File Structure / Responsibilities

### Frontend app

- Modify: `packages/happy-app/sources/sync/typesMessageMeta.ts`
  - Add metadata schema for human-only collaboration messages.
- Modify: `packages/happy-app/sources/sync/typesMessage.ts`
  - No new message kind; keep `user-text` and use metadata.
- Modify: `packages/happy-app/sources/sync/typesRaw.ts`
  - Ensure metadata survives normalization.
- Modify: `packages/happy-app/sources/sync/sync.ts`
  - Add `sendCollaborationMentionMessage()` that stores a message through `/messages`, never `/send`.
- Modify: `packages/happy-app/sources/-session/sessionMentionSharing.ts`
  - Convert all-or-nothing sharing into per-target best-effort results.
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`
  - Branch valid mentions into the collaboration path before normal AI send.
- Modify: `packages/happy-app/sources/components/MessageView.tsx`
  - Render human-only mention messages with collaboration styling.
- Modify: `packages/happy-app/sources/sync/feedTypes.ts`
  - Add `session_mention` feed body schema.
- Modify: `packages/happy-app/sources/components/FeedItemCard.tsx`
  - Render mention feed cards and navigate to the session.
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/{en,zh-Hans,zh-Hant,ca,es,it,ja,pl,pt,ru}.ts`
  - Add user-facing text keys.
- Tests:
  - Modify: `packages/happy-app/sources/-session/sessionMentionSharing.test.ts`
  - Create: `packages/happy-app/sources/-session/collaborationMentionSend.test.ts`
  - Modify: `packages/happy-app/sources/components/MessageView` test coverage if existing harness is practical; otherwise add targeted render helper test.
  - Modify: `packages/happy-app/sources/sync/feedTypes` or existing feed tests if present.

### Backend server

- Modify: `packages/happy-server/sources/app/feed/types.ts`
  - Add `session_mention` feed body.
- Create: `packages/happy-server/sources/app/notifications/expoPush.ts`
  - Best-effort Expo push sender using existing `AccountPushToken` rows and `axios`.
- Create: `packages/happy-server/sources/app/session/sessionMentionNotification.ts`
  - Server-side feed + push notification service for mention targets.
- Modify: `packages/happy-server/sources/app/api/routes/v3SessionRoutes.ts`
  - Accept mention target IDs on `/v3/sessions/:sessionId/messages` and notify after new message creation.
- Tests:
  - Modify: `packages/happy-server/sources/app/api/routes/v3SessionRoutes.test.ts`
  - Create: `packages/happy-server/sources/app/session/sessionMentionNotification.test.ts`

### CLI / AI-facing tools

- Modify: `packages/happy-cli/src/mcp/messageDecrypt.ts`
  - Preserve message metadata after decrypting.
- Modify: `packages/happy-cli/src/mcp/tools/sessionSummary.ts`
  - Exclude human-only messages from compacted AI-facing summaries.
- Modify: `packages/happy-cli/src/mcp/tools/sessionSummary.test.ts`
  - Prove human-only messages are skipped.
- Modify: `packages/happy-cli/src/api/apiSession.ts`
  - Skip human-only messages in auto-review/review history helpers that build AI context.
- Optional modify: `packages/happy-cli/src/mcp/tools/sessionMessages.ts`
  - If this tool is used by AI agents, hide human-only messages by default and add an explicit `includeHumanOnly` flag.

---

## Metadata Contract

Use the existing `RawRecord.meta` envelope so no database migration is required.

```ts
// packages/happy-app/sources/sync/typesMessageMeta.ts
export const CollaborationMentionMetaSchema = z.object({
    kind: z.literal('mention'),
    targetUserIds: z.array(z.string()).default([]),
    targetUsernames: z.array(z.string()).default([]),
});

export const MessageMetaSchema = z.object({
    // existing fields...
    sentFrom: z.string().optional(),
    permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'read-only', 'safe-yolo', 'yolo']).optional(),
    model: z.string().nullable().optional(),
    reasoningEffort: z.string().nullable().optional(),
    fallbackModel: z.string().nullable().optional(),
    customSystemPrompt: z.string().nullable().optional(),
    appendSystemPrompt: z.string().nullable().optional(),
    allowedTools: z.array(z.string()).nullable().optional(),
    disallowedTools: z.array(z.string()).nullable().optional(),
    displayText: z.string().optional(),

    // new fields
    humanOnly: z.boolean().optional(),
    skipAiContext: z.boolean().optional(),
    collaboration: CollaborationMentionMetaSchema.optional(),
});
```

Human-only mention messages must be created with:

```ts
meta: {
    sentFrom,
    displayText: text,
    humanOnly: true,
    skipAiContext: true,
    collaboration: {
        kind: 'mention',
        targetUserIds: targets.map(target => target.id),
        targetUsernames: targets.map(target => target.username),
    },
}
```

---

## Task 1: Message Metadata and Type Tests

**Files:**
- Modify: `packages/happy-app/sources/sync/typesMessageMeta.ts`
- Modify: `packages/happy-app/sources/sync/typesRaw.ts`
- Test: `packages/happy-app/sources/sync/typesRaw.spec.ts` or `packages/happy-app/sources/sync/typesRaw.sessionProtocol.test.ts`

- [ ] **Step 1: Write a failing metadata normalization test**

Add a test that normalizes a user raw record containing collaboration metadata and expects it on the resulting `user-text` message.

```ts
it('preserves human-only collaboration mention metadata on user text messages', () => {
    const raw = {
        role: 'user' as const,
        content: { type: 'text' as const, text: '@BenDaye please review' },
        meta: {
            displayText: '@BenDaye please review',
            humanOnly: true,
            skipAiContext: true,
            collaboration: {
                kind: 'mention' as const,
                targetUserIds: ['user-bendaye'],
                targetUsernames: ['BenDaye'],
            },
        },
    };

    const normalized = normalizeRawMessage('msg-1', 'local-1', 1000, raw);

    expect(normalized).toMatchObject({
        kind: 'user-text',
        text: '@BenDaye please review',
        meta: {
            humanOnly: true,
            skipAiContext: true,
            collaboration: {
                kind: 'mention',
                targetUserIds: ['user-bendaye'],
                targetUsernames: ['BenDaye'],
            },
        },
    });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd packages/happy-app && npx vitest run sources/sync/typesRaw.spec.ts --testNamePattern "human-only collaboration"
```

Expected: FAIL because `MessageMetaSchema` rejects/drops the new fields.

- [ ] **Step 3: Add the metadata schema**

Modify `typesMessageMeta.ts` with the metadata contract above.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
cd packages/happy-app && npx vitest run sources/sync/typesRaw.spec.ts --testNamePattern "human-only collaboration"
```

Expected: PASS.

---

## Task 2: Backend Mention Feed and Push Notification Service

**Files:**
- Modify: `packages/happy-server/sources/app/feed/types.ts`
- Create: `packages/happy-server/sources/app/notifications/expoPush.ts`
- Create: `packages/happy-server/sources/app/session/sessionMentionNotification.ts`
- Test: `packages/happy-server/sources/app/session/sessionMentionNotification.test.ts`

- [ ] **Step 1: Write failing tests for mention notifications**

Create `sessionMentionNotification.test.ts` with these behaviors:

```ts
it('creates one session_mention feed item per target with badge enabled', async () => {
    const tx = makeFakeTx();
    await notifySessionMentionRecipients(tx as never, {
        actorId: 'sender-1',
        actorName: 'wfs',
        sessionId: 'session-1',
        sessionTitle: 'Debug payment issue',
        messageLocalId: 'local-1',
        preview: '@BenDaye please review',
        targetUserIds: ['target-1', 'target-2'],
    });

    expect(feedPostMock).toHaveBeenCalledTimes(2);
    expect(feedPostMock).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ uid: 'target-1' }),
        {
            kind: 'session_mention',
            sessionId: 'session-1',
            actorId: 'sender-1',
            actorName: 'wfs',
            sessionTitle: 'Debug payment issue',
            preview: '@BenDaye please review',
        },
        'session-mention:session-1:local-1:target-1',
        true,
        { sessionId: 'session-1', actorId: 'sender-1' },
    );
});

it('deduplicates target IDs and never notifies the actor', async () => {
    await notifySessionMentionRecipients(tx as never, {
        actorId: 'sender-1',
        actorName: 'wfs',
        sessionId: 'session-1',
        sessionTitle: 'Debug payment issue',
        messageLocalId: 'local-2',
        preview: '@wfs @BenDaye',
        targetUserIds: ['sender-1', 'target-1', 'target-1'],
    });

    expect(feedPostMock).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd packages/happy-server && npx vitest run sources/app/session/sessionMentionNotification.test.ts
```

Expected: FAIL because the service and feed body kind do not exist.

- [ ] **Step 3: Add feed body schema**

Modify `packages/happy-server/sources/app/feed/types.ts`:

```ts
z.object({
    kind: z.literal('session_mention'),
    sessionId: z.string(),
    actorId: z.string(),
    actorName: z.string().nullable(),
    sessionTitle: z.string().nullable(),
    preview: z.string(),
}),
```

- [ ] **Step 4: Add best-effort Expo push sender**

Create `packages/happy-server/sources/app/notifications/expoPush.ts`:

```ts
import axios from 'axios';
import { db } from '@/storage/db';
import { warn } from '@/utils/log';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export async function sendExpoPushToUsers(input: {
    userIds: string[];
    title: string;
    body: string;
    data?: Record<string, unknown>;
}): Promise<void> {
    const userIds = Array.from(new Set(input.userIds));
    if (userIds.length === 0) return;

    try {
        const tokens = await db.accountPushToken.findMany({
            where: { accountId: { in: userIds } },
            select: { token: true },
        });
        if (tokens.length === 0) return;

        await axios.post(EXPO_PUSH_URL, tokens.map((row) => ({
            to: row.token,
            title: input.title,
            body: input.body,
            data: input.data ?? {},
        })), { timeout: 10_000 });
    } catch (err) {
        warn({ err }, 'expo push mention notification failed');
    }
}
```

Do not let push failure fail message sending.

- [ ] **Step 5: Add mention notification service**

Create `packages/happy-server/sources/app/session/sessionMentionNotification.ts`:

```ts
import { Context } from '@/context';
import { feedPost } from '@/app/feed/feedPost';
import { sendExpoPushToUsers } from '@/app/notifications/expoPush';
import type { Tx } from '@/storage/inTx';
import { afterTx } from '@/storage/inTx';

export async function notifySessionMentionRecipients(tx: Tx, input: {
    actorId: string;
    actorName: string | null;
    sessionId: string;
    sessionTitle: string | null;
    messageLocalId: string;
    preview: string;
    targetUserIds: string[];
}): Promise<void> {
    const targetUserIds = Array.from(new Set(input.targetUserIds)).filter(id => id !== input.actorId);
    if (targetUserIds.length === 0) return;

    for (const userId of targetUserIds) {
        await feedPost(
            tx,
            Context.create(userId),
            {
                kind: 'session_mention',
                sessionId: input.sessionId,
                actorId: input.actorId,
                actorName: input.actorName,
                sessionTitle: input.sessionTitle,
                preview: input.preview.slice(0, 240),
            },
            `session-mention:${input.sessionId}:${input.messageLocalId}:${userId}`,
            true,
            { sessionId: input.sessionId, actorId: input.actorId },
        );
    }

    afterTx(tx, async () => {
        await sendExpoPushToUsers({
            userIds: targetUserIds,
            title: input.actorName ? `${input.actorName} mentioned you` : 'You were mentioned',
            body: input.preview.slice(0, 160),
            data: { kind: 'session_mention', sessionId: input.sessionId },
        });
    });
}
```

- [ ] **Step 6: Run focused server tests**

Run:

```bash
cd packages/happy-server && npx vitest run sources/app/session/sessionMentionNotification.test.ts
```

Expected: PASS.

---

## Task 3: Extend `/v3/sessions/:id/messages` for Mention Notifications

**Files:**
- Modify: `packages/happy-server/sources/app/api/routes/v3SessionRoutes.ts`
- Test: `packages/happy-server/sources/app/api/routes/v3SessionRoutes.test.ts`

- [ ] **Step 1: Add failing route tests**

Add tests near existing `POST /v3/sessions/:sessionId/messages` cases:

```ts
it('stores a human-only mention message without dispatching /send and creates mention feed items', async () => {
    const res = await app.inject({
        method: 'POST',
        url: '/v3/sessions/session-1/messages',
        headers: authHeaders('sender-1'),
        payload: {
            messages: [{
                content: 'encrypted-human-only-content',
                localId: 'mention-local-1',
                trackCliDelivery: false,
                mentionTargetUserIds: ['target-1'],
            }],
        },
    });

    expect(res.statusCode).toBe(200);
    expect(state.messages).toContainEqual(expect.objectContaining({
        localId: 'mention-local-1',
    }));
    expect(feedPostMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ uid: 'target-1' }),
        expect.objectContaining({ kind: 'session_mention', sessionId: 'session-1' }),
        'session-mention:session-1:mention-local-1:target-1',
        true,
        expect.anything(),
    );
});

it('does not notify mention targets that cannot access the session', async () => {
    const res = await app.inject({
        method: 'POST',
        url: '/v3/sessions/session-1/messages',
        headers: authHeaders('sender-1'),
        payload: {
            messages: [{
                content: 'encrypted-human-only-content',
                localId: 'mention-local-2',
                mentionTargetUserIds: ['not-shared-user'],
            }],
        },
    });

    expect(res.statusCode).toBe(200);
    expect(feedPostMock).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ uid: 'not-shared-user' }),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
    );
});
```

- [ ] **Step 2: Run route tests and verify they fail**

Run:

```bash
cd packages/happy-server && npx vitest run sources/app/api/routes/v3SessionRoutes.test.ts --testNamePattern "mention"
```

Expected: FAIL because `mentionTargetUserIds` is not accepted and notification service is not called.

- [ ] **Step 3: Extend request schema**

Modify the message item schema:

```ts
const sendMessagesBodySchema = z.object({
    messages: z.array(z.object({
        content: z.string(),
        localId: z.string().min(1),
        trackCliDelivery: z.boolean().optional().default(false),
        mentionTargetUserIds: z.array(z.string()).max(20).optional().default([]),
    })).min(1).max(200),
});
```

- [ ] **Step 4: Validate accessible mention targets**

Add a helper in `v3SessionRoutes.ts`:

```ts
async function filterMentionTargetsWithSessionAccess(sessionId: string, targetUserIds: string[]): Promise<string[]> {
    const unique = Array.from(new Set(targetUserIds));
    if (unique.length === 0) return [];

    const accessible = await db.account.findMany({
        where: {
            id: { in: unique },
            OR: [
                { Session: { some: { id: sessionId } } },
                { sharedWithSessions: { some: { sessionId } } },
            ],
        },
        select: { id: true },
    });
    return accessible.map(row => row.id);
}
```

If Prisma relation naming differs, use the relation names from `schema.prisma`: `Session` and `sharedWithSessions` are already on `Account`.

- [ ] **Step 5: Notify only when a new message is created**

After `dispatchSessionMessage(...)` returns for a non-duplicate localId, call `notifySessionMentionRecipients` with filtered targets. The preview can be a generic encrypted-safe value because the server cannot decrypt the message body:

```ts
const mentionTargetUserIds = await filterMentionTargetsWithSessionAccess(sessionId, message.mentionTargetUserIds ?? []);
if (mentionTargetUserIds.length > 0) {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        select: { tag: true },
    });
    await db.$transaction(async (tx) => {
        await notifySessionMentionRecipients(tx, {
            actorId: userId,
            actorName: sentByName,
            sessionId,
            sessionTitle: session?.tag ?? null,
            messageLocalId: message.localId,
            preview: 'Mentioned you in a session',
            targetUserIds: mentionTargetUserIds,
        });
    });
}
```

Prefer integrating the notification transaction after the message transaction to keep the existing dispatch code surgical. If an engineer chooses to fold it into `dispatchSessionMessage`, ensure no duplicate notifications on idempotent retries.

- [ ] **Step 6: Run route tests**

Run:

```bash
cd packages/happy-server && npx vitest run sources/app/api/routes/v3SessionRoutes.test.ts --testNamePattern "mention"
```

Expected: PASS.

---

## Task 4: Best-Effort Mention Sharing Results

**Files:**
- Modify: `packages/happy-app/sources/-session/sessionMentionSharing.ts`
- Modify: `packages/happy-app/sources/-session/sessionMentionSharing.test.ts`

- [ ] **Step 1: Add failing tests for partial success**

Add tests:

```ts
it('continues sharing remaining mention targets when one target fails', async () => {
    const createShare = vi.fn()
        .mockRejectedValueOnce(new Error('alice failed'))
        .mockResolvedValueOnce(share('u2'));

    const result = await shareSessionWithMentionedFriendsWithDeps('session-1', [
        friend('u1', 'alice'),
        friend('u2', 'bob'),
    ], {
        getCredentials: () => ({ token: 'token' } as never),
        getSessionDataKey: () => new Uint8Array([1, 2, 3]),
        verifyBinding: vi.fn().mockReturnValue(true),
        encryptDataKey: vi.fn().mockReturnValue('encrypted-key'),
        createShare,
    });

    expect(result.succeeded.map(item => item.id)).toEqual(['u2']);
    expect(result.failed).toEqual([{ friend: expect.objectContaining({ id: 'u1' }), reason: 'alice failed' }]);
});

it('returns missing-key failures without throwing', async () => {
    const result = await shareSessionWithMentionedFriendsWithDeps('session-1', [
        friend('u1', 'alice', { contentPublicKey: null, contentPublicKeySig: null }),
    ], deps);

    expect(result.succeeded).toEqual([]);
    expect(result.failed[0].friend.id).toBe('u1');
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
cd packages/happy-app && npx vitest run sources/-session/sessionMentionSharing.test.ts
```

Expected: FAIL because the current function throws on first failure and returns `void`.

- [ ] **Step 3: Change the function return type**

Implement:

```ts
export type MentionShareResult = {
    succeeded: UserProfile[];
    failed: Array<{ friend: UserProfile; reason: string }>;
};
```

Update `shareSessionWithMentionedFriendsWithDeps` to loop through all targets and push failures instead of throwing per-target. Keep throwing only for session-wide unrecoverable failures such as missing session data key.

- [ ] **Step 4: Update wrapper**

```ts
export async function shareSessionWithMentionedFriends(sessionId: string, targets: UserProfile[]): Promise<MentionShareResult> {
    return shareSessionWithMentionedFriendsWithDeps(sessionId, targets, { ... });
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd packages/happy-app && npx vitest run sources/-session/sessionMentionSharing.test.ts
```

Expected: PASS.

---

## Task 5: Client Human-Only Mention Send API

**Files:**
- Modify: `packages/happy-app/sources/sync/sync.ts`
- Create: `packages/happy-app/sources/-session/collaborationMentionSend.test.ts` or add a focused sync test if an existing sync mock harness is available.

- [ ] **Step 1: Write failing test for human-only mention send**

Use a fetch mock and a fake prepared message. If `sync` is hard to instantiate, extract a small helper for request body creation and test it.

Expected body:

```ts
expect(fetchMock).toHaveBeenCalledWith(
    'https://happy.example/api/v3/sessions/session-1/messages',
    expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
            messages: [{
                content: 'encrypted-record',
                localId: 'local-1',
                trackCliDelivery: false,
                mentionTargetUserIds: ['u1', 'u2'],
            }],
        }),
    }),
);
expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/send'), expect.anything());
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd packages/happy-app && npx vitest run sources/-session/collaborationMentionSend.test.ts
```

Expected: FAIL because no human-only mention send API exists.

- [ ] **Step 3: Add meta override support to outgoing message preparation**

Change `prepareOutgoingMessage` to accept optional metadata overrides without changing existing callers:

```ts
type OutgoingMessageMetaOverrides = Partial<MessageMeta>;

private async prepareOutgoingMessage(
    sessionId: string,
    text: string,
    displayText?: string,
    images?: LocalImage[],
    existingLocalId?: string,
    uploadedImages?: ImageContent[],
    metaOverrides?: OutgoingMessageMetaOverrides,
): Promise<PreparedOutgoingMessage | { error: string; localId: string }> {
    // ...
    meta: {
        sentFrom,
        permissionMode: permissionMode || 'default',
        model,
        reasoningEffort,
        fallbackModel,
        appendSystemPrompt: this.buildSystemPrompt(sessionId),
        ...(displayText && { displayText }),
        ...metaOverrides,
    }
}
```

- [ ] **Step 4: Add `sendCollaborationMentionMessage`**

```ts
async sendCollaborationMentionMessage(input: {
    sessionId: string;
    text: string;
    targetUserIds: string[];
    targetUsernames: string[];
    displayText?: string;
    images?: LocalImage[];
    uploadedImages?: ImageContent[];
    existingLocalId?: string;
    onBeforeApply?: () => void;
}): Promise<SendMessageResult> {
    const prepared = await this.prepareOutgoingMessage(
        input.sessionId,
        input.text,
        input.displayText ?? input.text,
        input.images,
        input.existingLocalId,
        input.uploadedImages,
        {
            humanOnly: true,
            skipAiContext: true,
            collaboration: {
                kind: 'mention',
                targetUserIds: input.targetUserIds,
                targetUsernames: input.targetUsernames,
            },
        },
    );
    if ('error' in prepared) {
        return { success: false, error: prepared.error, localId: prepared.localId };
    }

    const { localId, encryptedRawRecord, normalizedMessage } = prepared;
    if (input.onBeforeApply) this.pendingSendCallbacks.set(localId, input.onBeforeApply);

    const response = await fetch(`${getServerUrl()}/v3/sessions/${input.sessionId}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${this.credentials.token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messages: [{
                content: encryptedRawRecord,
                localId,
                trackCliDelivery: false,
                mentionTargetUserIds: input.targetUserIds,
            }],
        }),
    });

    if (!response.ok) {
        this.pendingSendCallbacks.delete(localId);
        return { success: false, localId, error: `Send failed: ${response.status}` };
    }

    const pending = this.pendingSendCallbacks.get(localId);
    if (pending) {
        this.pendingSendCallbacks.delete(localId);
        pending();
    }
    if (normalizedMessage) {
        const msg = normalizedMessage;
        void this.enqueueSessionMessageDispatch(input.sessionId, 'sendCollaborationMentionMessage:local-ack', async () => {
            this.applyMessages(input.sessionId, [msg]);
        });
    }
    return { success: true, localId };
}
```

- [ ] **Step 5: Run focused test**

Run:

```bash
cd packages/happy-app && npx vitest run sources/-session/collaborationMentionSend.test.ts
```

Expected: PASS.

---

## Task 6: SessionView Collaboration Branch

**Files:**
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`
- Modify: `packages/happy-app/sources/utils/chatFriendMentions.test.ts` if extra extraction coverage is needed.
- Test: Prefer `packages/happy-app/sources/-session/sessionMentionSharing.test.ts` plus a new `collaborationMentionSend.test.ts`; avoid full component tests unless existing harness supports `SessionView` cleanly.

- [ ] **Step 1: Add a failing behavior test for route choice**

Test a small extracted helper instead of the whole component. Extract a pure function from the plan implementation:

```ts
export function buildMentionCollaborationPlan(input: {
    messageText: string;
    acceptedFriends: UserProfile[];
    existingShares: SessionShare[];
}) {
    const mentionedFriends = resolveMentionedFriends(input.messageText, input.acceptedFriends);
    const shareTargets = getMentionShareTargets(mentionedFriends, input.existingShares);
    return {
        isCollaborationMention: mentionedFriends.length > 0,
        mentionedFriends,
        shareTargets,
    };
}
```

Test:

```ts
it('treats any valid friend mention as collaboration mention', () => {
    const plan = buildMentionCollaborationPlan({
        messageText: 'AI summarize this, @BenDaye please inspect',
        acceptedFriends: [friend('u1', 'BenDaye')],
        existingShares: [],
    });

    expect(plan.isCollaborationMention).toBe(true);
    expect(plan.mentionedFriends.map(f => f.id)).toEqual(['u1']);
});

it('leaves unknown mentions on the normal AI path', () => {
    const plan = buildMentionCollaborationPlan({
        messageText: '@Unknown please inspect',
        acceptedFriends: [friend('u1', 'BenDaye')],
        existingShares: [],
    });

    expect(plan.isCollaborationMention).toBe(false);
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
cd packages/happy-app && npx vitest run sources/-session/sessionMentionSharing.test.ts --testNamePattern "collaboration"
```

Expected: FAIL until the helper exists.

- [ ] **Step 3: Extract the planning helper**

Add `buildMentionCollaborationPlan` to `sessionMentionSharing.ts` or a new focused file `sessionMentionCollaboration.ts`. Keep it pure and testable.

- [ ] **Step 4: Replace `confirmAndShareMentionedFriends` with collaboration flow**

In `SessionView.tsx`, before the normal upload + `sync.sendOrQueueMessage` branch:

1. Resolve valid mentioned friends.
2. If none, continue current normal AI path unchanged.
3. Fetch current shares.
4. Build `shareTargets` for only users not already shared.
5. Confirm all mentioned people, not only new share targets.
6. Share `shareTargets` best-effort.
7. Build `reachableTargets = alreadySharedMentionedFriends + successfullySharedFriends`.
8. If `reachableTargets.length === 0`, alert failure and keep draft/attachments.
9. Send via `sync.sendCollaborationMentionMessage`, not `sync.sendOrQueueMessage`.
10. Clear draft/attachments only after the message is accepted.
11. Show a non-blocking alert/toast listing failed target names when partial failures occur.

Pseudo-code:

```ts
const collaboration = await prepareMentionCollaboration(messageToSend);
if (collaboration) {
    if (collaboration.reachableTargets.length === 0) return;

    setIsSending(true);
    try {
        const uploadedFiles = filesToSend.length > 0
            ? await Promise.all(filesToSend.map(file => uploadChatFileToCli(sessionId, file)))
            : [];
        const finalMessage = `${messageToSend}${buildUploadedFilesText(uploadedFiles)}`;
        const result = await sync.sendCollaborationMentionMessage({
            sessionId,
            text: finalMessage,
            targetUserIds: collaboration.reachableTargets.map(target => target.id),
            targetUsernames: collaboration.reachableTargets.map(target => target.username),
            images: imagesToSend,
            onBeforeApply: () => {
                setMessage('');
                clearDraft();
                clearImages();
                clearFileAttachments();
            },
        });
        if (!result.success) {
            Modal.alert(t('common.error'), result.error || t('status.operationFailed'));
            return;
        }
        if (collaboration.failedTargets.length > 0) {
            Modal.alert(
                t('session.mentions.partialFailureTitle'),
                t('session.mentions.partialFailureMessage', {
                    names: collaboration.failedTargets.map(item => getDisplayName(item.friend)).join(', '),
                }),
            );
        }
        trackMessageSent();
    } finally {
        setIsSending(false);
        setIsUploadingImages(false);
    }
    return;
}
```

- [ ] **Step 5: Run focused app tests**

Run:

```bash
cd packages/happy-app && npx vitest run sources/-session/sessionMentionSharing.test.ts sources/-session/collaborationMentionSend.test.ts sources/utils/chatFriendMentions.test.ts
```

Expected: PASS.

---

## Task 7: Collaboration Message UI and Feed Card

**Files:**
- Modify: `packages/happy-app/sources/components/MessageView.tsx`
- Modify: `packages/happy-app/sources/sync/feedTypes.ts`
- Modify: `packages/happy-app/sources/components/FeedItemCard.tsx`
- Modify: text files under `packages/happy-app/sources/text/`

- [ ] **Step 1: Add text keys**

Add keys under `message` or `session.mentions`:

```ts
collaborationBadge: 'Collaboration note · not sent to AI',
collaborationDetail: ({ names }: { names: string }) => `Mentioned ${names}. AI will not see this message.`,
partialFailureTitle: 'Some people were not notified',
partialFailureMessage: ({ names }: { names: string }) => `Could not share with ${names}. The note was sent to everyone else.`,
mentionNotifyTitle: 'Mention people?',
mentionNotifyMessage: ({ names }: { names: string }) => `Share this session and notify ${names}?`,
mentionNotifyAction: 'Share and notify',
```

Add feed keys:

```ts
sessionMentionTitle: ({ name }: { name: string }) => `${name} mentioned you in a session`,
sessionMentionFallback: 'You were mentioned in a session',
```

Follow the existing translation rule: all locale files must receive the same keys. Use English fallback for locales where no translation is available.

- [ ] **Step 2: Add feed schema support**

Modify `packages/happy-app/sources/sync/feedTypes.ts` to match backend:

```ts
z.object({
    kind: z.literal('session_mention'),
    sessionId: z.string(),
    actorId: z.string(),
    actorName: z.string().nullable(),
    sessionTitle: z.string().nullable(),
    preview: z.string(),
}),
```

- [ ] **Step 3: Render feed card**

In `FeedItemCard.tsx` add a switch case:

```tsx
case 'session_mention':
    return (
        <Item
            title={item.body.actorName
                ? t('feed.sessionMentionTitle', { name: item.body.actorName })
                : t('feed.sessionMentionFallback')}
            subtitle={item.body.sessionTitle || getTimeAgo(item.createdAt)}
            icon={<Ionicons name="at" size={20} color={theme.colors.textLink} />}
            iconContainerStyle={{ marginRight: 20 }}
            onPress={() => router.push(`/session/${item.body.sessionId}`)}
            showChevron={true}
            showDivider={showDivider}
        />
    );
```

- [ ] **Step 4: Render collaboration message style**

In `UserTextBlock`, derive:

```ts
const collaboration = props.message.meta?.collaboration?.kind === 'mention'
    ? props.message.meta.collaboration
    : null;
```

Then add a badge above the markdown when `collaboration` exists:

```tsx
{collaboration && (
    <View style={styles.collaborationBadge}>
        <Text style={styles.collaborationBadgeText}>{t('message.collaborationBadge')}</Text>
    </View>
)}
```

Use a lightly distinct bubble style when `collaboration` exists:

```tsx
style={[
    styles.userMessageBubble,
    collaboration ? styles.collaborationMessageBubble : null,
]}
```

- [ ] **Step 5: Add styles**

```ts
collaborationMessageBubble: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSecondary,
},
collaborationBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 6,
    backgroundColor: theme.colors.surfacePressedOverlay,
},
collaborationBadgeText: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
},
```

Adjust exact theme tokens to existing `MessageView.tsx` style names if needed.

- [ ] **Step 6: Run app typecheck after UI/text changes**

Run:

```bash
cd packages/happy-app && yarn typecheck
```

Expected: PASS.

---

## Task 8: Filter Human-Only Messages from AI-Facing CLI Context

**Files:**
- Modify: `packages/happy-cli/src/mcp/messageDecrypt.ts`
- Modify: `packages/happy-cli/src/mcp/tools/sessionSummary.ts`
- Modify: `packages/happy-cli/src/mcp/tools/sessionSummary.test.ts`
- Modify: `packages/happy-cli/src/api/apiSession.ts`
- Optional modify: `packages/happy-cli/src/mcp/tools/sessionMessages.ts`

- [ ] **Step 1: Add failing summary test**

In `sessionSummary.test.ts`:

```ts
it('skips human-only collaboration messages when compacting AI-facing summaries', () => {
    const result = compactSessionMessages([
        msg({
            seq: 1,
            role: 'user',
            content: { type: 'text', text: '@BenDaye please inspect' },
            meta: { humanOnly: true, skipAiContext: true },
        } as any),
        msg({ seq: 2, role: 'user', content: { type: 'text', text: 'Now summarize the logs' } }),
    ], {
        textLimit: 200,
        maxTurns: 10,
        includeTools: true,
        maxToolsPerTurn: 5,
    });

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].user?.text).toBe('Now summarize the logs');
});
```

- [ ] **Step 2: Run focused CLI test and verify it fails**

Run:

```bash
cd packages/happy-cli && npx vitest run src/mcp/tools/sessionSummary.test.ts --testNamePattern "human-only"
```

Expected: FAIL because `DecryptedMessage` does not include meta and summary does not filter it.

- [ ] **Step 3: Preserve decrypted meta**

Modify `packages/happy-cli/src/mcp/messageDecrypt.ts`:

```ts
export interface DecryptedMessage {
    // existing fields...
    meta?: Record<string, unknown> | null;
}
```

Return:

```ts
meta: decrypted?.meta ?? null,
```

- [ ] **Step 4: Add helper and filter**

In `sessionSummary.ts`:

```ts
function isHumanOnlyMessage(message: DecryptedMessage): boolean {
    return Boolean((message.meta as any)?.humanOnly || (message.meta as any)?.skipAiContext);
}
```

At the start of the compaction loop:

```ts
if (isHumanOnlyMessage(message)) {
    continue;
}
```

- [ ] **Step 5: Filter auto-review history**

In `packages/happy-cli/src/api/apiSession.ts`, inside `fetchRecentReviewMessages`, after decrypting:

```ts
if (decrypted?.meta?.humanOnly || decrypted?.meta?.skipAiContext) {
    continue;
}
```

- [ ] **Step 6: Optional MCP session messages default filtering**

If `happy_session_messages` is considered AI-facing, update the input schema:

```ts
includeHumanOnly: z.boolean().optional().default(false),
```

Then filter unless explicitly included.

- [ ] **Step 7: Run focused CLI tests**

Run:

```bash
cd packages/happy-cli && npx vitest run src/mcp/tools/sessionSummary.test.ts
```

Expected: PASS.

---

## Task 9: End-to-End Verification and Release Prep

**Files:**
- Modify as needed: `packages/happy-app/CHANGELOG.md`
- Regenerate if changelog changed: `packages/happy-app/sources/changelog/changelog.json`

- [ ] **Step 1: Run targeted app tests**

```bash
cd packages/happy-app && npx vitest run \
  sources/utils/chatFriendMentions.test.ts \
  sources/-session/sessionMentionSharing.test.ts \
  sources/-session/collaborationMentionSend.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run targeted server tests**

```bash
cd packages/happy-server && npx vitest run \
  sources/app/session/sessionMentionNotification.test.ts \
  sources/app/api/routes/v3SessionRoutes.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Run targeted CLI tests**

```bash
cd packages/happy-cli && npx vitest run src/mcp/tools/sessionSummary.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Run package typechecks/builds**

```bash
cd packages/happy-app && yarn typecheck
cd packages/happy-server && yarn build
cd packages/happy-cli && yarn build
```

Expected: all commands exit 0.

- [ ] **Step 5: Manual production-like smoke checklist**

After deployment to a test/staging environment:

1. Open a session where `BenDaye` is a valid friend/coworker.
2. Send `@BenDaye 来测试一下艾特功能`.
3. Confirm the share/notify modal.
4. Verify the chat shows a collaboration message badge.
5. Verify no AI response is generated.
6. Verify BenDaye sees the session in shared sessions.
7. Verify BenDaye receives a feed item and push notification if push token exists.
8. Send a normal follow-up prompt to AI.
9. Verify the AI does not reference the `@BenDaye` collaboration note.
10. Send `@Unknown 来测试` and verify it follows the normal AI path.

- [ ] **Step 6: Changelog update**

Add a concise changelog entry:

```md
- Treat valid friend/coworker @mentions as collaboration notes that notify people without sending the note to AI.
```

Then regenerate changelog JSON if this package uses it:

```bash
cd packages/happy-app && npx tsx sources/scripts/parseChangelog.ts
```

---

## Rollout Notes

- No Prisma migration is required because collaboration state lives inside encrypted message metadata and feed body JSON.
- The server cannot decrypt the mention text. Feed/push text should therefore use a safe generic preview unless the client sends a plaintext preview intentionally. This plan uses a generic server preview for privacy.
- Mention notifications are idempotent per `(sessionId, messageLocalId, targetUserId)` via `repeatKey`, but every new mention message uses a new localId and therefore creates a new reminder.
- Existing production member cleanup is out of scope and should be handled in a separate destructive-data plan.
- If Expo push delivery fails, message sending must still succeed; feed/socket dynamic reminders remain the durable notification path.
