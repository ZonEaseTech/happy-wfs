/**
 * AgentMessage → ACPMessageData
 *
 * The app already renders the unified ACP message shapes for Gemini and Codex,
 * so a Cursor session only has to speak the same vocabulary to show up there.
 * Kept pure and separate from the runner so the translation can be tested
 * without a server or a child process.
 */

import type { ACPMessageData } from '@/api/apiSession';
import type { AgentMessage } from '@/agent/core/AgentMessage';

/** Ids are supplied by the caller so tests can use a deterministic sequence. */
export type IdFactory = () => string;

export function agentMessageToAcp(message: AgentMessage, newId: IdFactory): ACPMessageData[] {
    switch (message.type) {
        case 'model-output': {
            const text = message.fullText ?? message.textDelta;
            if (!text) return [];
            return [{ type: 'message', message: text }];
        }

        case 'event': {
            // Cursor reports reasoning as thinking deltas; anything else is
            // internal bookkeeping the app has no place for.
            if (message.name !== 'thinking') return [];
            const payload = message.payload as { textDelta?: unknown } | null;
            const text = payload && typeof payload.textDelta === 'string' ? payload.textDelta : null;
            if (!text) return [];
            return [{ type: 'thinking', text }];
        }

        case 'tool-call':
            return [{
                type: 'tool-call',
                callId: message.callId,
                name: message.toolName,
                input: message.args,
                id: newId(),
            }];

        case 'tool-result':
            return [{
                type: 'tool-result',
                callId: message.callId,
                output: message.result,
                id: newId(),
            }];

        case 'fs-edit':
            return [{
                type: 'file-edit',
                description: message.description,
                // The app keys file edits by path; an edit without one would
                // render as an orphan card, so fall back to a visible marker.
                filePath: message.path ?? '(unknown path)',
                ...(message.diff ? { diff: message.diff } : {}),
                id: newId(),
            }];

        case 'terminal-output':
            return [{ type: 'terminal-output', data: message.data, callId: newId() }];

        case 'token-count': {
            const { type: _type, ...rest } = message as Record<string, unknown> & { type: string };
            return [{ type: 'token_count', ...rest }];
        }

        case 'status': {
            switch (message.status) {
                case 'starting':
                    return [{ type: 'task_started', id: newId() }];
                case 'idle':
                    return [{ type: 'task_complete', id: newId() }];
                case 'stopped':
                    return [{ type: 'turn_aborted', id: newId() }];
                case 'error':
                    // Surface the reason as a message too — a bare task_complete
                    // would look like the turn simply ended.
                    return [
                        { type: 'message', message: message.detail ?? 'cursor-agent failed' },
                        { type: 'task_complete', id: newId() },
                    ];
                default:
                    return [];
            }
        }

        default:
            return [];
    }
}
