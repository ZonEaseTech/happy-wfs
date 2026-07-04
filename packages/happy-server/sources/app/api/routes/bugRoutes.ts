import { z } from 'zod';
import { type Fastify } from '../types';
import { uploadBugImage } from '@/app/bugs/bugImageUpload';
import {
    addBugComment,
    changeBugStatus,
    createBugForOwner,
    createOrRotateBugShareConfig,
    getBugForOwner,
    getBugShareConfig,
    linkBugSession,
    listBugsForOwner,
    recordBugAttachment,
    softDeleteBugForOwner,
    updateBugContent,
} from '@/app/bugs/bugService';

const createBugBody = z.object({
    description: z.string().trim().min(1),
    contentJson: z.unknown().optional(),
    visibility: z.enum(['shared', 'private']).optional(),
});

const statusBody = z.object({
    status: z.enum(['pending', 'in_progress', 'verify', 'closed']),
    action: z.enum(['return_to_pending']).optional(),
});

const commentBody = z.object({
    body: z.string().trim().min(1),
});

const contentBody = z.object({
    description: z.string().trim().min(1),
    contentJson: z.unknown().nullable().optional(),
});

const shareBody = z.object({
    accessCode: z.string().trim().min(1).optional(),
}).optional();

function happyActor(userId: string) {
    return { userId, nickname: 'Happy 用户' };
}

function handleRouteError(reply: any, error: unknown) {
    const statusCode = typeof (error as any)?.statusCode === 'number' ? (error as any).statusCode : 500;
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(statusCode).send({ error: message });
}

function buildBugUrl(request: any): string {
    const origin = request.headers.origin || request.headers.referer?.replace(/\/[^/]*$/, '') || '';
    return origin ? `${String(origin).replace(/\/$/, '')}/bug` : '/bug';
}

export function bugRoutes(app: Fastify) {
    app.get('/v1/bugs', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                status: z.enum(['pending', 'in_progress', 'verify', 'closed']).optional(),
                query: z.string().optional(),
                limit: z.coerce.number().int().min(1).max(200).optional(),
            }).optional(),
        },
    }, async (request, reply) => {
        try {
            const result = await listBugsForOwner(request.userId, {
                status: request.query?.status,
                query: request.query?.query,
                limit: request.query?.limit,
            });
            return reply.send(result);
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.post('/v1/bugs', {
        preHandler: app.authenticate,
        schema: { body: createBugBody },
    }, async (request, reply) => {
        try {
            const bug = await createBugForOwner(request.userId, happyActor(request.userId), request.body);
            return reply.code(201).send({ bug });
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.get('/v1/bugs/:bugId', {
        preHandler: app.authenticate,
        schema: { params: z.object({ bugId: z.string() }) },
    }, async (request, reply) => {
        try {
            const bug = await getBugForOwner(request.userId, request.params.bugId);
            return reply.send({ bug });
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.delete('/v1/bugs/:bugId', {
        preHandler: app.authenticate,
        schema: { params: z.object({ bugId: z.string() }) },
    }, async (request, reply) => {
        try {
            await softDeleteBugForOwner(request.userId, request.params.bugId, happyActor(request.userId));
            return reply.send({ ok: true });
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.post('/v1/bugs/:bugId/comments', {
        preHandler: app.authenticate,
        schema: { params: z.object({ bugId: z.string() }), body: commentBody },
    }, async (request, reply) => {
        try {
            const result = await addBugComment(request.userId, request.params.bugId, happyActor(request.userId), request.body.body);
            return reply.code(201).send(result);
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.patch('/v1/bugs/:bugId/status', {
        preHandler: app.authenticate,
        schema: { params: z.object({ bugId: z.string() }), body: statusBody },
    }, async (request, reply) => {
        try {
            const bug = await changeBugStatus(request.userId, request.params.bugId, happyActor(request.userId), request.body);
            return reply.send({ bug });
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.patch('/v1/bugs/:bugId/content', {
        preHandler: app.authenticate,
        schema: { params: z.object({ bugId: z.string() }), body: contentBody },
    }, async (request, reply) => {
        try {
            const bug = await updateBugContent(request.userId, request.params.bugId, happyActor(request.userId), request.body);
            return reply.send({ bug });
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.post('/v1/bugs/:bugId/start-session', {
        preHandler: app.authenticate,
        schema: { params: z.object({ bugId: z.string() }), body: z.object({ sessionId: z.string().min(1) }) },
    }, async (request, reply) => {
        try {
            const bug = await linkBugSession(request.userId, request.params.bugId, request.body.sessionId, happyActor(request.userId));
            return reply.send({ bug });
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.post('/v1/bugs/:bugId/attachments', {
        preHandler: app.authenticate,
        schema: { params: z.object({ bugId: z.string() }) },
    }, async (request, reply) => {
        try {
            let fileBuffer: Buffer | null = null;
            let fileMimeType: string | null = null;
            let commentId: string | undefined;
            for await (const part of request.parts()) {
                if (part.type === 'file' && part.fieldname === 'file') {
                    fileBuffer = await part.toBuffer();
                    fileMimeType = part.mimetype;
                } else if (part.type === 'field' && part.fieldname === 'commentId') {
                    commentId = String(part.value || '').trim() || undefined;
                }
            }
            if (!fileBuffer) return reply.code(400).send({ error: 'No file uploaded' });
            const upload = await uploadBugImage({ ownerId: request.userId, bugId: request.params.bugId, imageBuffer: fileBuffer, mimeType: fileMimeType || 'image/jpeg', sizeBytes: fileBuffer.length });
            const bug = await recordBugAttachment(request.userId, request.params.bugId, happyActor(request.userId), { ...upload, commentId });
            return reply.code(201).send({ bug });
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.get('/v1/bugs/share-config', { preHandler: app.authenticate }, async (request, reply) => {
        try {
            const config = await getBugShareConfig(request.userId);
            if (!config) return reply.send({ shareConfig: null });
            return reply.send({
                shareConfig: {
                    enabled: config.enabled,
                    accessCode: config.accessCode ?? '',
                    version: config.accessCodeVersion,
                    url: buildBugUrl(request),
                    createdAt: config.createdAt.getTime(),
                    updatedAt: config.updatedAt.getTime(),
                },
            });
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.post('/v1/bugs/share-config', {
        preHandler: app.authenticate,
        schema: { body: shareBody },
    }, async (request, reply) => {
        try {
            const { config, accessCode } = await createOrRotateBugShareConfig(request.userId, request.body?.accessCode);
            return reply.send({ accessCode, url: buildBugUrl(request), version: config.accessCodeVersion });
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });
}
