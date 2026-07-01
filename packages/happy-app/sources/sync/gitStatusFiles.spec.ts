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

    it('limits auto-discovery to direct child repositories', async () => {
        vi.mocked(sessionBash).mockResolvedValue({
            success: true,
            exitCode: 0,
            stdout: '/workspace/ttpos-flutter/.git\n/workspace/ttpos-server-go/.git\n',
            stderr: '',
        });

        const repos = await findNearbyGitRepos('session-1', '/workspace');

        expect(sessionBash).toHaveBeenCalledWith(
            'session-1',
            expect.objectContaining({
                command: expect.stringContaining('-maxdepth 2'),
                cwd: '/workspace',
                timeout: 5000,
            }),
        );
        const command = vi.mocked(sessionBash).mock.calls[0]?.[1]?.command ?? '';
        expect(command).not.toContain('-maxdepth 3');
        expect(repos).toEqual([
            {
                path: '/workspace/ttpos-flutter',
                name: 'ttpos-flutter',
            },
            {
                path: '/workspace/ttpos-server-go',
                name: 'ttpos-server-go',
            },
        ]);
    });
});
