import { describe, expect, it } from 'vitest';
import { buildMentionNotificationCard, isValidFeishuUserId } from './feishuAdapter';

describe('buildMentionNotificationCard', () => {
    it('builds one text notification with Happy mention names and truncates the note body to 500 chars', () => {
        const payload = buildMentionNotificationCard({
            actorName: 'Alice',
            recipients: [
                { username: 'youthqx', feishuUserId: null },
                { username: 'wfs', feishuUserId: null },
            ],
            sessionTitle: '支付问题排查',
            sessionUrl: 'https://happy.zonease.org/session/session-1',
            preview: 'x'.repeat(501),
        });

        expect(payload.msg_type).toBe('text');
        if (payload.msg_type !== 'text') {
            throw new Error('expected text payload');
        }
        const text = payload.content.text;
        expect(text).toContain('协作 @ 通知');
        expect(text).toContain('发起人：Alice');
        expect(text).toContain('被 @：@youthqx、@wfs');
        expect(text).toContain(`内容：${'x'.repeat(499)}…`);
        expect(text).not.toContain('x'.repeat(501));
        expect(text).toContain('https://happy.zonease.org/session/session-1');
    });

    it('renders a real <at> tag for recipients with a Feishu user id and falls back to plain text otherwise', () => {
        const payload = buildMentionNotificationCard({
            actorName: 'Alice',
            recipients: [
                { username: 'youthqx', feishuUserId: 'ou_abc123' },
                { username: 'wfs', feishuUserId: null },
            ],
            sessionTitle: null,
            sessionUrl: 'https://happy.zonease.org/session/session-1',
            preview: 'ping',
        });

        if (payload.msg_type !== 'text') {
            throw new Error('expected text payload');
        }
        expect(payload.content.text).toContain('<at user_id="ou_abc123">youthqx</at>、@wfs');
    });

    it('does not emit an <at> tag for ids that could break out of the tag or ping everyone', () => {
        const payload = buildMentionNotificationCard({
            actorName: null,
            recipients: [
                { username: 'evil', feishuUserId: 'all' },
                { username: 'evil2', feishuUserId: 'x"><at user_id="all' },
            ],
            sessionTitle: null,
            sessionUrl: 'https://happy.zonease.org/session/session-1',
            preview: 'ping',
        });

        if (payload.msg_type !== 'text') {
            throw new Error('expected text payload');
        }
        expect(payload.content.text).not.toContain('<at');
        expect(payload.content.text).toContain('@evil、@evil2');
    });
});

describe('isValidFeishuUserId', () => {
    it('accepts open_id and employee user_id shapes', () => {
        expect(isValidFeishuUserId('ou_84aad35d084aa403a838cf73ee18467')).toBe(true);
        expect(isValidFeishuUserId('3g46b1cd')).toBe(true);
    });

    it('rejects "all", markup characters, and empty/oversized values', () => {
        expect(isValidFeishuUserId('all')).toBe(false);
        expect(isValidFeishuUserId('ALL')).toBe(false);
        expect(isValidFeishuUserId('a"b')).toBe(false);
        expect(isValidFeishuUserId('<at>')).toBe(false);
        expect(isValidFeishuUserId('')).toBe(false);
        expect(isValidFeishuUserId('x'.repeat(65))).toBe(false);
    });
});
