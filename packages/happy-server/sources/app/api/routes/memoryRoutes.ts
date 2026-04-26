import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import {
    CreateMemoryRequestSchema,
    UpdateMemoryRequestSchema,
} from "happy-wire";

/**
 * REST API for user-scoped Memory rows. Used both by happy-app (CRUD) and
 * happy-cli (read-only on session start to inject into the system prompt).
 *
 * Limits — applied here rather than at DB level so we get clear errors:
 *   - max 100 memories per user (LIST returns all; older ones can be deleted
 *     manually if a user really wants more)
 *   - content max 8000 chars (Zod-enforced; longer entries should become
 *     reference docs, not memory)
 */
export function memoryRoutes(app: Fastify) {

    app.get('/v1/memory', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                limit: z.coerce.number().int().min(1).max(500).default(200),
            }).optional(),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const limit = request.query?.limit ?? 200;
        const memories = await db.memory.findMany({
            where: { accountId: userId },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
        return reply.send({
            memories: memories.map((m) => ({
                id: m.id,
                content: m.content,
                source: m.source as 'manual' | 'message-pin',
                sourceSessionId: m.sourceSessionId,
                sourceMessageId: m.sourceMessageId,
                createdAt: m.createdAt.getTime(),
                updatedAt: m.updatedAt.getTime(),
            })),
        });
    });

    app.post('/v1/memory', {
        preHandler: app.authenticate,
        schema: { body: CreateMemoryRequestSchema },
    }, async (request, reply) => {
        const userId = request.userId;
        const { content, source, sourceSessionId, sourceMessageId } = request.body;

        // Cap at 100 entries per user so the system prompt injection in cli
        // doesn't unboundedly grow over time.
        const count = await db.memory.count({ where: { accountId: userId } });
        if (count >= 100) {
            return reply.code(400).send({ error: 'memory_quota_exceeded', message: 'Memory quota of 100 entries reached. Delete older entries first.' });
        }

        const memory = await db.memory.create({
            data: {
                accountId: userId,
                content,
                source: source ?? 'manual',
                sourceSessionId: sourceSessionId ?? null,
                sourceMessageId: sourceMessageId ?? null,
            },
        });
        return reply.send({
            memory: {
                id: memory.id,
                content: memory.content,
                source: memory.source as 'manual' | 'message-pin',
                sourceSessionId: memory.sourceSessionId,
                sourceMessageId: memory.sourceMessageId,
                createdAt: memory.createdAt.getTime(),
                updatedAt: memory.updatedAt.getTime(),
            },
        });
    });

    app.patch('/v1/memory/:id', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ id: z.string() }),
            body: UpdateMemoryRequestSchema,
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;
        const { content } = request.body;

        const existing = await db.memory.findFirst({
            where: { id, accountId: userId },
        });
        if (!existing) {
            return reply.code(404).send({ error: 'memory_not_found' });
        }
        const updated = await db.memory.update({
            where: { id },
            data: { content },
        });
        return reply.send({
            memory: {
                id: updated.id,
                content: updated.content,
                source: updated.source as 'manual' | 'message-pin',
                sourceSessionId: updated.sourceSessionId,
                sourceMessageId: updated.sourceMessageId,
                createdAt: updated.createdAt.getTime(),
                updatedAt: updated.updatedAt.getTime(),
            },
        });
    });

    app.delete('/v1/memory/:id', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ id: z.string() }),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;
        const existing = await db.memory.findFirst({
            where: { id, accountId: userId },
        });
        if (!existing) {
            return reply.code(404).send({ error: 'memory_not_found' });
        }
        await db.memory.delete({ where: { id } });
        return reply.send({ success: true as const });
    });
}
