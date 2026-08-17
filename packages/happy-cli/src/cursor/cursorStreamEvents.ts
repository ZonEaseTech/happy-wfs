/**
 * Cursor CLI stream-json → AgentMessage
 *
 * `cursor-agent -p ... --output-format stream-json` emits one JSON object per
 * line. This module is the pure translation layer from those objects to the
 * AgentMessage stream the rest of Happy already speaks, kept free of process
 * and transport concerns so it can be tested against recorded output.
 *
 * Shapes below were taken from a real run of cursor-agent 2026.08.11-e8db854
 * (see mapCursorStreamEvent tests for captured samples).
 */

import type { AgentMessage } from '@/agent/core/AgentMessage';

/** Top-level event types cursor-agent emits on the stream. */
export type CursorStreamEventType = 'system' | 'user' | 'thinking' | 'tool_call' | 'assistant' | 'result';

export interface CursorStreamEvent {
    type: string;
    subtype?: string;
    session_id?: string;
    [key: string]: unknown;
}

/** Session facts carried by the `system/init` event. */
export interface CursorSessionInit {
    sessionId: string;
    model: string | null;
    cwd: string | null;
    permissionMode: string | null;
    apiKeySource: string | null;
}

function textFromMessageContent(message: unknown): string | null {
    if (!message || typeof message !== 'object') return null;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) return null;
    const parts: string[] = [];
    for (const block of content) {
        if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
            const text = (block as { text?: unknown }).text;
            if (typeof text === 'string') parts.push(text);
        }
    }
    return parts.length > 0 ? parts.join('') : null;
}

/**
 * Cursor wraps each tool call in a single-key object naming the tool
 * (`editToolCall`, `shellToolCall`, `readToolCall`, …). That key is the only
 * place the tool name appears, so it is also what we report upstream.
 */
function unwrapToolCall(toolCall: unknown): { toolName: string; args: Record<string, unknown>; result: unknown } | null {
    if (!toolCall || typeof toolCall !== 'object') return null;
    for (const [key, value] of Object.entries(toolCall as Record<string, unknown>)) {
        if (!key.endsWith('ToolCall') || !value || typeof value !== 'object') continue;
        const inner = value as { args?: unknown; result?: unknown };
        return {
            toolName: key.replace(/ToolCall$/, ''),
            args: (inner.args && typeof inner.args === 'object' ? inner.args : {}) as Record<string, unknown>,
            result: inner.result ?? null,
        };
    }
    return null;
}

/** Pulls the unified diff out of an edit tool result, when there is one. */
function editDiffFromResult(result: unknown): { diff: string; path: string | null } | null {
    if (!result || typeof result !== 'object') return null;
    const success = (result as { success?: unknown }).success;
    if (!success || typeof success !== 'object') return null;
    const diff = (success as { diffString?: unknown }).diffString;
    if (typeof diff !== 'string' || diff.length === 0) return null;
    const path = (success as { path?: unknown }).path;
    return { diff, path: typeof path === 'string' ? path : null };
}

export function parseCursorSessionInit(event: CursorStreamEvent): CursorSessionInit | null {
    if (event.type !== 'system' || event.subtype !== 'init') return null;
    const sessionId = event.session_id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
    const str = (key: string): string | null => (typeof event[key] === 'string' ? event[key] as string : null);
    return {
        sessionId,
        model: str('model'),
        cwd: str('cwd'),
        permissionMode: str('permissionMode'),
        apiKeySource: str('apiKeySource'),
    };
}

/**
 * Translates one stream event. Returns every AgentMessage the event implies —
 * a completed edit yields both a tool-result and an fs-edit, and an unknown
 * event yields nothing rather than a guess.
 */
export function mapCursorStreamEvent(event: CursorStreamEvent): AgentMessage[] {
    switch (event.type) {
        case 'system': {
            if (event.subtype !== 'init') return [];
            const init = parseCursorSessionInit(event);
            return [{
                type: 'status',
                status: 'running',
                detail: init?.model ? `cursor-agent ready (${init.model})` : 'cursor-agent ready',
            }];
        }

        // The user turn is echoed back to us; Happy already has that text from
        // the send path, so re-emitting it would duplicate the bubble.
        case 'user':
            return [];

        case 'thinking': {
            if (event.subtype !== 'delta') return [];
            const text = typeof event.text === 'string' ? event.text : null;
            if (!text) return [];
            return [{ type: 'event', name: 'thinking', payload: { textDelta: text } }];
        }

        case 'assistant': {
            const text = textFromMessageContent(event.message);
            if (!text) return [];
            return [{ type: 'model-output', fullText: text }];
        }

        case 'tool_call': {
            const callId = typeof event.call_id === 'string' ? event.call_id : null;
            const unwrapped = unwrapToolCall(event.tool_call);
            if (!callId || !unwrapped) return [];

            if (event.subtype === 'started') {
                return [{ type: 'tool-call', toolName: unwrapped.toolName, args: unwrapped.args, callId }];
            }
            if (event.subtype !== 'completed') return [];

            const messages: AgentMessage[] = [{
                type: 'tool-result',
                toolName: unwrapped.toolName,
                result: unwrapped.result,
                callId,
            }];
            const edit = editDiffFromResult(unwrapped.result);
            if (edit) {
                messages.push({
                    type: 'fs-edit',
                    description: edit.path ? `Edited ${edit.path}` : 'Edited file',
                    diff: edit.diff,
                    ...(edit.path ? { path: edit.path } : {}),
                });
            }
            return messages;
        }

        case 'result': {
            const messages: AgentMessage[] = [];
            const usage = event.usage;
            if (usage && typeof usage === 'object') {
                messages.push({ type: 'token-count', ...(usage as Record<string, unknown>) });
            }
            const isError = event.is_error === true;
            messages.push({
                type: 'status',
                status: isError ? 'error' : 'idle',
                detail: typeof event.subtype === 'string' ? event.subtype : undefined,
            });
            return messages;
        }

        default:
            return [];
    }
}

/**
 * Splits a stdout chunk into complete JSON lines, returning the leftover
 * partial line to be prepended to the next chunk. Cursor's output arrives in
 * arbitrary chunks, so a naive split drops the object straddling the boundary.
 */
export function drainJsonLines(buffer: string): { events: CursorStreamEvent[]; rest: string } {
    const events: CursorStreamEvent[] = [];
    const lines = buffer.split('\n');
    const rest = lines.pop() ?? '';
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
                events.push(parsed as CursorStreamEvent);
            }
        } catch {
            // Non-JSON noise on stdout (banners, warnings) is not fatal.
        }
    }
    return { events, rest };
}
