import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(__dirname, '..');

function read(relativePath: string): string {
    return readFileSync(resolve(sourceRoot, relativePath), 'utf8');
}

describe('auto-discovered workspace repos integration', () => {
    it('feeds discovered child repos into the Files repo selector flow', () => {
        const source = read('app/(app)/session/[id]/files.tsx');

        expect(source).toContain('getDiscoveredWorkspaceRepos');
        expect(source).toContain('autoWorkspaceRepos');
        expect(source).toContain('setAutoWorkspaceRepos(discoveredRepos)');
        expect(source).toContain('metadataWorkspaceRepos.length > 0 ? metadataWorkspaceRepos : autoWorkspaceRepos');
    });

    it('feeds discovered child repos into the Commits repo selector flow', () => {
        const source = read('app/(app)/session/[id]/commits.tsx');

        expect(source).toContain('getDiscoveredWorkspaceRepos');
        expect(source).toContain('autoWorkspaceRepos');
        expect(source).toContain('setAutoWorkspaceRepos(discoveredRepos)');
        expect(source).toContain('metadataWorkspaceRepos.length > 0 ? metadataWorkspaceRepos : autoWorkspaceRepos');
    });
});

describe('sidebar git status chips', () => {
    it('keeps per-session git status visible without requiring merged worktree groups', () => {
        const source = read('components/ActiveSessionsGroupCompact.tsx');

        expect(source).toContain('<ProjectGitStatus sessionId={session.id} />');
        expect(source).not.toContain('{mergeWorktreeGroups && (\n                        <View style={{ marginLeft: 8, flexShrink: 0 }}>\n                            <ProjectGitStatus sessionId={session.id} />');
    });
});
