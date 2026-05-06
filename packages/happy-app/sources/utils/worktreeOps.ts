/**
 * Worktree lifecycle operations.
 * All git commands execute remotely via machineBash.
 */

import { apiSocket } from '@/sync/apiSocket';
import { machineBash } from '@/sync/ops';
import type { Metadata } from '@/sync/storageTypes';
import { shellEscape } from './shellEscape';
import type { WorkspaceRepo } from '@/utils/workspaceRepos';

/** Validate a git ref name to prevent shell injection */
function isValidGitRef(name: string): boolean {
    return /^[a-zA-Z0-9._\/-]+$/.test(name) && name.length > 0 && name.length < 256;
}

/** Check if a session is a worktree session (detected by CLI at startup via git) */
export function isWorktreeSession(metadata: Metadata | null): boolean {
    if (!metadata) return false;
    return metadata.isWorktree === true;
}

/** Extract worktree info from metadata (set by CLI at startup via git) */
export function getWorktreeInfo(metadata: Metadata | null): { basePath: string; branchName: string } | null {
    if (!metadata) return null;
    if (metadata.worktreeBasePath && metadata.worktreeBranchName) {
        return { basePath: metadata.worktreeBasePath, branchName: metadata.worktreeBranchName };
    }
    return null;
}

/** Push the worktree branch to remote */
export async function pushWorktreeBranch(
    machineId: string,
    worktreePath: string,
    branchName: string
): Promise<{ success: boolean; error?: string }> {
    if (!isValidGitRef(branchName)) {
        return { success: false, error: 'Invalid branch name' };
    }
    const result = await machineBash(machineId, {
        command: `git push -u origin ${shellEscape(branchName)}`,
        cwd: worktreePath,
    });
    if (!result.success) {
        return { success: false, error: result.stderr || 'Failed to push branch' };
    }
    return { success: true };
}

/** Get local branch names in the base repository */
export async function getLocalBranches(
    machineId: string,
    basePath: string
): Promise<string[]> {
    const result = await machineBash(machineId, {
        command: "git branch --list --format='%(refname:short)'",
        cwd: basePath,
    });
    if (!result.success || !result.stdout.trim()) return [];
    return result.stdout.trim().split('\n').filter(Boolean);
}

/** Get the current branch name of the base repository */
export async function getCurrentBranch(
    machineId: string,
    basePath: string
): Promise<string | null> {
    const result = await machineBash(machineId, { command: 'git branch --show-current', cwd: basePath });
    if (!result.success || !result.stdout.trim()) return null;
    return result.stdout.trim();
}

/** Merge worktree branch into a specified target branch */
export async function mergeWorktreeBranch(
    machineId: string,
    basePath: string,
    branchName: string,
    targetBranch: string
): Promise<{ success: boolean; error?: string; hasConflicts?: boolean }> {
    if (!isValidGitRef(branchName) || !isValidGitRef(targetBranch)) {
        return { success: false, error: 'Invalid branch name' };
    }

    // Remember current branch so we can restore after merge
    const currentBranchResult = await machineBash(machineId, { command: 'git branch --show-current', cwd: basePath });
    const originalBranch = currentBranchResult.success ? currentBranchResult.stdout.trim() : null;
    const needsCheckout = originalBranch !== targetBranch;

    // Switch to target branch if needed
    if (needsCheckout) {
        const checkout = await machineBash(machineId, { command: `git checkout ${shellEscape(targetBranch)}`, cwd: basePath });
        if (!checkout.success) {
            return { success: false, error: checkout.stderr || `Failed to checkout ${targetBranch}` };
        }
    }

    const merge = await machineBash(machineId, { command: `git merge ${shellEscape(branchName)} --no-edit`, cwd: basePath });
    if (!merge.success) {
        const hasConflicts = merge.stdout.includes('CONFLICT') || merge.stderr.includes('CONFLICT');
        if (hasConflicts) {
            await machineBash(machineId, { command: 'git merge --abort', cwd: basePath });
        }
        // Restore original branch
        if (needsCheckout && originalBranch) {
            await machineBash(machineId, { command: `git checkout ${shellEscape(originalBranch)}`, cwd: basePath });
        }
        if (hasConflicts) {
            return { success: false, hasConflicts: true, error: 'Merge has conflicts' };
        }
        return { success: false, error: merge.stderr || 'Failed to merge branch' };
    }

    // Restore original branch after successful merge
    if (needsCheckout && originalBranch) {
        await machineBash(machineId, { command: `git checkout ${shellEscape(originalBranch)}`, cwd: basePath });
    }

    return { success: true };
}

/** Create a PR for the worktree branch using gh CLI */
export async function createWorktreePR(
    machineId: string,
    worktreePath: string,
    branchName: string,
    title?: string,
    baseBranch?: string,
): Promise<{ success: boolean; prUrl?: string; error?: string }> {
    if (!isValidGitRef(branchName)) {
        return { success: false, error: 'Invalid branch name' };
    }
    if (baseBranch && !isValidGitRef(baseBranch)) {
        return { success: false, error: 'Invalid base branch name' };
    }

    // Check if gh is installed
    const ghCheck = await machineBash(machineId, { command: 'gh --version', cwd: worktreePath });
    if (!ghCheck.success) {
        return { success: false, error: 'gh_not_installed' };
    }

    // Push first
    const push = await pushWorktreeBranch(machineId, worktreePath, branchName);
    if (!push.success) {
        return { success: false, error: push.error };
    }

    // Create PR with safe quoting
    const prTitle = title || branchName;
    const baseArg = baseBranch ? ` --base ${shellEscape(baseBranch)}` : '';
    const result = await machineBash(machineId, {
        command: `gh pr create --head ${shellEscape(branchName)}${baseArg} --title ${shellEscape(prTitle)} --body 'Created from Happy mobile app'`,
        cwd: worktreePath,
    });
    if (!result.success) {
        return { success: false, error: result.stderr || 'Failed to create PR' };
    }

    const prUrl = result.stdout.trim();
    return { success: true, prUrl };
}


/** Clean up the worktree (remove worktree directory, optionally delete the local branch) */
export async function cleanupWorktree(
    machineId: string,
    basePath: string,
    branchName: string,
    deleteBranch?: boolean
): Promise<{ success: boolean; error?: string }> {
    if (!isValidGitRef(branchName)) {
        return { success: false, error: 'Invalid branch name' };
    }

    const worktreeDir = `.dev/worktree/${branchName}`;

    const result = await machineBash(machineId, {
        command: `git worktree remove ${shellEscape(worktreeDir)} --force`,
        cwd: basePath,
    });

    if (!result.success) {
        if (result.stderr.includes('is not a working tree') || result.stderr.includes('No such file')) {
            // Worktree already gone — continue to branch deletion if requested
        } else {
            return { success: false, error: result.stderr || 'Failed to remove worktree' };
        }
    }

    if (deleteBranch) {
        const branchResult = await machineBash(machineId, {
            command: `git branch -D ${shellEscape(branchName)}`,
            cwd: basePath,
        });
        if (!branchResult.success) {
            // Non-fatal: worktree was already cleaned up
            if (!branchResult.stderr.includes('not found')) {
                return { success: true, error: branchResult.stderr || 'Worktree removed but failed to delete branch' };
            }
        }
    }

    return { success: true };
}

interface ArchiveWorkspaceResult {
    results: Array<{ repo: string; success: boolean; error?: string }>;
}

interface ArchiveWorkspaceParams {
    workspacePath: string;
    repos: Array<{
        worktreePath: string;
        basePath: string;
        branchName: string;
        archiveScript?: string;
        deleteBranch: boolean;
    }>;
}

/**
 * Clean up all worktrees in a workspace via daemon RPC.
 */
export async function cleanupWorkspace(
    machineId: string,
    workspacePath: string,
    repos: WorkspaceRepo[],
    deleteBranch: boolean,
    repoScripts?: Array<{ worktreePath: string; archiveScript?: string }>,
): Promise<{ success: boolean; errors: string[] }> {
    // Use archive-workspace RPC to let daemon handle scripts + cleanup
    const result = await apiSocket.machineRPC<ArchiveWorkspaceResult, ArchiveWorkspaceParams>(machineId, 'archive-workspace', {
        workspacePath,
        repos: repos.map((repo, i) => ({
            worktreePath: repo.path,
            basePath: repo.basePath,
            branchName: repo.branchName,
            archiveScript: repoScripts?.[i]?.archiveScript,
            deleteBranch,
        })),
    });

    const errors = result.results?.filter(r => !r.success).map(r => r.error ?? '') || [];
    return { success: errors.length === 0, errors };
}
