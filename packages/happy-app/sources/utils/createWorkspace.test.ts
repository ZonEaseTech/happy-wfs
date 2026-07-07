import { describe, expect, it } from 'vitest';
import { buildCopyFileCommand, buildWorktreeAddCommand, normalizeExistingWorktreeBranch } from './createWorkspaceBranches';

describe('buildCopyFileCommand', () => {
    const params = {
        repoPath: '/workspace/ttpos-server-go',
        worktreePath: '/home/u/.happy/workspaces/ws1/ttpos-server-go',
        workspacePath: '/home/u/.happy/workspaces/ws1',
    };

    it('copies relative entries from the repo root into the worktree', () => {
        expect(buildCopyFileCommand({ ...params, file: '.env' })).toBe(
            "mkdir -p \"$(dirname '/home/u/.happy/workspaces/ws1/ttpos-server-go/.env')\" && cp '/workspace/ttpos-server-go/.env' '/home/u/.happy/workspaces/ws1/ttpos-server-go/.env' 2>/dev/null",
        );
    });

    it('copies absolute entries to the workspace root by basename', () => {
        expect(buildCopyFileCommand({ ...params, file: '/workspace/.mcp.json' })).toBe(
            "cp '/workspace/.mcp.json' '/home/u/.happy/workspaces/ws1/.mcp.json' 2>/dev/null",
        );
    });

    it('skips path traversal and empty entries', () => {
        expect(buildCopyFileCommand({ ...params, file: '../secrets' })).toBeNull();
        expect(buildCopyFileCommand({ ...params, file: '/etc/../secrets' })).toBeNull();
        expect(buildCopyFileCommand({ ...params, file: '  ' })).toBeNull();
        expect(buildCopyFileCommand({ ...params, file: '/' })).toBeNull();
    });
});

describe('normalizeExistingWorktreeBranch', () => {
    it('keeps local branch names including slashes', () => {
        expect(normalizeExistingWorktreeBranch('feature/report-fix')).toEqual({
            branchName: 'feature/report-fix',
        });
    });

    it('turns origin remote branches into local tracking branch targets', () => {
        expect(normalizeExistingWorktreeBranch('origin/feature/report-fix')).toEqual({
            branchName: 'feature/report-fix',
            startPoint: 'origin/feature/report-fix',
        });
    });
});

describe('buildWorktreeAddCommand', () => {
    it('creates a new generated branch for new-branch mode', () => {
        expect(buildWorktreeAddCommand({
            mode: 'new',
            workspaceBranchName: 'vk/happy-branch',
            worktreePath: '/tmp/ws/repo',
            targetBranch: 'develop',
        })).toBe("git worktree add -b 'vk/happy-branch' '/tmp/ws/repo' 'develop'");
    });

    it('checks out the selected local branch directly for existing-branch mode', () => {
        expect(buildWorktreeAddCommand({
            mode: 'existing',
            workspaceBranchName: 'ignored/generated',
            worktreePath: '/tmp/ws/repo',
            targetBranch: 'feature/report-fix',
        })).toBe("git worktree add '/tmp/ws/repo' 'feature/report-fix'");
    });

    it('creates a local branch from origin branch for existing-branch mode', () => {
        expect(buildWorktreeAddCommand({
            mode: 'existing',
            workspaceBranchName: 'ignored/generated',
            worktreePath: '/tmp/ws/repo',
            targetBranch: 'origin/feature/report-fix',
        })).toBe("git worktree add -b 'feature/report-fix' '/tmp/ws/repo' 'origin/feature/report-fix'");
    });
});
