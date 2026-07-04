import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ops', () => ({
    sessionBash: vi.fn(),
}));

vi.mock('./storage', () => ({
    getSession: vi.fn(),
}));

import { sessionBash } from './ops';
import { findNearbyGitRepos } from './gitStatusFiles';

describe('findNearbyGitRepos', () => {
    beforeEach(() => {
        vi.mocked(sessionBash).mockReset();
    });

    it('returns only direct child repositories under the cwd', async () => {
        vi.mocked(sessionBash).mockResolvedValue({
            success: true,
            exitCode: 0,
            stdout: [
                '/workspace/ttpos-flutter/.git',
                '/workspace/ttpos-server-go/.git',
                '/workspace/workspace/happy-wfs/.git',
                '/workspace/workspace/happy-wfs-collab-app-core/.git',
                '/workspace/.git',
            ].join('\n'),
        } as any);

        const repos = await findNearbyGitRepos('session-1', '/workspace');

        expect(sessionBash).toHaveBeenCalledWith('session-1', expect.objectContaining({
            command: expect.stringContaining('-maxdepth 2'),
            cwd: '/workspace',
        }));
        expect(repos.map(repo => repo.path)).toEqual([
            '/workspace/ttpos-flutter',
            '/workspace/ttpos-server-go',
        ]);
    });
});
