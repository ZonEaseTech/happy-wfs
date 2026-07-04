import { z } from 'zod';
import { type Fastify } from '../types';
import { uploadBugImage } from '@/app/bugs/bugImageUpload';
import { createBugShareToken, verifyBugShareToken, type BugShareTokenPayload } from '@/app/bugs/bugShareToken';
import {
    addBugComment,
    changeBugStatus,
    createBugForOwner,
    findBugShareConfigByAccessCode,
    getBugForOwner,
    getValidBugShareConfig,
    listBugsForOwner,
    recordBugAttachment,
    updateBugContent,
} from '@/app/bugs/bugService';

const loginBody = z.object({
    accessCode: z.string().trim().min(1),
    nickname: z.string().trim().min(1).max(40),
});
const createBody = z.object({
    description: z.string().trim().min(1),
    contentJson: z.unknown().optional(),
});
const contentBody = z.object({
    description: z.string().trim().min(1),
    contentJson: z.unknown().nullable().optional(),
});
const commentBody = z.object({ body: z.string().trim().min(1) });
const statusBody = z.object({
    status: z.enum(['pending', 'in_progress', 'verify', 'closed']),
    action: z.enum(['return_to_pending']).optional(),
});

function handleRouteError(reply: any, error: unknown) {
    const statusCode = typeof (error as any)?.statusCode === 'number' ? (error as any).statusCode : 500;
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(statusCode).send({ error: message });
}

async function getPublicContext(request: any, reply: any): Promise<BugShareTokenPayload | null> {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.code(401).send({ error: 'Missing bug share token' });
        return null;
    }
    const payload = verifyBugShareToken(authHeader.substring(7));
    if (!payload) {
        reply.code(401).send({ error: 'Invalid bug share token' });
        return null;
    }
    try {
        await getValidBugShareConfig(payload.configId, payload.version);
        return payload;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply.code(typeof (error as any)?.statusCode === 'number' ? (error as any).statusCode : 401).send({ error: message });
        return null;
    }
}

export function bugPublicRoutes(app: Fastify) {
    app.post('/v1/bug-share/login', {
        schema: { body: loginBody },
    }, async (request, reply) => {
        try {
            const config = await findBugShareConfigByAccessCode(request.body.accessCode);
            if (!config || !config.enabled) return reply.code(401).send({ error: 'Invalid access code' });
            const token = createBugShareToken({
                configId: config.id,
                ownerId: config.ownerId,
                nickname: request.body.nickname,
                version: config.accessCodeVersion,
            });
            return reply.send({ token, nickname: request.body.nickname });
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.get('/v1/bug-share/bugs', {
        schema: {
            querystring: z.object({
                status: z.enum(['pending', 'in_progress', 'verify', 'closed']).optional(),
                query: z.string().optional(),
                limit: z.coerce.number().int().min(1).max(200).optional(),
            }).optional(),
        },
    }, async (request, reply) => {
        const context = await getPublicContext(request, reply);
        if (!context) return;
        try {
            const result = await listBugsForOwner(context.ownerId, {
                status: request.query?.status,
                query: request.query?.query,
                limit: request.query?.limit,
                publicOnly: true,
            });
            return reply.send(result);
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.post('/v1/bug-share/bugs', {
        schema: { body: createBody },
    }, async (request, reply) => {
        const context = await getPublicContext(request, reply);
        if (!context) return;
        try {
            const bug = await createBugForOwner(context.ownerId, { nickname: context.nickname }, {
                description: request.body.description,
                ...(request.body.contentJson === undefined ? {} : { contentJson: request.body.contentJson }),
                visibility: 'shared',
            });
            return reply.code(201).send({ bug });
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.get('/v1/bug-share/bugs/:bugId', {
        schema: { params: z.object({ bugId: z.string() }) },
    }, async (request, reply) => {
        const context = await getPublicContext(request, reply);
        if (!context) return;
        try {
            const bug = await getBugForOwner(context.ownerId, request.params.bugId, { publicOnly: true });
            return reply.send({ bug });
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.post('/v1/bug-share/bugs/:bugId/comments', {
        schema: { params: z.object({ bugId: z.string() }), body: commentBody },
    }, async (request, reply) => {
        const context = await getPublicContext(request, reply);
        if (!context) return;
        try {
            const result = await addBugComment(context.ownerId, request.params.bugId, { nickname: context.nickname }, request.body.body, { publicOnly: true });
            return reply.code(201).send(result);
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.patch('/v1/bug-share/bugs/:bugId/status', {
        schema: { params: z.object({ bugId: z.string() }), body: statusBody },
    }, async (request, reply) => {
        const context = await getPublicContext(request, reply);
        if (!context) return;
        try {
            const bug = await changeBugStatus(context.ownerId, request.params.bugId, { nickname: context.nickname }, { ...request.body, publicOnly: true });
            return reply.send({ bug });
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.patch('/v1/bug-share/bugs/:bugId/content', {
        schema: { params: z.object({ bugId: z.string() }), body: contentBody },
    }, async (request, reply) => {
        const context = await getPublicContext(request, reply);
        if (!context) return;
        try {
            const bug = await updateBugContent(context.ownerId, request.params.bugId, { nickname: context.nickname }, {
                description: request.body.description,
                ...(request.body.contentJson === undefined ? {} : { contentJson: request.body.contentJson }),
                publicOnly: true,
            });
            return reply.send({ bug });
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });

    app.post('/v1/bug-share/bugs/:bugId/attachments', {
        schema: { params: z.object({ bugId: z.string() }) },
    }, async (request, reply) => {
        const context = await getPublicContext(request, reply);
        if (!context) return;
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
            const upload = await uploadBugImage({ ownerId: context.ownerId, bugId: request.params.bugId, imageBuffer: fileBuffer, mimeType: fileMimeType || 'image/jpeg', sizeBytes: fileBuffer.length });
            const bug = await recordBugAttachment(context.ownerId, request.params.bugId, { nickname: context.nickname }, { ...upload, commentId }, { publicOnly: true });
            return reply.code(201).send({ bug });
        } catch (error) {
            return handleRouteError(reply, error);
        }
    });
}
