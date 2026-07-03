import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const commitsSource = readFileSync(resolve(__dirname, 'commits.tsx'), 'utf8');

describe('commits nearby repository empty state', () => {
    it('auto-scans nearby git repositories when the active cwd is not a git repository', () => {
        expect(commitsSource).toContain('findNearbyGitRepos');
        expect(commitsSource).toContain('adHocRepoPath');
        expect(commitsSource).toContain('setNearbyRepos(repos)');
        expect(commitsSource).toContain("t('files.foundNearbyRepos')");
        expect(commitsSource).toMatch(/not a git repository/i);
    });
});
