import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fastify } from '../types';

const { state, dbMock, sendFeishuMessageMock } = vi.hoisted(() => {
    const state = {
        notificationConfig: null as unknown,
        updatedNotificationConfig: null as unknown,
    };
    const dbMock = {
        account: {
            findUnique: vi.fn(async () => ({ notificationConfig: state.notificationConfig })),
            update: vi.fn(async (args: any) => {
                state.updatedNotificationConfig = args.data.notificationConfig;
                state.notificationConfig = args.data.notificationConfig;
                return { id: args.where.id };
            }),
        },
    };
    return {
        state,
        dbMock,
        sendFeishuMessageMock: vi.fn(async () => undefined),
    };
});

vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/app/notifications/feishuAdapter', async () => {
    const actual = await vi.importActual<typeof import('@/app/notifications/feishuAdapter')>('@/app/notifications/feishuAdapter');
    return {
        ...actual,
        sendFeishuMessage: sendFeishuMessageMock,
    };
});

import { notificationRoutes } from './notificationRoutes';

async function createApp(userId = 'user-1') {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate('authenticate', async (request: any) => {
        request.userId = userId;
    });
    notificationRoutes(typed);
    await typed.ready();
    return typed;
}

describe('notificationRoutes', () => {
    let app: Fastify;

    beforeEach(async () => {
        vi.clearAllMocks();
        state.notificationConfig = null;
        state.updatedNotificationConfig = null;
        app = await createApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it('GET /v1/notifications/feishu/mention returns only the collaboration mention Feishu config', async () => {
        state.notificationConfig = {
            feishu: { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/normal', enabled: true, secret: 'normal-secret' },
            feishuMention: { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/mention', enabled: true, secret: 'mention-secret', lastTestedAt: 1234 },
        };

        const res = await app.inject({ method: 'GET', url: '/v1/notifications/feishu/mention' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            url: 'https://open.feishu.cn/open-apis/bot/v2/hook/mention',
            enabled: true,
            secret_set: true,
            lastTestedAt: 1234,
        });
    });

    it('PUT /v1/notifications/feishu/mention preserves the normal Feishu config and existing mention secret', async () => {
        state.notificationConfig = {
            feishu: { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/normal', enabled: true, secret: 'normal-secret' },
            feishuMention: { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/old', enabled: false, secret: 'old-mention-secret', lastTestedAt: 1234 },
        };

        const res = await app.inject({
            method: 'PUT',
            url: '/v1/notifications/feishu/mention',
            payload: {
                url: 'https://open.feishu.cn/open-apis/bot/v2/hook/new',
                enabled: true,
            },
        });

        expect(res.statusCode).toBe(200);
        expect(state.updatedNotificationConfig).toEqual({
            feishu: { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/normal', enabled: true, secret: 'normal-secret' },
            feishuMention: { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/new', enabled: true, secret: 'old-mention-secret', lastTestedAt: 1234 },
        });
    });

    it('POST /v1/notifications/feishu/mention/test sends through the mention webhook only', async () => {
        state.notificationConfig = {
            feishu: { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/normal', enabled: true, secret: 'normal-secret' },
            feishuMention: { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/mention', enabled: true, secret: 'mention-secret' },
        };

        const res = await app.inject({ method: 'POST', url: '/v1/notifications/feishu/mention/test' });

        expect(res.statusCode).toBe(200);
        expect(sendFeishuMessageMock).toHaveBeenCalledTimes(1);
        expect(sendFeishuMessageMock).toHaveBeenCalledWith(
            { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/mention', enabled: true, secret: 'mention-secret' },
            expect.objectContaining({ msg_type: 'text' }),
        );
        expect((state.updatedNotificationConfig as any).feishu.lastTestedAt).toBeUndefined();
        expect((state.updatedNotificationConfig as any).feishuMention.lastTestedAt).toEqual(expect.any(Number));
    });
});
