import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every repo in a workspace shares one generated branch name, so the same
 * checkout appearing twice made the second `git worktree add -b` fail with
 * "a branch named … already exists" and rolled the whole workspace back.
 */

const machineBash = vi.fn();
vi.mock('@/sync/ops', () => ({ machineBash: (...a: unknown[]) => machineBash(...a) }));
vi.mock('@/sync/storage', () => ({ storage: { getState: () => ({ localSettings: { worktreeBranchPrefix: 'happy/' } }) } }));

const { createWorkspace } = await import('./createWorkspace');

const repo = (path: string, displayName: string) => ({ repo: { path, displayName } });

describe('createWorkspace de-duplicates repos by path', () => {
    beforeEach(() => {
        machineBash.mockReset().mockImplementation(async (_m: string, opts: { command: string }) => ({
            success: true,
            stdout: opts.command.startsWith('realpath') ? '/home/u/.happy/workspaces/ws' : '',
            stderr: '',
        }));
    });

    const worktreeAdds = () => machineBash.mock.calls
        .map(([, opts]) => opts.command as string)
        .filter((c) => c.startsWith('git worktree add'));

    it('creates one worktree per checkout even when the same repo is listed twice', async () => {
        const result = await createWorkspace('m1', [
            repo('/workspace/ttpos-flutter', 'ttpos-flutter'),
            repo('/workspace/ttpos-server-go', 'ttpos-server-go'),
            // Same checkout again — this is what the picker used to allow.
            repo('/workspace/ttpos-flutter', 'ttpos-flutter'),
        ]);

        expect(result.success).toBe(true);
        const adds = worktreeAdds();
        expect(adds).toHaveLength(2);
        expect(adds.filter((c) => c.includes('ttpos-flutter'))).toHaveLength(1);
        expect(result.repos.map((r) => r.basePath)).toEqual([
            '/workspace/ttpos-flutter',
            '/workspace/ttpos-server-go',
        ]);
    });

    it('leaves genuinely different repos alone', async () => {
        const result = await createWorkspace('m1', [
            repo('/workspace/ttpos-flutter', 'ttpos-flutter'),
            repo('/workspace/ttpos-server-go', 'ttpos-server-go'),
        ]);
        expect(result.success).toBe(true);
        expect(worktreeAdds()).toHaveLength(2);
    });
});
