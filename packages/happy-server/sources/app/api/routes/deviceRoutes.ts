import { z } from "zod";
import { Fastify } from "../types";
import { db } from "@/storage/db";
import { auth } from "@/app/auth/auth";
import { buildEnrollScript } from "@/app/devices/enrollScript";

const DEFAULT_PUBLIC_API_URL = 'https://api-happy.zonease.org';

const MAX_TOKEN_TTL_SECONDS = 60 * 60 * 24;
const DEFAULT_TOKEN_TTL_SECONDS = 60 * 15;

/**
 * Device enrollment: the app mints a one-time token "<lookupId>.<secret>",
 * keeps `secret` client-side, and stores the account key sealed to a keypair
 * derived from it. A machine running the installer redeems `lookupId` for an
 * API token plus that sealed blob, then opens it locally — so the server never
 * holds material that can decrypt the account.
 */
export function deviceRoutes(app: Fastify) {
    // Public installer. Served here (not as a static asset) so the baked-in
    // server URL always matches the deployment answering the request.
    app.get('/enroll.sh', async (request, reply) => {
        const apiUrl = (process.env.PUBLIC_API_URL || DEFAULT_PUBLIC_API_URL).replace(/\/+$/, '');
        const webappUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/+$/, '') : null;
        return reply
            .header('Content-Type', 'text/plain; charset=utf-8')
            .header('Cache-Control', 'no-store')
            .send(buildEnrollScript(apiUrl, webappUrl));
    });

    app.post('/v1/devices/enroll-tokens', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                lookupId: z.string().min(8).max(64),
                response: z.string().min(1).max(4096),
                label: z.string().max(120).optional(),
                ttlSeconds: z.number().int().min(60).max(MAX_TOKEN_TTL_SECONDS).optional()
            }),
            response: {
                200: z.object({ id: z.string(), expiresAt: z.number() }),
                409: z.object({ error: z.string() })
            }
        }
    }, async (request, reply) => {
        const expiresAt = new Date(Date.now() + (request.body.ttlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS) * 1000);
        const existing = await db.deviceEnrollToken.findUnique({ where: { lookupId: request.body.lookupId } });
        if (existing) {
            return reply.code(409).send({ error: 'Enrollment token already exists' });
        }
        const created = await db.deviceEnrollToken.create({
            data: {
                lookupId: request.body.lookupId,
                accountId: request.userId,
                response: request.body.response,
                label: request.body.label ?? null,
                expiresAt
            }
        });
        return reply.send({ id: created.id, expiresAt: created.expiresAt.getTime() });
    });

    app.get('/v1/devices/enroll-tokens', {
        preHandler: app.authenticate,
        schema: {
            response: {
                200: z.object({
                    tokens: z.array(z.object({
                        id: z.string(),
                        lookupId: z.string(),
                        label: z.string().nullable(),
                        expiresAt: z.number(),
                        usedAt: z.number().nullable(),
                        usedByMachineId: z.string().nullable(),
                        createdAt: z.number()
                    }))
                })
            }
        }
    }, async (request, reply) => {
        const tokens = await db.deviceEnrollToken.findMany({
            where: { accountId: request.userId },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        return reply.send({
            tokens: tokens.map((token) => ({
                id: token.id,
                lookupId: token.lookupId,
                label: token.label,
                expiresAt: token.expiresAt.getTime(),
                usedAt: token.usedAt?.getTime() ?? null,
                usedByMachineId: token.usedByMachineId,
                createdAt: token.createdAt.getTime()
            }))
        });
    });

    app.delete('/v1/devices/enroll-tokens/:id', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ id: z.string() }),
            response: { 200: z.object({ ok: z.boolean() }) }
        }
    }, async (request, reply) => {
        await db.deviceEnrollToken.deleteMany({
            where: { id: request.params.id, accountId: request.userId }
        });
        return reply.send({ ok: true });
    });

    // Public: the installer has only the token, no account credentials yet.
    app.post('/v1/devices/enroll', {
        config: {
            rateLimit: {
                max: 20,
                timeWindow: '1 minute'
            }
        },
        schema: {
            body: z.object({
                lookupId: z.string().min(8).max(64),
                machineId: z.string().max(200).optional()
            }),
            response: {
                200: z.object({ token: z.string(), response: z.string() }),
                404: z.object({ error: z.string() }),
                410: z.object({ error: z.string() })
            }
        }
    }, async (request, reply) => {
        const record = await db.deviceEnrollToken.findUnique({ where: { lookupId: request.body.lookupId } });
        if (!record) {
            return reply.code(404).send({ error: 'Enrollment token not found' });
        }
        if (record.usedAt) {
            return reply.code(410).send({ error: 'Enrollment token already used' });
        }
        if (record.expiresAt.getTime() < Date.now()) {
            return reply.code(410).send({ error: 'Enrollment token expired' });
        }

        // Claim atomically so two racing installers cannot both enroll.
        const claimed = await db.deviceEnrollToken.updateMany({
            where: { id: record.id, usedAt: null },
            data: { usedAt: new Date(), usedByMachineId: request.body.machineId ?? null }
        });
        if (claimed.count === 0) {
            return reply.code(410).send({ error: 'Enrollment token already used' });
        }

        const token = await auth.createToken(record.accountId);
        return reply.send({ token, response: record.response });
    });
}
