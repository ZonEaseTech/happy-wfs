import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The daemon kills a bash command at the request timeout, 30s when none is
 * given. Checking out a ~10k-file repo takes longer than that on a busy disk,
 * so `git worktree add` was cut off at "Updating files: 53%" and the whole
 * workspace rolled back every time.
 */

const machineBash = vi.fn();
vi.mock('@/sync/ops', () => ({ machineBash: (...a: unknown[]) => machineBash(...a) }));
vi.mock('@/sync/storage', () => ({ storage: { getState: () => ({ localSettings: { worktreeBranchPrefix: 'happy/' } }) } }));

const { createWorkspace } = await import('./createWorkspace');

const DAEMON_DEFAULT_TIMEOUT_MS = 30_000;
const callsStartingWith = (prefix: string) => machineBash.mock.calls
    .map(([, opts]) => opts as { command: string; timeout?: number })
    .filter((opts) => opts.command.startsWith(prefix));

describe('createWorkspace gives slow git commands enough time', () => {
    beforeEach(() => {
        machineBash.mockReset().mockImplementation(async (_m: string, opts: { command: string }) => ({
            success: true,
            stdout: opts.command.startsWith('realpath') ? '/home/u/.happy/workspaces/ws' : '',
            stderr: '',
        }));
    });

    it('asks for far more than the daemon default when adding a worktree', async () => {
        const result = await createWorkspace('m1', [{ repo: { path: '/workspace/ttpos-flutter', displayName: 'ttpos-flutter' } }]);

        expect(result.success).toBe(true);
        const adds = callsStartingWith('git worktree add');
        expect(adds).toHaveLength(1);
        expect(adds[0].timeout).toBeGreaterThanOrEqual(10 * 60 * 1000);
    });

    it('also lets the rollback finish tearing down a half-checked-out worktree', async () => {
        machineBash.mockImplementation(async (_m: string, opts: { command: string }) => {
            if (opts.command.startsWith('realpath')) return { success: true, stdout: '/home/u/.happy/workspaces/ws', stderr: '' };
            if (opts.command.includes('ttpos-server-go')) return { success: false, stdout: '', stderr: 'Command timed out' };
            return { success: true, stdout: '', stderr: '' };
        });

        const result = await createWorkspace('m1', [
            { repo: { path: '/workspace/ttpos-flutter', displayName: 'ttpos-flutter' } },
            { repo: { path: '/workspace/ttpos-server-go', displayName: 'ttpos-server-go' } },
        ]);

        expect(result.success).toBe(false);
        for (const opts of [...callsStartingWith('git worktree remove'), ...callsStartingWith('rm -rf')]) {
            expect(opts.timeout).toBeGreaterThan(DAEMON_DEFAULT_TIMEOUT_MS);
        }
        expect(callsStartingWith('git worktree remove')).toHaveLength(1);
        expect(callsStartingWith('rm -rf')).toHaveLength(1);
    });
});
