import { Buffer } from 'node:buffer';
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import type { PortProxyHttpRequest, PortProxyHttpResponse, PortProxyProtocol } from './types';

const ALLOWED_PORT_PROXY_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const PORT_PROXY_MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const BODYLESS_METHODS = new Set(['GET', 'HEAD']);
const RESPONSE_HEADERS_TO_DROP = new Set(['content-encoding', 'content-length']);

type HeadersWithSetCookie = Headers & {
    getSetCookie?: () => string[];
    raw?: () => Record<string, string[]>;
};

type BuildLocalProxyUrlParams = {
    protocol: PortProxyProtocol;
    targetHost: string;
    targetPort: number;
    path: string;
    search: string;
};

export function isAllowedPortProxyHost(host: string): boolean {
    return ALLOWED_PORT_PROXY_HOSTS.has(host);
}

export function buildLocalProxyUrl(params: BuildLocalProxyUrlParams): string {
    const host = params.targetHost === '::1' ? '[::1]' : params.targetHost;
    const url = new URL(`${params.protocol}://${host}:${params.targetPort}`);
    url.pathname = params.path.startsWith('/') ? params.path : `/${params.path}`;
    url.search = params.search;
    return url.toString();
}

function assertPortProxyRequest(value: PortProxyHttpRequest): void {
    if (value.protocol !== 'http') {
        throw new Error('Unsupported port proxy protocol');
    }

    if (!isAllowedPortProxyHost(value.targetHost)) {
        throw new Error('Port proxy target host must be loopback');
    }

    if (!Number.isInteger(value.targetPort) || value.targetPort < 1 || value.targetPort > 65535) {
        throw new Error('Port proxy target port must be an integer between 1 and 65535');
    }

    if (typeof value.method !== 'string' || typeof value.path !== 'string' || typeof value.search !== 'string') {
        throw new Error('Invalid port proxy request');
    }
}

function buildFetchHeaders(headers: Record<string, string>): Record<string, string> {
    const fetchHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        if (name.toLowerCase() !== 'accept-encoding') {
            fetchHeaders[name] = value;
        }
    }
    fetchHeaders['accept-encoding'] = 'identity';
    return fetchHeaders;
}

function headersToRecord(headers: Headers): Record<string, string | string[]> {
    const record: Record<string, string | string[]> = {};
    headers.forEach((value, name) => {
        const normalizedName = name.toLowerCase();
        if (!RESPONSE_HEADERS_TO_DROP.has(normalizedName)) {
            record[normalizedName] = value;
        }
    });

    // Node's undici Headers exposes getSetCookie(); older/fetch-compatible
    // implementations may only expose a combined set-cookie value through
    // iteration, so preserve the array when the runtime makes it available.
    const nodeHeaders = headers as HeadersWithSetCookie;
    const setCookies = nodeHeaders.getSetCookie?.() ?? nodeHeaders.raw?.()['set-cookie'];
    if (setCookies && setCookies.length > 0) {
        record['set-cookie'] = setCookies;
    }

    return record;
}

async function readLimitedResponseBody(response: Response): Promise<Buffer> {
    if (!response.body) {
        return Buffer.alloc(0);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            return Buffer.concat(chunks, totalBytes);
        }

        totalBytes += value.byteLength;
        if (totalBytes > PORT_PROXY_MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error('Port proxy response exceeds 20MB limit');
        }

        chunks.push(value);
    }
}

export function registerPortProxyHandlers(manager: RpcHandlerManager): void {
    manager.registerHandler<PortProxyHttpRequest, PortProxyHttpResponse>('port-proxy-http', async (request) => {
        assertPortProxyRequest(request);

        const method = request.method.toUpperCase();
        const url = buildLocalProxyUrl(request);
        const response = await fetch(url, {
            method,
            headers: buildFetchHeaders(request.headers),
            body: BODYLESS_METHODS.has(method) ? undefined : Buffer.from(request.bodyBase64, 'base64'),
        });
        const body = await readLimitedResponseBody(response);

        return {
            status: response.status,
            headers: headersToRecord(response.headers),
            bodyBase64: body.toString('base64'),
        };
    });
}
