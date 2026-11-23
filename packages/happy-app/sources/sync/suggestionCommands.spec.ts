import { describe, expect, it, vi } from 'vitest';

const draftSessions = {
    older: { createdAt: 1, activeAt: 9, metadata: { machineId: 'm1', path: '/workspace/menu', flavor: 'claude', slashCommands: ['superpowers:brainstorming', 'compact', 'model'] } },
    newest: { createdAt: 3, activeAt: 3, metadata: { machineId: 'm1', path: '/elsewhere', flavor: 'claude', slashCommands: ['wfs:mockup', 'compact', 'model'] } },
    codex: { createdAt: 4, activeAt: 4, metadata: { machineId: 'm1', path: '/workspace/menu', flavor: 'codex', skills: [{ name: 'codex-skill' }] } },
    otherMachine: { createdAt: 5, activeAt: 5, metadata: { machineId: 'm2', path: '/workspace/menu', flavor: 'claude', slashCommands: ['m2-skill'] } },
};

vi.mock('./storage', () => ({
    getSession: vi.fn(() => ({ metadata: { codexSessionId: 'codex-1' } })),
    storage: { getState: () => ({ sessions: draftSessions }) },
}));

import { searchCommands, searchDraftCommands } from './suggestionCommands';

describe('searchDraftCommands', () => {
    it('uses the newest session of the same agent on the same machine', async () => {
        const results = await searchDraftCommands({ machineId: 'm1', agentType: 'claude' }, '', { limit: 100 });
        const names = results.map(item => item.command);

        expect(names).toContain('wfs:mockup');
        expect(names).not.toContain('superpowers:brainstorming');
        expect(names).not.toContain('codex-skill');
        expect(names).not.toContain('m2-skill');
        expect(names).not.toContain('model');
        expect(names).not.toContain('clear');
    });

    it('offers codex skills for a codex draft', async () => {
        const results = await searchDraftCommands({ machineId: 'm1', agentType: 'codex' }, 'codex', { limit: 100 });
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
