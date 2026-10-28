import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, sendFeishuMessageMock } = vi.hoisted(() => ({
    dbMock: {
        bugReport: {
            findUnique: vi.fn(async () => null as unknown),
        },
        account: {
            findMany: vi.fn(async () => [] as unknown[]),
        },
        bugAttachment: {
            findMany: vi.fn(async () => [] as unknown[]),
            count: vi.fn(async () => 0),
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

import { countBugImageMarkers, notifyBugCommentToFeishu, notifyBugCommentWhenReady, onBugCommentImageAttached } from './bugCommentNotification';

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

describe('notifyBugCommentToFeishu with inline images', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.APP_URL = 'https://happy.zonease.org';
        delete process.env.FEISHU_MENTION_WEBHOOK_URL;
        delete process.env.FEISHU_MENTION_WEBHOOK_SECRET;
        dbMock.bugReport.findUnique.mockResolvedValue({
            displayNumber: 406, title: '复测', ownerId: 'owner-1', createdByUserId: null, createdByNickname: null, createdByUser: null,
        });
        dbMock.account.findMany.mockResolvedValue([{ id: 'owner-1', notificationConfig: { feishuMention: teamHook } }]);
    });

    it('leaves the image markers out of the preview', async () => {
        await notifyBugCommentToFeishu('bug-1', { userId: 'owner-1', nickname: 'wfs' }, '复测通过\n\n[[bug-image:1]]\n\n截图如上');

        const [, payload] = sendFeishuMessageMock.mock.calls[0] as any[];
        expect(payload.content.text).toContain('复测通过');
        expect(payload.content.text).toContain('截图如上');
        expect(payload.content.text).not.toContain('[[bug-image');
    });

    it('says [图片] when the comment is only images', async () => {
        await notifyBugCommentToFeishu('bug-1', { userId: 'owner-1', nickname: 'wfs' }, '[[bug-image:1]]\n\n[[bug-image:2]]');

        const [, payload] = sendFeishuMessageMock.mock.calls[0] as any[];
        expect(payload.content.text).toContain('[图片]');
        expect(payload.content.text).not.toContain('[[bug-image');
    });
});

describe('notifyBugCommentWhenReady', () => {
    const actor = { userId: 'owner-1', nickname: 'wfs' };
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        process.env.APP_URL = 'https://happy.zonease.org';
        delete process.env.FEISHU_MENTION_WEBHOOK_URL;
        dbMock.bugReport.findUnique.mockResolvedValue({
            displayNumber: 406, title: '复测', ownerId: 'owner-1', createdByUserId: null, createdByNickname: null, createdByUser: null,
        });
        dbMock.account.findMany.mockResolvedValue([{ id: 'owner-1', notificationConfig: { feishuMention: teamHook } }]);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('counts images by their highest marker', () => {
        expect(countBugImageMarkers('a [[bug-image:1]] b [[bug-image:3]]')).toBe(3);
        expect(countBugImageMarkers('no images')).toBe(0);
    });

    it('sends a text-only comment straight away', async () => {
        await notifyBugCommentWhenReady({ commentId: 'c-text', bugId: 'bug-1', actor, body: '复测通过' });
        expect(sendFeishuMessageMock).toHaveBeenCalledTimes(1);
    });

    it('waits for every image, then links them in upload order', async () => {
        await notifyBugCommentWhenReady({ commentId: 'c-2', bugId: 'bug-1', actor, body: '复测通过\n\n[[bug-image:1]]\n\n[[bug-image:2]]' });
        expect(sendFeishuMessageMock).not.toHaveBeenCalled();

        dbMock.bugAttachment.count.mockResolvedValueOnce(1);
        await onBugCommentImageAttached('c-2');
        expect(sendFeishuMessageMock).not.toHaveBeenCalled();

        dbMock.bugAttachment.count.mockResolvedValueOnce(2);
        dbMock.bugAttachment.findMany.mockResolvedValueOnce([{ url: 'https://files/a.png' }, { url: 'https://files/b.png' }]);
        await onBugCommentImageAttached('c-2');

        expect(sendFeishuMessageMock).toHaveBeenCalledTimes(1);
        const text = (sendFeishuMessageMock.mock.calls[0] as any[])[1].content.text as string;
        expect(text).toContain('图片 1：https://files/a.png');
        expect(text).toContain('图片 2：https://files/b.png');
        expect(text).not.toContain('[[bug-image');

        await onBugCommentImageAttached('c-2');
        expect(sendFeishuMessageMock).toHaveBeenCalledTimes(1);
    });

    it('sends with whatever arrived once the wait runs out', async () => {
        await notifyBugCommentWhenReady({ commentId: 'c-late', bugId: 'bug-1', actor, body: '[[bug-image:1]] [[bug-image:2]]' });
        dbMock.bugAttachment.findMany.mockResolvedValueOnce([{ url: 'https://files/only.png' }]);

        await vi.advanceTimersByTimeAsync(60_000);

        expect(sendFeishuMessageMock).toHaveBeenCalledTimes(1);
        const text = (sendFeishuMessageMock.mock.calls[0] as any[])[1].content.text as string;
        expect(text).toContain('图片 1：https://files/only.png');
    });
});
