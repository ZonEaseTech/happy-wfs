# mem-A-pin: long-press a chat message to save it as memory

## What changed

User can now long-press any user-text or agent-text bubble in the chat to save
its content as a memory. The action sheet path is:

1. Long-press (≥400ms) on the message bubble fires `pinMessageToMemory()`.
2. A light haptic confirms the gesture.
3. `Modal.alert(t('memory.pinTitle'), preview, [Cancel, Save to memory])` is
   shown. Preview is the trimmed message text, truncated to 200 chars.
4. On confirm: `createMemory({ content, source: 'message-pin',
   sourceSessionId, sourceMessageId })` is called against the memory API.
5. On success: light haptic + `showToast(t('memory.saved'))`.
6. On error: `Modal.alert(t('common.error'), <error message>)`.

Auth is read lazily via `getCurrentAuth()` to avoid making `MessageView`
re-render whenever the auth context updates.

## Files changed

- `packages/happy-app/sources/components/MessageView.tsx`
  - Added `pinMessageToMemory()` module-level helper.
  - Wrapped `userMessageBubble` (UserTextBlock) with a `Pressable` that
    forwards `onLongPress`. Existing image / option `Pressable` children keep
    their own tap handlers (RN responder system gives them priority).
  - Wrapped `agentMessageContainer` (AgentTextBlock) with a `Pressable` that
    forwards `onLongPress`.

- `packages/happy-app/sources/text/_default.ts` and all 10 translations
  (`en`, `ru`, `pl`, `es`, `it`, `pt`, `ca`, `ja`, `zh-Hans`, `zh-Hant`):
  - Added `memory.pinTitle` ("Save to memory?") and `memory.pinAction`
    ("Save to memory"). Chinese variants are localized; the others reuse
    English (matches the existing partially-translated state of the
    `memory:` section).

## Notes

- Reused the existing memory client `@/sync/apiMemory#createMemory`, which
  already supports `source: 'message-pin'` plus the `sourceSessionId` /
  `sourceMessageId` fields, so no API surface change is needed.
- `assistant content 数组拼 .text` from the task brief no longer applies —
  `AgentTextMessage.text` is already a flattened string in the current type
  definitions, so we just read `props.message.text` directly.
- Long-press is enabled regardless of `readOnly`. Saving to personal memory
  is independent of the session's edit permissions, so even a viewer of a
  shared session can pin a useful snippet.
- Per repo rules: used `@/modal` (no React Native `Alert`), `t()` with all
  ten language files updated, and no new dependencies / no install.

## Verification (deferred to main session)

- `yarn typecheck` (or `tsc --noEmit`) inside `packages/happy-app` should
  pass — added imports are existing modules and the new keys conform to
  `TranslationStructure` from `_default.ts`.
- Manual test plan: open a session, long-press a user message → action sheet
  shows preview → tap "Save to memory" → toast "Saved" → open `/memory`,
  see the new entry with `source = From chat`.
