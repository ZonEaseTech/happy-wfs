# OpenClaw Message Format Compatibility

**Date:** 2026-04-17
**Status:** Approved
**Scope:** `packages/happy-app` (OpenClaw chat)

## Problem

The OpenClaw gateway supports rich message content blocks (thinking, toolcall, tool_result, image) but happy-next's OpenClaw chat only extracts `type: "text"` blocks and silently discards everything else. The `OpenClawChatEvent` type also diverges from the latest gateway schema (missing `aborted` state, `errorKind`, extra non-existent states). This results in incomplete message rendering and missed streaming events.

## Approach

Create lightweight, OpenClaw-specific rendering components (independent of the Happy Session message system) with simplified rendering: thinking blocks are collapsible, tool calls shown as one-line summaries, and images rendered inline. Real-time streaming shows thinking and tool status as they happen.

## Type System Changes

### Content Block Types

```typescript
// packages/happy-app/sources/openclaw/types.ts

interface TextContentBlock {
    type: 'text';
    text: string;
    textSignature?: string;
}

interface ThinkingContentBlock {
    type: 'thinking';
    thinking: string;
}

interface ToolCallContentBlock {
    type: 'toolcall';
    id?: string;
    name?: string;
    arguments?: unknown;
    locations?: Array<{ path: string; line?: number }>;
}

interface ToolResultContentBlock {
    type: 'tool_result';
    id?: string;
    name?: string;
    content?: string | Array<{ type: string; text?: string }>;
    is_error?: boolean;
}

interface ImageContentBlock {
    type: 'image';
    data?: string;       // base64
    mimeType?: string;
}

type OpenClawContentBlock =
    | TextContentBlock
    | ThinkingContentBlock
    | ToolCallContentBlock
    | ToolResultContentBlock
    | ImageContentBlock;
```

### OpenClawChatMessage (expanded)

```typescript
interface OpenClawChatMessage {
    role: 'user' | 'assistant';
    content: OpenClawContentBlock[] | string;
    timestamp?: number;
    stopReason?: string;
    errorMessage?: string;
    phase?: 'commentary' | 'final_answer';
    usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    model?: string;
}
```

### OpenClawChatEvent (aligned with gateway ChatEventSchema)

```typescript
interface OpenClawChatEvent {
    runId: string;
    sessionKey: string;
    seq: number;
    state: 'delta' | 'final' | 'aborted' | 'error';
    message?: OpenClawChatMessage;
    errorMessage?: string;
    errorKind?: 'refusal' | 'timeout' | 'rate_limit' | 'context_length' | 'unknown';
    usage?: unknown;
    stopReason?: string;
}
```

Removed non-existent states: `started`, `thinking`, `tool`.
Added: `aborted`, `errorKind`, `usage`, `stopReason`.
Removed: `delta` field (delta content is inside `message`).

### OpenClawToolStreamEvent (new)

```typescript
interface OpenClawToolStreamEvent {
    sessionKey: string;
    runId?: string;
    toolCallId: string;
    phase: 'start' | 'update' | 'result';
    name?: string;
    args?: Record<string, unknown>;
    isError?: boolean;
}
```

## Event Handling Changes

### onEventCallback routing

```
event: "chat"                     -> pass as OpenClawChatEvent (existing)
agent, stream: "assistant"        -> convert to delta event with full content blocks
agent, stream: "tool"             -> convert to OpenClawToolStreamEvent (new)
agent, stream: "lifecycle"        -> convert to final/error/aborted event
```

The `stream: "tool"` events carry tool call lifecycle with three phases:
- `start`: tool begins execution (name, args)
- `update`: partial result available
- `result`: tool completed (success or failure)

### handleChatEvent changes

- `delta`: preserve full `content` block array (not just extracted text string)
- `final`: fetch history (unchanged)
- `aborted`: same as error — remove streaming message, clear runId
- `error`: unchanged

### LocalMessage extension

```typescript
interface LocalMessage extends OpenClawChatMessage {
    localId: string;
    status?: MessageStatus;
    isStreaming?: boolean;
    errorMessage?: string;
    activeToolCalls?: Record<string, { name: string; status: 'running' | 'completed' | 'failed' }>;
}
```

During streaming, `content` is maintained as an `OpenClawContentBlock[]` (not downgraded to string). This keeps the streaming and history rendering paths identical.

## Rendering Components

### MessageItem refactoring

```
if role === 'user':
    extract text content -> render as plain Text (unchanged)
if role === 'assistant':
    if content is string -> <MarkdownView> (backward compat)
    if content is array  -> iterate blocks:
        text         -> <MarkdownView>
        thinking     -> <ThinkingBlock>
        toolcall     -> <ToolCallSummary> (paired with matching tool_result)
        tool_result  -> <ToolResultSummary> (only if no matching toolcall)
        image        -> <ImageBlock>
    append activeToolCalls live status (during streaming)
    phase handling: if any text block has final_answer phase, show only those
```

### ThinkingBlock

Collapsible thinking content, collapsed by default.

```
Collapsed: 💭 思考 ∙ "Let me analyze th..." ▶
Expanded:  💭 思考                           ▼
           <full thinking text via MarkdownView>
```

- Muted background color, visually distinct from regular text
- Toggle via press on the header row
- Preview shows first ~50 characters when collapsed

### ToolCallSummary

One-line summary combining toolcall + matched tool_result.

```
🔧 Read ∙ path: src/index.ts          ✓
🔧 Edit ∙ path: src/utils.ts          ✓
🔧 Bash ∙ npm test                    ⏳ (streaming)
🔧 Read ∙ path: config.json           ✗ (failed)
```

- Icon + tool name + first argument value (truncated ~40 chars) + status indicator
- If no arguments, show tool name only (e.g., "🔧 ListFiles ✓")
- Match toolcall to tool_result by `id` within the same message
- Unmatched toolcall: show as running (streaming) or no status (history)

### ToolResultSummary

Standalone tool result when no matching toolcall exists (rare).

```
📋 Result ∙ {name}                     ✓/✗
```

### ImageBlock

Renders base64 image via expo-image.

- Source: `data:{mimeType};base64,{data}` URI
- Max width: message bubble width, height proportional
- Missing data/mimeType: show placeholder icon with text

## File Changes

| File | Change |
|------|--------|
| `happy-app/sources/openclaw/types.ts` | Add content block types, expand OpenClawChatMessage/Event, add OpenClawToolStreamEvent |
| `happy-app/sources/app/(app)/openclaw/chat.tsx` | Refactor MessageItem, add ThinkingBlock/ToolCallSummary/ToolResultSummary/ImageBlock, expand onEventCallback and handleChatEvent, update LocalMessage |
| `happy-app/sources/text/_default.ts` + 10 language files | Add i18n keys: `openclaw.thinking`, `openclaw.toolCall`, `openclaw.toolResult`, `openclaw.image`, `openclaw.thinkingPreview` |

## Edge Cases

| Scenario | Handling |
|----------|----------|
| content is plain string (legacy) | Backward compatible: render as single text block |
| Unknown block type | Skip silently |
| toolcall without matching tool_result | Show as running (streaming) or neutral (history) |
| tool_result without matching toolcall | Render as standalone ToolResultSummary |
| image block missing data/mimeType | Placeholder with "[Image unavailable]" text |
| phase = final_answer | Only render final_answer-phase text blocks; hide commentary |
| aborted event | Same as error: remove streaming message, clear runId |
| errorKind | Log only, not displayed in UI |

## Out of Scope

- Full tool argument/result expand view or detail page navigation
- Usage information display in UI
- Model/provider display
- textSignature parsing (phase taken from message.phase directly)
- Cross-message tool call + result coalescing
