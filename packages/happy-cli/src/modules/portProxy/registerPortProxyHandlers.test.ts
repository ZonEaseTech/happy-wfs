import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { registerPortProxyHandlers, isAllowedPortProxyHost, buildLocalProxyUrl } from './registerPortProxyHandlers';

describe('port proxy helpers', () => {
    it('allows only loopback hosts', () => {
        expect(isAllowedPortProxyHost('127.0.0.1')).toBe(true);
        expect(isAllowedPortProxyHost('localhost')).toBe(true);
        expect(isAllowedPortProxyHost('::1')).toBe(true);
        expect(isAllowedPortProxyHost('192.168.1.10')).toBe(false);
        expect(isAllowedPortProxyHost('example.com')).toBe(false);
    });

    it('builds an encoded local proxy URL', () => {
        const url = buildLocalProxyUrl({
            protocol: 'http',
            targetHost: '127.0.0.1',
            targetPort: 8080,
            path: '/a b',
            search: '?x=1',
        });

        expect(url).toBe('http://127.0.0.1:8080/a%20b?x=1');
    });
});

describe('registerPortProxyHandlers', () => {
    let closeServer: (() => Promise<void>) | null = null;

    afterEach(async () => {
        await closeServer?.();
        closeServer = null;
    });

    it('proxies an HTTP request and returns status, headers, and base64 body', async () => {
        const server = createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            request.on('end', () => {
                response.statusCode = 201;
                response.setHeader('content-type', 'application/json');
                response.setHeader('x-request-path', request.url || '');
                response.end(JSON.stringify({
                    method: request.method,
                    url: request.url,
                    body: Buffer.concat(chunks).toString('utf8'),
                }));
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        closeServer = () => new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Expected TCP server address');
        }

        const manager = new RpcHandlerManager({
            scopePrefix: 'machine-1',
            encryptionKey: new Uint8Array(32),
            encryptionVariant: 'legacy',
        });
        registerPortProxyHandlers(manager);

        const result = await manager.handleRequest({
            method: 'machine-1:port-proxy-http',
            params: {
                protocol: 'http',
                targetHost: '127.0.0.1',
                targetPort: address.port,
                method: 'POST',
                path: '/echo value',
                search: '?x=1',
                headers: { 'content-type': 'text/plain', 'x-test': 'yes' },
                bodyBase64: Buffer.from('hello proxy').toString('base64'),
            } as any,
        });

        expect(result.status).toBe(201);
        expect(result.headers['content-type']).toContain('application/json');
        expect(result.headers['x-request-path']).toBe('/echo%20value?x=1');
        expect(JSON.parse(Buffer.from(result.bodyBase64, 'base64').toString('utf8'))).toEqual({
            method: 'POST',
            url: '/echo%20value?x=1',
            body: 'hello proxy',
        });
    });

    it('requests identity encoding and strips stale compression headers', async () => {
        const responseText = 'readable gzip payload';
        const gzipped = gzipSync(responseText);
        const server = createServer((request, response) => {
            response.statusCode = request.headers['accept-encoding'] === 'identity' ? 200 : 418;
            response.setHeader('content-type', 'text/plain');
            response.setHeader('content-encoding', 'gzip');
            response.setHeader('content-length', String(gzipped.byteLength));
            response.end(gzipped);
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        closeServer = () => new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Expected TCP server address');
        }

        const manager = new RpcHandlerManager({
            scopePrefix: 'machine-1',
            encryptionKey: new Uint8Array(32),
            encryptionVariant: 'legacy',
        });
        registerPortProxyHandlers(manager);

        const result = await manager.handleRequest({
            method: 'machine-1:port-proxy-http',
            params: {
                protocol: 'http',
                targetHost: '127.0.0.1',
                targetPort: address.port,
                method: 'GET',
                path: '/',
                search: '',
                headers: { 'accept-encoding': 'gzip' },
                bodyBase64: '',
            } as any,
        });

        expect(result.status).toBe(200);
        expect(Buffer.from(result.bodyBase64, 'base64').toString('utf8')).toBe(responseText);
        expect(result.headers['content-encoding']).toBeUndefined();
        expect(result.headers['content-length']).toBeUndefined();
    });

    it('rejects non-loopback hosts and invalid ports', async () => {
        const manager = new RpcHandlerManager({
            scopePrefix: 'machine-1',
            encryptionKey: new Uint8Array(32),
            encryptionVariant: 'legacy',
        });
        registerPortProxyHandlers(manager);

        const baseRequest = {
            protocol: 'http',
            targetHost: '127.0.0.1',
            targetPort: 8080,
            method: 'GET',
            path: '/',
            search: '',
            headers: {},
            bodyBase64: '',
        };

        await expect(manager.handleRequest({
            method: 'machine-1:port-proxy-http',
            params: { ...baseRequest, targetHost: 'example.com' } as any,
        })).resolves.toEqual({ error: 'Port proxy target host must be loopback' });
        await expect(manager.handleRequest({
            method: 'machine-1:port-proxy-http',
            params: { ...baseRequest, targetPort: 70000 } as any,
        })).resolves.toEqual({ error: 'Port proxy target port must be an integer between 1 and 65535' });
    });
});
