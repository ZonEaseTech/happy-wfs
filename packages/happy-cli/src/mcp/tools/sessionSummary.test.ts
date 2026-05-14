import { describe, expect, it } from 'vitest';
import { compactSessionMessages } from './sessionSummary';
import { DecryptedMessage } from '../messageDecrypt';

function msg(partial: Partial<DecryptedMessage> & Pick<DecryptedMessage, 'seq' | 'role' | 'content'>): DecryptedMessage {
    return {
        id: `m-${partial.seq}`,
        textPreview: '',
        sentBy: null,
        sentByName: null,
        createdAt: partial.seq * 1000,
        updatedAt: partial.seq * 1000,
        ...partial,
    };
}

describe('compactSessionMessages', () => {
    it('groups user text, assistant text, and compact tool names into turns', () => {
        const result = compactSessionMessages([
            msg({
                seq: 1,
                role: 'user',
                content: { type: 'mixed', text: 'Please fix it', images: [{ url: 'x' }] },
            }),
            msg({
                seq: 2,
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        message: {
                            content: [
                                { type: 'thinking', thinking: 'hidden' },
                                { type: 'text', text: 'I will inspect the code.' },
                                { type: 'tool_use', name: 'Bash', input: { command: 'git status' } },
                            ],
                        },
                    },
                },
            }),
        ], {
            textLimit: 200,
            maxTurns: 10,
            includeTools: true,
            maxToolsPerTurn: 5,
        });

        expect(result.compactedCount).toBe(3);
        expect(result.turns).toHaveLength(1);
        expect(result.turns[0].user?.text).toBe('Please fix it');
        expect(result.turns[0].user?.imageCount).toBe(1);
        expect(result.turns[0].assistantTexts[0].text).toBe('I will inspect the code.');
        expect(result.turns[0].tools[0].name).toBe('Bash');
    });

    it('trims long text and caps returned turns/tools', () => {
        const result = compactSessionMessages([
            msg({ seq: 1, role: 'user', content: { type: 'text', text: 'first' } }),
            msg({
                seq: 2,
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        message: {
                            content: [
                                { type: 'text', text: 'x'.repeat(50) },
                                { type: 'tool_use', name: 'Read' },
                                { type: 'tool_use', name: 'Edit' },
                            ],
                        },
                    },
                },
            }),
            msg({ seq: 3, role: 'user', content: { type: 'text', text: 'second' } }),
        ], {
            textLimit: 10,
            maxTurns: 1,
            includeTools: true,
            maxToolsPerTurn: 1,
        });

        expect(result.turns).toHaveLength(1);
        expect(result.turns[0].user?.text).toBe('second');
    });
});
