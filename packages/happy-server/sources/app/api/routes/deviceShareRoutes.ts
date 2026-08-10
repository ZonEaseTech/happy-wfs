import { z } from "zod";
import { Fastify } from "../types";
import { deviceShareAddDevices, deviceShareCreate, deviceShareDevices, deviceShareExec, deviceShareList, deviceShareResolve, deviceShareRevoke } from "@/app/devices/deviceShare";

const JSONRPC_VERSION = '2.0';
const MCP_PROTOCOL_VERSION = '2025-06-18';

function rpcResult(id: unknown, result: unknown) {
    return { jsonrpc: JSONRPC_VERSION, id, result };
}

function rpcError(id: unknown, code: number, message: string) {
    return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } };
}

function bearerToken(request: { headers: Record<string, unknown> }): string | null {
    const header = request.headers['authorization'];
    if (typeof header !== 'string') return null;
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : null;
}

/**
 * Device sharing: owner-facing token management plus the hosted MCP endpoint
 * a grantee points their AI client at. The endpoint speaks the subset of MCP
 * that clients need over a single POST — initialize, tools/list, tools/call.
 */
export function deviceShareRoutes(app: Fastify) {
    app.post('/v1/devices/shares', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                devices: z.array(z.object({
                    machineId: z.string(),
                    deviceKey: z.string().min(1),
                })).min(1).max(50),
                label: z.string().max(120).optional(),
                expiresInDays: z.number().int().min(1).max(365).optional(),
            })
        }
    }, async (request, reply) => {
        try {
            const expiresAt = request.body.expiresInDays
                ? new Date(Date.now() + request.body.expiresInDays * 86400000)
                : null;
            const created = await deviceShareCreate(request.userId, {
                devices: request.body.devices,
                label: request.body.label ?? null,
                expiresAt,
            });
            return reply.code(201).send({ id: created.id, token: created.token });
        } catch (error) {
            const status = (error as any)?.statusCode ?? 500;
            return reply.code(status).send({ error: error instanceof Error ? error.message : 'Failed to create share' });
        }
    });

    app.get('/v1/devices/shares', { preHandler: app.authenticate }, async (request, reply) => {
        const shares = await deviceShareList(request.userId);
        return reply.send({
            shares: shares.map((share) => ({
                id: share.id,
                machineIds: Object.keys((share.deviceKeys ?? {}) as Record<string, string>),
                label: share.label,
                expiresAt: share.expiresAt?.getTime() ?? null,
                lastUsedAt: share.lastUsedAt?.getTime() ?? null,
                createdAt: share.createdAt.getTime(),
            }))
        });
    });

    app.patch('/v1/devices/shares/:id', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ id: z.string() }),
            body: z.object({
                devices: z.array(z.object({
                    machineId: z.string(),
                    deviceKey: z.string().min(1),
                })).min(1).max(50)
            })
        }
    }, async (request, reply) => {
        const updated = await deviceShareAddDevices(request.userId, request.params.id, request.body.devices);
        if (!updated) return reply.code(404).send({ error: 'Share not found' });
        return reply.send({ success: true });
    });

    app.delete('/v1/devices/shares/:id', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }) }
    }, async (request, reply) => {
        const revoked = await deviceShareRevoke(request.userId, request.params.id);
        if (!revoked) return reply.code(404).send({ error: 'Share not found' });
        return reply.send({ success: true });
    });

    app.post('/v1/mcp/device', async (request, reply) => {
        const token = bearerToken(request as any);
        if (!token) {
            return reply.code(401).send({ error: 'Missing bearer token' });
        }
        const grant = await deviceShareResolve(token);
        if (!grant) {
            return reply.code(401).send({ error: 'Invalid or expired token' });
        }

        const body = request.body as any;
        const id = body?.id ?? null;
        const method = body?.method;

        if (method === 'initialize') {
            return reply.send(rpcResult(id, {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: { tools: {} },
                serverInfo: { name: 'happy-device', version: '1.0.0' },
            }));
        }
        if (method === 'notifications/initialized') {
            return reply.code(202).send();
        }
        if (method === 'tools/list') {
            const granted = await deviceShareDevices(grant);
            return reply.send(rpcResult(id, {
                tools: [{
                    name: 'device_list',
                    description: `List the Happy devices this token can drive: ${granted.map((device) => device.name).join(', ') || 'none'}.`,
                    inputSchema: { type: 'object', properties: {} },
                }, {
                    name: 'device_exec',
                    description: 'Run a shell command on one of the shared Happy devices. Returns stdout, stderr and exit code.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            deviceId: { type: 'string', description: 'Target device id (see device_list). Optional when only one device is shared.' },
                            command: { type: 'string', description: 'Shell command to run' },
                            cwd: { type: 'string', description: 'Working directory' },
                            timeout: { type: 'number', description: 'Timeout in milliseconds (default 60000)' },
                        },
                        required: ['command'],
                    },
                }],
            }));
        }
        if (method === 'tools/call') {
            const name = body?.params?.name;
            if (name === 'device_list') {
                const granted = await deviceShareDevices(grant);
                const lines = granted.map((device) => `${device.id}  ${device.name}  [${device.active ? 'online' : 'offline'}]`);
                return reply.send(rpcResult(id, {
                    content: [{ type: 'text', text: lines.join('\n') || 'No devices in this share.' }],
                }));
            }
            if (name !== 'device_exec') {
                return reply.send(rpcError(id, -32602, `Unknown tool: ${name}`));
            }
            const args = body?.params?.arguments ?? {};
            const machineIds = [...grant.devices.keys()];
            const machineId = typeof args.deviceId === 'string' && args.deviceId
                ? args.deviceId
                : (machineIds.length === 1 ? machineIds[0] : null);
            if (!machineId) {
                return reply.send(rpcError(id, -32602, 'deviceId is required when the token covers several devices (see device_list)'));
            }
            if (typeof args.command !== 'string' || !args.command.trim()) {
                return reply.send(rpcError(id, -32602, 'command is required'));
            }
            try {
                const result = await deviceShareExec(grant, {
                    machineId,
                    command: args.command,
                    cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
                    timeout: typeof args.timeout === 'number' ? args.timeout : undefined,
                });
                const parts = [`exit code: ${result.exitCode}`];
                if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
                if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
                return reply.send(rpcResult(id, {
                    content: [{ type: 'text', text: parts.join('\n\n') }],
                    isError: !result.success,
                }));
            } catch (error) {
                return reply.send(rpcResult(id, {
                    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
                    isError: true,
                }));
            }
        }

        return reply.send(rpcError(id, -32601, `Method not found: ${method}`));
    });
}
