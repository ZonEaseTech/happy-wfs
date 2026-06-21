/**
 * Create a multi-repo workspace with git worktrees for each repo.
 */

import { machineBash } from '@/sync/ops';
import { generateWorktreeName } from '@/utils/generateWorktreeName';
import { shellEscape } from '@/utils/shellEscape';
import { buildWorktreeAddCommand, normalizeExistingWorktreeBranch, type WorktreeBranchMode } from '@/utils/createWorkspaceBranches';
import type { RegisteredRepo, WorkspaceRepo } from '@/utils/workspaceRepos';
import { storage } from '@/sync/storage';

/** Read the user's worktree branch prefix preference (e.g. "vk/"). */
function getBranchPrefix(): string {
    return storage.getState().localSettings?.worktreeBranchPrefix ?? '';
}

/** Only allow safe characters in path components (no slashes, no ..) */
function isSafePathComponent(name: string): boolean {
    return /^[a-zA-Z0-9._-]+$/.test(name) && name.length > 0 && name.length < 256;
}

function isRegisteredRepo(repo: WorkspaceRepoInput['repo']): repo is RegisteredRepo {
    return 'id' in repo;
}

export interface WorkspaceRepoInput {
    repo: RegisteredRepo | { path: string; displayName: string };
    targetBranch?: string;
}

interface CreateWorkspaceResult {
    success: boolean;
    workspaceName: string;
    workspacePath: string;
    repos: WorkspaceRepo[];
    error?: string;
}

/**
 * Create a multi-repo workspace with git worktrees for each repo.
 *
 * For each repo input, creates a git worktree inside a shared workspace
 * directory (~/.happy/workspaces/<name>). On failure, rolls back all
 * previously created worktrees and removes the workspace directory.
 */
export async function createWorkspace(
    machineId: string,
    repoInputs: WorkspaceRepoInput[],
    options?: { mode?: WorktreeBranchMode },
): Promise<CreateWorkspaceResult> {
    const workspaceName = generateWorktreeName();
    const mode = options?.mode ?? 'new';
    const prefix = getBranchPrefix();
    // Branch name keeps slashes for `git branch` namespacing (e.g. vk/ha-).
    // Directory name flattens slashes to dashes so the prefix shows up in
    // the workspace dir name without creating nested folders.
    const branchName = `${prefix}${workspaceName}`;
    const dirPrefix = prefix.replace(/\//g, '-');
    const dirName = `${dirPrefix}${workspaceName}`;
    // ~ is left unescaped so the shell expands it; dirName is safe (alphanum + - / .)
    const workspacePath = `~/.happy/workspaces/${shellEscape(dirName)}`;

    // Create workspace directory
    // Use '/' as cwd to bypass daemon path validation (the command itself uses absolute/~ paths)
    const mkdirResult = await machineBash(machineId, { command: `mkdir -p ${workspacePath}`, cwd: '/' });
    if (!mkdirResult.success) {
        return { success: false, workspaceName, workspacePath, repos: [], error: 'Failed to create workspace directory' };
    }

    // Resolve ~ to absolute path via realpath
    const resolveResult = await machineBash(machineId, { command: `realpath ${workspacePath}`, cwd: '/' });
    if (!resolveResult.success || !resolveResult.stdout.trim()) {
        await machineBash(machineId, { command: `rm -rf ${workspacePath}`, cwd: '/' });
        return { success: false, workspaceName, workspacePath: '', repos: [], error: 'Failed to resolve workspace path' };
    }
    const absoluteWorkspacePath = resolveResult.stdout.trim();

    const createdRepos: WorkspaceRepo[] = [];

    for (const input of repoInputs) {
        const { repo, targetBranch } = input;

        // Validate displayName as a safe path component
        if (!isSafePathComponent(repo.displayName)) {
            await rollbackCreatedRepos(machineId, createdRepos, branchName, absoluteWorkspacePath, workspaceName, mode === 'new');
            return {
                success: false, workspaceName, workspacePath: absoluteWorkspacePath, repos: [],
                error: `Invalid repo display name: ${repo.displayName}`,
            };
        }

        const worktreePath = `${absoluteWorkspacePath}/${repo.displayName}`;
        let repoBranchName = branchName;
        try {
            if (mode === 'existing') {
                repoBranchName = normalizeExistingWorktreeBranch(targetBranch).branchName;
            }
        } catch (error) {
            await rollbackCreatedRepos(machineId, createdRepos, branchName, absoluteWorkspacePath, workspaceName, mode === 'new');
            return {
                success: false, workspaceName, workspacePath: absoluteWorkspacePath, repos: [],
                error: error instanceof Error ? error.message : 'Invalid existing branch',
            };
        }

        // New branch mode creates a generated branch for the workspace.
        // Existing branch mode creates the worktree from the selected branch
        // itself, so the spawned session actually starts on the branch the user
        // selected instead of silently staying on the original repo checkout.
        const cmd = buildWorktreeAddCommand({
            mode,
            workspaceBranchName: branchName,
            worktreePath,
            targetBranch,
        });
        const result = await machineBash(machineId, { command: cmd, cwd: repo.path });

        if (!result.success) {
            await rollbackCreatedRepos(machineId, createdRepos, branchName, absoluteWorkspacePath, workspaceName, mode === 'new');
            return {
                success: false, workspaceName, workspacePath: absoluteWorkspacePath, repos: [],
                error: `Failed to create worktree for ${repo.displayName}: ${result.stderr}`,
            };
        }

        // Copy files if configured (RegisteredRepo has copyFiles field)
        if (isRegisteredRepo(repo) && repo.copyFiles) {
            const files = repo.copyFiles.split(',').map(f => f.trim()).filter(Boolean);
            for (const file of files) {
                // Skip files with path traversal
                if (file.includes('..')) continue;
                await machineBash(machineId, {
                    command: `mkdir -p "$(dirname ${shellEscape(worktreePath + '/' + file)})" && cp ${shellEscape(repo.path + '/' + file)} ${shellEscape(worktreePath + '/' + file)} 2>/dev/null`,
                    cwd: repo.path,
                });
            }
        }

        createdRepos.push({
            repoId: isRegisteredRepo(repo) ? repo.id : undefined,
            path: worktreePath,
            basePath: repo.path,
            branchName: repoBranchName,
            targetBranch,
            displayName: repo.displayName,
        });
    }

    // Generate workspace-level CLAUDE.md and AGENTS.md with @import references
    await generateWorkspaceConfigFiles(machineId, absoluteWorkspacePath, createdRepos);

    return { success: true, workspaceName, workspacePath: absoluteWorkspacePath, repos: createdRepos };
}

/**
 * Generate workspace-level CLAUDE.md and AGENTS.md files that @import
 * from each repo's corresponding file. Follows vibe-kanban's pattern:
 * only creates if the file doesn't already exist, and only if at least
 * one repo has the source file. Best-effort — failures don't block workspace creation.
 */
async function generateWorkspaceConfigFiles(
    machineId: string,
    workspacePath: string,
    repos: WorkspaceRepo[],
): Promise<void> {
    const configFiles = ['CLAUDE.md', 'AGENTS.md'];

    for (const configFile of configFiles) {
        try {
            // Skip if workspace already has this file
            const existsResult = await machineBash(machineId, {
                command: `test -f ${shellEscape(workspacePath + '/' + configFile)}`,
                cwd: '/',
            });
            if (existsResult.success) continue;

            // Check which repos have this file
            const reposWithFile: string[] = [];
            for (const repo of repos) {
                if (!repo.displayName) continue;
                const checkResult = await machineBash(machineId, {
                    command: `test -f ${shellEscape(repo.path + '/' + configFile)}`,
                    cwd: '/',
                });
                if (checkResult.success) {
                    reposWithFile.push(repo.displayName);
                }
            }

            // Only create if at least one repo has the file
            if (reposWithFile.length === 0) continue;

            const content = reposWithFile.map(name => `@${name}/${configFile}`).join('\n') + '\n';
            await machineBash(machineId, {
                command: `printf '%s' ${shellEscape(content)} > ${shellEscape(workspacePath + '/' + configFile)}`,
                cwd: '/',
            });
        } catch {
            // Best-effort: don't fail workspace creation
        }
    }
}

/**
 * Roll back previously created worktrees and remove workspace directory.
 * branchName carries the prefix (e.g. "vk/warm-meadow"); workspaceDirName
 * is the unprefixed dir-component used for the rm -rf cleanup target,
 * but absoluteWorkspacePath already accounts for that.
 */
async function rollbackCreatedRepos(
    machineId: string,
    createdRepos: WorkspaceRepo[],
    branchName: string,
    absoluteWorkspacePath: string,
    _workspaceDirName: string,
    deleteCreatedBranch = true,
): Promise<void> {
    for (const created of createdRepos) {
        const deleteBranchCommand = deleteCreatedBranch
            ? `; git branch -D ${shellEscape(branchName)} 2>/dev/null`
            : '';
        await machineBash(machineId, {
            command: `git worktree remove --force ${shellEscape(created.path)} 2>/dev/null${deleteBranchCommand}`,
            cwd: created.basePath,
        });
    }
    await machineBash(machineId, { command: `rm -rf ${shellEscape(absoluteWorkspacePath)}`, cwd: '/' });
}
