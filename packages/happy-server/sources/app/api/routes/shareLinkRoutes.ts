import { z } from "zod";
import { Fastify } from "../types";
import { db } from "@/storage/db";
import { isAllowedShareLinkUrl, shareLinkCreate } from "@/app/fileShare/shareLinkCreate";

export function shareLinkRoutes(app: Fastify) {
    app.post('/v1/share-links', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                url: z.string().url().max(2048),
                title: z.string().max(200).optional()
            }),
            response: {
                200: z.object({ code: z.string() }),
                400: z.object({ error: z.string() })
            }
        }
    }, async (request, reply) => {
        if (!isAllowedShareLinkUrl(request.body.url)) {
            return reply.status(400).send({ error: 'URL is not a shareable public HTML preview' });
        }
        const code = await shareLinkCreate(request.userId, request.body.url, request.body.title ?? null);
        return reply.send({ code });
    });

    app.get('/v1/share-links/:code', {
        schema: {
            params: z.object({
                code: z.string().min(4).max(32)
            }),
            response: {
                200: z.object({ url: z.string(), title: z.string().nullable() }),
                404: z.object({ error: z.string() })
            }
        }
    }, async (request, reply) => {
        const link = await db.publicShareLink.findUnique({
            where: { code: request.params.code }
        });
        if (!link) {
            return reply.status(404).send({ error: 'Share link not found' });
        }
        return reply.send({ url: link.url, title: link.title });
    });
}
