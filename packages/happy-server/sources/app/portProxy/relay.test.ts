import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { portProxyRoutes } from '@/app/api/routes/portProxyRoutes';
import { fromBase64Body } from './http';
import { relayPortProxyRequest } from './relay';
import { PORT_PROXY_RPC_TIMEOUT_MS } from './schemas';

const { invokeUserRpcMock, findFirstMock, updateMock } = vi.hoisted(() => ({
    invokeUserRpcMock: vi.fn(),
    findFirstMock: vi.fn(),
    updateMock: vi.fn(),
}));

vi.mock('@/app/api/socket/rpcRegistry', () => ({
    invokeUserRpc: invokeUserRpcMock,
}));

vi.mock('@/storage/db', () => ({
    db: {
        portProxy: {
            findFirst: findFirstMock,
            update: updateMock,
        },
    },
}));


function makeReply() {
    return {
        statusCode: undefined as number | undefined,
        headers: {} as Record<string, string | string[]>,
        sent: undefined as unknown,
        code(code: number) {
            this.statusCode = code;
            return this;
        },
        header(name: string, value: string | string[]) {
            this.headers[name] = value;
            return this;
        },
        send(value: unknown) {
            this.sent = value;
            return this;
        },
    };
}

describe('relayPortProxyRequest', () => {
    beforeEach(() => {
        invokeUserRpcMock.mockReset();
        findFirstMock.mockReset();
        updateMock.mockReset();
    });

    it('relays authenticated private proxy requests and preserves set-cookie values', async () => {
        findFirstMock.mockResolvedValue({
            id: 'proxy-1',
            machineId: 'machine-1',
            localHost: '127.0.0.1',
            localPort: 3000,
        });
        invokeUserRpcMock.mockResolvedValue({
            status: 201,
            headers: {
                'content-type': 'text/plain',
                'set-cookie': ['a=1', 'b=2'],
                connection: 'close',
            },
            bodyBase64: 'b2s=',
        });

        const reply = makeReply();
        await relayPortProxyRequest({
            userId: 'user-1',
            method: 'POST',
            url: '/p/dev/api/jobs?limit=2',
            headers: {
                host: 'proxy.test',
                'content-type': 'text/plain',
            },
            body: new Uint8Array([104, 105]),
        } as any, reply as any, 'dev', 'api/jobs');

        expect(findFirstMock).toHaveBeenCalledWith({
            where: { slug: 'dev', accountId: 'user-1', enabled: true, accessMode: 'private' },
        });
        expect(invokeUserRpcMock).toHaveBeenCalledWith('user-1', 'machine-1:port-proxy-http', {
            method: 'POST',
            path: '/api/jobs',
            search: '?limit=2',
            headers: { 'content-type': 'text/plain' },
            bodyBase64: 'aGk=',
            targetHost: '127.0.0.1',
            targetPort: 3000,
            protocol: 'http',
        }, PORT_PROXY_RPC_TIMEOUT_MS);
        expect(updateMock).toHaveBeenCalledWith({
            where: { id: 'proxy-1' },
            data: { lastAccessedAt: expect.any(Date) },
        });
        expect(reply.statusCode).toBe(201);
        expect(reply.headers).toEqual({
            'content-type': 'text/plain',
            'set-cookie': ['a=1', 'b=2'],
        });
        expect(Array.from(reply.sent as Uint8Array)).toEqual(Array.from(fromBase64Body('b2s=')));
    });



    it('preserves percent-encoding in relayed path and search', async () => {
        findFirstMock.mockResolvedValue({
            id: 'proxy-1',
            machineId: 'machine-1',
            localHost: '127.0.0.1',
            localPort: 3000,
        });
        invokeUserRpcMock.mockResolvedValue({
            status: 200,
            headers: {},
            bodyBase64: '',
        });

        const reply = makeReply();
        await relayPortProxyRequest({
            userId: 'user-1',
            method: 'GET',
            url: '/p/dev/a%2Fb%20c?q=x%2Fy',
            headers: {},
        } as any, reply as any, 'dev', 'a/b c');

        const payload = invokeUserRpcMock.mock.calls[0][2];
        expect(payload.path).toBe('/a%2Fb%20c');
        expect(payload.search).toBe('?q=x%2Fy');
    });

    it('uses raw JSON bytes instead of reserializing parsed body', async () => {
        findFirstMock.mockResolvedValue({
            id: 'proxy-1',
            machineId: 'machine-1',
            localHost: '127.0.0.1',
            localPort: 3000,
        });
        invokeUserRpcMock.mockResolvedValue({
            status: 200,
            headers: {},
            bodyBase64: '',
        });

        const rawJson = '{  "b": 2, "a": 1 }';
        const reply = makeReply();
        await relayPortProxyRequest({
            userId: 'user-1',
            method: 'POST',
            url: '/p/dev/json',
            headers: { 'content-type': 'application/json' },
            rawBody: new TextEncoder().encode(rawJson),
            body: { b: 2, a: 1 },
        } as any, reply as any, 'dev', 'json');

        const payload = invokeUserRpcMock.mock.calls[0][2];
        expect(new TextDecoder().decode(fromBase64Body(payload.bodyBase64))).toBe(rawJson);
    });


    it('relays unknown content-type bodies as raw bytes', async () => {
        findFirstMock.mockResolvedValue({
            id: 'proxy-1',
            machineId: 'machine-1',
            localHost: '127.0.0.1',
            localPort: 3000,
        });
        invokeUserRpcMock.mockResolvedValue({
            status: 200,
            headers: {},
            bodyBase64: '',
        });

        const app = fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.decorate('authenticate', async (request: any) => {
            request.userId = 'user-1';
        });
        app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
            (request as typeof request & { rawBody?: string }).rawBody = body as string;
            done(null, body ? JSON.parse(body as string) : undefined);
        });
        portProxyRoutes(app.withTypeProvider<ZodTypeProvider>() as any);

        await app.ready();
        const response = await app.inject({
            method: 'POST',
            url: '/p/dev/xml',
            headers: { 'content-type': 'application/xml' },
            payload: '<root id="1" />',
        });
        await app.close();

        expect(response.statusCode).toBe(200);
        const payload = invokeUserRpcMock.mock.calls[0][2];
        expect(payload.headers['content-type']).toBe('application/xml');
        expect(new TextDecoder().decode(fromBase64Body(payload.bodyBase64))).toBe('<root id="1" />');
    });

    it('rejects oversized request bodies before invoking RPC', async () => {
        findFirstMock.mockResolvedValue({
            id: 'proxy-1',
            machineId: 'machine-1',
            localHost: '127.0.0.1',
            localPort: 3000,
        });

        const reply = makeReply();
        await relayPortProxyRequest({
            userId: 'user-1',
            method: 'POST',
            url: '/p/dev/upload',
            headers: {},
            body: new Uint8Array(10 * 1024 * 1024 + 1),
        } as any, reply as any, 'dev', 'upload');

        expect(reply.statusCode).toBe(413);
        expect(invokeUserRpcMock).not.toHaveBeenCalled();
    });
});


describe('portProxyRoutes parser registration', () => {
    it('does not duplicate the parent application/json parser', async () => {
        const app = fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.decorate('authenticate', async () => undefined);
        app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
            (request as typeof request & { rawBody?: string }).rawBody = body as string;
            done(null, body ? JSON.parse(body as string) : undefined);
        });

        portProxyRoutes(app.withTypeProvider<ZodTypeProvider>() as any);

        await app.ready();
        await app.close();
    });
});
