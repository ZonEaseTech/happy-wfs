import { describe, expect, it } from 'vitest';
import { GITHUB_OAUTH_SCOPE } from './githubOAuthScope';

describe('GitHub OAuth scope', () => {
    it('requests writable project scope for ProjectV2 status updates', () => {
        const scopes = GITHUB_OAUTH_SCOPE.split(',');

        expect(scopes).toContain('project');
        expect(scopes).not.toContain('read:project');
    });
});
