import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiSocketMock, state } = vi.hoisted(() => ({
    apiSocketMock: {
        machineRPC: vi.fn(),
        machineSpawnHTTP: vi.fn(),
    },
    state: {
        machines: {} as Record<string, any>,
    },
}));

vi.mock('./apiSocket', () => ({ apiSocket: apiSocketMock }));
vi.mock('./sync', () => ({ sync: {} }));
vi.mock('./storage', () => ({ storage: { getState: () => state } }));

import { machineForkClaudeSession, machineSpawnNewSession } from './ops';

describe('machine RPC fallback', () => {
    beforeEach(() => {
        apiSocketMock.machineRPC.mockReset();
        apiSocketMock.machineSpawnHTTP.mockReset();
        state.machines = {
            'old-machine': {
                id: 'old-machine',
                active: false,
                activeAt: 1,
                metadata: { host: 'wfs' },
            },
            'current-machine': {
                id: 'current-machine',
                active: true,
                activeAt: 2,
                metadata: { host: 'wfs' },
            },
        };
    });

    it('forks a Claude session on the current machine when the saved machine RPC is unavailable', async () => {
        apiSocketMock.machineRPC.mockImplementation(async (machineId: string, method: string) => {
            if (machineId === 'old-machine') throw new Error('RPC method not available');
            if (machineId === 'current-machine' && method === 'claude-fork-session') {
                return { success: true, newSessionId: 'forked-claude-session' };
            }
            throw new Error(`unexpected call ${machineId}:${method}`);
        });

        const result = await machineForkClaudeSession('old-machine', 'claude-session');

        expect(result).toEqual({ success: true, newSessionId: 'forked-claude-session', errorMessage: undefined });
        expect(apiSocketMock.machineRPC.mock.calls.map(([machineId, method]) => `${machineId}:${method}`)).toEqual([
            'old-machine:claude-fork-session',
            'current-machine:claude-fork-session',
        ]);
    });

    it('spawns the resumed session on the current machine when the saved machine RPC is unavailable', async () => {
        apiSocketMock.machineSpawnHTTP.mockImplementation(async (machineId: string) => {
            if (machineId === 'old-machine') throw new Error('RPC method not available: old-machine:spawn-happy-session');
            if (machineId === 'current-machine') return { type: 'success', sessionId: 'new-session' };
            throw new Error(`unexpected machine ${machineId}`);
        });

        const result = await machineSpawnNewSession({
            machineId: 'old-machine',
            directory: '/workspace',
            agent: 'claude',
            resumeSessionId: 'forked-claude-session',
            intent: 'resume',
        });

        expect(result).toEqual({ type: 'success', sessionId: 'new-session' });
        expect(apiSocketMock.machineSpawnHTTP.mock.calls.map(([machineId]) => machineId)).toEqual([
            'old-machine',
            'current-machine',
        ]);
    });
});
