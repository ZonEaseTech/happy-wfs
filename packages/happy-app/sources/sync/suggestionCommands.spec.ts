import { describe, expect, it, vi } from 'vitest';

const draftSessions = {
    older: { activeAt: 1, metadata: { machineId: 'm1', path: '/other', flavor: 'claude', slashCommands: ['older-skill'] } },
    samePath: { activeAt: 2, metadata: { machineId: 'm1', path: '/workspace/skills', flavor: 'claude', slashCommands: ['ws-skill', 'compact', 'model'] } },
    newestOtherPath: { activeAt: 3, metadata: { machineId: 'm1', path: '/elsewhere', flavor: 'claude', slashCommands: ['elsewhere-skill'] } },
    codex: { activeAt: 4, metadata: { machineId: 'm1', path: '/workspace/skills', flavor: 'codex', skills: [{ name: 'codex-skill' }] } },
    otherMachine: { activeAt: 5, metadata: { machineId: 'm2', path: '/workspace/skills', flavor: 'claude', slashCommands: ['m2-skill'] } },
};

vi.mock('./storage', () => ({
    getSession: vi.fn(() => ({ metadata: { codexSessionId: 'codex-1' } })),
    storage: { getState: () => ({ sessions: draftSessions }) },
}));

import { searchCommands, searchDraftCommands } from './suggestionCommands';

describe('searchDraftCommands', () => {
    it('borrows commands from the same agent on the same machine, preferring the same directory', async () => {
        const results = await searchDraftCommands({ machineId: 'm1', path: '/workspace/skills', agentType: 'claude' }, '', { limit: 100 });
        const names = results.map(item => item.command);

        expect(names).toContain('ws-skill');
        expect(names).not.toContain('elsewhere-skill');
        expect(names).not.toContain('codex-skill');
        expect(names).not.toContain('m2-skill');
        expect(names).not.toContain('model');
        expect(names).not.toContain('clear');
    });

    it('falls back to the most recent session when no session used this directory', async () => {
        const results = await searchDraftCommands({ machineId: 'm1', path: '/new', agentType: 'claude' }, '', { limit: 100 });
        expect(results.map(item => item.command)).toContain('elsewhere-skill');
    });

    it('offers codex skills for a codex draft', async () => {
        const results = await searchDraftCommands({ machineId: 'm1', path: '/x', agentType: 'codex' }, 'codex', { limit: 100 });
        expect(results[0]).toEqual(expect.objectContaining({ command: 'codex-skill', kind: 'skill' }));
    });
});

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
