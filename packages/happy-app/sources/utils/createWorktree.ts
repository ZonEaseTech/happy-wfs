/**
 * Create a Git worktree with automatic branch creation
 */

import { machineBash } from '@/sync/ops';
import { generateWorktreeName } from './generateWorktreeName';
import { shellEscape } from './shellEscape';
import { storage } from '@/sync/storage';

/**
 * Read the user's worktree branch prefix preference. Trailing "/" is left as-is
 * so users can opt into namespacing (e.g. "vk/" → "vk/clever-ocean") or no
 * separator (e.g. "feat-" → "feat-clever-ocean").
 */
function getBranchPrefix(): string {
    return storage.getState().localSettings?.worktreeBranchPrefix ?? '';
}

export async function createWorktree(
    machineId: string,
    basePath: string
): Promise<{
    success: boolean;
    worktreePath: string;
    branchName: string;
    error?: string;
}> {
    const name = generateWorktreeName();
    const prefix = getBranchPrefix();
    // Branch name keeps slashes for `git branch` namespacing (e.g. vk/ha-);
    // worktree directory flattens slashes to dashes so the prefix shows up in
    // the worktree path without creating nested folders.
    const branchName = `${prefix}${name}`;
    const dirPrefix = prefix.replace(/\//g, '-');
    const dirName = `${dirPrefix}${name}`;

    // Check if it's a git repository
    const gitCheck = await machineBash(
        machineId,
        'git rev-parse --git-dir',
        basePath
    );

    if (!gitCheck.success) {
        return {
            success: false,
            worktreePath: '',
            branchName: '',
            error: 'Not a Git repository'
        };
    }

    // Create the worktree with new branch
    const worktreePath = `.dev/worktree/${dirName}`;
    let result = await machineBash(
        machineId,
        `git worktree add -b ${shellEscape(branchName)} ${shellEscape(worktreePath)}`,
        basePath
    );

    // If worktree exists, try with a different name
    if (!result.success && result.stderr.includes('already exists')) {
        // Try up to 3 times with numbered suffixes
        for (let i = 2; i <= 4; i++) {
            const newName = `${name}-${i}`;
            const newBranchName = `${prefix}${newName}`;
            const newWorktreePath = `.dev/worktree/${dirPrefix}${newName}`;
            result = await machineBash(
                machineId,
                `git worktree add -b ${shellEscape(newBranchName)} ${shellEscape(newWorktreePath)}`,
                basePath
            );

            if (result.success) {
                return {
                    success: true,
                    worktreePath: `${basePath}/${newWorktreePath}`,
                    branchName: newBranchName,
                    error: undefined
                };
            }
        }
    }

    if (result.success) {
        return {
            success: true,
            worktreePath: `${basePath}/${worktreePath}`,
            branchName,
            error: undefined
        };
    }

    return {
        success: false,
        worktreePath: '',
        branchName: '',
        error: result.stderr || 'Failed to create worktree'
    };
}
