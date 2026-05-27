import type { FastifyReply, FastifyRequest } from 'fastify';
import { invokeUserRpc } from '@/app/api/socket/rpcRegistry';
import { db } from '@/storage/db';
import {
    PORT_PROXY_MAX_REQUEST_BYTES,
    PORT_PROXY_RPC_TIMEOUT_MS,
    type PortProxyHttpResponse,
} from './schemas';
import {
    filterProxyRequestHeaders,
    filterProxyResponseHeaders,
    fromBase64Body,
    toBase64Body,
} from './http';

function bodyToBytes(request: FastifyRequest): Uint8Array | undefined {
    const rawBody = (request as FastifyRequest & { rawBody?: string | Uint8Array }).rawBody;
    if (rawBody instanceof Uint8Array) {
        return rawBody;
    }

    if (typeof rawBody === 'string') {
        return new TextEncoder().encode(rawBody);
    }

    const body = request.body;
    if (body === undefined || body === null) {
        return undefined;
    }

    if (body instanceof Uint8Array) {
        return body;
    }

    if (typeof body === 'string') {
        return new TextEncoder().encode(body);
    }

    return undefined;
}

function getSearch(url: string): string {
    return new URL(url, 'http://port-proxy.local').search;
}

function getRelayPath(url: string, slug: string): string {
    const rawPath = url.split('?')[0] || '';
    const prefixes = [`/p/${slug}`, `/p/${encodeURIComponent(slug)}`];

    for (const prefix of prefixes) {
        if (rawPath === prefix) {
            return '/';
        }

        if (rawPath.startsWith(`${prefix}/`)) {
            return rawPath.slice(prefix.length);
        }
    }

    return '/';
}

function isTimeoutError(error: unknown): boolean {
    return error instanceof Error && /timeout|timed out/i.test(error.message);
}

export async function relayPortProxyRequest(
    request: FastifyRequest,
    reply: FastifyReply,
    slug: string,
    _path: string | undefined,
) {
    const userId = request.userId;
    if (!userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
    }

    const proxy = await db.portProxy.findFirst({
        where: { slug, accountId: userId, enabled: true, accessMode: 'private' },
    });

    if (!proxy) {
        return reply.code(404).send({ error: 'Port proxy not found' });
    }

    const body = bodyToBytes(request);
    if (body && body.byteLength > PORT_PROXY_MAX_REQUEST_BYTES) {
        return reply.code(413).send({ error: 'Request body too large' });
    }

    try {
        const response = await invokeUserRpc(userId, `${proxy.machineId}:port-proxy-http`, {
            method: request.method,
            path: getRelayPath(request.url, slug),
            search: getSearch(request.url),
            headers: filterProxyRequestHeaders(request.headers),
            bodyBase64: toBase64Body(body),
            targetHost: proxy.localHost,
            targetPort: proxy.localPort,
            protocol: 'http',
        }, PORT_PROXY_RPC_TIMEOUT_MS) as PortProxyHttpResponse;

        await db.portProxy.update({
            where: { id: proxy.id },
            data: { lastAccessedAt: new Date() },
        });

        const headers = filterProxyResponseHeaders(response.headers);
        for (const [name, value] of Object.entries(headers)) {
            reply.header(name, value);
        }

        return reply.code(response.status).send(fromBase64Body(response.bodyBase64));
    } catch (error) {
        return reply.code(isTimeoutError(error) ? 504 : 502).send({ error: 'Port proxy relay failed' });
    }
}
