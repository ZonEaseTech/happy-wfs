import { z } from 'zod';

export const PORT_PROXY_MAX_REQUEST_BYTES = 10 * 1024 * 1024;
export const PORT_PROXY_MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
export const PORT_PROXY_RPC_TIMEOUT_MS = 30_000;

export const portProxyHostSchema = z.enum(['127.0.0.1', 'localhost', '::1']);
export const portProxyProtocolSchema = z.enum(['http']);
export const portProxyAccessModeSchema = z.enum(['private']);

const machineId = z.string().min(1);

export const createPortProxyBodySchema = z.object({
    machineId,
    name: z.string().trim().min(1).max(80),
    localHost: portProxyHostSchema.default('127.0.0.1'),
    localPort: z.number().int().min(1).max(65535),
    protocol: portProxyProtocolSchema.default('http'),
    enabled: z.boolean().default(true),
});

export const updatePortProxyBodySchema = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    localHost: portProxyHostSchema.optional(),
    localPort: z.number().int().min(1).max(65535).optional(),
    enabled: z.boolean().optional(),
});

export const portProxyIdParamsSchema = z.object({ id: z.string().min(1) });
export const portProxyRelayParamsSchema = z.object({ slug: z.string().min(1), '*': z.string().optional() });

export type PortProxyHttpRequest = {
    method: string;
    path: string;
    search: string;
    headers: Record<string, string>;
    bodyBase64: string;
    targetHost: '127.0.0.1' | 'localhost' | '::1';
    targetPort: number;
    protocol: 'http';
};

export type PortProxyHttpResponse = {
    status: number;
    headers: Record<string, string | string[]>;
    bodyBase64: string;
};
