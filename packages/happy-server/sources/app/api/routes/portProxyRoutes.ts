import type { PortProxy } from '@prisma/client';
import { db } from '@/storage/db';
import { relayPortProxyRequest } from '@/app/portProxy/relay';
import { makePortProxySlug } from '@/app/portProxy/slug';
import {
    createPortProxyBodySchema,
    PORT_PROXY_MAX_REQUEST_BYTES,
    portProxyIdParamsSchema,
    portProxyRelayParamsSchema,
    updatePortProxyBodySchema,
} from '@/app/portProxy/schemas';
import { Fastify } from '../types';

function formatPortProxy(proxy: PortProxy) {
    return {
        id: proxy.id,
        machineId: proxy.machineId,
        name: proxy.name,
        localHost: proxy.localHost,
        localPort: proxy.localPort,
        protocol: proxy.protocol,
        slug: proxy.slug,
        enabled: proxy.enabled,
        accessMode: proxy.accessMode,
        lastAccessedAt: proxy.lastAccessedAt ? proxy.lastAccessedAt.getTime() : null,
        createdAt: proxy.createdAt.getTime(),
        updatedAt: proxy.updatedAt.getTime(),
    };
}

export function portProxyRoutes(app: Fastify) {
    app.get('/v1/port-proxies', {
        preHandler: app.authenticate,
    }, async (request) => {
        const userId = request.userId;

        const proxies = await db.portProxy.findMany({
            where: { accountId: userId },
            orderBy: { updatedAt: 'desc' },
        });

        return proxies.map(formatPortProxy);
    });

    app.post('/v1/port-proxies', {
        preHandler: app.authenticate,
        schema: {
            body: createPortProxyBodySchema,
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const body = request.body;

        const machine = await db.machine.findFirst({
            where: {
                id: body.machineId,
                accountId: userId,
            },
        });

        if (!machine) {
            return reply.code(404).send({ error: 'Machine not found' });
        }

        const proxy = await db.portProxy.create({
            data: {
                accountId: userId,
                machineId: body.machineId,
                name: body.name,
                localHost: body.localHost,
                localPort: body.localPort,
                protocol: body.protocol,
                slug: makePortProxySlug(),
                enabled: body.enabled,
                accessMode: 'private',
            },
        });

        return reply.code(201).send({ proxy: formatPortProxy(proxy) });
    });

    app.patch('/v1/port-proxies/:id', {
        preHandler: app.authenticate,
        schema: {
            params: portProxyIdParamsSchema,
            body: updatePortProxyBodySchema,
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;
        const body = request.body;

        const existingProxy = await db.portProxy.findFirst({
            where: {
                id,
                accountId: userId,
            },
        });

        if (!existingProxy) {
            return reply.code(404).send({ error: 'Port proxy not found' });
        }

        const proxy = await db.portProxy.update({
            where: { id },
            data: body,
        });

        return reply.send({ proxy: formatPortProxy(proxy) });
    });

    app.delete('/v1/port-proxies/:id', {
        preHandler: app.authenticate,
        schema: {
            params: portProxyIdParamsSchema,
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;

        const existingProxy = await db.portProxy.findFirst({
            where: {
                id,
                accountId: userId,
            },
        });

        if (!existingProxy) {
            return reply.code(404).send({ error: 'Port proxy not found' });
        }

        await db.portProxy.delete({
            where: { id },
        });

        return reply.send({ ok: true });
    });

    app.register(async (relayApp: Fastify) => {
        const rawBodyParser = (request: any, body: string | Buffer, done: (error: Error | null, body?: Buffer) => void) => {
            const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
            (request as typeof request & { rawBody?: Buffer }).rawBody = rawBody;
            done(null, rawBody);
        };
        const rawBodyParserOptions = {
            parseAs: 'buffer' as const,
            bodyLimit: PORT_PROXY_MAX_REQUEST_BYTES + 1,
        };

        // JSON is parsed by the parent application parser, which also stores request.rawBody.
        // The catch-all parser handles unknown proxy content-types without duplicating exact JSON.
        relayApp.addContentTypeParser(/^text\//, rawBodyParserOptions, rawBodyParser);
        relayApp.addContentTypeParser('application/octet-stream', rawBodyParserOptions, rawBodyParser);
        relayApp.addContentTypeParser('application/x-www-form-urlencoded', rawBodyParserOptions, rawBodyParser);
        relayApp.addContentTypeParser('*', rawBodyParserOptions, rawBodyParser);

        relayApp.all('/p/:slug/*', {
            preHandler: relayApp.authenticate,
            schema: {
                params: portProxyRelayParamsSchema,
            },
        }, async (request, reply) => {
            const { slug, '*': path } = request.params;
            return relayPortProxyRequest(request, reply, slug, path);
        });
    });
}
