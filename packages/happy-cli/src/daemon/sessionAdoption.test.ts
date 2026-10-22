import { describe, expect, it, vi } from 'vitest';
import { adoptSessionsFromPreviousRun, planSessionAdoption, type ServerSessionSnapshot, type SessionAdoptionDeps } from './sessionAdoption';

vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const MACHINE = 'machine-a';

function session(id: string, metadata: Record<string, any> | null, extra: Partial<ServerSessionSnapshot> = {}): ServerSessionSnapshot {
    return { id, active: true, activeAt: 1000, metadata, ...extra };
}

describe('planSessionAdoption', () => {
    it('tracks sessions whose process is still running and resumes the ones whose process is gone', () => {
        const plan = planSessionAdoption({
            machineId: MACHINE,
            alivePids: new Set([111]),
            sessions: [
                session('alive', { machineId: MACHINE, hostPid: 111, path: '/w/a', claudeSessionId: 'c-1' }),
                session('dead', { machineId: MACHINE, hostPid: 222, path: '/w/b', claudeSessionId: 'c-2', summary: { text: 'Fix login' } }),
            ],
        });

        expect(plan.track).toEqual([{ id: 'alive', pid: 111, metadata: expect.anything() }]);
        expect(plan.resume).toEqual([expect.objectContaining({ id: 'dead', agent: 'claude', directory: '/w/b', forkSource: 'c-2', title: 'Fix login' })]);
        expect(plan.skipped).toEqual([]);
    });

    it('leaves other machines, inactive sessions and unreadable rows alone', () => {
        const plan = planSessionAdoption({
            machineId: MACHINE,
            alivePids: new Set(),
            sessions: [
                session('elsewhere', { machineId: 'machine-b', hostPid: 5, path: '/w', claudeSessionId: 'c' }),
                session('archived', { machineId: MACHINE, hostPid: 6, path: '/w', claudeSessionId: 'c' }, { active: false }),
                session('unreadable', null),
            ],
        });

        expect(plan.track).toEqual([]);
        expect(plan.resume).toEqual([]);
        expect(plan.skipped).toEqual([]);
    });

    it('picks the fork source each agent resumes from', () => {
        const plan = planSessionAdoption({
            machineId: MACHINE,
            alivePids: new Set(),
            sessions: [
                session('codex', { machineId: MACHINE, path: '/w', flavor: 'codex', codexSessionId: 'conv-1' }),
                session('gemini', { machineId: MACHINE, path: '/w', flavor: 'gemini' }),
                session('cursor', { machineId: MACHINE, path: '/w', flavor: 'cursor', cursorSessionId: 'chat-1' }),
                session('codex-no-id', { machineId: MACHINE, path: '/w', flavor: 'codex' }),
                session('no-path', { machineId: MACHINE, claudeSessionId: 'c' }),
            ],
        });

        expect(plan.resume.map((s) => [s.id, s.agent, s.forkSource])).toEqual([
            ['codex', 'codex', 'conv-1'],
            ['gemini', 'gemini', 'gemini'],
            ['cursor', 'cursor', 'chat-1'],
        ]);
        expect(plan.skipped.map((s) => s.id)).toEqual(['codex-no-id', 'no-path']);
    });

    it('resumes the most recently active session first', () => {
        const plan = planSessionAdoption({
            machineId: MACHINE,
            alivePids: new Set(),
            sessions: [
                session('older', { machineId: MACHINE, path: '/w', claudeSessionId: 'c1' }, { activeAt: 10 }),
                session('newer', { machineId: MACHINE, path: '/w', claudeSessionId: 'c2' }, { activeAt: 20 }),
            ],
        });
        expect(plan.resume.map((s) => s.id)).toEqual(['newer', 'older']);
    });
});

describe('adoptSessionsFromPreviousRun', () => {
    function deps(overrides: Partial<SessionAdoptionDeps> = {}): SessionAdoptionDeps & { calls: string[] } {
        const calls: string[] = [];
        return {
            calls,
            machineId: MACHINE,
            listActiveSessions: async () => [
                session('alive', { machineId: MACHINE, hostPid: 111, path: '/w/a', claudeSessionId: 'c-1' }),
                session('dead', { machineId: MACHINE, hostPid: 222, path: '/w/b', claudeSessionId: 'c-2', summary: { text: 'Fix login' } }),
            ],
            listAliveSessionPids: async () => new Set([111]),
            fork: async (agent, source) => { calls.push(`fork:${agent}:${source}`); return { success: true, resumeSessionId: `${source}-copy` }; },
            spawnSession: async (options) => { calls.push(`spawn:${options.directory}:${options.resumeSessionId}:${options.intent}:${options.sessionTitle}`); return { type: 'success', sessionId: 'new-1' }; },
            archiveSession: async (id) => { calls.push(`archive:${id}`); return true; },
            track: (s) => { calls.push(`track:${s.id}:${s.pid}`); },
            ...overrides,
        };
    }

    it('tracks the live one, then forks, spawns and retires the dead one', async () => {
        const d = deps();
        const report = await adoptSessionsFromPreviousRun(d);

        expect(report).toEqual({ tracked: 1, resumed: [{ from: 'dead', to: 'new-1' }], failed: [], skipped: [] });
        expect(d.calls).toEqual([
            'track:alive:111',
            'fork:claude:c-2',
            'spawn:/w/b:c-2-copy:resume:Fix login',
            'archive:dead',
        ]);
    });

    it('keeps the old session active when the fork or spawn fails, so a later attempt can retry', async () => {
        const d = deps({ fork: async () => ({ success: false, errorMessage: 'transcript missing' }) });
        const report = await adoptSessionsFromPreviousRun(d);

        expect(report.failed).toEqual([{ id: 'dead', reason: 'transcript missing' }]);
        expect(d.calls.some((c) => c.startsWith('archive:'))).toBe(false);
        expect(d.calls.some((c) => c.startsWith('spawn:'))).toBe(false);
    });

    it('does not create a session for a directory that no longer exists', async () => {
        const d = deps({ spawnSession: async (o) => ({ type: 'requestToApproveDirectoryCreation', directory: o.directory }) });
        const report = await adoptSessionsFromPreviousRun(d);

        expect(report.failed).toEqual([{ id: 'dead', reason: 'directory missing: /w/b' }]);
        expect(d.calls.some((c) => c.startsWith('archive:'))).toBe(false);
    });

    it('still reports the resume when only the retire step fails', async () => {
        const d = deps({ archiveSession: async () => false });
        const report = await adoptSessionsFromPreviousRun(d);
        expect(report.resumed).toEqual([{ from: 'dead', to: 'new-1' }]);
    });
});
