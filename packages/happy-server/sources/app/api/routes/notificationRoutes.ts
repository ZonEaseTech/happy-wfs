import { z } from 'zod';
import { type Fastify } from '../types';
import { db } from '@/storage/db';
import { warn } from '@/utils/log';
import {
    NotificationConfigSchema,
    FeishuWebhookConfigPublicSchema,
} from 'happy-wire';
import { sendFeishuMessage, buildTestCard, buildMentionTestCard } from '@/app/notifications/feishuAdapter';

const FeishuPutBody = z.object({
    url: z.string().url().nullable(),
    secret: z.string().nullable().optional(),
    enabled: z.boolean(),
});

type NotificationConfigKey = 'feishu' | 'feishuMention';

async function loadNotificationConfig(userId: string) {
    const account = await db.account.findUnique({
        where: { id: userId },
        select: { notificationConfig: true },
    });
    const parsed = NotificationConfigSchema.safeParse(account?.notificationConfig);
    return parsed.success ? parsed.data : {};
}

function toPublicFeishuConfig(config: Awaited<ReturnType<typeof loadNotificationConfig>>, key: NotificationConfigKey) {
    const f = config[key];
    return {
        url: f?.url ?? null,
        secret_set: !!f?.secret,
        enabled: !!f?.enabled,
        lastTestedAt: f?.lastTestedAt ?? null,
    };
}

async function saveFeishuConfig(
    userId: string,
    key: NotificationConfigKey,
    body: z.infer<typeof FeishuPutBody>,
) {
    const { url, secret, enabled } = body;
    const existing = await loadNotificationConfig(userId);
    const prev = existing[key];

    if (!url) {
        const next = { ...existing, [key]: undefined };
        await db.account.update({
            where: { id: userId },
            data: { notificationConfig: next as object },
        });
        return;
    }

    const next = {
        ...existing,
        [key]: {
            url,
            // null clears the secret; undefined keeps the existing one
            secret: secret === null ? undefined : secret ?? prev?.secret,
            enabled,
            lastTestedAt: prev?.lastTestedAt,
        },
    };
    await db.account.update({
        where: { id: userId },
        data: { notificationConfig: next as object },
    });
}

export function notificationRoutes(app: Fastify) {

    app.get('/v1/notifications/feishu', {
        schema: {
            response: {
                200: FeishuWebhookConfigPublicSchema,
            },
        },
        preHandler: app.authenticate,
    }, async (request) => {
        return toPublicFeishuConfig(await loadNotificationConfig(request.userId), 'feishu');
    });

    app.put('/v1/notifications/feishu', {
        schema: {
            body: FeishuPutBody,
            response: {
                200: z.object({ success: z.literal(true) }),
            },
        },
        preHandler: app.authenticate,
    }, async (request) => {
        await saveFeishuConfig(request.userId, 'feishu', request.body);
        return { success: true as const };
    });

    app.get('/v1/notifications/feishu/mention', {
        schema: {
            response: {
                200: FeishuWebhookConfigPublicSchema,
            },
        },
        preHandler: app.authenticate,
    }, async (request) => {
        return toPublicFeishuConfig(await loadNotificationConfig(request.userId), 'feishuMention');
    });

    app.put('/v1/notifications/feishu/mention', {
        schema: {
            body: FeishuPutBody,
            response: {
                200: z.object({ success: z.literal(true) }),
            },
        },
        preHandler: app.authenticate,
    }, async (request) => {
        await saveFeishuConfig(request.userId, 'feishuMention', request.body);
        return { success: true as const };
    });

    app.post('/v1/notifications/feishu/test', {
        schema: {
            response: {
                200: z.object({ success: z.literal(true) }),
                400: z.object({ error: z.string() }),
            },
        },
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;
        const account = await db.account.findUnique({
            where: { id: userId },
            select: { notificationConfig: true },
        });
        const parsed = NotificationConfigSchema.safeParse(account?.notificationConfig);
        const feishu = parsed.success ? parsed.data.feishu : undefined;
        if (!feishu?.url) {
            return reply.code(400).send({ error: 'feishu webhook not configured' });
        }
        try {
            await sendFeishuMessage(feishu, buildTestCard());
        } catch (err) {
            warn({ err, userId }, 'feishu test send failed');
            return reply.code(400).send({ error: err instanceof Error ? err.message : 'send failed' });
        }
        // mark lastTestedAt
        const next = { ...parsed.data!, feishu: { ...feishu, lastTestedAt: Date.now() } };
        await db.account.update({
            where: { id: userId },
            data: { notificationConfig: next as object },
        });
        return { success: true as const };
    });

    app.post('/v1/notifications/feishu/mention/test', {
        schema: {
            response: {
                200: z.object({ success: z.literal(true) }),
                400: z.object({ error: z.string() }),
            },
        },
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;
        const config = await loadNotificationConfig(userId);
        const feishuMention = config.feishuMention;
        if (!feishuMention?.url) {
            return reply.code(400).send({ error: 'feishu mention webhook not configured' });
        }
        try {
            await sendFeishuMessage(feishuMention, buildMentionTestCard());
        } catch (err) {
            warn({ err, userId }, 'feishu mention test send failed');
            return reply.code(400).send({ error: err instanceof Error ? err.message : 'send failed' });
        }
        const next = { ...config, feishuMention: { ...feishuMention, lastTestedAt: Date.now() } };
        await db.account.update({
            where: { id: userId },
            data: { notificationConfig: next as object },
        });
        return { success: true as const };
    });
}
