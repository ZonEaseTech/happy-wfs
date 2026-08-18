/**
 * Cursor approval bridge
 *
 * Cursor gates tools through file-based hooks and gives the SDK no callback,
 * so the path from a tool call to the phone runs through a short-lived local
 * HTTP server:
 *
 *   cursor-agent → .cursor/hooks.json → `happy cursor-approval-hook`
 *     → POST 127.0.0.1:<port>/approve → CursorPermissionHandler → phone
 *
 * The hook process blocks on that POST. Measured against cursor-agent
 * 2026.08.11: a hook may block indefinitely (312s observed with no
 * interference), a deny genuinely stops the tool — including the agent's
 * attempt to route around a blocked Write via Shell — and it outranks
 * --force. Hooks are also invoked concurrently, which is why requests are
 * keyed by tool_use_id.
 */

import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm, readFile, rename, readdir, rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '@/ui/logger';
import type { CursorPermissionHandler } from './cursorPermissionHandler';
import { normalizeCursorTool } from './cursorToolNames';

/**
 * Endpoints live in one registry keyed by Cursor's chat id, not next to
 * hooks.json. Several sessions can share a working directory — the app happily
 * starts a second one in the same folder — and a per-directory endpoint file
 * meant the newest session silently captured every other session's approvals.
 */
export function approvalRegistryDir(): string {
    return join(homedir(), '.happy', 'cursor-approvals');
}

/** Legacy per-directory endpoint file; still cleaned up if one is lying around. */
export const APPROVAL_ENDPOINT_FILE = '.happy-approval.json';
const HOOKS_FILE = 'hooks.json';
const HOOKS_BACKUP_FILE = 'hooks.json.happy-backup';
const MCP_FILE = 'mcp.json';
const MCP_BACKUP_FILE = 'mcp.json.happy-backup';

/**
 * How long the hook is allowed to block, in seconds. Generous on purpose:
 * this is a human reaching for their phone, and Cursor honours whatever we
 * put here. `failClosed` covers the case where it does expire.
 */
const HOOK_TIMEOUT_SECONDS = 900;

export interface CursorApprovalBridgeOptions {
    /** Session working directory — where .cursor/ lives */
    cwd: string;
    handler: CursorPermissionHandler;
    /**
     * Command and args for Happy's MCP stdio bridge, including this session's
     * --url. Passing it through the environment would have been better —
     * mcp.json is per-directory while a process environment is per-session —
     * but Cursor starts MCP servers with a scrubbed environment, so the URL has
     * to live in the file. Consequence: when two sessions share a directory the
     * later one owns the MCP config, and the earlier one's agent would reach
     * the wrong session's tools. Approvals are unaffected; those are routed by
     * chat id through the registry.
     */
    mcpBridge?: { command: string; args: string[] } | null;
}

interface HookRequestBody {
    token?: string;
    tool_use_id?: string;
    tool_name?: string;
    tool_input?: unknown;
}

export class CursorApprovalBridge {
    private readonly cwd: string;
    private readonly handler: CursorPermissionHandler;
    private readonly token = randomUUID();
    private server: Server | null = null;
    private port = 0;
    private hadExistingHooks = false;
    private hadExistingMcp = false;
    private readonly mcpBridge: { command: string; args: string[] } | null;
    /** True when .cursor/ did not exist before this session created it. */
    private createdCursorDir = false;
    private started = false;
    /** Chat ids this session has registered, so they can be cleaned up. */
    private readonly registeredChatIds = new Set<string>();

    constructor(options: CursorApprovalBridgeOptions) {
        this.cwd = options.cwd;
        this.handler = options.handler;
        this.mcpBridge = options.mcpBridge ?? null;
    }

    private get cursorDir(): string {
        return join(this.cwd, '.cursor');
    }

    async start(): Promise<void> {
        await this.listen();
        await this.installHooks();
        this.started = true;
        logger.debug(`[cursor] approval bridge listening on 127.0.0.1:${this.port}`);
    }

    /**
     * Claims a chat id for this session. Called as soon as cursor-agent reveals
     * it, which is what lets the hook route an approval back to the session
     * that actually made the call.
     */
    async registerChat(chatId: string): Promise<void> {
        if (!this.started || this.registeredChatIds.has(chatId)) return;
        const dir = approvalRegistryDir();
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${chatId}.json`), JSON.stringify({
            port: this.port,
            token: this.token,
            pid: process.pid,
        }), 'utf8');
        this.registeredChatIds.add(chatId);
        logger.debug(`[cursor] chat ${chatId} routed to this session's bridge`);
    }

    private listen(): Promise<void> {
        return new Promise((resolve, reject) => {
            const server = createServer((req, res) => {
                if (req.method !== 'POST' || !req.url?.startsWith('/approve')) {
                    res.writeHead(404).end();
                    return;
                }
                let body = '';
                req.on('data', (chunk) => { body += chunk; });
                req.on('end', () => {
                    void this.decide(body)
                        .then((approved) => {
                            res.writeHead(200, { 'content-type': 'application/json' });
                            res.end(JSON.stringify({ approved }));
                        })
                        .catch((error) => {
                            logger.debug(`[cursor] approval failed: ${error}`);
                            // The hook turns any failure into a deny; say so explicitly.
                            res.writeHead(200, { 'content-type': 'application/json' });
                            res.end(JSON.stringify({ approved: false }));
                        });
                });
            });
            // Loopback only: this endpoint decides whether code runs.
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                if (address === null || typeof address === 'string') {
                    reject(new Error('Failed to determine approval server port'));
                    return;
                }
                this.port = address.port;
                this.server = server;
                resolve();
            });
            server.on('error', reject);
        });
    }

    private async decide(rawBody: string): Promise<boolean> {
        let parsed: HookRequestBody;
        try {
            parsed = JSON.parse(rawBody) as HookRequestBody;
        } catch {
            return false;
        }
        if (parsed.token !== this.token) {
            logger.debug('[cursor] rejecting approval request with a bad token');
            return false;
        }
        // Same normalisation as the stream path, so the approval card and the
        // tool card that follows it describe the call the same way.
        const { name: toolName, input: toolInput } = normalizeCursorTool(
            typeof parsed.tool_name === 'string' && parsed.tool_name.length > 0 ? parsed.tool_name : 'unknown',
            parsed.tool_input,
        );
        // Cursor omits tool_use_id on some events; a synthetic id keeps
        // concurrent requests from colliding in the pending map.
        const toolCallId = typeof parsed.tool_use_id === 'string' && parsed.tool_use_id.length > 0
            ? parsed.tool_use_id
            : `cursor-${randomUUID()}`;
        return this.handler.requestApproval(toolCallId, toolName, toolInput);
    }

    /**
     * Writes .cursor/hooks.json pointing at this CLI. Any file already there is
     * moved aside and restored on stop, so a project with its own hooks is not
     * quietly clobbered.
     */
    private async installHooks(): Promise<void> {
        this.createdCursorDir = !existsSync(this.cursorDir);
        await mkdir(this.cursorDir, { recursive: true });

        const hooksPath = join(this.cursorDir, HOOKS_FILE);
        if (existsSync(hooksPath)) {
            await rename(hooksPath, join(this.cursorDir, HOOKS_BACKUP_FILE));
            this.hadExistingHooks = true;
            logger.debug('[cursor] existing hooks.json moved aside for the session');
        }

        const hookCommand = `${process.execPath} ${process.argv[1]} cursor-approval-hook`;
        await writeFile(hooksPath, JSON.stringify({
            version: 1,
            hooks: {
                // preToolUse covers every tool, including Read, Write and Shell.
                // It only understands allow/deny — never "ask" — and failClosed
                // has to be explicit because hooks fail open by default.
                preToolUse: [
                    { type: 'command', command: hookCommand, timeout: HOOK_TIMEOUT_SECONDS, failClosed: true },
                ],
            },
        }, null, 2), 'utf8');

        await this.installMcpConfig();
        await this.excludeFromGit();
    }

    /** Points Cursor at Happy's tools (change_title, preview_html, devices…). */
    private async installMcpConfig(): Promise<void> {
        if (!this.mcpBridge) return;
        const mcpPath = join(this.cursorDir, MCP_FILE);
        if (existsSync(mcpPath)) {
            await rename(mcpPath, join(this.cursorDir, MCP_BACKUP_FILE));
            this.hadExistingMcp = true;
            logger.debug('[cursor] existing mcp.json moved aside for the session');
        }
        await writeFile(mcpPath, JSON.stringify({
            mcpServers: {
                happy: { command: this.mcpBridge.command, args: this.mcpBridge.args },
            },
        }, null, 2), 'utf8');
    }

    /** Keep the session's scaffolding out of `git status`. */
    private async excludeFromGit(): Promise<void> {
        const excludePath = join(this.cwd, '.git', 'info', 'exclude');
        if (!existsSync(excludePath)) return;
        try {
            const current = await readFile(excludePath, 'utf8');
            if (current.includes('.cursor/.happy-approval.json')) return;
            await writeFile(
                excludePath,
                `${current}${current.endsWith('\n') ? '' : '\n'}# added by happy cursor session\n.cursor/hooks.json\n.cursor/mcp.json\n.cursor/.happy-approval.json\n`,
                'utf8',
            );
        } catch (error) {
            logger.debug(`[cursor] could not update .git/info/exclude: ${error}`);
        }
    }

    async stop(): Promise<void> {
        if (!this.started) return;
        this.started = false;

        try {
            for (const chatId of this.registeredChatIds) {
                await rm(join(approvalRegistryDir(), `${chatId}.json`), { force: true });
            }
            this.registeredChatIds.clear();
            await rm(join(this.cursorDir, APPROVAL_ENDPOINT_FILE), { force: true });
            const hooksPath = join(this.cursorDir, HOOKS_FILE);
            const backupPath = join(this.cursorDir, HOOKS_BACKUP_FILE);
            if (this.hadExistingHooks && existsSync(backupPath)) {
                await rename(backupPath, hooksPath);
            } else {
                await rm(hooksPath, { force: true });
            }

            const mcpPath = join(this.cursorDir, MCP_FILE);
            const mcpBackup = join(this.cursorDir, MCP_BACKUP_FILE);
            if (this.hadExistingMcp && existsSync(mcpBackup)) {
                await rename(mcpBackup, mcpPath);
            } else if (this.mcpBridge) {
                await rm(mcpPath, { force: true });
            }
            // Leaving an empty .cursor/ behind in someone's repo is still
            // litter, so remove the directory when we made it and nothing
            // else moved in.
            if (this.createdCursorDir && (await readdir(this.cursorDir)).length === 0) {
                await rmdir(this.cursorDir);
            }
        } catch (error) {
            logger.debug(`[cursor] cleanup of .cursor/ failed: ${error}`);
        }

        await new Promise<void>((resolve) => {
            if (!this.server) return resolve();
            this.server.close(() => resolve());
            this.server = null;
        });
        logger.debug('[cursor] approval bridge stopped');
    }
}
