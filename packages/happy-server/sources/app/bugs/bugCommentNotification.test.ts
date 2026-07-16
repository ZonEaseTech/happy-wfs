import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, sendFeishuMessageMock } = vi.hoisted(() => ({
    dbMock: {
        bugReport: {
            findUnique: vi.fn(async () => null as unknown),
        },
        account: {
            findMany: vi.fn(async () => [] as unknown[]),
        },
    },
    sendFeishuMessageMock: vi.fn(async () => undefined),
}));

vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/app/notifications/feishuAdapter', async () => {
    const actual = await vi.importActual<typeof import('@/app/notifications/feishuAdapter')>('@/app/notifications/feishuAdapter');
    return { ...actual, sendFeishuMessage: sendFeishuMessageMock };
});
vi.mock('@/utils/log', () => ({ warn: vi.fn() }));

import { notifyBugCommentToFeishu } from './bugCommentNotification';

const teamHook = { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/team', enabled: true };

describe('notifyBugCommentToFeishu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.APP_URL = 'https://happy.zonease.org';
        delete process.env.FEISHU_MENTION_WEBHOOK_URL;
        delete process.env.FEISHU_MENTION_WEBHOOK_SECRET;
        dbMock.bugReport.findUnique.mockResolvedValue({
            displayNumber: 21,
            title: '批量没有区分本店自建',
            ownerId: 'owner-1',
            createdByUserId: 'creator-1',
            createdByNickname: null,
            createdByUser: { username: 'youthqx' },
        });
    });

    it('sends one deduped card and pings the creator with a real <at>', async () => {
        dbMock.account.findMany.mockResolvedValue([
            { id: 'owner-1', notificationConfig: { feishuMention: teamHook } },
            { id: 'creator-1', notificationConfig: { feishuMention: teamHook, feishuUserId: 'ou_abc' } },
            { id: 'actor-1', notificationConfig: { feishuMention: teamHook } },
        ]);

        await notifyBugCommentToFeishu('bug-1', { userId: 'actor-1', nickname: 'wfs' }, '这个修复了吗？');

        expect(sendFeishuMessageMock).toHaveBeenCalledTimes(1);
        const [webhook, payload] = sendFeishuMessageMock.mock.calls[0] as any[];
        expect(webhook.url).toBe(teamHook.url);
        expect(payload.content.text).toContain('BUG-21 · 批量没有区分本店自建');
        expect(payload.content.text).toContain('评论人：wfs');
        expect(payload.content.text).toContain('<at user_id="ou_abc">youthqx</at>');
        expect(payload.content.text).toContain('这个修复了吗？');
        expect(payload.content.text).toContain('https://happy.zonease.org/bug');
    });

    it('does not ping the creator when they are the commenter', async () => {
        dbMock.account.findMany.mockResolvedValue([
            { id: 'owner-1', notificationConfig: { feishuMention: teamHook } },
            { id: 'creator-1', notificationConfig: { feishuUserId: 'ou_abc' } },
        ]);

        await notifyBugCommentToFeishu('bug-1', { userId: 'creator-1', nickname: 'youthqx' }, '补充说明');

        expect(sendFeishuMessageMock).toHaveBeenCalledTimes(1);
        const payload = (sendFeishuMessageMock.mock.calls[0] as any[])[1];
        expect(payload.content.text).not.toContain('<at');
        expect(payload.content.text).not.toContain('提醒：');
    });

    it('uses the server-wide webhook when configured, ignoring account configs', async () => {
        process.env.FEISHU_MENTION_WEBHOOK_URL = 'https://open.feishu.cn/open-apis/bot/v2/hook/global';
        dbMock.account.findMany.mockResolvedValue([
            { id: 'owner-1', notificationConfig: { feishuMention: teamHook } },
            { id: 'creator-1', notificationConfig: { feishuUserId: 'ou_abc' } },
        ]);

        await notifyBugCommentToFeishu('bug-1', { userId: 'actor-1', nickname: 'wfs' }, '全局通道');

        expect(sendFeishuMessageMock).toHaveBeenCalledTimes(1);
        const [webhook, payload] = sendFeishuMessageMock.mock.calls[0] as any[];
        expect(webhook.url).toBe('https://open.feishu.cn/open-apis/bot/v2/hook/global');
        expect(payload.content.text).toContain('<at user_id="ou_abc">youthqx</at>');
    });

    it('stays silent when nobody configured a mention webhook', async () => {
        dbMock.account.findMany.mockResolvedValue([
            { id: 'owner-1', notificationConfig: null },
            { id: 'creator-1', notificationConfig: null },
        ]);

        await notifyBugCommentToFeishu('bug-1', { nickname: '测试李' }, '路人评论');

        expect(sendFeishuMessageMock).not.toHaveBeenCalled();
    });
});
