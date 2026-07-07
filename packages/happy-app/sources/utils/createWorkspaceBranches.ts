import { shellEscape } from '@/utils/shellEscape';

export type WorktreeBranchMode = 'new' | 'existing';

export function normalizeExistingWorktreeBranch(targetBranch: string | undefined): {
    branchName: string;
    startPoint?: string;
} {
    const trimmed = targetBranch?.trim();
    if (!trimmed) {
        throw new Error('Existing branch mode requires a selected branch');
    }

    if (trimmed.startsWith('origin/')) {
        return {
            branchName: trimmed.slice('origin/'.length),
            startPoint: trimmed,
        };
    }

    return { branchName: trimmed };
}

export function buildWorktreeAddCommand(params: {
    mode: WorktreeBranchMode;
    workspaceBranchName: string;
    worktreePath: string;
    targetBranch?: string;
}): string {
    if (params.mode === 'existing') {
        const existing = normalizeExistingWorktreeBranch(params.targetBranch);
        if (existing.startPoint) {
            return `git worktree add -b ${shellEscape(existing.branchName)} ${shellEscape(params.worktreePath)} ${shellEscape(existing.startPoint)}`;
        }
        return `git worktree add ${shellEscape(params.worktreePath)} ${shellEscape(existing.branchName)}`;
    }

    const targetArg = params.targetBranch ? ` ${shellEscape(params.targetBranch)}` : '';
    return `git worktree add -b ${shellEscape(params.workspaceBranchName)} ${shellEscape(params.worktreePath)}${targetArg}`;
}

/**
 * Build the shell command for one copyFiles entry, or null to skip it.
 * Relative entries copy repo-root files into the same relative spot in the
 * repo worktree. Absolute entries land at the workspace root by basename —
 * that is where sessions start, so configs like .mcp.json get picked up.
 */
export function buildCopyFileCommand(params: {
    file: string;
    repoPath: string;
    worktreePath: string;
    workspacePath: string;
}): string | null {
    const file = params.file.trim();
    if (!file || file.includes('..')) return null;
    if (file.startsWith('/')) {
        const baseName = file.split('/').filter(Boolean).pop();
        if (!baseName) return null;
        return `cp ${shellEscape(file)} ${shellEscape(params.workspacePath + '/' + baseName)} 2>/dev/null`;
    }
    return `mkdir -p "$(dirname ${shellEscape(params.worktreePath + '/' + file)})" && cp ${shellEscape(params.repoPath + '/' + file)} ${shellEscape(params.worktreePath + '/' + file)} 2>/dev/null`;
}
