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
import { spawnShell, resizePty, closePty, writeToPty, PTY_UNAVAILABLE } from '@/modules/pty';
import { encrypt, decrypt, encodeBase64, decodeBase64 } from '@/api/encryption';

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
 * PTY (pseudo-terminal) RPC types — see protocol doc in
 * .task-orchestrator/.../protocol.md. The lifecycle goes through RPC
 * (encrypted by RpcHandlerManager). Streaming frames (pty-input,
 * pty-output, pty-exit) are non-RPC socket events that we encrypt manually
 * with the same session encryption key.
 */
interface PtyStartRequest {
    cols: number;
    rows: number;
    cwd?: string;
}

interface PtyStartResponse {
    ok: boolean;
    ptyId?: string;
    error?: string;
}

interface PtyResizeRequest {
    ptyId: string;
    cols: number;
    rows: number;
}

interface PtyResizeResponse {
    ok: boolean;
}

interface PtyCloseRequest {
    ptyId: string;
}

interface PtyCloseResponse {
    ok: boolean;
}

interface PtyInputEvent {
    sessionId: string;
    ptyId: string;
    data: string; // utf-8 keystrokes from xterm.onData
}

/** Output frames are batched and encrypted; see batching constants below. */
const PTY_OUTPUT_FLUSH_MS = 16;
const PTY_OUTPUT_FLUSH_BYTES = 32 * 1024;

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

        // ============================================================
        // PTY (xterm-style interactive shell) RPC + streaming handlers
        // ============================================================
        // The protocol splits PTY control across:
        //   - RPC (encrypted by RpcHandlerManager): pty-start, pty-resize, pty-close
        //   - Non-RPC socket events (encrypted manually): pty-input (in), pty-output / pty-exit (out)
        //
        // We keep one Map<ptyId, { batch state, dispose handles }> per spawn so that
        // onData batching state stays per-PTY and gets cleaned up on close/exit.
        type PtyOutboundState = {
            buffer: Buffer[];
            byteCount: number;
            timer: NodeJS.Timeout | null;
            dataDispose: { dispose(): void };
            exitDispose: { dispose(): void };
        };
        const outboundStates = new Map<string, PtyOutboundState>();

        // Server's pty-output / pty-exit listeners expect a PLAINTEXT envelope
        // ({ sessionId, ptyId, data?, exitCode? }) so they can route by
        // sessionId without decrypting. Only the `data` field is encrypted —
        // sessionId/ptyId/exitCode stay readable. The previous version
        // encrypted the whole envelope as a single string and the server
        // silently dropped it (`typeof data !== 'object'`).
        const emitEncrypted = (event: 'pty-output' | 'pty-exit', payload: { sessionId: string; ptyId: string; data?: string; exitCode?: number }): void => {
            const socket = rpcHandlerManager.getSocket();
            if (!socket || !socket.connected) {
                return;
            }
            const envelope: Record<string, unknown> = { sessionId: payload.sessionId, ptyId: payload.ptyId };
            if (event === 'pty-output' && typeof payload.data === 'string') {
                const key = rpcHandlerManager.getEncryptionKey();
                const variant = rpcHandlerManager.getEncryptionVariant();
                envelope.data = encodeBase64(encrypt(key, variant, payload.data));
            } else if (event === 'pty-exit' && typeof payload.exitCode === 'number') {
                envelope.exitCode = payload.exitCode;
            }
            // volatile.emit: drop on socket buffer pressure rather than queue.
            // For PTY output that's the right tradeoff — stale bytes are noise.
            socket.volatile.emit(event, envelope);
        };

        // If `merged` ends in the middle of a UTF-8 multi-byte sequence
        // (continuation expected), strip those trailing bytes off and
        // return them — they get re-prepended to the next batch so the
        // wire never carries half a code point. Without this, CJK / emoji
        // shows up as garbled glyphs because xterm decodes per-write and
        // any half-byte breaks the next sequence too.
        const splitOnUtf8Boundary = (merged: Buffer): { complete: Buffer; tail: Buffer } => {
            if (merged.length === 0) return { complete: merged, tail: merged };
            // Walk back from the end to find the last char-start byte.
            // A start byte is either ASCII (0xxxxxxx) or a leading byte
            // (11xxxxxx). Continuation bytes are 10xxxxxx.
            let i = merged.length - 1;
            while (i >= 0 && (merged[i] & 0xc0) === 0x80) i--;
            if (i < 0) return { complete: Buffer.alloc(0), tail: merged };
            const lead = merged[i];
            // Count expected length of the sequence starting at `lead`.
            // 0xxxxxxx = 1, 110xxxxx = 2, 1110xxxx = 3, 11110xxx = 4.
            let expected = 1;
            if ((lead & 0x80) === 0) expected = 1;
            else if ((lead & 0xe0) === 0xc0) expected = 2;
            else if ((lead & 0xf0) === 0xe0) expected = 3;
            else if ((lead & 0xf8) === 0xf0) expected = 4;
            const have = merged.length - i;
            if (have >= expected) return { complete: merged, tail: Buffer.alloc(0) };
            // Sequence incomplete — peel the trailing partial off.
            return { complete: merged.subarray(0, i), tail: merged.subarray(i) };
        };

        const flushPtyOutput = (ptyId: string): void => {
            const state = outboundStates.get(ptyId);
            if (!state) return;
            if (state.timer) {
                clearTimeout(state.timer);
                state.timer = null;
            }
            if (state.buffer.length === 0) return;
            const merged = Buffer.concat(state.buffer, state.byteCount);
            const { complete, tail } = splitOnUtf8Boundary(merged);
            // Carry incomplete trailing bytes to the next batch — they'll
            // join their continuation bytes there and emit as a whole.
            if (tail.length > 0) {
                state.buffer = [tail];
                state.byteCount = tail.length;
                if (!state.timer) {
                    state.timer = setTimeout(() => flushPtyOutput(ptyId), PTY_OUTPUT_FLUSH_MS);
                }
            } else {
                state.buffer = [];
                state.byteCount = 0;
            }
            if (complete.length === 0) return;
            const data = complete.toString('base64');
            emitEncrypted('pty-output', { sessionId, ptyId, data });
        };

        const cleanupPtyState = (ptyId: string): void => {
            const state = outboundStates.get(ptyId);
            if (!state) return;
            // Drain any remaining buffered output before tearing down handlers.
            flushPtyOutput(ptyId);
            try { state.dataDispose.dispose(); } catch { /* already disposed */ }
            try { state.exitDispose.dispose(); } catch { /* already disposed */ }
            outboundStates.delete(ptyId);
        };

        rpcHandlerManager.registerHandler<PtyStartRequest, PtyStartResponse>('pty-start', async (data) => {
            logger.debug('[pty-start] request', { cols: data.cols, rows: data.rows, cwd: data.cwd });
            try {
                const { ptyId, term } = spawnShell({
                    cols: data.cols,
                    rows: data.rows,
                    cwd: data.cwd,
                });

                // Wire onData → batched pty-output emit.
                // spawnShell uses encoding: null so node-pty hands us raw Buffers
                // here. This is critical for non-ASCII PTY output: utf8-decoding
                // chunk-by-chunk corrupts multibyte sequences (a 3-byte UTF-8 "你"
                // becomes JS char 0x4F60, then any latin1 round-trip truncates to
                // 0x60). With raw Buffers we preserve the byte stream verbatim and
                // let xterm.js do the streaming UTF-8 decode on the receive side.
                const dataDispose = term.onData((chunk: Buffer) => {
                    const state = outboundStates.get(ptyId);
                    if (!state) return; // already cleaned up
                    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as string, 'binary');
                    state.buffer.push(buf);
                    state.byteCount += buf.length;
                    if (state.byteCount >= PTY_OUTPUT_FLUSH_BYTES) {
                        flushPtyOutput(ptyId);
                        return;
                    }
                    if (!state.timer) {
                        state.timer = setTimeout(() => flushPtyOutput(ptyId), PTY_OUTPUT_FLUSH_MS);
                    }
                });

                const exitDispose = term.onExit(({ exitCode }) => {
                    logger.debug(`[pty-exit] ${ptyId} exitCode=${exitCode}`);
                    // Flush any pending output before notifying exit.
                    flushPtyOutput(ptyId);
                    emitEncrypted('pty-exit', { sessionId, ptyId, exitCode });
                    cleanupPtyState(ptyId);
                    closePty(ptyId);
                });

                outboundStates.set(ptyId, {
                    buffer: [],
                    byteCount: 0,
                    timer: null,
                    dataDispose,
                    exitDispose,
                });

                return { ok: true, ptyId };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (message === PTY_UNAVAILABLE) {
                    logger.debug('[pty-start] node-pty unavailable on this host');
                    return { ok: false, error: PTY_UNAVAILABLE };
                }
                logger.debug('[pty-start] spawn failed:', message);
                return { ok: false, error: message };
            }
        });

        rpcHandlerManager.registerHandler<PtyResizeRequest, PtyResizeResponse>('pty-resize', async (data) => {
            logger.debug(`[pty-resize] ${data.ptyId} ${data.cols}x${data.rows}`);
            const ok = resizePty(data.ptyId, data.cols, data.rows);
            return { ok };
        });

        rpcHandlerManager.registerHandler<PtyCloseRequest, PtyCloseResponse>('pty-close', async (data) => {
            logger.debug(`[pty-close] ${data.ptyId}`);
            // Tear down our batching/onData state first so the imminent exit
            // event from kill() doesn't try to emit on a half-disposed term.
            cleanupPtyState(data.ptyId);
            const ok = closePty(data.ptyId);
            return { ok };
        });

        // Non-RPC streaming inbound: keystrokes from the app.
        // Per protocol, the server relay forwards opaque ciphertext as a base64
        // string — the CLI decrypts here with the session encryption key.
        // (The matching encrypt step on the app side mirrors emitEncrypted above.)
        // The server fan-outs pty-input as a plaintext envelope:
        //   { sessionId, ptyId, data: <encrypted base64 of the keystrokes> }
        // sessionId/ptyId stay readable so the server can route by session
        // without decrypting; only `data` carries ciphertext.
        rpcHandlerManager.registerSocketEvent('pty-input', (envelope: any) => {
            if (!envelope || typeof envelope !== 'object') {
                logger.debug('[pty-input] unexpected envelope shape, dropping');
                return;
            }
            if (envelope.sessionId !== sessionId) return;
            if (typeof envelope.ptyId !== 'string') return;
            if (typeof envelope.data !== 'string') return;
            try {
                const key = rpcHandlerManager.getEncryptionKey();
                const variant = rpcHandlerManager.getEncryptionVariant();
                const decoded = decrypt(key, variant, decodeBase64(envelope.data));
                if (typeof decoded !== 'string') {
                    logger.debug('[pty-input] decrypted payload not a string, dropping');
                    return;
                }
                writeToPty(envelope.ptyId, decoded);
            } catch (err) {
                logger.debug('[pty-input] decrypt/dispatch failed:', err);
            }
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
