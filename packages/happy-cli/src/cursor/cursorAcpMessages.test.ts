import { describe, it, expect } from 'vitest';
import { agentMessageToAcp } from './cursorAcpMessages';

/** Deterministic ids so expectations can name them. */
function idSeq() {
    let n = 0;
    return () => `id-${++n}`;
}

describe('agentMessageToAcp', () => {
    it('sends assistant output as a message', () => {
        expect(agentMessageToAcp({ type: 'model-output', fullText: 'done' }, idSeq()))
            .toEqual([{ type: 'message', message: 'done' }]);
    });

    it('falls back to the delta when there is no full text', () => {
        expect(agentMessageToAcp({ type: 'model-output', textDelta: 'partial' }, idSeq()))
            .toEqual([{ type: 'message', message: 'partial' }]);
    });

    it('drops empty model output instead of sending a blank bubble', () => {
        expect(agentMessageToAcp({ type: 'model-output' }, idSeq())).toEqual([]);
    });

    it('maps the thinking event and ignores other events', () => {
        expect(agentMessageToAcp({ type: 'event', name: 'thinking', payload: { textDelta: 'hmm' } }, idSeq()))
            .toEqual([{ type: 'thinking', text: 'hmm' }]);
        expect(agentMessageToAcp({ type: 'event', name: 'something', payload: {} }, idSeq()))
            .toEqual([]);
    });

    it('carries tool calls and results with their call id', () => {
        expect(agentMessageToAcp({ type: 'tool-call', toolName: 'edit', args: { path: 'a.txt' }, callId: 'c1' }, idSeq()))
            .toEqual([{ type: 'tool-call', callId: 'c1', name: 'edit', input: { path: 'a.txt' }, id: 'id-1' }]);
        expect(agentMessageToAcp({ type: 'tool-result', toolName: 'edit', result: { ok: true }, callId: 'c1' }, idSeq()))
            .toEqual([{ type: 'tool-result', callId: 'c1', output: { ok: true }, id: 'id-1' }]);
    });

    it('keeps the diff on a file edit', () => {
        expect(agentMessageToAcp({ type: 'fs-edit', description: 'Edited a.txt', diff: '@@', path: 'a.txt' }, idSeq()))
            .toEqual([{ type: 'file-edit', description: 'Edited a.txt', filePath: 'a.txt', diff: '@@', id: 'id-1' }]);
    });

    it('substitutes a visible marker when an edit has no path', () => {
        const [edit] = agentMessageToAcp({ type: 'fs-edit', description: 'Edited something' }, idSeq());
        expect(edit).toMatchObject({ type: 'file-edit', filePath: '(unknown path)' });
    });

    it('translates status into task lifecycle events', () => {
        expect(agentMessageToAcp({ type: 'status', status: 'starting' }, idSeq()))
            .toEqual([{ type: 'task_started', id: 'id-1' }]);
        expect(agentMessageToAcp({ type: 'status', status: 'idle' }, idSeq()))
            .toEqual([{ type: 'task_complete', id: 'id-1' }]);
        expect(agentMessageToAcp({ type: 'status', status: 'stopped' }, idSeq()))
            .toEqual([{ type: 'turn_aborted', id: 'id-1' }]);
    });

    it('explains an error instead of ending the turn silently', () => {
        expect(agentMessageToAcp({ type: 'status', status: 'error', detail: 'exit 1: not logged in' }, idSeq()))
            .toEqual([
                { type: 'message', message: 'exit 1: not logged in' },
                { type: 'task_complete', id: 'id-1' },
            ]);
    });

    it('passes usage through as token_count without the internal type tag', () => {
        const [usage] = agentMessageToAcp(
            { type: 'token-count', inputTokens: 10, outputTokens: 2 } as never,
            idSeq(),
        );
        expect(usage).toEqual({ type: 'token_count', inputTokens: 10, outputTokens: 2 });
    });

    it('ignores message kinds with no ACP counterpart', () => {
        expect(agentMessageToAcp({ type: 'permission-response', id: 'p1', approved: true }, idSeq())).toEqual([]);
    });
});
