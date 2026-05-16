import { describe, expect, it } from 'vitest';
import { buildWorktreeAddCommand, normalizeExistingWorktreeBranch } from './createWorkspaceBranches';

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
