# Chat Friend Mentions Share Design

Date: 2026-07-03
Status: Approved for implementation planning

## Goal

Allow users to mention friends directly in the session chat input. Mentioning a friend should share the current session with that friend before the outgoing message is sent.

## Confirmed Product Decisions

- The chat input `@` autocomplete panel shows both friends and files.
- Friend suggestions are shown before file suggestions and are visually grouped.
- Selecting a friend inserts `@username` into the input.
- Manually typed `@username` is also recognized at send time.
- Only accepted friends are recognized for auto-sharing.
- Unknown usernames and non-friends are treated as plain text and do not block sending.
- Mentioned friends receive direct session sharing with access level `edit`.
- Sharing happens only after the user taps Send and confirms the share prompt.
- If a mentioned friend already has a direct share, no confirmation is shown for that friend.
- If sharing fails, the message is not sent.

## Current Code Context

- Chat input component: `packages/happy-app/sources/components/AgentInput.tsx`
- Existing autocomplete source: `packages/happy-app/sources/components/autocomplete/suggestions.ts`
- Existing suggestion row UI: `packages/happy-app/sources/components/AgentInputSuggestionView.tsx`
- Session send flow: `packages/happy-app/sources/-session/SessionView.tsx`
- Friend data types: `packages/happy-app/sources/sync/friendTypes.ts`
- Friend storage selector: `packages/happy-app/sources/sync/storage.ts` (`useAcceptedFriends`)
- Direct share API: `packages/happy-app/sources/sync/apiSharing.ts` (`getSessionShares`, `createSessionShare`)
- Existing direct share crypto: `packages/happy-app/sources/sync/directShareEncryption.ts`
- Existing sharing page implementation: `packages/happy-app/sources/app/(app)/session/[id]/sharing.tsx`

The current `@` autocomplete is file-oriented. The feature should extend it rather than replace it.

## Proposed Architecture

### Friend/file unified suggestions

Extend the existing autocomplete suggestion model with optional metadata. Add friend suggestions ahead of file suggestions for `@` queries. Keep commands (`/`) and skills (`$`) unchanged.

### Mention parsing

Add a small pure utility that extracts mention usernames from outgoing text. It should ignore file-style mentions such as `@workspace/AGENTS.md` by not matching mentions followed by `/`.

### Send-time sharing

In `SessionView`, before sending a message:

1. Resolve mentioned friends from accepted friends by username.
2. Fetch existing direct shares for the session.
3. Filter out already shared friends.
4. If new share targets remain, show a confirmation prompt.
5. If confirmed, encrypt the current session data key for each recipient and call `createSessionShare` with `accessLevel: 'edit'`.
6. Send the message only after all required shares succeed.

If the current user cannot manage sharing for the session, friend suggestions should not be offered and send-time sharing should be skipped. Typed `@username` remains plain text in that case.

## Error Handling

- Missing recipient content key: fail sharing and do not send; show the existing recipient-missing-keys message.
- Invalid content key binding: fail sharing and do not send; show a generic operation failure.
- Missing local session data key: fail sharing and do not send; show session-not-found.
- API failure: fail sharing and do not send; show operation failed.
- User cancels confirmation: do not share and do not send.
- Unknown `@username`: ignore for sharing and send as plain text.

## Testing Strategy

- Unit-test mention parsing and friend resolution.
- Unit-test friend suggestion ordering and non-interference with file suggestions.
- Unit-test share planning: already-shared friends are filtered, unknown users are ignored, duplicate mentions are deduped.
- Add a focused SessionView/source-level test or integration-style test for the send guard if feasible without over-mocking.
- Run `yarn typecheck` in `packages/happy-app` after implementation.

## Out of Scope

- Backend mention metadata.
- Push notifications specifically for mentions.
- Rich mention chips inside the text input.
- Changing existing direct share backend routes.
- Public-share chat mentions.
