import { logger } from '@/ui/logger';
import { exec, ExecOptions } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, readdir, stat, rename, unlink, rm, mkdir, lstat } from 'fs/promises';
import { join, resolve } from 'path';
import { run as runRipgrep } from '@/modules/ripgrep/index';
import { run as runDifftastic } from '@/modules/difftastic/index';
import { RpcHandlerManager } from '../../api/rpc/RpcHandlerManager';
import { validatePath } from './pathSecurity';
import { getDiffDetail } from './diffStore';
import { getToolOutputRecord } from './toolOutputStore';

const execAsync = promisify(exec);

interface BashRequest {
    command: string;
    cwd?: string;
    timeout?: number; // timeout in milliseconds
}

interface BashResponse {
    success: boolean;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    error?: string;
}

interface ReadFileRequest {
    path: string;
}

interface ReadFileResponse {
    success: boolean;
    content?: string; // base64 encoded
    error?: string;
}

interface WriteFileRequest {
    path: string;
    content: string; // base64 encoded
}

interface WriteFileResponse {
    success: boolean;
    error?: string;
    bytesWritten?: number;
}

interface ListDirRequest {
    path: string;
    hideSystem?: boolean;
}

interface DirEntry {
    name: string;
    path: string;
    type: 'file' | 'dir';
    size?: number;
    mtime?: number;
}

interface ListDirResponse {
    success: boolean;
    entries?: DirEntry[];
    error?: string;
}

interface GetDirectoryTreeRequest {
    path: string;
    maxDepth: number;
}

interface TreeNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    modified?: number;
    children?: TreeNode[]; // Only present for directories
}

interface GetDirectoryTreeResponse {
    success: boolean;
    tree?: TreeNode;
    error?: string;
}

interface RipgrepRequest {
    args: string[];
    cwd?: string;
}

interface RipgrepResponse {
    success: boolean;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    error?: string;
}

interface DifftasticRequest {
    args: string[];
    cwd?: string;
}

interface DifftasticResponse {
    success: boolean;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    error?: string;
}

interface RenameRequest {
    from: string;
    to: string;
}

interface RenameResponse {
    success: boolean;
    error?: string;
}

interface DeleteFileRequest {
    path: string;
}

interface DeleteFileResponse {
    success: boolean;
    error?: string;
}

interface DeleteDirectoryRequest {
    path: string;
}

interface DeleteDirectoryResponse {
    success: boolean;
    deletedCount?: number;
    error?: string;
}

interface CreateFileRequest {
    path: string;
    content?: string; // base64 encoded; defaults to empty
}

interface CreateFileResponse {
    success: boolean;
    error?: string;
}

interface CreateDirectoryRequest {
    path: string;
}

interface CreateDirectoryResponse {
    success: boolean;
    error?: string;
}

/*
 * Spawn Session Options and Result
 * This rpc type is used by the daemon, all other RPCs here are for sessions
*/

export interface SpawnSessionOptions {
    machineId?: string;
    directory: string;
    sessionId?: string;
    resumeSessionId?: string;
    /**
     * Caller-declared spawn intent. Required for the daemon to enable
     * resume-related side effects (Claude --resume, JSONL backfill).
     * - 'resume': caller deliberately resumes from resumeSessionId
     * - 'new': caller wants a fresh session; resumeSessionId is ignored
     * - undefined: legacy behavior (treated as 'new' for safety)
     */
    intent?: 'new' | 'resume';
    sessionTitle?: string;
    skipForkSession?: boolean;
    approvedNewDirectoryCreation?: boolean;
    agent?: 'claude' | 'codex' | 'gemini';
    token?: string;
    environmentVariables?: {
        // Anthropic Claude API configuration
        ANTHROPIC_BASE_URL?: string;        // Custom API endpoint (overrides default)
        ANTHROPIC_AUTH_TOKEN?: string;      // API authentication token
        ANTHROPIC_MODEL?: string;           // Model to use (e.g., claude-3-5-sonnet-20241022)

        // Tmux session management environment variables
        // Based on tmux(1) manual and common tmux usage patterns
        TMUX_SESSION_NAME?: string;         // Name for tmux session (creates/attaches to named session)
        TMUX_TMPDIR?: string;               // Temporary directory for tmux server socket files
        // Note: TMUX_TMPDIR is used by tmux to store socket files when default /tmp is not suitable
        // Common use case: When /tmp has limited space or different permissions
    };
    // Worktree metadata - passed through to CLI for initial metadata creation
    worktreeBasePath?: string;
    worktreeBranchName?: string;
    // Multi-repo workspace
    workspaceRepos?: Array<{
        repoId?: string;
        path: string;
        basePath: string;
        branchName: string;
        targetBranch?: string;
        displayName?: string;
    }>;
    workspacePath?: string;
    // Per-repo scripts (daemon executes these)
    repoScripts?: Array<{
        repoDisplayName: string;
        worktreePath: string;
        setupScript?: string;
        parallelSetup?: boolean;
        cleanupScript?: string;
        archiveScript?: string;
        devServerScript?: string;
    }>;
    // Extra MCP servers to inject (e.g., DooTask MCP)
    mcpServers?: Array<{
        name: string;
        url: string;
        headers?: Record<string, string>;
    }>;
}

export type SpawnSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | { type: 'error'; errorMessage: string };

/**
 * Register all RPC handlers with the session
 */
export function registerCommonHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string, sessionId?: string) {

    // Shell command handler - executes commands in the default shell
    rpcHandlerManager.registerHandler<BashRequest, BashResponse>('bash', async (data) => {
        logger.debug('Shell command request:', data.command);

        // Validate cwd if provided
        // Special case: "/" means "use shell's default cwd" (used by CLI detection)
        // Security: Still validate all other paths to prevent directory traversal
        if (data.cwd && data.cwd !== '/') {
            const validation = validatePath(data.cwd, workingDirectory);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }
        }

        try {
            // Build options with shell enabled by default
            // Note: ExecOptions doesn't support boolean for shell, but exec() uses the default shell when shell is undefined
            // If cwd is "/", use undefined to let shell use its default (respects user's PATH)
            const options: ExecOptions = {
                cwd: data.cwd === '/' ? undefined : data.cwd,
                timeout: data.timeout || 30000, // Default 30 seconds timeout
            };

            logger.debug('Shell command executing...', { cwd: options.cwd, timeout: options.timeout });
            const { stdout, stderr } = await execAsync(data.command, options);
            logger.debug('Shell command executed, processing result...');

            const result = {
                success: true,
                stdout: stdout ? stdout.toString() : '',
                stderr: stderr ? stderr.toString() : '',
                exitCode: 0
            };
            logger.debug('Shell command result:', {
                success: true,
                exitCode: 0,
                stdoutLen: result.stdout.length,
                stderrLen: result.stderr.length
            });
            return result;
        } catch (error) {
            const execError = error as NodeJS.ErrnoException & {
                stdout?: string;
                stderr?: string;
                code?: number | string;
                killed?: boolean;
            };

            // Check if the error was due to timeout
            if (execError.code === 'ETIMEDOUT' || execError.killed) {
                const result = {
                    success: false,
                    stdout: execError.stdout || '',
                    stderr: execError.stderr || '',
                    exitCode: typeof execError.code === 'number' ? execError.code : -1,
                    error: 'Command timed out'
                };
                logger.debug('Shell command timed out:', {
                    success: false,
                    exitCode: result.exitCode,
                    error: 'Command timed out'
                });
                return result;
            }

            // If exec fails, it includes stdout/stderr in the error
            const result = {
                success: false,
                stdout: execError.stdout ? execError.stdout.toString() : '',
                stderr: execError.stderr ? execError.stderr.toString() : execError.message || 'Command failed',
                exitCode: typeof execError.code === 'number' ? execError.code : 1,
                error: execError.message || 'Command failed'
            };
            logger.debug('Shell command failed:', {
                success: false,
                exitCode: result.exitCode,
                error: result.error,
                stdoutLen: result.stdout.length,
                stderrLen: result.stderr.length
            });
            return result;
        }
    });

    // Read file handler - returns base64 encoded content
    rpcHandlerManager.registerHandler<ReadFileRequest, ReadFileResponse>('readFile', async (data) => {
        logger.debug('Read file request:', data.path);

        // Validate path is within working directory
        const validation = validatePath(data.path, workingDirectory);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        try {
            const buffer = await readFile(data.path);
            const content = buffer.toString('base64');
            return { success: true, content };
        } catch (error) {
            logger.debug('Failed to read file:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Failed to read file' };
        }
    });

    // Write file handler - A3 policy: read-anywhere / write-with-deny-list
    rpcHandlerManager.registerHandler<WriteFileRequest, WriteFileResponse>('writeFile', async (data) => {
        logger.debug('Write file request:', data.path);

        const absPath = resolve(workingDirectory, data.path);

        const validation = validatePath(data.path, workingDirectory);
        if (!validation.valid) {
            logger.debug('[writeFile] path=%s ok=%s reason=%s', absPath, false, validation.error);
            return { success: false, error: validation.error };
        }

        if (!isWritableForSession(absPath)) {
            logger.debug('[writeFile] path=%s ok=%s reason=%s', absPath, false, 'system path is read-only');
            return { success: false, error: `Path '${absPath}' is on the system write deny-list` };
        }

        try {
            const buf = Buffer.from(data.content, 'base64');
            await writeFile(absPath, buf);
            logger.debug('[writeFile] path=%s bytes=%d ok=%s', absPath, buf.length, true);
            return { success: true, bytesWritten: buf.length };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to write file';
            logger.debug('[writeFile] path=%s ok=%s reason=%s', absPath, false, message);
            return { success: false, error: message };
        }
    });

    // Rename / move handler - both endpoints must satisfy A3 write policy
    rpcHandlerManager.registerHandler<RenameRequest, RenameResponse>('rename', async (data) => {
        logger.debug('Rename request:', data.from, '->', data.to);

        const absFrom = resolve(workingDirectory, data.from);
        const absTo = resolve(workingDirectory, data.to);

        const fromValidation = validatePath(data.from, workingDirectory);
        if (!fromValidation.valid) {
            return { success: false, error: fromValidation.error };
        }
        const toValidation = validatePath(data.to, workingDirectory);
        if (!toValidation.valid) {
            return { success: false, error: toValidation.error };
        }

        if (!isWritableForSession(absFrom)) {
            logger.info('[rename] %s -> %s ok=%s', absFrom, absTo, false);
            return { success: false, error: `Path '${absFrom}' is on the system write deny-list` };
        }
        if (!isWritableForSession(absTo)) {
            logger.info('[rename] %s -> %s ok=%s', absFrom, absTo, false);
            return { success: false, error: `Path '${absTo}' is on the system write deny-list` };
        }

        try {
            await rename(absFrom, absTo);
            logger.info('[rename] %s -> %s ok=%s', absFrom, absTo, true);
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to rename';
            logger.info('[rename] %s -> %s ok=%s', absFrom, absTo, false);
            return { success: false, error: message };
        }
    });

    // Delete file handler - rejects directories so callers must use deleteDirectory
    rpcHandlerManager.registerHandler<DeleteFileRequest, DeleteFileResponse>('deleteFile', async (data) => {
        logger.debug('Delete file request:', data.path);

        const absPath = resolve(workingDirectory, data.path);

        const validation = validatePath(data.path, workingDirectory);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        if (!isWritableForSession(absPath)) {
            logger.info('[deleteFile] path=%s ok=%s reason=%s', absPath, false, 'system path is read-only');
            return { success: false, error: `Path '${absPath}' is on the system write deny-list` };
        }

        try {
            // lstat so a symlink-to-directory is treated as a file (we unlink the link itself)
            const st = await lstat(absPath);
            if (st.isDirectory()) {
                logger.info('[deleteFile] path=%s ok=%s reason=%s', absPath, false, 'is directory');
                return { success: false, error: 'Not a file, use deleteDirectory' };
            }
            await unlink(absPath);
            logger.info('[deleteFile] path=%s ok=%s', absPath, true);
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to delete file';
            logger.info('[deleteFile] path=%s ok=%s reason=%s', absPath, false, message);
            return { success: false, error: message };
        }
    });

    // Delete directory handler - recursive; symlinks are removed as links, never followed
    rpcHandlerManager.registerHandler<DeleteDirectoryRequest, DeleteDirectoryResponse>('deleteDirectory', async (data) => {
        logger.debug('Delete directory request:', data.path);

        const absPath = resolve(workingDirectory, data.path);

        const validation = validatePath(data.path, workingDirectory);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        if (!isWritableForSession(absPath)) {
            logger.info('[deleteDirectory] path=%s ok=%s reason=%s', absPath, false, 'system path is read-only');
            return { success: false, error: `Path '${absPath}' is on the system write deny-list` };
        }

        try {
            const top = await lstat(absPath);
            if (!top.isDirectory()) {
                logger.info('[deleteDirectory] path=%s ok=%s reason=%s', absPath, false, 'not a directory');
                return { success: false, error: 'Not a directory' };
            }

            // Pre-walk to count entries; never traverse into symlinks so we can't escape absPath.
            // fs.rm with recursive:true mirrors this — it removes symlinks as links rather than
            // following them — so the count matches what will actually be removed.
            async function countEntries(dir: string): Promise<number> {
                const entries = await readdir(dir, { withFileTypes: true });
                let n = 0;
                for (const entry of entries) {
                    n += 1;
                    if (entry.isDirectory() && !entry.isSymbolicLink()) {
                        n += await countEntries(join(dir, entry.name));
                    }
                }
                return n;
            }

            const deletedCount = await countEntries(absPath);
            await rm(absPath, { recursive: true, force: false });
            logger.info('[deleteDirectory] path=%s deletedCount=%d ok=%s', absPath, deletedCount, true);
            return { success: true, deletedCount };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to delete directory';
            logger.info('[deleteDirectory] path=%s ok=%s reason=%s', absPath, false, message);
            return { success: false, error: message };
        }
    });

    // Create file handler - exclusive create; fails if the path already exists
    rpcHandlerManager.registerHandler<CreateFileRequest, CreateFileResponse>('createFile', async (data) => {
        logger.debug('Create file request:', data.path);

        const absPath = resolve(workingDirectory, data.path);

        const validation = validatePath(data.path, workingDirectory);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        if (!isWritableForSession(absPath)) {
            logger.info('[createFile] path=%s ok=%s reason=%s', absPath, false, 'system path is read-only');
            return { success: false, error: `Path '${absPath}' is on the system write deny-list` };
        }

        try {
            const buf = data.content ? Buffer.from(data.content, 'base64') : Buffer.alloc(0);
            await writeFile(absPath, buf, { flag: 'wx' });
            logger.info('[createFile] path=%s bytes=%d ok=%s', absPath, buf.length, true);
            return { success: true };
        } catch (error) {
            const errno = (error as NodeJS.ErrnoException).code;
            if (errno === 'EEXIST') {
                logger.info('[createFile] path=%s ok=%s reason=%s', absPath, false, 'file exists');
                return { success: false, error: 'File exists' };
            }
            const message = error instanceof Error ? error.message : 'Failed to create file';
            logger.info('[createFile] path=%s ok=%s reason=%s', absPath, false, message);
            return { success: false, error: message };
        }
    });

    // Create directory handler - non-recursive; fails if the directory already exists
    rpcHandlerManager.registerHandler<CreateDirectoryRequest, CreateDirectoryResponse>('createDirectory', async (data) => {
        logger.debug('Create directory request:', data.path);

        const absPath = resolve(workingDirectory, data.path);

        const validation = validatePath(data.path, workingDirectory);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        if (!isWritableForSession(absPath)) {
            logger.info('[createDirectory] path=%s ok=%s reason=%s', absPath, false, 'system path is read-only');
            return { success: false, error: `Path '${absPath}' is on the system write deny-list` };
        }

        try {
            await mkdir(absPath);
            logger.info('[createDirectory] path=%s ok=%s', absPath, true);
            return { success: true };
        } catch (error) {
            const errno = (error as NodeJS.ErrnoException).code;
            if (errno === 'EEXIST') {
                logger.info('[createDirectory] path=%s ok=%s reason=%s', absPath, false, 'directory exists');
                return { success: false, error: 'Directory exists' };
            }
            const message = error instanceof Error ? error.message : 'Failed to create directory';
            logger.info('[createDirectory] path=%s ok=%s reason=%s', absPath, false, message);
            return { success: false, error: message };
        }
    });

    // List directory handler - one-level listing with optional system-noise filter
    rpcHandlerManager.registerHandler<ListDirRequest, ListDirResponse>('listDirectory', async (data) => {
        logger.debug('List directory request:', data.path);

        const absPath = resolve(workingDirectory, data.path);

        const validation = validatePath(data.path, workingDirectory);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        const hideSystem = data.hideSystem !== false;

        try {
            const rawEntries = await readdir(absPath, { withFileTypes: true });
            // Drop symlinks before listing — Dirent.isDirectory() follows the link
            // and would let a symlink to /etc tunnel out of the validated workingDirectory
            // boundary on the next listDirectory call (validatePath only checks the
            // path string, not what it resolves to). Mirrors getDirectoryTree (~L409).
            const noSymlinks = rawEntries.filter((e) => !e.isSymbolicLink());
            const visible = hideSystem
                ? noSymlinks.filter((e) => !isSystemNoise(e.name))
                : noSymlinks;

            const entries: DirEntry[] = await Promise.all(
                visible.map(async (entry) => {
                    const fullPath = join(absPath, entry.name);
                    const type: 'file' | 'dir' = entry.isDirectory() ? 'dir' : 'file';
                    let size: number | undefined;
                    let mtime: number | undefined;

                    try {
                        const stats = await stat(fullPath);
                        size = stats.size;
                        mtime = stats.mtime.getTime();
                    } catch (error) {
                        logger.debug(`Failed to stat ${fullPath}:`, error);
                    }

                    return { name: entry.name, path: fullPath, type, size, mtime };
                })
            );

            entries.sort((a, b) => {
                if (a.type === 'dir' && b.type !== 'dir') return -1;
                if (a.type !== 'dir' && b.type === 'dir') return 1;
                return a.name.localeCompare(b.name);
            });

            return { success: true, entries };
        } catch (error) {
            logger.debug('Failed to list directory:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Failed to list directory' };
        }
    });

    // Get directory tree handler - recursive with depth control
    rpcHandlerManager.registerHandler<GetDirectoryTreeRequest, GetDirectoryTreeResponse>('getDirectoryTree', async (data) => {
        logger.debug('Get directory tree request:', data.path, 'maxDepth:', data.maxDepth);

        // Validate path is within working directory
        const validation = validatePath(data.path, workingDirectory);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        // Helper function to build tree recursively
        async function buildTree(path: string, name: string, currentDepth: number): Promise<TreeNode | null> {
            try {
                const stats = await stat(path);

                // Base node information
                const node: TreeNode = {
                    name,
                    path,
                    type: stats.isDirectory() ? 'directory' : 'file',
                    size: stats.size,
                    modified: stats.mtime.getTime()
                };

                // If it's a directory and we haven't reached max depth, get children
                if (stats.isDirectory() && currentDepth < data.maxDepth) {
                    const entries = await readdir(path, { withFileTypes: true });
                    const children: TreeNode[] = [];

                    // Process entries in parallel, filtering out symlinks
                    await Promise.all(
                        entries.map(async (entry) => {
                            // Skip symbolic links completely
                            if (entry.isSymbolicLink()) {
                                logger.debug(`Skipping symlink: ${join(path, entry.name)}`);
                                return;
                            }

                            const childPath = join(path, entry.name);
                            const childNode = await buildTree(childPath, entry.name, currentDepth + 1);
                            if (childNode) {
                                children.push(childNode);
                            }
                        })
                    );

                    // Sort children: directories first, then files, alphabetically
                    children.sort((a, b) => {
                        if (a.type === 'directory' && b.type !== 'directory') return -1;
                        if (a.type !== 'directory' && b.type === 'directory') return 1;
                        return a.name.localeCompare(b.name);
                    });

                    node.children = children;
                }

                return node;
            } catch (error) {
                // Log error but continue traversal
                logger.debug(`Failed to process ${path}:`, error instanceof Error ? error.message : String(error));
                return null;
            }
        }

        try {
            // Validate maxDepth
            if (data.maxDepth < 0) {
                return { success: false, error: 'maxDepth must be non-negative' };
            }

            // Get the base name for the root node
            const baseName = data.path === '/' ? '/' : data.path.split('/').pop() || data.path;

            // Build the tree starting from the requested path
            const tree = await buildTree(data.path, baseName, 0);

            if (!tree) {
                return { success: false, error: 'Failed to access the specified path' };
            }

            return { success: true, tree };
        } catch (error) {
            logger.debug('Failed to get directory tree:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Failed to get directory tree' };
        }
    });

    // Ripgrep handler - raw interface to ripgrep
    rpcHandlerManager.registerHandler<RipgrepRequest, RipgrepResponse>('ripgrep', async (data) => {
        logger.debug('Ripgrep request with args:', data.args, 'cwd:', data.cwd);

        // Validate cwd if provided
        if (data.cwd) {
            const validation = validatePath(data.cwd, workingDirectory);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }
        }

        try {
            const result = await runRipgrep(data.args, { cwd: data.cwd });
            return {
                success: true,
                exitCode: result.exitCode,
                stdout: result.stdout.toString(),
                stderr: result.stderr.toString()
            };
        } catch (error) {
            logger.debug('Failed to run ripgrep:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to run ripgrep'
            };
        }
    });

    // Difftastic handler - raw interface to difftastic
    rpcHandlerManager.registerHandler<DifftasticRequest, DifftasticResponse>('difftastic', async (data) => {
        logger.debug('Difftastic request with args:', data.args, 'cwd:', data.cwd);

        // Validate cwd if provided
        if (data.cwd) {
            const validation = validatePath(data.cwd, workingDirectory);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }
        }

        try {
            const result = await runDifftastic(data.args, { cwd: data.cwd });
            return {
                success: true,
                exitCode: result.exitCode,
                stdout: result.stdout.toString(),
                stderr: result.stderr.toString()
            };
        } catch (error) {
            logger.debug('Failed to run difftastic:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to run difftastic'
            };
        }
    });

    // Get diff detail handler - returns stored diff for a specific callId + filePath
    if (sessionId) {
        rpcHandlerManager.registerHandler<
            { callId: string; filePath: string },
            { success: boolean; diff?: string; additions?: number; deletions?: number; error?: string }
        >('getDiffDetail', async (data) => {
            logger.debug('getDiffDetail request:', data.callId, data.filePath);

            const result = getDiffDetail(sessionId, data.callId, data.filePath);
            if (!result) {
                return { success: false, error: 'not_found' };
            }

            return {
                success: true,
                diff: result.diff,
                additions: result.additions,
                deletions: result.deletions,
            };
        });

        rpcHandlerManager.registerHandler<
            { callId: string },
            { success: boolean; toolName?: string; agent?: 'claude' | 'codex' | 'gemini'; result?: unknown; error?: string }
        >('getToolOutput', async (data) => {
            logger.debug('getToolOutput request:', data.callId);

            const record = getToolOutputRecord(sessionId, data.callId);
            if (!record) {
                return { success: false, error: 'not_found' };
            }

            return {
                success: true,
                toolName: record.toolName,
                agent: record.agent,
                result: record.result,
            };
        });
    }
}

// A3 path policy: read anywhere, but block writes to OS-managed system paths
// AND high-impact user-level paths whose write would yield persistent backdoors
// (SSH keys, shell rc, launch agents, cloud creds). Reading these is still A3-allowed;
// only writes are denied because writing them weaponizes the session.
const SYSTEM_WRITE_DENY = [
    // OS-managed Linux/POSIX system roots.
    /^\/etc\//,
    /^\/usr\//,
    /^\/sbin\//,
    /^\/bin\//,
    /^\/sys\//,
    /^\/proc\//,
    /^\/dev\//,
    /^\/boot\//,
    /^\/var\/log\//,

    // User-level high-impact paths (anywhere under any home / under any cwd).
    /\/\.ssh\//,                     // private keys, authorized_keys
    /\/\.aws\//,                     // credentials, config
    /\/\.gnupg\//,                   // GPG keyrings
    /\/\.docker\/config\.json$/,
    /\/\.git-credentials$/,
    /\/\.config\/git\/credentials$/,
    /\/\.netrc$/,
    /\/\.npmrc$/,                    // can carry registry tokens
    /\/\.pypirc$/,                   // PyPI tokens

    // Shell rc / login shell paths — append = persistent command injection.
    /\/\.bashrc$/,
    /\/\.bash_profile$/,
    /\/\.bash_login$/,
    /\/\.profile$/,
    /\/\.zshrc$/,
    /\/\.zshenv$/,
    /\/\.zprofile$/,
    /\/\.zlogin$/,
    /\/\.config\/fish\/config\.fish$/,

    // macOS launch agents / daemons — writing here = boot-time persistence.
    /\/Library\/LaunchAgents\//,
    /\/Library\/LaunchDaemons\//,

    // Linux systemd user services.
    /\/\.config\/systemd\/user\//,

    // SSH server-side key drop-points (some homed setups put authorized_keys outside .ssh).
    /\/authorized_keys$/,
];

export function isWritableForSession(absPath: string): boolean {
    return !SYSTEM_WRITE_DENY.some((re) => re.test(absPath));
}

const SYSTEM_NOISE_NAMES = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    '.cache',
    '.DS_Store',
    '.next',
    '.expo',
]);

function isSystemNoise(name: string): boolean {
    if (SYSTEM_NOISE_NAMES.has(name)) return true;
    return name.endsWith('.lock');
}
