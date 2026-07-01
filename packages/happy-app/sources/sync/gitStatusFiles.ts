/**
 * Git status file-level functionality
 * Provides detailed git status with file-level changes and line statistics
 */

import { sessionBash } from './ops';
import { getSession } from './storage';
import { parseStatusSummaryV2, getCurrentBranchV2 } from './git-parsers/parseStatusV2';
import { parseNumStat, createDiffStatsMap } from './git-parsers/parseDiff';
import { shellEscape } from '@/utils/shellEscape';

export interface GitFileStatus {
    fileName: string;
    filePath: string;
    fullPath: string;
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
    isStaged: boolean;
    linesAdded: number;
    linesRemoved: number;
    oldPath?: string; // For renamed files
}

export interface GitStatusFiles {
    stagedFiles: GitFileStatus[];
    unstagedFiles: GitFileStatus[];
    branch: string | null;
    totalStaged: number;
    totalUnstaged: number;
}

/**
 * Fetch detailed git status with file-level information
 */
export async function getGitStatusFiles(sessionId: string, cwd?: string): Promise<GitStatusFiles | null> {
    try {
        // Check if we have a session with valid metadata
        const session = getSession(sessionId);
        const sessionPath = session?.metadata?.path;
        const targetRepoPath = cwd || sessionPath;
        if (!targetRepoPath) {
            return null;
        }
        const useGitPathOverride = Boolean(cwd && sessionPath && cwd !== sessionPath);
        const commandCwd = useGitPathOverride ? sessionPath : targetRepoPath;
        const gitPrefix = useGitPathOverride
            ? `git -C ${shellEscape(targetRepoPath)}`
            : 'git';

        // Get git status in porcelain v2 format (includes branch info and repo check)
        // --untracked-files=all ensures we get individual files, not directories
        const statusResult = await sessionBash(sessionId, {
            command: `${gitPrefix} status --porcelain=v2 --branch --untracked-files=all`,
            cwd: commandCwd,
            timeout: 10000
        });

        if (!statusResult.success || statusResult.exitCode !== 0) {
            // Not a git repo or git command failed
            return null;
        }

        // Get combined diff statistics for both staged and unstaged changes
        const diffStatResult = await sessionBash(sessionId, {
            command: `${gitPrefix} diff --numstat && echo "---STAGED---" && ${gitPrefix} diff --cached --numstat`,
            cwd: commandCwd,
            timeout: 10000
        });

        // Parse the results using v2 parser
        const statusOutput = statusResult.stdout;
        const diffOutput = diffStatResult.success ? diffStatResult.stdout : '';

        return parseGitStatusFilesV2(statusOutput, diffOutput);

    } catch (error) {
        console.error('Error fetching git status files for session', sessionId, ':', error);
        return null;
    }
}

/**
 * Parse git status v2 and diff outputs into structured file data
 */
function parseGitStatusFilesV2(
    statusOutput: string,
    combinedDiffOutput: string
): GitStatusFiles {
    // Parse status using v2 parser
    const statusSummary = parseStatusSummaryV2(statusOutput);
    const branchName = getCurrentBranchV2(statusSummary);
    
    // Parse combined diff statistics
    const [unstagedOutput = '', stagedOutput = ''] = combinedDiffOutput.split('---STAGED---');
    const unstagedDiff = parseNumStat(unstagedOutput.trim());
    const stagedDiff = parseNumStat(stagedOutput.trim());
    const unstagedStats = createDiffStatsMap(unstagedDiff);
    const stagedStats = createDiffStatsMap(stagedDiff);

    const stagedFiles: GitFileStatus[] = [];
    const unstagedFiles: GitFileStatus[] = [];

    for (const file of statusSummary.files) {
        const parts = file.path.split('/');
        const fileNameOnly = parts[parts.length - 1] || file.path;
        const filePathOnly = parts.slice(0, -1).join('/');

        // Create file status for staged changes
        if (file.index !== ' ' && file.index !== '.' && file.index !== '?') {
            const status = getFileStatusV2(file.index);
            const stats = stagedStats[file.path] || { added: 0, removed: 0, binary: false };
            
            stagedFiles.push({
                fileName: fileNameOnly,
                filePath: filePathOnly,
                fullPath: file.path,
                status,
                isStaged: true,
                linesAdded: stats.added,
                linesRemoved: stats.removed,
                oldPath: file.from
            });
        }

        // Create file status for unstaged changes
        if (file.working_dir !== ' ' && file.working_dir !== '.') {
            const status = getFileStatusV2(file.working_dir);
            const stats = unstagedStats[file.path] || { added: 0, removed: 0, binary: false };
            
            unstagedFiles.push({
                fileName: fileNameOnly,
                filePath: filePathOnly,
                fullPath: file.path,
                status,
                isStaged: false,
                linesAdded: stats.added,
                linesRemoved: stats.removed,
                oldPath: file.from
            });
        }
    }

    // Add untracked files to unstaged
    for (const untrackedPath of statusSummary.not_added) {
        // Handle both files and directories (directories have trailing slash)
        const isDirectory = untrackedPath.endsWith('/');
        const cleanPath = isDirectory ? untrackedPath.slice(0, -1) : untrackedPath;
        const parts = cleanPath.split('/');
        const fileNameOnly = parts[parts.length - 1] || cleanPath;
        const filePathOnly = parts.slice(0, -1).join('/');
        
        // Skip directory entries since we're using --untracked-files=all
        // This is a fallback in case git still reports directories
        if (isDirectory) {
            console.warn(`Unexpected directory in untracked files: ${untrackedPath}`);
            continue;
        }
        
        unstagedFiles.push({
            fileName: fileNameOnly,
            filePath: filePathOnly,
            fullPath: cleanPath,
            status: 'untracked',
            isStaged: false,
            linesAdded: 0,
            linesRemoved: 0
        });
    }

    return {
        stagedFiles,
        unstagedFiles,
        branch: branchName,
        totalStaged: stagedFiles.length,
        totalUnstaged: unstagedFiles.length
    };
}

/**
 * Convert git status character to readable status (v2 format)
 */
function getFileStatusV2(statusChar: string): GitFileStatus['status'] {
    switch (statusChar) {
        case 'M': return 'modified';
        case 'A': return 'added';
        case 'D': return 'deleted';
        case 'R': 
        case 'C': return 'renamed';
        case '?': return 'untracked';
        default: return 'modified';
    }
}


// ============================================================
// Nearby git repo discovery
// 当 cwd 不是 git 仓库时，扫描其子目录寻找 git 仓库。
// 用于在文件面板空状态下让用户一键切换到子仓库。
// 调用方：files.tsx 的空状态分支（待 wei 填实现后由我接入）
// ============================================================

export interface NearbyGitRepo {
    path: string;   // 子仓库的绝对路径
    name: string;   // 显示用的目录名（通常是 basename）
}

/**
 * 扫描 cwd 的子目录，返回内含 .git 的目录列表
 *
 * 6 个决策点（在 TODO 里实现你想要的策略）：
 *   1) 命令：推荐 find <cwd> -maxdepth N -name .git -print -prune
 *   2) 深度 N：2=只命中直接子目录里的 .git；3+ 会扫到孙级 repo
 *   3) 过滤：必排 /node_modules/ 与 /.git/（防止递归进 .git 内部）
 *   4) 超时：5000ms 起步，避免慢盘阻塞 UI
 *   5) 排序：字母序 vs 按 .git/HEAD 修改时间倒序（活跃优先）
 *   6) 上限：建议 ≤ 20 条，避免列表过长
 *
 * 失败请 return [] 而不是抛异常，UI 会回退到原占位符。
 */
export async function findNearbyGitRepos(
    sessionId: string,
    cwd: string,
): Promise<NearbyGitRepo[]> {
    // Git worktrees store `.git` as a file, not a directory. Do not filter by
    // `-type d`, otherwise a multi-repo worktree workspace whose metadata was
    // stripped cannot recover by scanning its child repos.
    const cmd = `find ${shellEscape(cwd)} -maxdepth 2 \\( -name node_modules -o -name .cache -o -name vendor \\) -prune -o \\( -name .git -print -prune \\) 2>/dev/null`;
    const result = await sessionBash(sessionId, {
        command: cmd,
        cwd,
        timeout: 5000,
    });
    if (!result.success || result.exitCode !== 0) {
        return [];
    }
    const seen = new Set<string>();
    const repos: NearbyGitRepo[] = [];
    for (const line of result.stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.endsWith('/.git')) continue;
        const path = trimmed.replace(/\/\.git$/, '');
        if (path === cwd || seen.has(path)) continue;
        seen.add(path);
        repos.push({ path, name: path.split('/').pop() || path });
    }
    repos.sort((a, b) => a.path.localeCompare(b.path));
    return repos.slice(0, 20);
}
