/**
 * Happy MCP server
 * Provides Happy CLI specific tools including chat session title management
 *
 * Supports multiple sessions to handle mode switching (local <-> remote)
 * where each mode spawns a new Claude Code process that needs to connect.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { AddressInfo } from "node:net";
import { z } from "zod";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { readCredentials } from "@/persistence";
import { deviceExec, listDevices } from "@/device/deviceExec";
import { deleteBug, editBug, listBugs, submitBug } from "@/bugs/bugs";
import { randomUUID } from "node:crypto";
import { shouldEnableOrchestratorTools } from '@/orchestrator/prompt';
import { applyDefaultWorkingDirectory } from '@/orchestrator/common';
import {
    ORCHESTRATOR_CANCEL_TOOL_SCHEMA,
    ORCHESTRATOR_GET_CONTEXT_TOOL_SCHEMA,
    ORCHESTRATOR_LIST_TOOL_SCHEMA,
    ORCHESTRATOR_PEND_TOOL_SCHEMA,
    ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA,
    ORCHESTRATOR_SUBMIT_TOOL_SCHEMA,
} from '@/orchestrator/mcpToolSchemas';
import { CLAUDE_MODEL_MODES, CODEX_MODEL_MODES, GEMINI_MODEL_MODES } from 'happy-wire';

function toToolSuccess(data: unknown) {
    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(data, null, 2),
            },
        ],
        isError: false,
    };
}

function toToolError(message: string, details?: unknown) {
    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify({
                    ok: false,
                    error: message,
                    ...(details !== undefined ? { details } : {}),
                }, null, 2),
            },
        ],
        isError: true,
    };
}

// Factory function to create MCP server with tools
function createMcpServer(client: ApiSessionClient, options: { enableOrchestratorTools: boolean }): McpServer {
    const mcp = new McpServer({
        name: "Happy MCP",
        version: "1.0.0",
    });

    // Handler that sends title updates via the client
    const handler = async (title: string) => {
        logger.debug('[happyMCP] Changing title to:', title);
        if (client.isTitlePinned) {
            return { success: false, error: 'Title is pinned by user and cannot be changed automatically' };
        }
        try {
            client.sendClaudeSessionMessage({
                type: 'summary',
                summary: title,
                leafUuid: randomUUID()
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    };

    mcp.registerTool('device_list', {
        description: 'List enrolled Happy devices (servers and computers) with their online state. Use before device_exec when you need a device id.',
        title: 'List Devices',
        inputSchema: {},
    }, async () => {
        const credentials = await readCredentials();
        if (!credentials) {
            return { content: [{ type: 'text', text: 'No Happy credentials on this machine.' }] };
        }
        try {
            const devices = await listDevices(credentials);
            const target = client.targetDevices.map((device) => device.id);
            const lines = devices.map((device) => {
                const marks = [device.active ? 'online' : 'offline'];
                if (target.includes(device.id)) marks.push('session default');
                return `${device.id}  ${device.name}${device.platform ? ` (${device.platform})` : ''}  [${marks.join(', ')}]${device.description ? `  — ${device.description}` : ''}`;
            });
            return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : 'No devices enrolled yet.' }] };
        } catch (error) {
            return { content: [{ type: 'text', text: `Failed to list devices: ${error instanceof Error ? error.message : String(error)}` }] };
        }
    });

    mcp.registerTool('device_exec', {
        description: 'Run a shell command on an enrolled device (a server or computer registered in Happy). '
            + 'Omit deviceId to use the device the user selected for this session. Returns stdout, stderr and exit code.',
        title: 'Run Command on Device',
        inputSchema: {
            command: z.string().describe('Shell command to run on the device'),
            deviceId: z.string().optional().describe('Target device id. Defaults to the session\'s selected device.'),
            cwd: z.string().optional().describe('Working directory on the device'),
            timeout: z.number().optional().describe('Timeout in milliseconds (default 60000)'),
        },
    }, async (args) => {
        const credentials = await readCredentials();
        if (!credentials) {
            return { content: [{ type: 'text', text: 'No Happy credentials on this machine.' }] };
        }
        const targets = client.targetDevices;
        const deviceId = args.deviceId
            || (targets.length === 1 ? targets[0].id : null);
        if (!deviceId && targets.length > 1) {
            return { content: [{ type: 'text', text: `This session targets several devices — pass deviceId: ${targets.map((device) => `${device.name} (${device.id})`).join(', ')}` }] };
        }
        if (!deviceId) {
            return { content: [{ type: 'text', text: 'No device selected for this session. Pick one in the app or pass deviceId (see device_list).' }] };
        }
        try {
            const result = await deviceExec(client.rpcSocket as any, credentials, deviceId, args.command, {
                cwd: args.cwd,
                timeout: args.timeout,
                deviceKeyBase64: targets.find((device) => device.id === deviceId)?.key ?? null,
            });
            const parts = [`exit code: ${result.exitCode}`];
            if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
            if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
            return { content: [{ type: 'text', text: parts.join('\n\n') }] };
        } catch (error) {
            return { content: [{ type: 'text', text: `Device command failed: ${error instanceof Error ? error.message : String(error)}` }] };
        }
    });

    mcp.registerTool('change_title', {
        description: 'Change the title of the current chat session',
        title: 'Change Chat Title',
        inputSchema: {
            title: z.string().describe('The new title for the chat session'),
        },
    }, async (args) => {
        const response = await handler(args.title);
        logger.debug('[happyMCP] Response:', response);

        if (response.success) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Successfully changed chat title to: "${args.title}"`,
                    },
                ],
                isError: false,
            };
        } else {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to change chat title: ${response.error || 'Unknown error'}`,
                    },
                ],
                isError: true,
            };
        }
    });

    mcp.registerTool('preview_html', {
        description: 'Preview an HTML page in the client app. The HTML must be a complete, self-contained document with all CSS and JS inlined.',
        title: 'Preview HTML',
        inputSchema: {
            html: z.string().describe('Complete self-contained HTML document string'),
            title: z.string().optional().describe('Display title for the preview'),
        },
    }, async (args) => {
        logger.debug('[happyMCP] Preview HTML:', args.title || 'Untitled');
        return {
            content: [{
                type: 'text',
                text: `HTML preview ready: ${args.title || 'Untitled'}`,
            }],
            isError: false,
        };
    });

    mcp.registerTool('submit_bug', {
        description: 'File a bug report on the user\'s Happy bug board. Use when the user asks to report or file a bug. '
            + 'Write the description yourself from the conversation: what went wrong, what was expected, and the steps to reproduce it.',
        title: 'Submit Bug',
        inputSchema: {
            description: z.string().describe('What went wrong, what was expected, and how to reproduce it. The title is derived from the first line.'),
            visibility: z.enum(['shared', 'private']).optional().describe('shared (default) puts it on the shared board; private keeps it to the owner'),
            images: z.array(z.string()).optional().describe('Absolute paths to screenshots on this machine. JPEG and PNG only, up to 10 images, 20MB each.'),
        },
    }, async (args) => {
        const credentials = await readCredentials();
        if (!credentials) {
            return toToolError('No Happy credentials on this machine.');
        }
        try {
            const bug = await submitBug(credentials, args);
            logger.debug('[happyMCP] Submitted bug:', bug.displayId);
            return toToolSuccess({ ok: true, ...bug });
        } catch (error) {
            return toToolError(`Failed to submit bug: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    mcp.registerTool('list_bugs', {
        description: 'List bugs on the user\'s Happy bug board. Use to answer what is open, to find a bug the user is describing, or to get its number before editing or deleting it.',
        title: 'List Bugs',
        inputSchema: {
            status: z.enum(['pending', 'in_progress', 'verify', 'closed']).optional().describe('Only bugs in this state'),
            query: z.string().describe('Free text matched against number, title, description, author and status').optional(),
            limit: z.number().int().min(1).max(200).optional().describe('How many to return, 50 by default'),
        },
    }, async (args) => {
        const credentials = await readCredentials();
        if (!credentials) {
            return toToolError('No Happy credentials on this machine.');
        }
        try {
            const { bugs, pendingCount } = await listBugs(credentials, args);
            const lines = bugs.map((bug) => {
                const counts = [
                    bug.attachmentCount ? `${bug.attachmentCount} images` : '',
                    bug.commentCount ? `${bug.commentCount} comments` : '',
                ].filter(Boolean).join(', ');
                const activity = bug.lastActivityAt ? new Date(bug.lastActivityAt).toISOString().slice(0, 10) : '';
                return `${bug.displayId}  [${bug.status}]  ${bug.title}${bug.createdByNickname ? `  — ${bug.createdByNickname}` : ''}${counts ? `  (${counts})` : ''}${activity ? `  ${activity}` : ''}`;
            });
            const header = `${bugs.length} bugs shown, ${pendingCount} pending on the board`;
            return { content: [{ type: 'text', text: lines.length ? `${header}\n${lines.join('\n')}` : header }] };
        } catch (error) {
            return toToolError(`Failed to list bugs: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    mcp.registerTool('edit_bug', {
        description: 'Change a bug already on the user\'s Happy bug board: rewrite its description, add screenshots to it, or both. '
            + 'Use when the user wants to correct, expand or illustrate an existing bug.',
        title: 'Edit Bug',
        inputSchema: {
            bug: z.string().describe('Which bug, as the user refers to it: "BUG-236", "#236" or "236". An internal bug id also works.'),
            description: z.string().optional().describe('The full replacement description. It replaces the old one outright, so carry over anything still true. Omit to leave the description alone.'),
            images: z.array(z.string()).optional().describe('Absolute paths to screenshots on this machine, added to any already on the bug. JPEG and PNG only, 10 per bug in total, 20MB each.'),
        },
    }, async (args) => {
        const credentials = await readCredentials();
        if (!credentials) {
            return toToolError('No Happy credentials on this machine.');
        }
        try {
            const bug = await editBug(credentials, args);
            logger.debug('[happyMCP] Edited bug:', bug.displayId);
            return toToolSuccess({ ok: true, ...bug });
        } catch (error) {
            return toToolError(`Failed to edit bug: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    mcp.registerTool('delete_bug', {
        description: 'Remove a bug from the user\'s Happy bug board. The server keeps the row and hides it, so this can be undone by an admin, but it disappears from the board immediately.',
        title: 'Delete Bug',
        inputSchema: {
            bug: z.string().describe('Which bug, as the user refers to it: "BUG-236", "#236" or "236". An internal bug id also works.'),
        },
    }, async (args) => {
        const credentials = await readCredentials();
        if (!credentials) {
            return toToolError('No Happy credentials on this machine.');
        }
        try {
            const deleted = await deleteBug(credentials, args.bug);
            logger.debug('[happyMCP] Deleted bug:', args.bug);
            return toToolSuccess({ ok: true, ...deleted });
        } catch (error) {
            return toToolError(`Failed to delete bug: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    if (options.enableOrchestratorTools) {
        mcp.registerTool('orchestrator_get_context', ORCHESTRATOR_GET_CONTEXT_TOOL_SCHEMA, async () => {
            try {
                const metadata = client.getMetadataSnapshot();
                const fallback = {
                    controllerSessionId: client.sessionId,
                    machineId: metadata?.machineId ?? null,
                    workingDirectory: metadata?.path ?? null,
                    defaults: {
                        mode: 'async',
                        maxConcurrency: 2,
                        retryMaxAttempts: 1,
                        retryBackoffMs: 0,
                    },
                    providers: ['claude', 'codex', 'gemini'],
                    modelModes: {
                        claude: CLAUDE_MODEL_MODES,
                        codex: CODEX_MODEL_MODES,
                        gemini: GEMINI_MODEL_MODES,
                    },
                    machines: [],
                };
                try {
                    const response = await client.orchestratorGetContext();
                    const data = response?.data ?? null;
                    if (data) {
                        const machines = data.machines ?? [];
                        const currentMachine = machines.find((m: any) => m.machineId === metadata?.machineId);
                        return toToolSuccess({
                            ok: true,
                            data: {
                                ...fallback,
                                defaults: data.defaults ?? fallback.defaults,
                                providers: currentMachine?.providers ?? data.providers ?? fallback.providers,
                                modelModes: currentMachine?.modelModes ?? data.modelModes ?? fallback.modelModes,
                                machines,
                            },
                        });
                    }
                } catch (_error) {
                    // fallback to local-only context for backward compatibility
                }
                return toToolSuccess({
                    ok: true,
                    data: fallback,
                });
            } catch (error) {
                return toToolError('Failed to load orchestrator context', error instanceof Error ? error.message : String(error));
            }
        });

        mcp.registerTool('orchestrator_submit', ORCHESTRATOR_SUBMIT_TOOL_SCHEMA, async (args) => {
            try {
                const metadata = client.getMetadataSnapshot();
                const submitBody = {
                    title: args.title,
                    controllerSessionId: args.controllerSessionId ?? client.sessionId,
                    controllerMachineId: metadata?.machineId ?? undefined,
                    tasks: applyDefaultWorkingDirectory(args.tasks, metadata?.path, metadata?.machineId),
                    maxConcurrency: args.maxConcurrency,
                    idempotencyKey: args.idempotencyKey,
                    metadata: args.metadata,
                    mode: 'async' as const,
                };

                const submit = await client.orchestratorSubmit(submitBody);
                return toToolSuccess({
                    ok: true,
                    mode: 'async',
                    data: submit?.data ?? null,
                });
            } catch (error) {
                return toToolError('Failed to submit orchestrator run', error instanceof Error ? error.message : String(error));
            }
        });

        mcp.registerTool('orchestrator_pend', ORCHESTRATOR_PEND_TOOL_SCHEMA, async (args) => {
            const startedAt = Date.now();
            const totalTimeoutMs = args.timeoutMs ?? 10 * 60 * 1000;
            let cursor = args.cursor;
            while (true) {
                const elapsed = Date.now() - startedAt;
                const remaining = totalTimeoutMs - elapsed;
                if (remaining <= 0) break;

                try {
                    const response = await client.orchestratorPend(args.runId, {
                        cursor,
                        waitFor: args.waitFor,
                        timeoutMs: Math.min(remaining, 60_000),
                        include: args.include,
                    });
                    return toToolSuccess(response);
                } catch (error: any) {
                    const status = error?.response?.status;
                    if (status === 504 && remaining > 1000) {
                        cursor = undefined; // Reset cursor on 504 and retry
                        continue;
                    }
                    return toToolError('Failed to pend orchestrator run', error instanceof Error ? error.message : String(error));
                }
            }

            // Timeout exhausted — do a final non-blocking fetch
            try {
                const response = await client.orchestratorPend(args.runId, {
                    cursor,
                    waitFor: args.waitFor,
                    timeoutMs: 0,
                    include: args.include,
                });
                return toToolSuccess(response);
            } catch (error) {
                return toToolError('Failed to pend orchestrator run', error instanceof Error ? error.message : String(error));
            }
        });

        mcp.registerTool('orchestrator_list', ORCHESTRATOR_LIST_TOOL_SCHEMA, async (args) => {
            try {
                const response = await client.orchestratorListRuns({
                    status: args.status,
                    limit: args.limit,
                    cursor: args.cursor,
                });
                return toToolSuccess(response);
            } catch (error) {
                return toToolError('Failed to list orchestrator runs', error instanceof Error ? error.message : String(error));
            }
        });

        mcp.registerTool('orchestrator_cancel', ORCHESTRATOR_CANCEL_TOOL_SCHEMA, async (args) => {
            try {
                const response = await client.orchestratorCancel(args.runId, { reason: args.reason });
                return toToolSuccess(response);
            } catch (error) {
                return toToolError('Failed to cancel orchestrator run', error instanceof Error ? error.message : String(error));
            }
        });

        mcp.registerTool('orchestrator_send_message', ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA, async (args) => {
            try {
                const response = await client.orchestratorSendMessage({
                    taskId: args.taskId,
                    message: args.message,
                });
                return toToolSuccess(response);
            } catch (error) {
                return toToolError('Failed to send message to orchestrator task', error instanceof Error ? error.message : String(error));
            }
        });
    }

    return mcp;
}

export async function startHappyServer(client: ApiSessionClient) {
    // Store transports by session ID to support multiple Claude Code connections
    // This is needed when switching between local and remote modes, as each mode
    // spawns a new Claude Code process that needs its own MCP session
    const transports: Map<string, StreamableHTTPServerTransport> = new Map();
    const enableOrchestratorTools = shouldEnableOrchestratorTools();
    const toolNames = enableOrchestratorTools
        ? ['change_title', 'preview_html', 'device_list', 'device_exec', 'list_bugs', 'submit_bug', 'edit_bug', 'delete_bug', 'orchestrator_get_context', 'orchestrator_submit', 'orchestrator_pend', 'orchestrator_list', 'orchestrator_cancel', 'orchestrator_send_message']
        : ['change_title', 'preview_html', 'device_list', 'device_exec', 'list_bugs', 'submit_bug', 'edit_bug', 'delete_bug'];

    // Capture console.error from Hono to our logger
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
        logger.debug("[happyMCP] console.error:", ...args);
        originalConsoleError.apply(console, args);
    };

    //
    // Create the HTTP server with multi-session support
    //
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        logger.debug("[happyMCP] Received request:", req.method, req.url, "sessionId:", sessionId);

        try {
            // For POST requests, we need to read the body to check if it's an initialize request
            if (req.method === 'POST') {
                const body = await readRequestBody(req);
                const parsedBody = JSON.parse(body);

                let transport: StreamableHTTPServerTransport;

                if (sessionId && transports.has(sessionId)) {
                    // Reuse existing transport for this session
                    transport = transports.get(sessionId)!;
                    logger.debug("[happyMCP] Reusing transport for session:", sessionId);
                } else if (!sessionId && isInitializeRequest(parsedBody)) {
                    // New initialization request - create new transport and MCP server
                    logger.debug("[happyMCP] New initialize request, creating transport");

                    transport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: () => randomUUID(),
                        onsessioninitialized: (newSessionId: string) => {
                            logger.debug("[happyMCP] Session initialized:", newSessionId);
                            transports.set(newSessionId, transport);
                        }
                    });

                    // Set up cleanup when transport closes
                    transport.onclose = () => {
                        const sid = transport.sessionId;
                        if (sid && transports.has(sid)) {
                            logger.debug("[happyMCP] Transport closed, removing session:", sid);
                            transports.delete(sid);
                        }
                    };

                    transport.onerror = (error: Error) => {
                        logger.debug("[happyMCP] Transport error:", error);
                    };

                    // Create and connect MCP server to this transport
                    const mcp = createMcpServer(client, { enableOrchestratorTools });
                    await mcp.connect(transport);

                    // Handle the request with the parsed body
                    await transport.handleRequest(req, res, parsedBody);
                    logger.debug("[happyMCP] Initialize request handled successfully");
                    return;
                } else {
                    // Invalid request - no session ID and not an initialize request
                    logger.debug("[happyMCP] Bad request: no session ID and not initialize");
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        jsonrpc: '2.0',
                        error: {
                            code: -32000,
                            message: 'Bad Request: No valid session ID provided'
                        },
                        id: null
                    }));
                    return;
                }

                // Handle the request with existing transport
                await transport.handleRequest(req, res, parsedBody);
                logger.debug("[happyMCP] Request handled successfully");
            } else if (req.method === 'GET' || req.method === 'DELETE') {
                // GET (SSE) and DELETE requests require a session ID
                if (!sessionId || !transports.has(sessionId)) {
                    logger.debug("[happyMCP] Bad request: invalid session for GET/DELETE");
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Invalid or missing session ID');
                    return;
                }

                const transport = transports.get(sessionId)!;
                await transport.handleRequest(req, res);
                logger.debug("[happyMCP] GET/DELETE request handled successfully");
            } else {
                res.writeHead(405, { 'Content-Type': 'text/plain' });
                res.end('Method not allowed');
            }
        } catch (error) {
            logger.debug("[happyMCP] Error handling request:", error);
            if (!res.headersSent) {
                res.writeHead(500).end();
            }
        }
    });

    const baseUrl = await new Promise<URL>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as AddressInfo;
            resolve(new URL(`http://127.0.0.1:${addr.port}`));
        });
    });

    logger.debug("[happyMCP] Server started at:", baseUrl.toString());

    return {
        url: baseUrl.toString(),
        toolNames,
        stop: async () => {
            logger.debug('[happyMCP] Stopping server');
            // Close all active transports
            for (const [sessionId, transport] of transports) {
                logger.debug('[happyMCP] Closing transport for session:', sessionId);
                try {
                    await transport.close();
                } catch (error) {
                    logger.debug('[happyMCP] Error closing transport:', error);
                }
            }
            transports.clear();
            server.close();
        }
    }
}

// Helper function to read request body
function readRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}
