import { describe, expect, it, vi } from 'vitest';

vi.mock('./storage', () => ({
    getSession: vi.fn(() => ({ metadata: { codexSessionId: 'codex-1' } })),
}));

import { searchCommands } from './suggestionCommands';

describe('suggestionCommands Superpowers shortcuts', () => {
    it('suggests /brainstorm when filtering by b', async () => {
        const results = await searchCommands('session-1', 'b', { limit: 5 });

        expect(results).toEqual(expect.arrayContaining([
            expect.objectContaining({
                command: 'brainstorm',
                description: expect.stringContaining('brainstorming'),
                insertText: expect.stringContaining('brainstorming skill'),
            }),
        ]));
    });

    it('returns Superpowers shortcuts in the default command list', async () => {
        const results = await searchCommands('session-1', '', { limit: 20 });

        expect(results.map(item => item.command)).toEqual(expect.arrayContaining([
            'brainstorm',
            'plan',
            'debug',
            'tdd',
            'verify',
            'review',
        ]));
    });
});
