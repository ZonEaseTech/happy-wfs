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
