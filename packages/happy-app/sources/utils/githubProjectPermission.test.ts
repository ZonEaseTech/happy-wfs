import { describe, expect, it } from 'vitest';
import { GITHUB_PROJECT_RECONNECT_MESSAGE, isGitHubProjectPermissionError } from './githubProjectPermission';

describe('github project permission errors', () => {
    it('detects ProjectV2 update scope failures', () => {
        expect(isGitHubProjectPermissionError(
            "The 'updateProjectV2ItemFieldValue' field requires one of the following scopes: ['project']",
        )).toBe(true);
    });

    it('asks the user to reconnect GitHub instead of entering a token manually', () => {
        expect(GITHUB_PROJECT_RECONNECT_MESSAGE).toContain('重新连接 GitHub');
        expect(GITHUB_PROJECT_RECONNECT_MESSAGE).toContain('project');
    });
});
