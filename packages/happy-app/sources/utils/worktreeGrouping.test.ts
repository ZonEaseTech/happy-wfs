import { describe, expect, it } from 'vitest';
import { getMergedGroupPath, getWorktreeBranchLabel } from './worktreeGrouping';

const home = '/home/weifashi';
const repo = (name: string, branchName: string, workspace: string) => ({
    path: `${home}/.happy/workspaces/${workspace}/${name}`,
    basePath: `/workspace/ttpos/${name}`,
    branchName,
});

describe('getMergedGroupPath', () => {
    it('keeps ordinary directories in their own group', () => {
        expect(getMergedGroupPath({ path: '/workspace/happy-wfs', homeDir: home })).toBe('/workspace/happy-wfs');
        expect(getMergedGroupPath({ path: '/workspace/AVTools', homeDir: home })).toBe('/workspace/AVTools');
        expect(getMergedGroupPath({ path: home, homeDir: home })).toBe(home);
    });

    it('puts a multi-repo workspace under the repos\' common parent', () => {
        expect(getMergedGroupPath({
            path: `${home}/.happy/workspaces/calm-bridge-qnq8`,
            homeDir: home,
            workspacePath: `${home}/.happy/workspaces/calm-bridge-qnq8`,
            workspaceRepos: [
                repo('ttpos-flutter', 'feature/bug-412-member-login-guest-fail', 'calm-bridge-qnq8'),
                repo('ttpos-server-go', 'calm-bridge-qnq8', 'calm-bridge-qnq8'),
            ],
        })).toBe('/workspace/ttpos');
    });

    it('puts a single-repo workspace and a legacy worktree under their source repo', () => {
        expect(getMergedGroupPath({
            path: `${home}/.happy/workspaces/quiet-prairie-3h05/ttpos-flutter`,
            homeDir: home,
            workspaceRepos: [repo('ttpos-flutter', 'feature/marketing-v232', 'quiet-prairie-3h05')],
        })).toBe('/workspace/ttpos/ttpos-flutter');
        expect(getMergedGroupPath({
            path: '/workspace/happy-wfs-wt/fix-dedupe',
            worktreeBasePath: '/workspace/happy-wfs',
        })).toBe('/workspace/happy-wfs');
    });

    it('falls back to the parent only for unlabelled worktrees under ~/.happy/', () => {
        expect(getMergedGroupPath({ path: `${home}/.happy/workspaces/vk-1234`, homeDir: home })).toBe(`${home}/.happy/workspaces`);
    });
});

describe('getWorktreeBranchLabel', () => {
    it('prefers the task branch over the one named after the workspace', () => {
        expect(getWorktreeBranchLabel({
            path: `${home}/.happy/workspaces/calm-bridge-qnq8`,
            workspacePath: `${home}/.happy/workspaces/calm-bridge-qnq8`,
            workspaceRepos: [
                repo('ttpos-server-go', 'calm-bridge-qnq8', 'calm-bridge-qnq8'),
                repo('ttpos-flutter', 'feature/bug-412-member-login-guest-fail', 'calm-bridge-qnq8'),
            ],
        })).toBe('bug-412-member-login-guest-fail');
    });

    it('treats happy/<name> as the workspace default branch', () => {
        expect(getWorktreeBranchLabel({
            workspacePath: `${home}/.happy/workspaces/happy-vivid-glacier-gixr`,
            workspaceRepos: [
                repo('ttpos-flutter', 'happy/vivid-glacier-gixr', 'happy-vivid-glacier-gixr'),
                repo('ttpos-server-go', 'feature/marketing-v232', 'happy-vivid-glacier-gixr'),
            ],
        })).toBe('marketing-v232');
    });

    it('shows nothing when every branch is just the random workspace name', () => {
        expect(getWorktreeBranchLabel({
            workspacePath: `${home}/.happy/workspaces/clear-beacon-rb41`,
            workspaceRepos: [repo('ttpos-flutter', 'clear-beacon-rb41', 'clear-beacon-rb41')],
        })).toBeNull();
        expect(getWorktreeBranchLabel({
            workspacePath: `${home}/.happy/workspaces/keen-island-nkw7`,
            workspaceRepos: [repo('ttpos-flutter', 'happy/keen-island-nkw7', 'keen-island-nkw7')],
        })).toBeNull();
        expect(getWorktreeBranchLabel({
            path: `${home}/.happy/workspaces/happy-keen-island-nkw7/ttpos-flutter`,
            workspaceRepos: [repo('ttpos-flutter', 'happy/keen-island-nkw7', 'happy-keen-island-nkw7')],
        })).toBeNull();
        expect(getWorktreeBranchLabel({ worktreeBranchName: 'feature/fix-dedupe' })).toBe('fix-dedupe');
    });

    it('returns nothing for ordinary sessions', () => {
        expect(getWorktreeBranchLabel({ path: '/workspace/happy-wfs' })).toBeNull();
    });
});
